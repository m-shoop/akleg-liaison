from __future__ import annotations

import json
import logging
from datetime import date as _date
from datetime import datetime as _datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.reporting.registry import ENTITY_TABLE, REPORTS, FieldDefinition, ReportDefinition
from app.schemas.report import FilterCondition, FilterGroup, ReportRequest, ReportResponse

logger = logging.getLogger(__name__)


class ReportValidationError(ValueError):
    pass


class ReportPermissionError(PermissionError):
    pass


def _coerce_param(value, field_type: str):
    """Convert string values to the Python types asyncpg expects for typed columns."""
    if field_type == "date" and isinstance(value, str):
        return _date.fromisoformat(value)
    if field_type == "datetime" and isinstance(value, str):
        return _datetime.fromisoformat(value)
    if field_type == "integer" and isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return value
    return value


def _build_condition(
    field_def: FieldDefinition,
    field_key: str,
    condition: FilterCondition,
    params: dict,
) -> str:
    if condition.op not in field_def.operators:
        raise ReportValidationError(
            f"Operator '{condition.op}' is not allowed for field '{field_key}'"
        )

    col = field_def.column
    base = f"p{len(params)}"
    op = condition.op

    ft = field_def.type

    if op == "equals":
        params[base] = _coerce_param(condition.value, ft)
        return f"{col} = :{base}"
    elif op == "contains":
        params[base] = f"%{condition.value}%"
        return f"{col} ILIKE :{base}"
    elif op == "starts_with":
        params[base] = f"{condition.value}%"
        return f"{col} ILIKE :{base}"
    elif op == "in":
        values = condition.value if isinstance(condition.value, list) else [condition.value]
        placeholders = []
        for i, v in enumerate(values):
            k = f"{base}_{i}"
            params[k] = _coerce_param(v, ft)
            placeholders.append(f":{k}")
        return f"{col} IN ({', '.join(placeholders)})"
    elif op == "between":
        values = condition.value if isinstance(condition.value, list) else [condition.value]
        if len(values) != 2:
            raise ReportValidationError(
                f"'between' requires exactly 2 values for '{field_key}'"
            )
        params[f"{base}_lo"] = _coerce_param(values[0], ft)
        params[f"{base}_hi"] = _coerce_param(values[1], ft)
        return f"{col} BETWEEN :{base}_lo AND :{base}_hi"
    elif op == "before":
        params[base] = _coerce_param(condition.value, ft)
        return f"{col} < :{base}"
    elif op == "after":
        params[base] = _coerce_param(condition.value, ft)
        return f"{col} > :{base}"
    elif op == "is_empty":
        return f"({col} IS NULL OR {col} = '')"
    elif op == "is_not_empty":
        return f"({col} IS NOT NULL AND {col} != '')"

    raise ReportValidationError(f"Unknown operator: '{op}'")


def _build_exists_shell(
    report: ReportDefinition,
    field_def: FieldDefinition,
    col_conditions: list[str],
) -> str:
    """
    Wrap one or more already-built column conditions inside an EXISTS subquery.

    For a direct join (no depends_on):
        EXISTS (SELECT 1 FROM table WHERE <join.on> AND <col1> AND <col2> …)

    For a chained join (depends_on → … → base):
        EXISTS (SELECT 1 FROM root_table JOIN leaf_table ON … WHERE root_fk AND <col1> AND …)
    """
    chain: list[str] = []
    key = field_def.join
    while key:
        chain.append(key)
        key = report.joins[key].depends_on

    root_key = chain[-1]
    root_jd = report.joins[root_key]
    root_table = ENTITY_TABLE[root_jd.entity]
    combined = " AND ".join(col_conditions)

    if len(chain) == 1:
        where_clause = root_jd.on
        for cond in root_jd.fixed_conditions:
            where_clause += f" AND {cond}"
        return f"EXISTS (SELECT 1 FROM {root_table} WHERE {where_clause} AND {combined})"

    join_parts: list[str] = []
    for join_key in reversed(chain[:-1]):
        jd = report.joins[join_key]
        table = ENTITY_TABLE[jd.entity]
        clause = f"JOIN {table} ON {jd.on}"
        for cond in jd.fixed_conditions:
            clause += f" AND {cond}"
        join_parts.append(clause)

    root_where = root_jd.on
    for cond in root_jd.fixed_conditions:
        root_where += f" AND {cond}"

    joins_sql = " ".join(join_parts)
    return f"EXISTS (SELECT 1 FROM {root_table} {joins_sql} WHERE {root_where} AND {combined})"


def _build_exists_condition(
    report: ReportDefinition,
    field_def: FieldDefinition,
    field_key: str,
    condition: FilterCondition,
    params: dict,
) -> str:
    col_condition = _build_condition(field_def, field_key, condition, params)
    return _build_exists_shell(report, field_def, [col_condition])


def _build_filter_group(
    report: ReportDefinition,
    group: FilterGroup,
    params: dict,
    user_permissions: frozenset[str],
) -> tuple[str, set[str]]:
    parts: list[str] = []
    required_joins: set[str] = set()

    # For AND groups, bucket exists-strategy conditions by join so they collapse
    # into a single correlated subquery per table. OR groups keep them independent
    # (each EXISTS is a separate bill-level predicate).
    exists_buckets: dict[str, list[tuple[FieldDefinition, FilterCondition]]] = {}
    deferred_exists: list[tuple[FieldDefinition, FilterCondition]] = []

    for condition in group.conditions:
        field_def = report.fields.get(condition.field)
        if field_def is None:
            raise ReportValidationError(f"Unknown field: '{condition.field}'")
        if not field_def.filterable:
            raise ReportValidationError(f"Field '{condition.field}' is not filterable")
        if (
            field_def.requires_permission
            and field_def.requires_permission not in user_permissions
        ):
            raise ReportPermissionError(
                f"Insufficient permissions for field '{condition.field}'"
            )

        if field_def.join and field_def.filter_strategy == "exists":
            if group.logic == "AND":
                exists_buckets.setdefault(field_def.join, []).append((field_def, condition))
            else:
                deferred_exists.append((field_def, condition))
        else:
            if field_def.join:
                required_joins.add(field_def.join)
            parts.append(_build_condition(field_def, condition.field, condition, params))

    # Emit one EXISTS per join bucket (all conditions for that table are correlated)
    for _join_key, field_conditions in exists_buckets.items():
        col_conditions = [
            _build_condition(fd, cond.field, cond, params)
            for fd, cond in field_conditions
        ]
        parts.append(_build_exists_shell(report, field_conditions[0][0], col_conditions))

    # OR-logic exists conditions stay as independent EXISTS clauses
    for field_def, condition in deferred_exists:
        parts.append(_build_exists_condition(report, field_def, condition.field, condition, params))

    for subgroup in group.groups:
        sub_sql, sub_joins = _build_filter_group(report, subgroup, params, user_permissions)
        required_joins |= sub_joins
        parts.append(f"({sub_sql})")

    if not parts:
        return "TRUE", required_joins

    return f" {group.logic} ".join(parts), required_joins


def _resolve_join_order(report: ReportDefinition, required: set[str]) -> list[str]:
    full: set[str] = set(required)
    changed = True
    while changed:
        changed = False
        for key in list(full):
            dep = report.joins[key].depends_on
            if dep and dep not in full:
                full.add(dep)
                changed = True

    ordered: list[str] = []
    remaining = set(full)
    while remaining:
        for key in sorted(remaining):
            dep = report.joins[key].depends_on
            if dep is None or dep in ordered:
                ordered.append(key)
                remaining.remove(key)
                break
        else:
            raise ReportValidationError("Circular dependency detected in report joins")
    return ordered


def _build_join_sql(report: ReportDefinition, join_keys: list[str]) -> str:
    parts = []
    for key in join_keys:
        jd = report.joins[key]
        table = ENTITY_TABLE[jd.entity]
        table_ref = f"{table} AS {jd.alias}" if jd.alias else table
        clause = f"{jd.join_type} JOIN {table_ref} ON {jd.on}"
        for cond in jd.fixed_conditions:
            clause += f" AND {cond}"
        parts.append(clause)
    return "\n".join(parts)


async def run_report(
    db: AsyncSession,
    request: ReportRequest,
    user_permissions: frozenset[str],
) -> ReportResponse:
    report = REPORTS.get(request.report)
    if report is None:
        raise ReportValidationError(f"Unknown report: '{request.report}'")

    columns = request.columns if request.columns else report.default_columns
    for col in columns:
        field = report.fields.get(col)
        if field is None:
            raise ReportValidationError(f"Unknown column: '{col}'")
        if not field.selectable:
            raise ReportValidationError(f"Column '{col}' is not selectable")
        if field.requires_permission and field.requires_permission not in user_permissions:
            raise ReportPermissionError(f"Insufficient permissions for column '{col}'")

    params: dict = {}
    where_sql, filter_joins = _build_filter_group(
        report, request.filters, params, user_permissions
    )
    if report.base_conditions:
        base_sql = " AND ".join(report.base_conditions)
        where_sql = f"{base_sql} AND ({where_sql})" if where_sql != "TRUE" else base_sql

    missing_security_sql = [
        sf.fallback_sql
        for sf in report.security_filters
        if sf.requires_permission not in user_permissions
    ]
    if missing_security_sql:
        security_sql = " AND ".join(missing_security_sql)
        where_sql = f"{security_sql} AND ({where_sql})" if where_sql != "TRUE" else security_sql

    sort_fields: list[FieldDefinition] = []
    for sort_key in request.sort_by:
        sf = report.fields.get(sort_key)
        if sf is None:
            raise ReportValidationError(f"Unknown sort field: '{sort_key}'")
        if sf.aggregate:
            raise ReportValidationError(f"Cannot sort by aggregate field '{sort_key}'")
        sort_fields.append(sf)

    required_joins: set[str] = set(filter_joins)
    for col in columns:
        field = report.fields[col]
        if field.join:
            required_joins.add(field.join)
    for sf in sort_fields:
        if sf.join:
            required_joins.add(sf.join)

    join_keys = _resolve_join_order(report, required_joins)
    join_sql = _build_join_sql(report, join_keys)
    base_table = ENTITY_TABLE[report.base_entity]

    has_aggregates = any(report.fields[c].aggregate for c in columns)
    select_exprs = ", ".join(
        f"{report.fields[c].aggregate} AS {c}" if report.fields[c].aggregate
        else f"{report.fields[c].column} AS {c}"
        for c in columns
    )

    if has_aggregates:
        non_agg_exprs = [
            report.fields[c].column for c in columns if not report.fields[c].aggregate
        ]
        group_by_cols = list(dict.fromkeys([f"{base_table}.id"] + non_agg_exprs))
        group_by_clause = "GROUP BY " + ", ".join(group_by_cols)
    else:
        group_by_clause = ""

    if sort_fields:
        sort_dir_sql = "DESC" if request.sort_dir == "desc" else "ASC"
        order_by_clause = "ORDER BY " + ", ".join(f"{sf.column} {sort_dir_sql}" for sf in sort_fields)
    else:
        order_by_clause = ""

    query = text(
        f"SELECT {select_exprs}"
        f" FROM {base_table}"
        f" {join_sql}"
        f" WHERE {where_sql}"
        f" {group_by_clause}"
        f" {order_by_clause}"
        f" LIMIT :_limit OFFSET :_offset"
    )
    count_query = text(
        f"SELECT COUNT(DISTINCT {base_table}.id)"
        f" FROM {base_table}"
        f" {join_sql}"
        f" WHERE {where_sql}"
    )

    params["_limit"] = request.page_size
    params["_offset"] = (request.page - 1) * request.page_size
    count_params = {k: v for k, v in params.items() if not k.startswith("_")}

    result = await db.execute(query, params)
    rows = []
    for raw_row in result.fetchall():
        row = dict(zip(columns, raw_row))
        for col in columns:
            if report.fields[col].type == "json_array" and isinstance(row.get(col), str):
                try:
                    row[col] = json.loads(row[col])
                except (json.JSONDecodeError, TypeError):
                    row[col] = []
        rows.append(row)

    count_result = await db.execute(count_query, count_params)
    total = count_result.scalar() or 0

    return ReportResponse(
        report=request.report,
        columns=columns,
        rows=rows,
        total=total,
        page=request.page,
        page_size=request.page_size,
    )

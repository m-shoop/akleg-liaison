import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.reporting.query_builder import ReportPermissionError, ReportValidationError, run_report
from app.reporting.registry import REPORTS
from app.schemas.report import (
    FieldMeta,
    ReportMeta,
    ReportRequest,
    ReportResponse,
    ReportsListResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])


async def _resolve_enum_options(db: AsyncSession, enum_source: dict | str | list | None) -> list | None:
    if enum_source is None:
        return None
    if isinstance(enum_source, list):
        return enum_source
    if isinstance(enum_source, str):
        result = await db.execute(text(enum_source))
        return [row[0] for row in result.fetchall()]
    table = enum_source["table"]
    value_col = enum_source["value_col"]
    result = await db.execute(
        text(
            f"SELECT DISTINCT {value_col} FROM {table}"
            f" WHERE {value_col} IS NOT NULL ORDER BY {value_col}"
        )
    )
    return [row[0] for row in result.fetchall()]


@router.get("", response_model=ReportsListResponse)
async def list_reports(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReportsListResponse:
    """Return all available reports with field metadata for client tooling."""
    report_metas = []
    for report_id, report_def in REPORTS.items():
        fields: dict[str, FieldMeta] = {}
        for field_key, field_def in report_def.fields.items():
            if (
                field_def.requires_permission
                and not current_user.can(field_def.requires_permission)
            ):
                continue
            fields[field_key] = FieldMeta(
                label=field_def.label,
                type=field_def.type,
                filter_tier=field_def.filter_tier,
                filter_group=field_def.filter_group,
                operators=field_def.operators,
                filterable=field_def.filterable,
                selectable=field_def.selectable,
                render_as=field_def.render_as,
                link_template=field_def.link_template,
                enum_options=await _resolve_enum_options(db, field_def.enum_source),
            )
        report_metas.append(
            ReportMeta(
                id=report_id,
                label=report_def.label,
                fields=fields,
                default_columns=report_def.default_columns,
            )
        )
    return ReportsListResponse(reports=report_metas)


@router.post("/{report_id}", response_model=ReportResponse)
async def run_report_route(
    report_id: str,
    body: ReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReportResponse:
    """Execute a report with the given filter criteria and column selection."""
    request = body.model_copy(update={"report": report_id})
    try:
        return await run_report(db, request, current_user.permissions)
    except ReportPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ReportValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        logger.exception("Unexpected error running report '%s'", report_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Report execution failed",
        )

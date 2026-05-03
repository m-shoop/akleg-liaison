from __future__ import annotations

from sqlalchemy import and_, case, delete, false, nulls_last, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.saved_report import (
    DefaultUserReport,
    PublicationLevel,
    SavedReport,
    UserReportOrder,
)
from app.models.user import Role

# Admin satisfies any role gate. This is enforced in two places (the SQL
# visibility clause and the per-row check); the rejection of "admin" in
# allowed_roles input lives in the router's _validate_role_names.
ADMIN_ROLE = "admin"


def _visibility_clause(user_id: int, user_roles: frozenset[str]):
    """Rows the caller may see: their own user-level rows, plus system-level
    rows. Admins see every system-level row by bypass; non-admins see a row
    only if their roles overlap its allowed_roles. An empty allowed_roles
    means admin-only (no non-admin role can pass)."""
    own_user_rows = and_(
        SavedReport.publication_level == PublicationLevel.user,
        SavedReport.user_id == user_id,
    )
    if ADMIN_ROLE in user_roles:
        system_rows = SavedReport.publication_level == PublicationLevel.system
    elif user_roles:
        system_rows = and_(
            SavedReport.publication_level == PublicationLevel.system,
            SavedReport.allowed_roles.overlap(list(user_roles)),
        )
    else:
        system_rows = false()
    return or_(own_user_rows, system_rows)


async def list_visible_reports(
    session: AsyncSession,
    *,
    user_id: int,
    user_roles: frozenset[str],
    registry_name: str,
    include_inactive: bool,
) -> list[tuple[SavedReport, float | None]]:
    """Return reports visible to the caller along with each one's per-user
    sort_key (None when unranked).  Ordering matches what the UI renders:
    system section first, user section second; within each section by
    sort_key (NULLS LAST), tiebroken by display_name."""
    section_rank = case(
        (SavedReport.publication_level == PublicationLevel.system, 0),
        else_=1,
    )
    stmt = (
        select(SavedReport, UserReportOrder.sort_key)
        .outerjoin(
            UserReportOrder,
            and_(
                UserReportOrder.report_id == SavedReport.id,
                UserReportOrder.user_id == user_id,
            ),
        )
        .where(
            SavedReport.registry_name == registry_name,
            _visibility_clause(user_id, user_roles),
        )
    )
    if not include_inactive:
        stmt = stmt.where(SavedReport.is_active.is_(True))
    stmt = stmt.order_by(
        section_rank,
        nulls_last(UserReportOrder.sort_key.asc()),
        SavedReport.display_name,
    )
    result = await session.execute(stmt)
    return [(row[0], row[1]) for row in result.all()]


# ---------------------------------------------------------------------------
# Per-user ordering
# ---------------------------------------------------------------------------

# Step used when extending past either edge of the section.  Mid-list
# inserts halve the gap between neighbours, so it shrinks geometrically —
# fine for typical reorder counts; the router compacts when the gap gets
# too small to halve safely.
_EDGE_STEP = 1.0
# Below this gap, halving would lose precision in float64 mantissa once
# multiple adjacent inserts stack up.  When we hit this we rebalance the
# whole section to integer keys before inserting.
_MIN_GAP = 1e-6


async def _get_section_orders(
    session: AsyncSession,
    *,
    user_id: int,
    registry_name: str,
    publication_level: PublicationLevel,
    user_roles: frozenset[str],
) -> list[tuple[SavedReport, float | None]]:
    rows = await list_visible_reports(
        session,
        user_id=user_id,
        user_roles=user_roles,
        registry_name=registry_name,
        include_inactive=True,
    )
    return [(r, k) for (r, k) in rows if r.publication_level == publication_level]


async def _upsert_sort_key(
    session: AsyncSession, *, user_id: int, report_id: int, sort_key: float
) -> None:
    existing = await session.execute(
        select(UserReportOrder).where(
            UserReportOrder.user_id == user_id,
            UserReportOrder.report_id == report_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row is None:
        session.add(
            UserReportOrder(user_id=user_id, report_id=report_id, sort_key=sort_key)
        )
    else:
        row.sort_key = sort_key
    await session.flush()


async def _rebalance_section(
    session: AsyncSession,
    *,
    user_id: int,
    section: list[tuple[SavedReport, float | None]],
) -> dict[int, float]:
    """Assign integer sort_keys 0, 1, 2, ... to every report in the section
    in their currently-rendered order.  Returns the new key for each report
    by id.  Used both for Sort Alphabetically (after re-sorting `section`)
    and as a backstop when fractional gaps grow too small to halve."""
    new_keys: dict[int, float] = {}
    for index, (report, _) in enumerate(section):
        key = float(index)
        new_keys[report.id] = key
        await _upsert_sort_key(
            session, user_id=user_id, report_id=report.id, sort_key=key
        )
    return new_keys


async def reorder_report(
    session: AsyncSession,
    *,
    user_id: int,
    user_roles: frozenset[str],
    report: SavedReport,
    after_id: int | None,
    before_id: int | None,
) -> None:
    """Move `report` so it sits between `after_id` (above) and `before_id`
    (below) within its section.  Rebalances when the gap shrinks past float
    precision."""
    section = await _get_section_orders(
        session,
        user_id=user_id,
        registry_name=report.registry_name,
        publication_level=report.publication_level,
        user_roles=user_roles,
    )
    keys: dict[int, float | None] = {r.id: k for (r, k) in section}

    # Unranked rows in the section get integer keys based on current order
    # before we compute a midpoint — otherwise the midpoint formula has no
    # numbers to work with.
    if any(k is None for k in keys.values()):
        keys = await _rebalance_section(session, user_id=user_id, section=section)

    after_key = keys.get(after_id) if after_id is not None else None
    before_key = keys.get(before_id) if before_id is not None else None

    if after_key is None and before_key is None:
        new_key = 0.0
    elif before_key is None:
        new_key = after_key + _EDGE_STEP  # type: ignore[operator]
    elif after_key is None:
        new_key = before_key - _EDGE_STEP
    else:
        gap = before_key - after_key
        if gap < _MIN_GAP:
            # Compact and try once more with the rebalanced keys.
            keys = await _rebalance_section(session, user_id=user_id, section=section)
            after_key = keys[after_id] if after_id is not None else None
            before_key = keys[before_id] if before_id is not None else None
            new_key = (after_key + before_key) / 2.0  # type: ignore[operator]
        else:
            new_key = (after_key + before_key) / 2.0

    await _upsert_sort_key(
        session, user_id=user_id, report_id=report.id, sort_key=new_key
    )


async def sort_reports_alphabetically(
    session: AsyncSession,
    *,
    user_id: int,
    user_roles: frozenset[str],
    registry_name: str,
) -> None:
    """Assign integer sort_keys to every visible report (both sections,
    independently), in display_name order.  Inactive reports are included
    so that toggling Include Inactive doesn't reveal a stale order."""
    rows = await list_visible_reports(
        session,
        user_id=user_id,
        user_roles=user_roles,
        registry_name=registry_name,
        include_inactive=True,
    )
    for level in (PublicationLevel.system, PublicationLevel.user):
        section = sorted(
            [(r, k) for (r, k) in rows if r.publication_level == level],
            key=lambda pair: pair[0].display_name.lower(),
        )
        await _rebalance_section(session, user_id=user_id, section=section)


async def get_report_by_id(session: AsyncSession, report_id: int) -> SavedReport | None:
    result = await session.execute(select(SavedReport).where(SavedReport.id == report_id))
    return result.scalar_one_or_none()


async def is_report_visible_to(
    session: AsyncSession,
    report: SavedReport,
    *,
    user_id: int,
    user_roles: frozenset[str],
) -> bool:
    if report.publication_level == PublicationLevel.user:
        return report.user_id == user_id
    # system-level: admins bypass; otherwise the caller needs a role overlap.
    # Empty allowed_roles is admin-only — no non-admin can pass.
    if ADMIN_ROLE in user_roles:
        return True
    return any(r in user_roles for r in report.allowed_roles)


async def create_saved_report(
    session: AsyncSession,
    *,
    display_name: str,
    registry_name: str,
    publication_level: PublicationLevel,
    user_id: int | None,
    allowed_roles: list[str],
    report_criteria: dict,
) -> SavedReport:
    report = SavedReport(
        display_name=display_name,
        registry_name=registry_name,
        publication_level=publication_level,
        user_id=user_id,
        allowed_roles=allowed_roles,
        report_criteria=report_criteria,
    )
    session.add(report)
    await session.flush()
    return report


async def update_saved_report(
    session: AsyncSession,
    report: SavedReport,
    *,
    display_name: str | None = None,
    report_criteria: dict | None = None,
    is_active: bool | None = None,
    allowed_roles: list[str] | None = None,
) -> SavedReport:
    if display_name is not None:
        report.display_name = display_name
    if report_criteria is not None:
        report.report_criteria = report_criteria
    if is_active is not None:
        if report.is_active and not is_active:
            # Deactivation cascades: any user who had this as their default
            # for the registry loses that default rather than carrying a
            # pointer to an unrunnable report.
            await session.execute(
                delete(DefaultUserReport).where(DefaultUserReport.report_id == report.id)
            )
        report.is_active = is_active
    if allowed_roles is not None:
        report.allowed_roles = allowed_roles
    await session.flush()
    return report


async def get_default_report(
    session: AsyncSession, user_id: int, registry_name: str
) -> DefaultUserReport | None:
    result = await session.execute(
        select(DefaultUserReport).where(
            DefaultUserReport.user_id == user_id,
            DefaultUserReport.registry_name == registry_name,
        )
    )
    return result.scalar_one_or_none()


async def set_default_report(
    session: AsyncSession, user_id: int, registry_name: str, report_id: int
) -> None:
    """Upsert a default report through the ORM so the session's identity map
    stays consistent with the DB row."""
    existing = await get_default_report(session, user_id, registry_name)
    if existing is None:
        session.add(DefaultUserReport(
            user_id=user_id, registry_name=registry_name, report_id=report_id,
        ))
    else:
        existing.report_id = report_id
    await session.flush()


async def clear_default_report(
    session: AsyncSession, user_id: int, registry_name: str
) -> None:
    await session.execute(
        delete(DefaultUserReport).where(
            DefaultUserReport.user_id == user_id,
            DefaultUserReport.registry_name == registry_name,
        )
    )


async def list_roles(session: AsyncSession) -> list[Role]:
    result = await session.execute(select(Role).order_by(Role.name))
    return list(result.scalars().all())


async def get_existing_role_names(
    session: AsyncSession, names: list[str]
) -> set[str]:
    if not names:
        return set()
    result = await session.execute(
        select(Role.name).where(Role.name.in_(names))
    )
    return {row[0] for row in result.fetchall()}

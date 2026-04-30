from __future__ import annotations

from sqlalchemy import and_, delete, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.saved_report import DefaultUserReport, PublicationLevel, SavedReport
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
) -> list[SavedReport]:
    stmt = select(SavedReport).where(
        SavedReport.registry_name == registry_name,
        _visibility_clause(user_id, user_roles),
    )
    if not include_inactive:
        stmt = stmt.where(SavedReport.is_active.is_(True))
    stmt = stmt.order_by(SavedReport.publication_level, SavedReport.display_name)
    result = await session.execute(stmt)
    return list(result.scalars().all())


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

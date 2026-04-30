"""Data access for user_comm_prefs and user_comm_prefs_history.

Lazy-creation pattern: a missing row means "use the default (TRUE)" — see
get_email_enabled() and the COALESCE in the design doc. The history table is
append-only; we never UPDATE or DELETE history rows."""

from datetime import datetime, timezone

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email import UserCommPrefs, UserCommPrefsHistory


_FIELD_EMAIL_ENABLED = "email_enabled"
DEFAULT_EMAIL_ENABLED = True


async def get_prefs(db: AsyncSession, user_id: int) -> UserCommPrefs | None:
    result = await db.execute(
        select(UserCommPrefs).where(UserCommPrefs.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def get_email_enabled(db: AsyncSession, user_id: int) -> bool:
    """Resolved email_enabled — default TRUE when no row exists. Mirrors the
    COALESCE shipping in the design's "should I send?" check."""
    result = await db.execute(
        select(
            func.coalesce(
                select(UserCommPrefs.email_enabled)
                .where(UserCommPrefs.user_id == user_id)
                .scalar_subquery(),
                True,
            )
        )
    )
    return bool(result.scalar())


async def set_email_enabled(
    db: AsyncSession,
    *,
    user_id: int,
    new_value: bool,
    changed_by: int | None,
    source: str,
) -> UserCommPrefs:
    """Upsert the user's email_enabled preference and append a history row.

    Both writes happen in the caller's transaction so they commit together.
    """
    existing = await get_prefs(db, user_id)
    old_value = existing.email_enabled if existing is not None else None

    if existing is None:
        existing = UserCommPrefs(
            user_id=user_id,
            email_enabled=new_value,
            updated_by=changed_by,
        )
        db.add(existing)
    else:
        existing.email_enabled = new_value
        existing.updated_by = changed_by
        existing.updated_at = datetime.now(timezone.utc)

    history = UserCommPrefsHistory(
        user_id=user_id,
        field=_FIELD_EMAIL_ENABLED,
        old_value=old_value,
        new_value=new_value,
        changed_by=changed_by,
        source=source,
    )
    db.add(history)
    await db.flush()
    return existing


async def list_history(
    db: AsyncSession, user_id: int
) -> list[UserCommPrefsHistory]:
    result = await db.execute(
        select(UserCommPrefsHistory)
        .where(UserCommPrefsHistory.user_id == user_id)
        .order_by(desc(UserCommPrefsHistory.changed_at))
    )
    return list(result.scalars().all())

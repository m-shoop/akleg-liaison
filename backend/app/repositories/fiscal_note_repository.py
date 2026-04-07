from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fiscal_note import FiscalNote


async def get_note_by_session_id(
    db: AsyncSession, bill_id: int, session_id: str
) -> FiscalNote | None:
    """Return the FiscalNote for this bill with a matching session_id, or None."""
    result = await db.execute(
        select(FiscalNote).where(
            FiscalNote.bill_id == bill_id,
            FiscalNote.session_id == session_id,
        )
    )
    return result.scalar_one_or_none()


async def update_note_html_fields(
    db: AsyncSession,
    note_id: int,
    url: str,
    fn_department: str | None,
    fn_appropriation: str | None,
    fn_allocation: str | None,
) -> None:
    """Refresh HTML-derived fields and mark the note active. No PDF fetch needed."""
    now = datetime.now(timezone.utc)
    await db.execute(
        update(FiscalNote)
        .where(FiscalNote.id == note_id)
        .values(
            url=url,
            fn_department=fn_department,
            fn_appropriation=fn_appropriation,
            fn_allocation=fn_allocation,
            is_active=True,
            last_synced=now,
        )
    )


async def upsert_note_by_identifier(
    db: AsyncSession,
    bill_id: int,
    fn_identifier: str,
    session_id: str,
    url: str,
    fn_department: str | None,
    fn_appropriation: str | None,
    fn_allocation: str | None,
    control_code: str | None,
    publish_date,
) -> tuple[int, bool]:
    """
    Insert or update a FiscalNote keyed on (bill_id, fn_identifier).

    On conflict (same bill + identifier seen before), updates session_id and all
    fields so the row tracks the note's new URL across sync cycles.

    Returns (fiscal_note_id, is_new).
    """
    now = datetime.now(timezone.utc)
    stmt = (
        insert(FiscalNote)
        .values(
            bill_id=bill_id,
            fn_identifier=fn_identifier,
            session_id=session_id,
            url=url,
            fn_department=fn_department,
            fn_appropriation=fn_appropriation,
            fn_allocation=fn_allocation,
            control_code=control_code,
            publish_date=publish_date,
            is_active=True,
            last_synced=now,
        )
        .on_conflict_do_update(
            index_elements=[FiscalNote.bill_id, FiscalNote.fn_identifier],
            index_where=FiscalNote.fn_identifier.isnot(None),
            set_=dict(
                session_id=session_id,
                url=url,
                fn_department=fn_department,
                fn_appropriation=fn_appropriation,
                fn_allocation=fn_allocation,
                is_active=True,
                last_synced=now,
            ),
        )
        .returning(FiscalNote.id, FiscalNote.creation_timestamp)
    )
    result = await db.execute(stmt)
    row = result.one()
    is_new = (now - row.creation_timestamp.replace(tzinfo=timezone.utc)).total_seconds() < 5
    return row.id, is_new


async def deactivate_missing_notes(
    db: AsyncSession, bill_id: int, active_fn_identifiers: Sequence[str]
) -> None:
    """
    Set is_active=False on FiscalNote rows for bill_id whose fn_identifier was
    not seen in this sync cycle. Rows with fn_identifier IS NULL are left alone
    (they haven't been identified yet and can't be matched either way).
    """
    stmt = (
        FiscalNote.__table__
        .update()
        .where(
            FiscalNote.bill_id == bill_id,
            FiscalNote.fn_identifier.isnot(None),
            FiscalNote.fn_identifier.not_in(list(active_fn_identifiers)),
        )
        .values(is_active=False)
    )
    await db.execute(stmt)


async def get_fiscal_notes_for_bill(
    db: AsyncSession, bill_id: int, active_only: bool = True
) -> list[FiscalNote]:
    stmt = select(FiscalNote).where(FiscalNote.bill_id == bill_id)
    if active_only:
        stmt = stmt.where(FiscalNote.is_active == True)  # noqa: E712
    result = await db.execute(stmt)
    return list(result.scalars().all())

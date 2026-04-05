from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fiscal_note import FiscalNote


async def upsert_fiscal_note(
    db: AsyncSession,
    bill_id: int,
    session_id: str,
    url: str,
    fn_department: str | None = None,
    control_code: str | None = None,
    fn_identifier: str | None = None,
) -> tuple[int, bool]:
    """
    Insert or update a FiscalNote row keyed on (bill_id, session_id).

    Returns (fiscal_note_id, is_new).  For existing rows the PDF-derived fields
    (fn_department, control_code, fn_identifier) are NOT overwritten — they are
    only set on initial insert, since re-fetching the PDF every day is expensive.
    last_synced and is_active are always updated.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        insert(FiscalNote)
        .values(
            bill_id=bill_id,
            session_id=session_id,
            url=url,
            fn_department=fn_department,
            control_code=control_code,
            fn_identifier=fn_identifier,
            is_active=True,
            last_synced=now,
        )
        .on_conflict_do_update(
            constraint="uq_fiscal_note_bill_session",
            set_=dict(
                is_active=True,
                last_synced=now,
                url=url,
                # PDF-derived fields left unchanged on update
            ),
        )
        .returning(FiscalNote.id, FiscalNote.creation_timestamp)
    )
    result = await db.execute(stmt)
    row = result.one()
    # is_new when creation_timestamp is very close to now (just inserted)
    is_new = (now - row.creation_timestamp.replace(tzinfo=timezone.utc)).total_seconds() < 5
    return row.id, is_new


async def deactivate_missing_notes(
    db: AsyncSession, bill_id: int, active_session_ids: Sequence[str]
) -> None:
    """
    Set is_active=False on all FiscalNote rows for bill_id whose session_id
    is NOT in the provided active_session_ids list.
    """
    stmt = (
        FiscalNote.__table__
        .update()
        .where(
            FiscalNote.bill_id == bill_id,
            FiscalNote.session_id.not_in(list(active_session_ids)),
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

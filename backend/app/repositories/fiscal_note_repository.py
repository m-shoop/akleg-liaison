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
    fn_appropriation: str | None = None,
    fn_allocation: str | None = None,
    control_code: str | None = None,
    fn_identifier: str | None = None,
) -> tuple[int, bool, str | None]:
    """
    Insert or update a FiscalNote row keyed on (bill_id, session_id).

    Returns (fiscal_note_id, is_new, existing_fn_identifier).

    HTML-derived fields (fn_department, fn_appropriation, fn_allocation) are
    updated on every sync since they come for free from the listing page.
    PDF-derived fields (fn_identifier, control_code, publish_date) are only
    written on initial insert and left unchanged on conflict — the caller
    re-fetches the PDF separately when fn_identifier is still None.

    existing_fn_identifier is the fn_identifier already in the DB; None means
    the PDF was never successfully parsed and should be retried.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        insert(FiscalNote)
        .values(
            bill_id=bill_id,
            session_id=session_id,
            url=url,
            fn_department=fn_department,
            fn_appropriation=fn_appropriation,
            fn_allocation=fn_allocation,
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
                # HTML-derived fields: update every sync
                fn_department=fn_department,
                fn_appropriation=fn_appropriation,
                fn_allocation=fn_allocation,
                # PDF-derived fields (fn_identifier, control_code, publish_date)
                # are left unchanged — re-fetched by the caller when still None
            ),
        )
        .returning(FiscalNote.id, FiscalNote.creation_timestamp, FiscalNote.fn_identifier)
    )
    result = await db.execute(stmt)
    row = result.one()
    # is_new when creation_timestamp is very close to now (just inserted)
    is_new = (now - row.creation_timestamp.replace(tzinfo=timezone.utc)).total_seconds() < 5
    return row.id, is_new, row.fn_identifier


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

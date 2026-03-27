from datetime import date
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.meeting import AgendaItem, Meeting


async def upsert_meeting(
    session: AsyncSession,
    chamber: str,
    committee_name: str,
    committee_type: str,
    committee_code: str | None,
    committee_url: str | None,
    meeting_date: date,
    meeting_time,
    location: str | None,
    legislature_session: int,
) -> int:
    """Insert or update an active meeting row; return the meeting id.

    Conflict detection uses the partial unique index uq_meeting_active
    (WHERE is_active = TRUE), so inactive historical records are never matched.
    """
    stmt = (
        insert(Meeting)
        .values(
            chamber=chamber,
            committee_name=committee_name,
            committee_type=committee_type,
            committee_code=committee_code,
            committee_url=committee_url,
            meeting_date=meeting_date,
            meeting_time=meeting_time,
            location=location,
            legislature_session=legislature_session,
            is_active=True,
        )
        .on_conflict_do_update(
            index_elements=[
                "chamber",
                "committee_name",
                "committee_type",
                "meeting_date",
                "meeting_time",
                "legislature_session",
            ],
            index_where=Meeting.is_active == True,  # noqa: E712
            set_=dict(
                committee_code=committee_code,
                committee_url=committee_url,
                location=location,
                is_active=True,
                updated_at=func.now(),
            ),
        )
        .returning(Meeting.id)
    )
    result = await session.execute(stmt)
    return result.scalar_one()


async def deactivate_removed_meetings(
    session: AsyncSession,
    start_date: date,
    end_date: date,
    legislature_session: int,
    active_ids: set[int],
) -> None:
    """Mark active meetings in the date range that were NOT found in the latest
    scrape as inactive. Called after every scrape run."""
    stmt = (
        update(Meeting)
        .where(
            Meeting.legislature_session == legislature_session,
            Meeting.meeting_date >= start_date,
            Meeting.meeting_date <= end_date,
            Meeting.is_active == True,  # noqa: E712
            Meeting.id.notin_(active_ids),
        )
        .values(is_active=False)
    )
    await session.execute(stmt)


async def replace_agenda_items(
    session: AsyncSession,
    meeting_id: int,
    items: list[dict],
) -> None:
    """Delete all existing agenda items for a meeting and insert the fresh set.

    This ensures the stored agenda always matches the latest scrape exactly,
    with no risk of stale or duplicate rows accumulating over time.
    """
    await session.execute(
        delete(AgendaItem).where(AgendaItem.meeting_id == meeting_id)
    )
    if items:
        await session.execute(insert(AgendaItem), items)


async def list_meetings(
    session: AsyncSession,
    start_date: date,
    end_date: date | None,
    legislature_session: int,
    include_inactive: bool = False,
) -> list[Meeting]:
    # Always load all meetings (active + inactive) for the range so we can
    # compute has_inactive_notes_sibling without a second query.
    filters = [
        Meeting.legislature_session == legislature_session,
        Meeting.meeting_date >= start_date,
    ]
    if end_date is not None:
        filters.append(Meeting.meeting_date <= end_date)
    stmt = (
        select(Meeting)
        .where(*filters)
        .options(selectinload(Meeting.agenda_items))
        .order_by(Meeting.meeting_date, Meeting.meeting_time, Meeting.chamber, Meeting.committee_name)
    )
    result = await session.execute(stmt)
    all_meetings = list(result.scalars().all())

    # Build a set of (chamber, committee_name, meeting_date, legislature_session)
    # keys for inactive meetings that have notes.
    inactive_with_notes: set[tuple] = {
        (m.chamber, m.committee_name, m.meeting_date, m.legislature_session)
        for m in all_meetings
        if not m.is_active and m.dps_notes
    }

    for m in all_meetings:
        key = (m.chamber, m.committee_name, m.meeting_date, m.legislature_session)
        m.has_inactive_notes_sibling = m.is_active and key in inactive_with_notes

    if include_inactive:
        return all_meetings
    return [m for m in all_meetings if m.is_active]


async def get_meeting_by_id(session: AsyncSession, meeting_id: int) -> Meeting | None:
    stmt = (
        select(Meeting)
        .where(Meeting.id == meeting_id)
        .options(selectinload(Meeting.agenda_items))
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def update_dps_notes(
    session: AsyncSession, meeting_id: int, dps_notes: str | None
) -> Meeting | None:
    meeting = await get_meeting_by_id(session, meeting_id)
    if meeting is None:
        return None
    meeting.dps_notes = dps_notes
    return meeting

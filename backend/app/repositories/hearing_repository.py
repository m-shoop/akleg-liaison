import hashlib
import json
from datetime import date

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.hearing import AgendaItem, CommitteeHearing, Hearing, HearingAgendaVersion


async def get_upcoming_hearing_dates(
    session: AsyncSession,
    legislature_session: int,
    as_of: date,
    limit: int = 4,
) -> dict[int, list[date]]:
    """Return {bill_id: [upcoming_dates asc]} (up to `limit` per bill) for all
    bills that appear as bill items on active hearings on or after `as_of`."""
    stmt = (
        select(AgendaItem.bill_id, Hearing.hearing_date)
        .join(HearingAgendaVersion, AgendaItem.agenda_version_id == HearingAgendaVersion.id)
        .join(Hearing, HearingAgendaVersion.hearing_id == Hearing.id)
        .where(
            HearingAgendaVersion.is_current == True,  # noqa: E712
            AgendaItem.bill_id.isnot(None),
            AgendaItem.is_bill == True,  # noqa: E712
            Hearing.is_active == True,  # noqa: E712
            Hearing.legislature_session == legislature_session,
            Hearing.hearing_date >= as_of,
        )
        .distinct()
        .order_by(AgendaItem.bill_id, Hearing.hearing_date.asc())
    )
    result = await session.execute(stmt)
    grouped: dict[int, list[date]] = {}
    for bill_id, hearing_date in result.all():
        dates = grouped.setdefault(bill_id, [])
        if len(dates) < limit:
            dates.append(hearing_date)
    return grouped


async def get_recent_hearing_dates(
    session: AsyncSession,
    legislature_session: int,
    as_of: date,
    limit: int = 3,
) -> dict[int, list[date]]:
    """Return {bill_id: [past_dates asc]} (up to `limit` most recent per bill,
    in chronological order) for bills on active hearings strictly before `as_of`."""
    stmt = (
        select(AgendaItem.bill_id, Hearing.hearing_date)
        .join(HearingAgendaVersion, AgendaItem.agenda_version_id == HearingAgendaVersion.id)
        .join(Hearing, HearingAgendaVersion.hearing_id == Hearing.id)
        .where(
            HearingAgendaVersion.is_current == True,  # noqa: E712
            AgendaItem.bill_id.isnot(None),
            AgendaItem.is_bill == True,  # noqa: E712
            Hearing.is_active == True,  # noqa: E712
            Hearing.legislature_session == legislature_session,
            Hearing.hearing_date < as_of,
        )
        .distinct()
        .order_by(AgendaItem.bill_id, Hearing.hearing_date.desc())
    )
    result = await session.execute(stmt)
    grouped: dict[int, list[date]] = {}
    for bill_id, hearing_date in result.all():
        dates = grouped.setdefault(bill_id, [])
        if len(dates) < limit:
            dates.append(hearing_date)
    return {bill_id: list(reversed(dates)) for bill_id, dates in grouped.items()}


async def upsert_committee_hearing(
    session: AsyncSession,
    chamber: str,
    committee_name: str,
    committee_type: str,
    committee_code: str | None,
    committee_url: str | None,
    hearing_date: date,
    hearing_time,
    location: str | None,
    legislature_session: int,
) -> int:
    """Insert or update a committee hearing; return the hearing id.

    When committee_code is present, uses the partial unique index
    uq_committee_hearing_active for conflict detection. When it is None
    (rare), falls back to a SELECT + manual insert/update to avoid trying
    to target a partial index that excludes NULL committee_code rows.
    """
    if committee_code is not None:
        stmt = (
            insert(Hearing)
            .values(
                chamber=chamber,
                hearing_type="Committee",
                length=60,
                hearing_date=hearing_date,
                hearing_time=hearing_time,
                location=location,
                committee_code=committee_code,
                legislature_session=legislature_session,
                is_active=True,
                last_sync=func.now(),
            )
            .on_conflict_do_update(
                index_elements=["chamber", "committee_code", "hearing_date", "legislature_session"],
                index_where=text(
                    "hearing_type = 'Committee' AND is_active = TRUE AND committee_code IS NOT NULL"
                ),
                set_=dict(
                    location=location,
                    hearing_time=hearing_time,
                    is_active=True,
                    updated_at=func.now(),
                    last_sync=func.now(),
                ),
            )
            .returning(Hearing.id)
        )
        result = await session.execute(stmt)
        hearing_id = result.scalar_one()
    else:
        # Fallback: manual upsert for committees without a code.
        existing = await session.scalar(
            select(Hearing)
            .join(CommitteeHearing, CommitteeHearing.hearing_id == Hearing.id)
            .where(
                Hearing.chamber == chamber,
                Hearing.hearing_type == "Committee",
                Hearing.hearing_date == hearing_date,
                Hearing.legislature_session == legislature_session,
                Hearing.is_active == True,  # noqa: E712
                Hearing.committee_code.is_(None),
                CommitteeHearing.committee_name == committee_name,
                CommitteeHearing.committee_type == committee_type,
            )
        )
        if existing:
            existing.location = location
            existing.hearing_time = hearing_time
            existing.is_active = True
            existing.last_sync = func.now()
            await session.flush()
            hearing_id = existing.id
        else:
            new_hearing = Hearing(
                chamber=chamber,
                hearing_type="Committee",
                length=60,
                hearing_date=hearing_date,
                hearing_time=hearing_time,
                location=location,
                committee_code=None,
                legislature_session=legislature_session,
                is_active=True,
            )
            session.add(new_hearing)
            await session.flush()
            hearing_id = new_hearing.id

    # Upsert committee_hearings (1:1 with hearing_id as the conflict target).
    ch_stmt = (
        insert(CommitteeHearing)
        .values(
            hearing_id=hearing_id,
            committee_name=committee_name,
            committee_type=committee_type,
            committee_url=committee_url,
        )
        .on_conflict_do_update(
            index_elements=["hearing_id"],
            set_=dict(
                committee_name=committee_name,
                committee_type=committee_type,
                committee_url=committee_url,
            ),
        )
    )
    await session.execute(ch_stmt)

    return hearing_id


async def upsert_floor_hearing(
    session: AsyncSession,
    chamber: str,
    hearing_date: date,
    hearing_time,
    location: str | None,
    legislature_session: int,
) -> int:
    """Insert or update a floor hearing; return the hearing id."""
    stmt = (
        insert(Hearing)
        .values(
            chamber=chamber,
            hearing_type="Floor",
            length=90,
            hearing_date=hearing_date,
            hearing_time=hearing_time,
            location=location,
            committee_code=None,
            legislature_session=legislature_session,
            is_active=True,
            last_sync=func.now(),
        )
        .on_conflict_do_update(
            index_elements=["chamber", "hearing_date", "legislature_session"],
            index_where=text("hearing_type = 'Floor' AND is_active = TRUE"),
            set_=dict(
                hearing_time=hearing_time,
                location=location,
                is_active=True,
                updated_at=func.now(),
                last_sync=func.now(),
            ),
        )
        .returning(Hearing.id)
    )
    result = await session.execute(stmt)
    return result.scalar_one()


async def deactivate_removed_hearings(
    session: AsyncSession,
    start_date: date,
    end_date: date,
    legislature_session: int,
    active_ids: set[int],
) -> None:
    """Mark active hearings in the date range that were NOT found in the latest
    scrape as inactive. Called after every scrape run."""
    stmt = (
        update(Hearing)
        .where(
            Hearing.legislature_session == legislature_session,
            Hearing.hearing_date >= start_date,
            Hearing.hearing_date <= end_date,
            Hearing.is_active == True,  # noqa: E712
            Hearing.id.notin_(active_ids),
        )
        .values(is_active=False)
    )
    await session.execute(stmt)


def compute_agenda_hash(items: list[dict]) -> str:
    """Compute a deterministic SHA-256 hash of agenda item content."""
    sorted_items = sorted(items, key=lambda x: x["sort_order"])
    canonical = [
        {
            "bill_number": item["bill_number"],
            "content": item["content"],
            "is_bill": item["is_bill"],
            "is_teleconferenced": item["is_teleconferenced"],
            "prefix": item["prefix"],
            "sort_order": item["sort_order"],
            "url": item["url"],
        }
        for item in sorted_items
    ]
    serialized = json.dumps(canonical, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(serialized.encode()).hexdigest()


async def replace_agenda_items(
    session: AsyncSession,
    hearing_id: int,
    items: list[dict],
) -> None:
    """Version-aware agenda update.

    Computes a SHA-256 hash of the incoming items and compares it against the
    current version's stored hash. If identical, no write occurs. If different
    (or no version exists yet), a new HearingAgendaVersion row is created, the
    previous version is marked is_current=False, and new agenda items are inserted.

    Historical AgendaItem rows are never deleted; only is_current changes.
    """
    new_hash = compute_agenda_hash(items)

    result = await session.execute(
        select(HearingAgendaVersion)
        .where(
            HearingAgendaVersion.hearing_id == hearing_id,
            HearingAgendaVersion.is_current == True,  # noqa: E712
        )
    )
    current_version = result.scalar_one_or_none()

    if current_version is not None:
        if current_version.agenda_hash is None:
            await session.execute(
                update(HearingAgendaVersion)
                .where(HearingAgendaVersion.id == current_version.id)
                .values(agenda_hash=new_hash)
            )
            return
        if current_version.agenda_hash == new_hash:
            return

    if current_version is not None:
        next_version = current_version.version + 1
        await session.execute(
            update(HearingAgendaVersion)
            .where(HearingAgendaVersion.id == current_version.id)
            .values(is_current=False)
        )
    else:
        next_version = 1

    version_result = await session.execute(
        insert(HearingAgendaVersion)
        .values(
            hearing_id=hearing_id,
            version=next_version,
            is_current=True,
            agenda_hash=new_hash,
        )
        .returning(HearingAgendaVersion.id)
    )
    new_version_id = version_result.scalar_one()

    if items:
        await session.execute(
            insert(AgendaItem),
            [{**item, "agenda_version_id": new_version_id} for item in items],
        )


async def list_hearings(
    session: AsyncSession,
    start_date: date,
    end_date: date | None,
    legislature_session: int,
    include_inactive: bool = False,
) -> list[Hearing]:
    filters = [
        Hearing.legislature_session == legislature_session,
        Hearing.hearing_date >= start_date,
    ]
    if end_date is not None:
        filters.append(Hearing.hearing_date <= end_date)

    stmt = (
        select(Hearing)
        .where(*filters)
        .options(
            selectinload(Hearing.committee_hearing),
            selectinload(Hearing.agenda_versions).selectinload(
                HearingAgendaVersion.agenda_items
            ),
        )
        .order_by(
            Hearing.hearing_date,
            Hearing.hearing_time,
            Hearing.chamber,
        )
    )
    result = await session.execute(stmt)
    all_hearings = list(result.scalars().all())

    if include_inactive:
        return all_hearings
    return [h for h in all_hearings if h.is_active]


async def get_hearing_by_id(session: AsyncSession, hearing_id: int) -> Hearing | None:
    stmt = (
        select(Hearing)
        .where(Hearing.id == hearing_id)
        .options(
            selectinload(Hearing.committee_hearing),
            selectinload(Hearing.agenda_versions).selectinload(
                HearingAgendaVersion.agenda_items
            ),
        )
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_prior_agenda_versions(
    session: AsyncSession,
    hearing_id: int,
) -> list[HearingAgendaVersion]:
    """Return all non-current agenda versions for a hearing, newest first."""
    stmt = (
        select(HearingAgendaVersion)
        .where(
            HearingAgendaVersion.hearing_id == hearing_id,
            HearingAgendaVersion.is_current == False,  # noqa: E712
        )
        .options(selectinload(HearingAgendaVersion.agenda_items))
        .order_by(HearingAgendaVersion.version.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def update_dps_notes(
    session: AsyncSession, hearing_id: int, dps_notes: str | None
) -> Hearing | None:
    hearing = await get_hearing_by_id(session, hearing_id)
    if hearing is None:
        return None
    hearing.dps_notes = dps_notes
    return hearing


async def update_hidden(
    session: AsyncSession, hearing_id: int, hidden: bool
) -> Hearing | None:
    hearing = await get_hearing_by_id(session, hearing_id)
    if hearing is None:
        return None
    hearing.hidden = hidden
    return hearing

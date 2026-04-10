"""
Persists scraped bills, events, and analyzed outcomes to PostgreSQL.

Upsert strategy
---------------
Bills    — unique on (bill_number, session).  Metadata fields are updated on
           each run so status changes are captured.
Events   — unique on (bill_id, event_date, source_url).  raw_text is updated
           if it changes.  The `analyzed` flag is only set to True once
           outcomes have been stored; it is never reset to False on conflict.
Outcomes — inserted fresh each time an event is analyzed.  Deduplication
           across events with the same source URL is left to the view layer.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import with_loader_criteria

from app.models.bill import Bill, BillEvent, BillEventOutcome, BillSponsor, BillKeyword
from app.models.fiscal_note import FiscalNote
from app.services.bill_scraper import ScrapedBill, ScrapedEvent
from app.services.outcome_analyzer import ScrapedOutcome


async def upsert_bill(
    session: AsyncSession,
    scraped: ScrapedBill,
    default_tracked: bool = True,
) -> tuple[int, bool]:
    """
    Insert or update a Bill row.

    Returns (bill_id, is_tracked).

    default_tracked controls is_tracked for brand-new bills only.
    Existing bills keep whatever is_tracked value they already have —
    is_tracked is intentionally excluded from the ON CONFLICT SET clause.
    """
    stmt = (
        insert(Bill)
        .values(
            bill_number=scraped.bill_number,
            session=scraped.session,
            title=scraped.title,
            short_title=scraped.short_title,
            status=scraped.status,
            introduced_date=scraped.introduced_date,
            source_url=scraped.source_url,
            is_tracked=default_tracked,
            last_sync=func.now(),
        )
        .on_conflict_do_update(
            constraint="uq_bill_session",
            set_=dict(
                title=scraped.title,
                short_title=scraped.short_title,
                status=scraped.status,
                introduced_date=scraped.introduced_date,
                source_url=scraped.source_url,
                updated_at=func.now(),
                last_sync=func.now(),
                # is_tracked intentionally omitted — preserve the user's choice
            ),
        )
        .returning(Bill.id, Bill.is_tracked)
    )
    result = await session.execute(stmt)
    bill_id, is_tracked = result.one()

    # Sponsors: delete and re-insert on each run (small list, not worth diffing)
    await session.execute(
        BillSponsor.__table__.delete().where(BillSponsor.bill_id == bill_id)
    )
    for sp in scraped.sponsors:
        session.add(BillSponsor(
            bill_id=bill_id,
            name=sp.name,
            chamber=sp.chamber,
            sponsor_type=sp.sponsor_type,
        ))

    # Subjects: delete and re-insert on each run
    await session.execute(
        BillKeyword.__table__.delete().where(BillKeyword.bill_id == bill_id)
    )
    for sub in scraped.keywords:
        session.add(BillKeyword(bill_id=bill_id, keyword=sub.keyword, url=sub.url))

    return bill_id, is_tracked


async def upsert_event(
    session: AsyncSession, bill_id: int, scraped: ScrapedEvent
) -> tuple[int, bool]:
    """
    Insert or update a BillEvent row.

    Returns (event_id, is_new) where is_new=True means this event was just
    inserted and has not yet been analyzed.
    """
    stmt = (
        insert(BillEvent)
        .values(
            bill_id=bill_id,
            event_date=scraped.event_date,
            source_url=scraped.source_url,
            event_type=scraped.event_type,
            chamber=scraped.chamber,
            raw_text=scraped.raw_text,
            analyzed=False,
        )
        .on_conflict_do_update(
            constraint="uq_bill_event",
            set_=dict(
                raw_text=scraped.raw_text,
                is_active=True,   # re-activate if it had been marked inactive
                updated_at=func.now(),
                # analyzed is intentionally NOT reset — once done, stays done
            ),
        )
        .returning(BillEvent.id, BillEvent.analyzed)
    )
    result = await session.execute(stmt)
    event_id, analyzed = result.one()
    return event_id, not analyzed


async def insert_outcomes(
    session: AsyncSession, event_id: int, outcomes: list[ScrapedOutcome]
) -> None:
    """Insert outcome rows and mark the parent event as analyzed."""
    for oc in outcomes:
        session.add(BillEventOutcome(
            event_id=event_id,
            chamber=oc.chamber,
            outcome_type=oc.outcome_type,
            description=oc.description,
            committee=oc.committee,
            ai_generated=True,
        ))

    await session.execute(
        BillEvent.__table__
        .update()
        .where(BillEvent.id == event_id)
        .values(analyzed=True, updated_at=func.now())
    )


async def get_inactive_event_source_urls(
    session: AsyncSession, bill_id: int
) -> set[str]:
    """Return source_urls of currently inactive events for *bill_id*."""
    result = await session.execute(
        select(BillEvent.source_url).where(
            BillEvent.bill_id == bill_id,
            BillEvent.is_active == False,  # noqa: E712
        )
    )
    return {row[0] for row in result.all()}


async def deactivate_stale_events(
    session: AsyncSession, bill_id: int, active_source_urls: set[str]
) -> list[dict]:
    """
    Mark as inactive any bill_events for *bill_id* whose source_url is no
    longer present in the latest scrape.  Inactive events (and their outcomes)
    are hidden from all read queries.

    Returns a list of dicts describing each newly-deactivated event so the
    caller can write audit log entries.
    """
    result = await session.execute(
        BillEvent.__table__
        .update()
        .where(
            BillEvent.bill_id == bill_id,
            BillEvent.is_active == True,  # noqa: E712
            BillEvent.source_url.notin_(active_source_urls),
        )
        .values(is_active=False, updated_at=func.now())
        .returning(
            BillEvent.__table__.c.id,
            BillEvent.__table__.c.event_date,
            BillEvent.__table__.c.source_url,
            BillEvent.__table__.c.raw_text,
        )
    )
    return [
        {"id": row[0], "event_date": row[1], "source_url": row[2], "raw_text": row[3]}
        for row in result.all()
    ]


async def get_bill_tracking_status(
    session: AsyncSession, bill_number: str, legislature_session: int
) -> bool | None:
    """
    Return the is_tracked value for a bill, or None if the bill is not in the DB.
    Used by the scheduler to decide whether to scrape at all.
    """
    result = await session.execute(
        select(Bill.is_tracked).where(
            Bill.bill_number == bill_number,
            Bill.session == legislature_session,
        )
    )
    row = result.one_or_none()
    return row[0] if row is not None else None


async def get_bill_by_id(
    session: AsyncSession, bill_id: int, load_relations: bool = False
) -> Bill | None:
    """Fetch a single bill by primary key, optionally with events and outcomes."""
    from sqlalchemy.orm import selectinload
    from app.models.tag import Tag
    stmt = select(Bill).where(Bill.id == bill_id)
    if load_relations:
        stmt = stmt.options(
            selectinload(Bill.sponsors),
            selectinload(Bill.events).selectinload(BillEvent.outcomes),
            selectinload(Bill.tags),
            selectinload(Bill.keywords),
            selectinload(Bill.fiscal_notes),
            selectinload(Bill.fiscal_notes_query_failed_record),
            with_loader_criteria(BillEvent, BillEvent.is_active == True),  # noqa: E712
        )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def list_bills(
    session: AsyncSession, include_untracked: bool = False
) -> list[Bill]:
    """Return bills ordered by session descending then bill number.

    By default only tracked bills are returned.  Pass include_untracked=True
    to include bills where is_tracked=False as well.
    """
    from sqlalchemy.orm import selectinload
    stmt = (
        select(Bill)
        .options(
            selectinload(Bill.sponsors),
            selectinload(Bill.events).selectinload(BillEvent.outcomes),
            selectinload(Bill.tags),
            selectinload(Bill.keywords),
            selectinload(Bill.fiscal_notes),
            selectinload(Bill.fiscal_notes_query_failed_record),
            with_loader_criteria(BillEvent, BillEvent.is_active == True),  # noqa: E712
        )
        .order_by(Bill.session.desc(), Bill.bill_number)
    )
    if not include_untracked:
        stmt = stmt.where(Bill.is_tracked == True)  # noqa: E712
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def set_bill_tracked(
    session: AsyncSession, bill_id: int, is_tracked: bool
) -> Bill | None:
    """Set the is_tracked flag on a bill. Returns the updated bill or None."""
    await session.execute(
        Bill.__table__
        .update()
        .where(Bill.id == bill_id)
        .values(is_tracked=is_tracked, updated_at=func.now())
    )
    result = await session.execute(select(Bill).where(Bill.id == bill_id))
    return result.scalar_one_or_none()


async def get_event_by_id(
    session: AsyncSession, event_id: int
) -> BillEvent | None:
    """Fetch a single event with its outcomes."""
    from sqlalchemy.orm import selectinload
    result = await session.execute(
        select(BillEvent)
        .where(BillEvent.id == event_id)
        .options(selectinload(BillEvent.outcomes))
    )
    return result.scalar_one_or_none()


async def get_bill_by_number(
    session: AsyncSession, bill_number: str, legislature_session: int
) -> Bill | None:
    """Return a bill by its bill_number + session, or None if not found."""
    result = await session.execute(
        select(Bill).where(
            Bill.bill_number == bill_number,
            Bill.session == legislature_session,
        )
    )
    return result.scalar_one_or_none()


async def list_events_for_bill(
    session: AsyncSession, bill_id: int
) -> list[BillEvent]:
    """Return all active events for a bill ordered by date, with outcomes."""
    from sqlalchemy.orm import selectinload
    result = await session.execute(
        select(BillEvent)
        .where(BillEvent.bill_id == bill_id, BillEvent.is_active == True)  # noqa: E712
        .order_by(BillEvent.event_date)
        .options(selectinload(BillEvent.outcomes))
    )
    return list(result.scalars().all())

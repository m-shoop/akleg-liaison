"""
Shared logic for scraping a bill and persisting any new events + outcomes.

Used by both the HTTP router (manual fetch/refresh) and the background scheduler.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.bill_repository import (
    get_bill_tracking_status,
    insert_outcomes,
    upsert_bill,
    upsert_event,
)
from app.services.bill_scraper import ScrapedEvent, scrape_bill
from app.services.outcome_analyzer import analyze_event as analyze_event_with_mistral

logger = logging.getLogger(__name__)


async def analyze_new_events(
    db: AsyncSession,
    bill_number: str,
    scraped_events: list[ScrapedEvent],
    bill_id: int,
) -> None:
    """Upsert events and run Mistral analysis on any that are new."""
    for se in scraped_events:
        event_id, is_new = await upsert_event(db, bill_id, se)
        if is_new:
            try:
                outcomes = await analyze_event_with_mistral(se, bill_number)
                await insert_outcomes(db, event_id, outcomes)
            except Exception as exc:
                logger.warning("analyze_event failed for event %d: %s", event_id, exc)


async def refresh_bill(db: AsyncSession, bill_number: str, session: int) -> int:
    """
    Manual scrape: upsert bill (keeping existing is_tracked value, defaulting True
    for new bills) and analyze all new events.  Returns the bill's DB id.
    """
    scraped = await scrape_bill(bill_number, session)
    bill_id, _ = await upsert_bill(db, scraped, default_tracked=True)
    await analyze_new_events(db, scraped.bill_number, scraped.events, bill_id)
    return bill_id


async def sync_bill_for_scheduler(
    db: AsyncSession, bill_number: str, session: int
) -> None:
    """
    Scheduler scrape: upsert bill metadata, defaulting new bills to untracked.

    Bills that already exist in the DB and are untracked are skipped entirely —
    no web request is made.  Events and outcomes are only processed for tracked bills.
    """
    is_tracked = await get_bill_tracking_status(db, bill_number, session)
    if is_tracked is False:
        # Already in DB and explicitly untracked — nothing to do.
        return

    scraped = await scrape_bill(bill_number, session)
    bill_id, is_tracked = await upsert_bill(db, scraped, default_tracked=False)
    if is_tracked:
        await analyze_new_events(db, scraped.bill_number, scraped.events, bill_id)

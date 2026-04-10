"""
Shared logic for scraping a bill and persisting any new events + outcomes.

Used by both the HTTP router (manual fetch/refresh) and the background scheduler.
"""

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.audit_log_repository import log_system_action
from app.repositories.bill_repository import (
    deactivate_stale_events,
    get_bill_tracking_status,
    get_inactive_event_source_urls,
    insert_outcomes,
    upsert_bill,
    upsert_event,
)
from app.services.bill_scraper import ScrapedEvent, scrape_bill
from app.services.fiscal_note_sync import sync_fiscal_notes_for_bill
from app.services.outcome_analyzer import MISTRAL_MODEL, analyze_event as analyze_event_with_mistral

logger = logging.getLogger(__name__)


async def analyze_new_events(
    db: AsyncSession,
    bill_number: str,
    scraped_events: list[ScrapedEvent],
    bill_id: int,
) -> None:
    """Upsert events, run Mistral analysis on any that are new, and mark
    any previously-stored events that no longer appear on the page as inactive."""
    inactive_urls = await get_inactive_event_source_urls(db, bill_id)

    for se in scraped_events:
        event_id, is_new = await upsert_event(db, bill_id, se)

        if se.source_url in inactive_urls:
            await log_system_action(
                db,
                action="event_reactivated",
                entity_type="bill_event",
                entity_id=event_id,
                details={
                    "bill_number": bill_number,
                    "event_date": se.event_date.isoformat(),
                    "source_url": se.source_url,
                    "raw_text": se.raw_text,
                },
            )

        if is_new:
            try:
                outcomes = await analyze_event_with_mistral(se, bill_number)
                await insert_outcomes(db, event_id, outcomes)
                for oc in outcomes:
                    await log_system_action(
                        db,
                        action="outcome_generated",
                        entity_type="bill_event",
                        entity_id=event_id,
                        details={
                            "bill_number": bill_number,
                            "event_date": se.event_date.isoformat(),
                            "outcome_type": oc.outcome_type.value,
                            "chamber": oc.chamber.value,
                            "description": oc.description,
                            "committee": oc.committee,
                            "model": MISTRAL_MODEL,
                        },
                    )
            except Exception as exc:
                logger.warning("analyze_event failed for event %d: %s", event_id, exc)

    active_urls = {se.source_url for se in scraped_events}
    deactivated = await deactivate_stale_events(db, bill_id, active_urls)
    for row in deactivated:
        await log_system_action(
            db,
            action="event_deactivated",
            entity_type="bill_event",
            entity_id=row["id"],
            details={
                "bill_number": bill_number,
                "event_date": row["event_date"].isoformat(),
                "source_url": row["source_url"],
                "raw_text": row["raw_text"],
            },
        )


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
    db: AsyncSession,
    bill_number: str,
    session: int,
    allnotes_entries: list[dict] | None = None,
    client: httpx.AsyncClient | None = None,
) -> None:
    """
    Scheduler scrape: upsert bill metadata, defaulting new bills to untracked.

    Bills that already exist in the DB and are untracked are skipped entirely —
    no web request is made.  Events, outcomes, and fiscal notes are only
    processed for tracked bills.

    Pass allnotes_entries (from load_allnotes_entries()) and a shared httpx
    client to also sync fiscal notes for tracked bills in the same pass.
    """
    is_tracked = await get_bill_tracking_status(db, bill_number, session)
    if is_tracked is False:
        # Already in DB and explicitly untracked — nothing to do.
        return

    scraped = await scrape_bill(bill_number, session)
    bill_id, is_tracked = await upsert_bill(db, scraped, default_tracked=False)
    if is_tracked:
        await analyze_new_events(db, scraped.bill_number, scraped.events, bill_id)
        if allnotes_entries is not None and client is not None:
            new_count = await sync_fiscal_notes_for_bill(
                db, bill_id, bill_number, allnotes_entries, client
            )
            if new_count:
                logger.info("[bill_sync] %s: %d new fiscal note(s).", bill_number, new_count)

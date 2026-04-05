"""
Background scheduler: syncs all bills from akleg.gov twice per day at 4:05 AM
and 4:05 PM Juneau time.

Also syncs committee meeting hearings from akleg.gov every Thursday at 4:05 PM
Juneau time. The sync covers the next Sunday through the following Saturday
(7 days), capturing the week whose hearings must be finalized by the Thursday
4 PM policy deadline.

For each bill on the website:
  - Bill metadata (title, status, sponsors) is always upserted.
  - New bills are added with is_tracked=False by default.
  - Events and Mistral analysis are only run for bills already marked as tracked.

Both loops run as asyncio tasks alongside the FastAPI server so HTTP requests
are never blocked.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.database import AsyncSessionLocal
from app.services.bill_scraper import scrape_bill_list
from app.services.bill_sync import sync_bill_for_scheduler
from app.services.fiscal_note_sync import sync_all_fiscal_notes
from app.services.meeting_scraper import scrape_and_store_meetings

logger = logging.getLogger(__name__)

_JUNEAU_TZ = ZoneInfo("America/Anchorage")
_BILL_SYNC_TIMES = [(4, 5), (16, 5)]    # 4:05 AM and 4:05 PM Juneau
_HEARING_SYNC_TIMES = [(4, 5), (16, 5)] # 4:05 AM and 4:05 PM Juneau
_FISCAL_NOTE_SYNC_TIME = (4, 0)         # 4:00 AM Juneau (daily)
_LEGISLATURE_SESSION = 34


def _seconds_until_next_bill_sync() -> float:
    """Return seconds until the next scheduled bill sync time in Juneau time."""
    now = datetime.now(_JUNEAU_TZ)
    candidates = []
    for hour, minute in _BILL_SYNC_TIMES:
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        candidates.append(candidate)
    next_run = min(candidates)
    return (next_run - now).total_seconds()


def _seconds_until_next_fiscal_sync() -> float:
    """Return seconds until the next 4:00 AM Juneau time."""
    now = datetime.now(_JUNEAU_TZ)
    hour, minute = _FISCAL_NOTE_SYNC_TIME
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return (candidate - now).total_seconds()


def _seconds_until_next_hearing_sync() -> float:
    """Return seconds until the next scheduled hearing sync time in Juneau time."""
    now = datetime.now(_JUNEAU_TZ)
    candidates = []
    for hour, minute in _HEARING_SYNC_TIMES:
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        candidates.append(candidate)
    next_run = min(candidates)
    return (next_run - now).total_seconds()


def _hearing_sync_date_range() -> tuple[date, date]:
    """Return (next_sunday, following_saturday) from the current Juneau date."""
    today = datetime.now(_JUNEAU_TZ).date()
    days_until_sunday = (6 - today.weekday()) % 7 or 7
    next_sunday = today + timedelta(days=days_until_sunday)
    following_saturday = next_sunday + timedelta(days=6)
    return next_sunday, following_saturday


async def _sync_all_bills() -> None:
    """
    Pull every bill listed on akleg.gov and upsert it.
    New bills are marked untracked; tracked bills also get their events refreshed.
    """
    logger.info("[scheduler] Starting bill sync.")

    bill_numbers = await scrape_bill_list(_LEGISLATURE_SESSION)
    logger.info("[scheduler] %d bill(s) found on akleg.gov.", len(bill_numbers))

    for bill_number in bill_numbers:
        try:
            async with AsyncSessionLocal() as db:
                await sync_bill_for_scheduler(db, bill_number, _LEGISLATURE_SESSION)
                await db.commit()
            logger.info("[scheduler] Synced %s.", bill_number)
        except Exception as exc:
            logger.warning("[scheduler] Error syncing %s: %s", bill_number, exc)

    logger.info("[scheduler] Bill sync complete.")


async def _sync_hearings() -> None:
    """
    Fetch and persist committee meeting hearings for the next Sunday–Saturday.
    """
    start, end = _hearing_sync_date_range()
    logger.info("[scheduler] Starting hearing sync for %s to %s.", start, end)
    try:
        async with AsyncSessionLocal() as db:
            count = await scrape_and_store_meetings(db, start, end, _LEGISLATURE_SESSION)
        logger.info("[scheduler] Hearing sync complete: %d meeting(s) saved.", count)
    except Exception as exc:
        logger.warning("[scheduler] Error during hearing sync: %s", exc)


async def scheduler_loop() -> None:
    """
    Bill sync loop. Runs immediately on startup, then waits until the next
    scheduled sync time (4:05 AM or 4:05 PM Juneau). Designed to run as a
    fire-and-forget asyncio.Task.
    """
    while True:
        wait = _seconds_until_next_bill_sync()
        next_run = datetime.now(_JUNEAU_TZ) + timedelta(seconds=wait)
        logger.info(
            "[scheduler] Next bill sync at %s.",
            next_run.strftime("%Y-%m-%d %H:%M %Z"),
        )
        await asyncio.sleep(wait)
        await _sync_all_bills()


async def _sync_fiscal_notes() -> None:
    """Fetch and persist fiscal notes for all known bills."""
    logger.info("[scheduler] Starting fiscal note sync.")
    try:
        async with AsyncSessionLocal() as db:
            await sync_all_fiscal_notes(db)
        logger.info("[scheduler] Fiscal note sync complete.")
    except Exception as exc:
        logger.warning("[scheduler] Error during fiscal note sync: %s", exc)


async def fiscal_note_scheduler_loop() -> None:
    """
    Fiscal note sync loop. Runs daily at 4:00 AM Juneau time.
    Designed to run as a fire-and-forget asyncio.Task.
    """
    while True:
        wait = _seconds_until_next_fiscal_sync()
        next_run = datetime.now(_JUNEAU_TZ) + timedelta(seconds=wait)
        logger.info(
            "[scheduler] Next fiscal note sync at %s.",
            next_run.strftime("%Y-%m-%d %H:%M %Z"),
        )
        await asyncio.sleep(wait)
        await _sync_fiscal_notes()


async def hearing_scheduler_loop() -> None:
    """
    Hearing sync loop. Runs at 4:05 AM and 4:05 PM Juneau time daily.
    Designed to run as a fire-and-forget asyncio.Task.
    """
    while True:
        wait = _seconds_until_next_hearing_sync()
        next_run = datetime.now(_JUNEAU_TZ) + timedelta(seconds=wait)
        logger.info(
            "[scheduler] Next hearing sync at %s.",
            next_run.strftime("%Y-%m-%d %H:%M %Z"),
        )
        await asyncio.sleep(wait)
        await _sync_hearings()

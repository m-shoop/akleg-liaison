"""
Background scheduler: syncs all bills from akleg.gov once per day at 4 AM Juneau
time, and immediately on startup.

For each bill on the website:
  - Bill metadata (title, status, sponsors) is always upserted.
  - New bills are added with is_tracked=False by default.
  - Events and Mistral analysis are only run for bills already marked as tracked.

The loop runs as an asyncio task alongside the FastAPI server so HTTP requests
are never blocked.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.database import AsyncSessionLocal
from app.services.bill_scraper import scrape_bill_list
from app.services.bill_sync import sync_bill_for_scheduler

logger = logging.getLogger(__name__)

_JUNEAU_TZ = ZoneInfo("America/Anchorage")


def _seconds_until_next_4am() -> float:
    """Return seconds until the next 4:00 AM Juneau time."""
    now = datetime.now(_JUNEAU_TZ)
    next_run = now.replace(hour=4, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()


async def _sync_all_bills() -> None:
    """
    Pull every bill listed on akleg.gov and upsert it.
    New bills are marked untracked; tracked bills also get their events refreshed.
    """
    logger.info("[scheduler] Starting daily bill sync.")

    bill_numbers = await scrape_bill_list(34)
    logger.info("[scheduler] %d bill(s) found on akleg.gov.", len(bill_numbers))

    for bill_number in bill_numbers:
        try:
            async with AsyncSessionLocal() as db:
                await sync_bill_for_scheduler(db, bill_number, 34)
                await db.commit()
            logger.info("[scheduler] Synced %s.", bill_number)
        except Exception as exc:
            logger.warning("[scheduler] Error syncing %s: %s", bill_number, exc)

    logger.info("[scheduler] Daily bill sync complete.")


async def scheduler_loop() -> None:
    """
    Main loop.  Runs immediately on startup, then waits until 4 AM Juneau each day.
    Designed to run as a fire-and-forget asyncio.Task.
    """
    await _sync_all_bills()

    while True:
        wait = _seconds_until_next_4am()
        next_run = datetime.now(_JUNEAU_TZ) + timedelta(seconds=wait)
        logger.info(
            "[scheduler] Next sync at %s.",
            next_run.strftime("%Y-%m-%d %H:%M %Z"),
        )
        await asyncio.sleep(wait)
        await _sync_all_bills()

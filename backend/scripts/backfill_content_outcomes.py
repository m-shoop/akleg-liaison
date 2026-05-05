"""
Backfill regex-derived outcomes against existing BillEvent rows.

Walks bill_events, applies app.services.content_outcome_parser to each event's
raw_text, and inserts any new outcomes with ai_generated=False. Re-runs are
safe — insert_content_outcomes skips an outcome_type if a non-AI row of that
type already exists on the event.

This does NOT re-trigger the Mistral pass and does NOT touch existing
ai_generated=True outcomes.

Usage (run from backend/):
    python scripts/backfill_content_outcomes.py
    python scripts/backfill_content_outcomes.py --include-inactive
    python scripts/backfill_content_outcomes.py --dry-run
    python scripts/backfill_content_outcomes.py --bill HB384 --session 34
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Load every model module so SQLAlchemy can resolve string-named relationships.
import app.models  # noqa: F401
import app.models.audit_log  # noqa: F401
import app.models.fiscal_note  # noqa: F401
import app.models.job  # noqa: F401

from app.config import settings
from app.models.bill import Bill, BillEvent
from app.repositories.audit_log_repository import log_system_action
from app.repositories.bill_repository import insert_content_outcomes
from app.services.content_outcome_parser import parse_outcomes_from_raw_text


logger = logging.getLogger("backfill_content_outcomes")


async def run(
    *,
    include_inactive: bool,
    dry_run: bool,
    bill_filter: str | None,
    session_filter: int | None,
) -> int:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    total_events = 0
    total_inserted = 0
    events_with_inserts = 0

    async with Session() as db:
        stmt = (
            select(BillEvent, Bill.bill_number, Bill.session)
            .join(Bill, BillEvent.bill_id == Bill.id)
            .order_by(Bill.session.desc(), Bill.bill_number, BillEvent.event_date)
        )
        if not include_inactive:
            stmt = stmt.where(BillEvent.is_active == True)  # noqa: E712
        if bill_filter:
            stmt = stmt.where(Bill.bill_number == bill_filter)
        if session_filter is not None:
            stmt = stmt.where(Bill.session == session_filter)

        result = await db.execute(stmt)
        rows = result.all()

        for event, bill_number, bill_session in rows:
            total_events += 1
            outcomes = parse_outcomes_from_raw_text(
                event.raw_text, event.chamber, event.source_url
            )
            if not outcomes:
                continue

            if dry_run:
                for oc in outcomes:
                    logger.info(
                        "[DRY] would insert: bill=%s sess=%d event=%d date=%s "
                        "type=%s committee=%s raw=%r",
                        bill_number, bill_session, event.id, event.event_date,
                        oc.outcome_type.value, oc.committee, event.raw_text,
                    )
                # Even in dry-run, count what would be inserted (excluding
                # ones that the idempotency check would skip).
                continue

            inserted = await insert_content_outcomes(db, event.id, outcomes)
            if not inserted:
                continue

            events_with_inserts += 1
            total_inserted += len(inserted)
            for oc in inserted:
                logger.info(
                    "inserted: bill=%s sess=%d event=%d date=%s type=%s committee=%s",
                    bill_number, bill_session, event.id, event.event_date,
                    oc.outcome_type.value, oc.committee,
                )
                await log_system_action(
                    db,
                    action="content_outcome_generated",
                    entity_type="bill_event",
                    entity_id=event.id,
                    details={
                        "bill_number": bill_number,
                        "event_date": event.event_date.isoformat(),
                        "outcome_type": oc.outcome_type.value,
                        "chamber": oc.chamber.value,
                        "description": oc.description,
                        "committee": oc.committee,
                        "source": "raw_text_regex",
                        "via": "backfill_content_outcomes.py",
                    },
                )

        if dry_run:
            await db.rollback()
        else:
            await db.commit()

    await engine.dispose()

    logger.info(
        "Done. events_scanned=%d events_with_inserts=%d outcomes_inserted=%d (dry_run=%s)",
        total_events, events_with_inserts, total_inserted, dry_run,
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--include-inactive",
        action="store_true",
        help="Also process events marked is_active=False (default: skip).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log what would be inserted without writing to the DB.",
    )
    parser.add_argument(
        "--bill",
        default=None,
        help="Restrict to a single bill_number (e.g. 'HB 384'). Match is exact.",
    )
    parser.add_argument(
        "--session",
        type=int,
        default=None,
        help="Restrict to a specific legislature session number (e.g. 34).",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    rc = asyncio.run(run(
        include_inactive=args.include_inactive,
        dry_run=args.dry_run,
        bill_filter=args.bill,
        session_filter=args.session,
    ))
    raise SystemExit(rc)


if __name__ == "__main__":
    main()

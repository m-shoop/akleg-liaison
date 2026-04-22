"""
Background scheduler: auto-suggests hearing assignments at 4:45 AM and 4:45 PM
Juneau time, running after the bill and hearing syncs (4:05 AM/PM).

For each future hearing that has a tracked bill on its current agenda with no
existing hearing_assignment (for that exact hearing/bill pair), the system looks
up the most recent prior assignment for that bill and creates an
auto_suggested_hearing_assignment workflow for the same assignee.

Suggestions with no prior assignment history are skipped — use the
"Has Unassigned Tracked Bills" filter on the Hearings page to find those manually.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.database import AsyncSessionLocal
from app.models.workflow import WorkflowActionType
from app.repositories.workflow_repository import (
    create_hearing_assignment_workflow,
    get_hearing_bill_combos_needing_suggestion,
    get_most_recent_assignee_for_bill,
)

logger = logging.getLogger(__name__)

_JUNEAU_TZ = ZoneInfo("America/Anchorage")
_SUGGESTION_TIMES = [(5, 54), (16, 45)]  # 4:45 AM and 4:45 PM Juneau


def _seconds_until_next_suggestion_run() -> float:
    now = datetime.now(_JUNEAU_TZ)
    candidates = []
    for hour, minute in _SUGGESTION_TIMES:
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        candidates.append(candidate)
    next_run = min(candidates)
    return (next_run - now).total_seconds()


async def _run_suggestions() -> None:
    """
    Find all future hearing/bill combos needing a suggestion, look up the most
    recent prior assignee for each bill, and create auto-suggested workflows.
    """
    today_juneau = datetime.now(_JUNEAU_TZ).date()
    logger.info("[suggester] Starting hearing assignment suggestion run (Juneau date: %s).", today_juneau)

    async with AsyncSessionLocal() as db:
        combos = await get_hearing_bill_combos_needing_suggestion(db, reference_date=today_juneau)
        logger.info("[suggester] %d hearing/bill combo(s) need evaluation.", len(combos))

        created = 0
        skipped = 0

        for hearing_id, bill_id in combos:
            try:
                assignee_id = await get_most_recent_assignee_for_bill(db, bill_id)
                if assignee_id is None:
                    logger.info(
                        "[suggester] No prior assignee for bill_id=%d, hearing_id=%d — skipping.",
                        bill_id,
                        hearing_id,
                    )
                    skipped += 1
                    continue

                await create_hearing_assignment_workflow(
                    db,
                    hearing_id=hearing_id,
                    assignee_id=assignee_id,
                    bill_id=bill_id,
                    created_by_user_id=assignee_id,
                    initial_action_type=WorkflowActionType.AUTO_SUGGESTED_HEARING_ASSIGNMENT,
                    action_actor_user_id=assignee_id,
                )
                created += 1

            except Exception as exc:
                logger.warning(
                    "[suggester] Error creating suggestion for hearing_id=%d bill_id=%d: %s",
                    hearing_id,
                    bill_id,
                    exc,
                )

        await db.commit()

    logger.info(
        "[suggester] Suggestion run complete: %d created, %d skipped (no prior assignee).",
        created,
        skipped,
    )


async def hearing_assignment_suggester_loop() -> None:
    """
    Suggestion loop. Runs at 4:45 AM and 4:45 PM Juneau time daily — after the
    bill and hearing syncs at 4:05 AM/PM. Designed to run as a fire-and-forget
    asyncio.Task.
    """
    while True:
        wait = _seconds_until_next_suggestion_run()
        next_run = datetime.now(_JUNEAU_TZ) + timedelta(seconds=wait)
        logger.info(
            "[suggester] Next suggestion run at %s.",
            next_run.strftime("%Y-%m-%d %H:%M %Z"),
        )
        await asyncio.sleep(wait)
        await _run_suggestions()

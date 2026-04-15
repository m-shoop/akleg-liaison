import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_optional_current_user, require_permission
from app.models.bill import BillEventOutcome
from app.repositories.bill_repository import (
    get_bill_by_id,
    get_event_by_id,
    insert_outcomes,
    list_bills,
    list_events_for_bill,
    set_bill_tracked,
    upsert_bill,
)
from app.repositories.audit_log_repository import log_action
from app.repositories.job_repository import create_job, get_job, set_job_complete, set_job_failed, set_job_running
from app.repositories.workflow_repository import (
    close_open_workflows_for_bill,
    get_bill_tracking_state,
)
from app.models.workflow import WorkflowActionType
from app.schemas.bill import (
    BillEventOutcomeCreate,
    BillEventOutcomeRead,
    BillEventRead,
    BillRead,
)
from app.schemas.job import JobRead
from app.services.bill_scraper import ScrapedEvent, scrape_bill, scrape_bill_list
from app.services.bill_sync import refresh_bill as sync_refresh_bill
from app.services.outcome_analyzer import analyze_event as analyze_event_with_mistral

router = APIRouter(prefix="/bills", tags=["bills"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_bill_or_404(bill_id: int, db: AsyncSession):
    bill = await get_bill_by_id(db, bill_id, load_relations=True)
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


async def _get_event_or_404(event_id: int, db: AsyncSession):
    event = await get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _strip_tags(bill_read: BillRead) -> BillRead:
    bill_read.tags = []
    return bill_read


# ---------------------------------------------------------------------------
# Bills
# ---------------------------------------------------------------------------

async def _run_refresh_job(job_id, bill_number: str, session: int) -> None:
    """Background task: re-scrapes a bill and syncs its fiscal notes."""
    import httpx

    from app.database import AsyncSessionLocal
    from app.services.fiscal_note_sync import load_allnotes_entries, sync_fiscal_notes_for_bill

    allnotes_entries = await load_allnotes_entries()

    async with AsyncSessionLocal() as db:
        await set_job_running(db, job_id)
        await db.commit()
        try:
            bill_id = await sync_refresh_bill(db, bill_number, session)
            if allnotes_entries:
                async with httpx.AsyncClient() as client:
                    await sync_fiscal_notes_for_bill(
                        db, bill_id, bill_number, allnotes_entries, client
                    )
            await set_job_complete(db, job_id, {"bill_id": bill_id})
            await db.commit()
        except Exception as exc:
            await db.rollback()
            await set_job_failed(db, job_id, str(exc))
            await db.commit()


@router.post("/{bill_id}/refresh", response_model=JobRead, status_code=202)
async def refresh_bill(
    bill_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("bill:query")),
):
    """Enqueue a bill re-scrape and return immediately. Poll GET /jobs/{id} for status."""
    bill = await _get_bill_or_404(bill_id, db)
    job_id = await create_job(db, job_type="refresh_bill")
    await log_action(db, current_user.user, "bill_queried", entity_type="bill", entity_id=bill_id, details={"bill_number": bill.bill_number})
    await db.commit()
    background_tasks.add_task(_run_refresh_job, job_id, bill.bill_number, bill.session)
    job = await get_job(db, job_id)
    return job


async def _run_fetch_all(session: int) -> None:
    """Background task: pull every bill from the Range page and upsert it."""
    from app.database import AsyncSessionLocal

    bill_numbers = await scrape_bill_list(session)
    logger.info("[fetch-all] Found %d bills to import.", len(bill_numbers))
    for bill_number in bill_numbers:
        try:
            async with AsyncSessionLocal() as db:
                await sync_refresh_bill(db, bill_number, session)
                await db.commit()
            logger.info("[fetch-all] Imported %s", bill_number)
        except Exception as exc:
            logger.warning("[fetch-all] Error importing %s: %s", bill_number, exc)
    logger.info("[fetch-all] Import complete.")


@router.post("/fetch-all", status_code=202)
async def fetch_all_bills(
    background_tasks: BackgroundTasks,
    _: CurrentUser = Depends(require_permission("bill:query")),
):
    """
    Scrape every bill listed on akleg.gov for session 34, upsert them all,
    and analyze any new events.  Returns immediately — work runs in the background.
    """
    background_tasks.add_task(_run_fetch_all, 34)
    return {"message": "Import started. Bills will appear as they are processed."}


@router.get("", response_model=list[BillRead])
async def list_bills_route(
    db: AsyncSession = Depends(get_db),
    include_untracked: bool = Query(False),
    current_user: CurrentUser | None = Depends(get_optional_current_user),
):
    bills = await list_bills(db, include_untracked=include_untracked)
    can_view_tags = current_user is not None and current_user.can("bill-tags:view")
    bills_read = [BillRead.model_validate(b) for b in bills]
    if not can_view_tags:
        for b in bills_read:
            b.tags = []

    # Enrich with tracking request state (only for untracked bills)
    untracked_bill_ids = [b.id for b in bills_read if not b.is_tracked]
    if untracked_bill_ids:
        user_id = current_user.user.id if current_user else None
        tracking_state = await get_bill_tracking_state(db, untracked_bill_ids, user_id)
        for b in bills_read:
            if not b.is_tracked and b.id in tracking_state:
                b.tracking_requested = tracking_state[b.id]["tracking_requested"]
                b.user_tracking_request_denied = tracking_state[b.id]["user_tracking_request_denied"]

    return bills_read


@router.patch("/{bill_id}/tracked", response_model=BillRead)
async def update_bill_tracked(
    bill_id: int,
    background_tasks: BackgroundTasks,
    is_tracked: bool = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("bill:track")),
):
    """Set or clear the is_tracked flag on a bill. Marking as tracked triggers an immediate sync."""
    bill = await set_bill_tracked(db, bill_id, is_tracked)
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    action = "bill_tracked" if is_tracked else "bill_untracked"
    await log_action(db, current_user.user, action, entity_type="bill", entity_id=bill_id, details={"bill_number": bill.bill_number})
    if is_tracked:
        job_id = await create_job(db, job_type="refresh_bill")
        # Auto-close any pending tracking request workflows for this bill
        await close_open_workflows_for_bill(
            db,
            bill_id=bill_id,
            action_type=WorkflowActionType.APPROVE_BILL_TRACKING,
            acting_user_id=current_user.user.id,
        )
    await db.commit()
    if is_tracked:
        background_tasks.add_task(_run_refresh_job, job_id, bill.bill_number, bill.session)
    bill_read = BillRead.model_validate(await _get_bill_or_404(bill_id, db))
    return bill_read


@router.get("/{bill_id}", response_model=BillRead)
async def get_bill(
    bill_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser | None = Depends(get_optional_current_user),
):
    bill = await _get_bill_or_404(bill_id, db)
    bill_read = BillRead.model_validate(bill)
    if current_user is None or not current_user.can("bill-tags:view"):
        bill_read.tags = []
    return bill_read


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@router.get("/{bill_id}/events", response_model=list[BillEventRead])
async def list_events(bill_id: int, db: AsyncSession = Depends(get_db)):
    await _get_bill_or_404(bill_id, db)
    return await list_events_for_bill(db, bill_id)


# ---------------------------------------------------------------------------
# Outcomes
# ---------------------------------------------------------------------------

@router.get("/{bill_id}/events/{event_id}/outcomes", response_model=list[BillEventOutcomeRead])
async def list_outcomes(
    bill_id: int, event_id: int, db: AsyncSession = Depends(get_db)
):
    event = await _get_event_or_404(event_id, db)
    if event.bill_id != bill_id:
        raise HTTPException(status_code=404, detail="Event not found for this bill")
    return event.outcomes


@router.post(
    "/{bill_id}/events/{event_id}/outcomes",
    response_model=BillEventOutcomeRead,
    status_code=201,
)
async def add_outcome(
    bill_id: int,
    event_id: int,
    body: BillEventOutcomeCreate,
    db: AsyncSession = Depends(get_db),
):
    """Manually attach an outcome to an event."""
    event = await _get_event_or_404(event_id, db)
    if event.bill_id != bill_id:
        raise HTTPException(status_code=404, detail="Event not found for this bill")
    outcome = BillEventOutcome(
        event_id=event_id,
        chamber=body.chamber,
        description=body.description,
        outcome_type=body.outcome_type,
        committee=body.committee,
        ai_generated=False,
    )
    db.add(outcome)
    await db.commit()
    await db.refresh(outcome)
    return outcome


@router.post(
    "/{bill_id}/events/{event_id}/analyze",
    response_model=list[BillEventOutcomeRead],
    status_code=201,
)
async def analyze_event(
    bill_id: int,
    event_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Trigger Mistral AI analysis of an event's source document."""
    event = await _get_event_or_404(event_id, db)
    if event.bill_id != bill_id:
        raise HTTPException(status_code=404, detail="Event not found for this bill")
    bill = await get_bill_by_id(db, bill_id)
    scraped_event = ScrapedEvent(
        event_date=event.event_date,
        source_url=event.source_url,
        event_type=event.event_type,
        chamber=event.chamber,
        raw_text=event.raw_text,
    )
    outcomes = await analyze_event_with_mistral(scraped_event, bill.bill_number)
    await insert_outcomes(db, event_id, outcomes)
    await db.commit()
    refreshed = await _get_event_or_404(event_id, db)
    return refreshed.outcomes

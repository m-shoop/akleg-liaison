import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.bill import BillEventOutcome
from app.models.user import User
from app.repositories.bill_repository import (
    get_bill_by_id,
    get_event_by_id,
    insert_outcomes,
    list_bills,
    list_events_for_bill,
    set_bill_tracked,
    upsert_bill,
)
from app.schemas.bill import (
    BillEventOutcomeCreate,
    BillEventOutcomeRead,
    BillEventRead,
    BillFetchRequest,
    BillRead,
)
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


# ---------------------------------------------------------------------------
# Bills
# ---------------------------------------------------------------------------

@router.post("/fetch", response_model=BillRead, status_code=201)
async def fetch_and_persist_bill(
    request: BillFetchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Scrape a bill from akleg.gov and upsert it into the database."""
    bill_id = await sync_refresh_bill(db, request.bill_number, request.session)
    await db.commit()
    return await _get_bill_or_404(bill_id, db)


@router.post("/{bill_id}/refresh", response_model=BillRead)
async def refresh_bill(
    bill_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Re-scrape a bill and upsert any new events, analyzing any that are new."""
    bill = await _get_bill_or_404(bill_id, db)
    await sync_refresh_bill(db, bill.bill_number, bill.session)
    await db.commit()
    return await _get_bill_or_404(bill_id, db)


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
    _: User = Depends(get_current_user),
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
):
    return await list_bills(db, include_untracked=include_untracked)


@router.patch("/{bill_id}/tracked", response_model=BillRead)
async def update_bill_tracked(
    bill_id: int,
    is_tracked: bool = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Set or clear the is_tracked flag on a bill."""
    bill = await set_bill_tracked(db, bill_id, is_tracked)
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    await db.commit()
    return await _get_bill_or_404(bill_id, db)


@router.get("/{bill_id}", response_model=BillRead)
async def get_bill(bill_id: int, db: AsyncSession = Depends(get_db)):
    return await _get_bill_or_404(bill_id, db)


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

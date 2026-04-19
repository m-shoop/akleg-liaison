from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.dependencies import CurrentUser, get_optional_current_user, require_permission
from app.repositories.audit_log_repository import log_action
from app.repositories.job_repository import (
    create_job,
    get_job,
    set_job_complete,
    set_job_failed,
    set_job_running,
)
from app.repositories.hearing_repository import (
    get_hearing_by_id,
    get_prior_agenda_versions,
    get_recent_hearing_dates,
    get_upcoming_hearing_dates,
    list_hearings,
    update_dps_notes,
    update_hidden,
)
from app.schemas.hearing import (
    HearingDpsNotesUpdate,
    HearingHiddenUpdate,
    HearingRead,
    HearingScrapeRequest,
    PriorAgendaVersionRead,
)
from app.schemas.job import JobRead
from app.services.hearing_scraper import scrape_and_store_hearings

router = APIRouter(tags=["hearings"])


async def _run_scrape_job(
    job_id: int,
    start: date,
    end: date,
    legislature_session: int,
) -> None:
    """Background task: runs the scrape in its own DB session."""
    async with AsyncSessionLocal() as db:
        await set_job_running(db, job_id)
        await db.commit()
        try:
            count = await scrape_and_store_hearings(db, start, end, legislature_session)
            await set_job_complete(db, job_id, {"hearings_saved": count})
            await db.commit()
        except Exception as exc:
            await set_job_failed(db, job_id, str(exc))
            await db.commit()


@router.get("/hearings/upcoming-bill-hearings", response_model=dict[int, list[date]])
async def upcoming_bill_hearings(
    legislature_session: int = Query(34),
    db: AsyncSession = Depends(get_db),
):
    """Return {bill_id: [upcoming_dates]} (up to 4 per bill) for all bills
    with active hearings scheduled today or later."""
    return await get_upcoming_hearing_dates(db, legislature_session, date.today())


@router.get("/hearings/recent-bill-hearings", response_model=dict[int, list[date]])
async def recent_bill_hearings(
    legislature_session: int = Query(34),
    db: AsyncSession = Depends(get_db),
):
    """Return {bill_id: [past_dates]} (up to 3 most recent per bill, asc) for
    all bills with active hearings before today."""
    return await get_recent_hearing_dates(db, legislature_session, date.today())


@router.get("/hearings", response_model=list[HearingRead])
async def get_hearings(
    start_date: date = Query(...),
    end_date: date | None = Query(None),
    legislature_session: int = Query(34),
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser | None = Depends(get_optional_current_user),
):
    hearings = await list_hearings(
        db, start_date, end_date, legislature_session, include_inactive
    )
    can_view_notes = current_user is not None and current_user.can("hearing-notes:view")
    if not can_view_notes:
        for h in hearings:
            h.dps_notes = None
    return hearings


@router.post("/hearings/scrape", response_model=JobRead, status_code=202)
async def scrape_hearings(
    body: HearingScrapeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_permission("hearing:query")),
):
    """Enqueue a scrape job and return immediately. Poll GET /jobs/{id} for status."""
    job_id = await create_job(db, job_type="scrape_hearings")
    await db.commit()
    background_tasks.add_task(
        _run_scrape_job, job_id, body.start_date, body.end_date, body.legislature_session
    )
    job = await get_job(db, job_id)
    return job


@router.get(
    "/hearings/{hearing_id}/prior-agendas",
    response_model=list[PriorAgendaVersionRead],
)
async def get_prior_agendas(
    hearing_id: int,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(require_permission("prior-hearing-agendas:view")),
):
    """Return all prior (non-current) agenda versions for a hearing, newest first."""
    existing = await get_hearing_by_id(db, hearing_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Hearing not found")
    return await get_prior_agenda_versions(db, hearing_id)


@router.patch("/hearings/{hearing_id}/hidden", response_model=HearingRead)
async def patch_hidden(
    hearing_id: int,
    body: HearingHiddenUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("hearing:hide")),
):
    existing = await get_hearing_by_id(db, hearing_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Hearing not found")
    hearing = await update_hidden(db, hearing_id, body.hidden)
    label = existing.committee_name or f"{existing.chamber} Floor"
    await log_action(
        db,
        current_user.user,
        "hearing_hidden_updated",
        entity_type="hearing",
        entity_id=hearing_id,
        details={
            "hidden": body.hidden,
            "label": label,
            "hearing_date": str(existing.hearing_date),
        },
    )
    await db.commit()
    await db.refresh(hearing)
    return hearing


@router.patch("/hearings/{hearing_id}/dps-notes", response_model=HearingRead)
async def patch_dps_notes(
    hearing_id: int,
    body: HearingDpsNotesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("hearing-notes:edit")),
):
    existing = await get_hearing_by_id(db, hearing_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Hearing not found")
    old_notes = existing.dps_notes
    hearing = await update_dps_notes(db, hearing_id, body.dps_notes)
    label = existing.committee_name or f"{existing.chamber} Floor"
    await log_action(
        db,
        current_user.user,
        "hearing_notes_updated",
        entity_type="hearing",
        entity_id=hearing_id,
        details={
            "old_notes": old_notes,
            "new_notes": body.dps_notes,
            "label": label,
            "hearing_date": str(existing.hearing_date),
        },
    )
    await db.commit()
    await db.refresh(hearing)
    return hearing

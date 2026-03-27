from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.repositories.job_repository import (
    create_job,
    set_job_complete,
    set_job_failed,
    set_job_running,
)
from app.repositories.audit_log_repository import log_action
from app.repositories.meeting_repository import (
    get_meeting_by_id,
    list_meetings,
    update_dps_notes,
)
from app.schemas.job import JobRead
from app.schemas.meeting import MeetingDpsNotesUpdate, MeetingRead, MeetingScrapeRequest
from app.services.meeting_scraper import scrape_and_store_meetings

router = APIRouter(tags=["meetings"])


async def _run_scrape_job(
    job_id,
    start: date,
    end: date,
    legislature_session: int,
) -> None:
    """Background task: runs the scrape in its own DB session."""
    async with AsyncSessionLocal() as db:
        await set_job_running(db, job_id)
        await db.commit()
        try:
            count = await scrape_and_store_meetings(db, start, end, legislature_session)
            await set_job_complete(db, job_id, {"meetings_saved": count})
            await db.commit()
        except Exception as exc:
            await set_job_failed(db, job_id, str(exc))
            await db.commit()


@router.get("/meetings", response_model=list[MeetingRead])
async def get_meetings(
    start_date: date = Query(...),
    end_date: date | None = Query(None),
    legislature_session: int = Query(34),
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    return await list_meetings(db, start_date, end_date, legislature_session, include_inactive)


@router.post("/meetings/scrape", response_model=JobRead, status_code=202)
async def scrape_meetings(
    body: MeetingScrapeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Enqueue a scrape job and return immediately. Poll GET /jobs/{id} for status."""
    job_id = await create_job(db, job_type="scrape_meetings")
    await db.commit()
    background_tasks.add_task(
        _run_scrape_job, job_id, body.start_date, body.end_date, body.legislature_session
    )
    from app.repositories.job_repository import get_job
    job = await get_job(db, job_id)
    return job


@router.patch("/meetings/{meeting_id}/dps-notes", response_model=MeetingRead)
async def patch_dps_notes(
    meeting_id: int,
    body: MeetingDpsNotesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await get_meeting_by_id(db, meeting_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    old_notes = existing.dps_notes
    meeting = await update_dps_notes(db, meeting_id, body.dps_notes)
    await log_action(db, current_user, "meeting_notes_updated", entity_type="meeting", entity_id=meeting_id, details={"old_notes": old_notes, "new_notes": body.dps_notes, "committee": existing.committee_name, "meeting_date": str(existing.meeting_date)})
    await db.commit()
    await db.refresh(meeting)
    return meeting

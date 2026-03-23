from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.repositories.meeting_repository import (
    get_meeting_by_id,
    list_meetings,
    update_dps_notes,
)
from app.schemas.meeting import MeetingDpsNotesUpdate, MeetingRead, MeetingScrapeRequest
from app.services.meeting_scraper import scrape_and_store_meetings

router = APIRouter(tags=["meetings"])


@router.get("/meetings", response_model=list[MeetingRead])
async def get_meetings(
    start_date: date = Query(...),
    end_date: date = Query(...),
    legislature_session: int = Query(34),
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    return await list_meetings(db, start_date, end_date, legislature_session, include_inactive)


@router.post("/meetings/scrape", status_code=201)
async def scrape_meetings(
    body: MeetingScrapeRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Fetch and store meetings for a given date range from akleg.gov."""
    try:
        count = await scrape_and_store_meetings(
            db,
            start=body.start_date,
            end=body.end_date,
            legislature_session=body.legislature_session,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"meetings_saved": count}


@router.patch("/meetings/{meeting_id}/dps-notes", response_model=MeetingRead)
async def patch_dps_notes(
    meeting_id: int,
    body: MeetingDpsNotesUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    meeting = await update_dps_notes(db, meeting_id, body.dps_notes)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    await db.commit()
    await db.refresh(meeting)
    return meeting

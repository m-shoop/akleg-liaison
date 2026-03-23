from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict


class AgendaItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meeting_id: int
    bill_id: int | None
    bill_number: str | None
    content: str
    url: str | None
    prefix: str | None
    is_bill: bool
    is_teleconferenced: bool
    sort_order: int
    created_at: datetime


class MeetingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chamber: str
    committee_name: str
    committee_type: str
    committee_code: str | None
    committee_url: str | None
    meeting_date: date
    meeting_time: time | None
    location: str | None
    legislature_session: int
    is_active: bool
    dps_notes: str | None
    # True when an inactive sibling meeting (same chamber/committee/date) has notes
    has_inactive_notes_sibling: bool = False
    created_at: datetime
    agenda_items: list[AgendaItemRead]


class MeetingScrapeRequest(BaseModel):
    start_date: date
    end_date: date
    legislature_session: int = 34


class MeetingDpsNotesUpdate(BaseModel):
    dps_notes: str | None

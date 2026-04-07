from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.bill import Chamber, EventType, OutcomeType
from app.schemas.fiscal_note import FiscalNoteRead
from app.schemas.tag import TagRead


class BillKeywordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    keyword: str
    url: str | None


class BillSponsorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    chamber: str | None
    sponsor_type: str


class BillEventOutcomeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chamber: Chamber
    description: str
    outcome_type: OutcomeType
    committee: str | None
    ai_generated: bool
    created_at: datetime


class BillEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_date: date
    source_url: str
    event_type: EventType
    chamber: Chamber
    raw_text: str
    analyzed: bool
    created_at: datetime
    updated_at: datetime
    outcomes: list[BillEventOutcomeRead]


class BillRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bill_number: str
    session: int
    title: str | None
    short_title: str | None
    status: str | None
    introduced_date: date | None
    source_url: str | None
    is_tracked: bool
    last_sync: datetime | None
    created_at: datetime
    updated_at: datetime
    sponsors: list[BillSponsorRead]
    events: list[BillEventRead]
    tags: list[TagRead]
    keywords: list[BillKeywordRead]
    fiscal_notes: list[FiscalNoteRead]
    fiscal_notes_query_failed: bool


class BillFetchRequest(BaseModel):
    bill_number: str
    session: int


class BillEventOutcomeCreate(BaseModel):
    """Manually attach an outcome to an event."""

    chamber: Chamber
    description: str
    outcome_type: OutcomeType
    committee: str | None = None

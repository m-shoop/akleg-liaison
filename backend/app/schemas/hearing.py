from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict


class AgendaItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    agenda_version_id: int
    bill_id: int | None
    bill_number: str | None
    content: str
    url: str | None
    prefix: str | None
    is_bill: bool
    is_teleconferenced: bool
    sort_order: int
    created_at: datetime


class HearingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chamber: str
    hearing_type: str        # "Floor" or "Committee"
    length: int              # minutes
    hearing_date: date
    hearing_time: time | None
    location: str | None
    # Committee-specific fields — None for floor hearings.
    committee_name: str | None
    committee_type: str | None
    committee_url: str | None
    legislature_session: int
    is_active: bool
    hidden: bool
    dps_notes: str | None
    last_sync: datetime | None
    # True when at least one prior (non-current) agenda version exists.
    has_prior_agendas: bool = False
    # created_at of the current agenda version.
    current_agenda_created_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    agenda_items: list[AgendaItemRead]


class PriorAgendaVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: int
    created_at: datetime
    agenda_items: list[AgendaItemRead]


class HearingScrapeRequest(BaseModel):
    start_date: date
    end_date: date
    legislature_session: int = 34


class HearingDpsNotesUpdate(BaseModel):
    dps_notes: str | None


class HearingHiddenUpdate(BaseModel):
    hidden: bool

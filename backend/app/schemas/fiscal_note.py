from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class FiscalNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    session_id: str
    fn_department: str | None
    is_active: bool
    control_code: str | None
    fn_identifier: str | None
    publish_date: date | None
    last_synced: datetime | None
    creation_timestamp: datetime

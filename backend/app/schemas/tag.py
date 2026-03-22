from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    is_active: bool
    created_at: datetime


class TagCreate(BaseModel):
    label: str


class TagUpdate(BaseModel):
    is_active: bool

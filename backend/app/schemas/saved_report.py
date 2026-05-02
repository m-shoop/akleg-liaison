from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.saved_report import PublicationLevel


class SavedReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str
    registry_name: str
    publication_level: PublicationLevel
    user_id: int | None
    allowed_roles: list[str]
    is_active: bool
    report_criteria: dict
    created_at: datetime
    updated_at: datetime


class SavedReportListResponse(BaseModel):
    reports: list[SavedReportRead]
    default_report_id: int | None


class SavedReportCreate(BaseModel):
    display_name: str = Field(min_length=1)
    registry_name: str
    publication_level: PublicationLevel
    allowed_roles: list[str] = Field(default_factory=list)
    report_criteria: dict


class SavedReportUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1)
    report_criteria: dict | None = None
    is_active: bool | None = None
    allowed_roles: list[str] | None = None


class DefaultUserReportSet(BaseModel):
    # null clears the default for this (user, registry)
    report_id: int | None


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str

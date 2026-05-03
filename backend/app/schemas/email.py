from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.workflow import AssignmentType


# ---------------------------------------------------------------------------
# Email templates
# ---------------------------------------------------------------------------


class EmailTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_key: str
    name: str
    description: str | None
    subject_template: str
    body_markdown: str
    default_cc_email: str | None
    updated_at: datetime
    updated_by: int | None


class EmailTemplateUpdate(BaseModel):
    subject_template: str
    body_markdown: str
    default_cc_email: str | None = None


class EmailTemplatePreviewRequest(BaseModel):
    hearing_id: int
    bill_id: int | None = None
    cancellation_reason: str | None = None
    assignment_type: AssignmentType | None = None


class EmailTemplatePreviewResponse(BaseModel):
    subject: str
    html_body: str
    text_body: str


class PreviewBillItem(BaseModel):
    bill_id: int
    bill_number: str
    content: str | None = None


class PreviewHearingItem(BaseModel):
    id: int
    label: str  # "<date> <time> <committee> <bill #s>"
    bills: list[PreviewBillItem] = []


# ---------------------------------------------------------------------------
# Email notifications (audit log)
# ---------------------------------------------------------------------------


class EmailNotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hearing_assignment_id: int
    workflow_action_id: int
    template_id: int | None
    event_type: str
    recipient_user_id: int | None
    recipient_email: str
    subject: str
    sent_at: datetime | None
    error: str | None
    suppressed_reason: str | None
    state: str  # derived: pending|sent|failed|suppressed
    created_at: datetime


class EmailNotificationDetail(EmailNotificationRead):
    body: str


# ---------------------------------------------------------------------------
# Comm prefs
# ---------------------------------------------------------------------------


class CommPrefsRead(BaseModel):
    user_id: int
    email: str
    email_enabled: bool
    updated_at: datetime | None
    updated_by: int | None


class CommPrefsUpdate(BaseModel):
    email_enabled: bool


class CommPrefsHistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    field: str
    old_value: bool | None
    new_value: bool
    changed_by: int | None
    source: str | None
    changed_at: datetime

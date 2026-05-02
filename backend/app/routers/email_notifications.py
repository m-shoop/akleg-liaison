"""Admin audit-log endpoints for email_notifications. Read-only —
notifications are inserted by the workflow code, never via API."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.repositories.email_repository import (
    get_notification_by_id,
    list_notifications,
)
from app.schemas.email import EmailNotificationDetail, EmailNotificationRead

router = APIRouter(prefix="/email-notifications", tags=["email-notifications"])


_VALID_STATES = {"pending", "sent", "failed", "suppressed"}


def _to_read(row) -> EmailNotificationRead:
    return EmailNotificationRead(
        id=row.id,
        hearing_assignment_id=row.hearing_assignment_id,
        workflow_action_id=row.workflow_action_id,
        template_id=row.template_id,
        event_type=row.event_type,
        recipient_user_id=row.recipient_user_id,
        recipient_email=row.recipient_email,
        subject=row.subject,
        sent_at=row.sent_at,
        error=row.error,
        suppressed_reason=row.suppressed_reason,
        state=row.state,
        created_at=row.created_at,
    )


@router.get(
    "",
    response_model=list[EmailNotificationRead],
    dependencies=[Depends(require_permission("email-notification:view"))],
)
async def list_notifications_route(
    hearing_assignment_id: int | None = Query(None),
    recipient_user_id: int | None = Query(None),
    event_type: str | None = Query(None),
    status: str | None = Query(None, description="One of pending|sent|failed|suppressed"),
    since: datetime | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    if status is not None and status not in _VALID_STATES:
        raise HTTPException(status_code=422, detail=f"Unknown status: {status}")

    rows = await list_notifications(
        db,
        hearing_assignment_id=hearing_assignment_id,
        recipient_user_id=recipient_user_id,
        event_type=event_type,
        state=status,
        since=since,
        limit=limit,
        offset=offset,
    )
    return [_to_read(r) for r in rows]


@router.get(
    "/{notification_id}",
    response_model=EmailNotificationDetail,
    dependencies=[Depends(require_permission("email-notification:view"))],
)
async def get_notification_route(
    notification_id: int, db: AsyncSession = Depends(get_db)
):
    row = await get_notification_by_id(db, notification_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    base = _to_read(row).model_dump()
    return EmailNotificationDetail(**base, body=row.body)

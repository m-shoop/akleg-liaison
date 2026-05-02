"""Data access for email_templates, email_notifications, and
workflow_action_messages."""

from datetime import datetime, timezone

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email import (
    EmailNotification,
    EmailTemplate,
    WorkflowActionMessage,
)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


async def list_templates(db: AsyncSession) -> list[EmailTemplate]:
    result = await db.execute(select(EmailTemplate).order_by(EmailTemplate.template_key))
    return list(result.scalars().all())


async def get_template_by_key(db: AsyncSession, template_key: str) -> EmailTemplate | None:
    result = await db.execute(
        select(EmailTemplate).where(EmailTemplate.template_key == template_key)
    )
    return result.scalar_one_or_none()


async def update_template(
    db: AsyncSession,
    template: EmailTemplate,
    *,
    subject_template: str,
    body_markdown: str,
    default_cc_email: str | None,
    updated_by: int,
) -> None:
    template.subject_template = subject_template
    template.body_markdown = body_markdown
    template.default_cc_email = default_cc_email
    template.updated_by = updated_by
    template.updated_at = datetime.now(timezone.utc)
    await db.flush()


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


async def has_sent_notification(
    db: AsyncSession, hearing_assignment_id: int, event_type: str
) -> bool:
    """Return True if a notification with this (assignment, event_type) was
    successfully sent."""
    result = await db.execute(
        select(EmailNotification.id)
        .where(
            EmailNotification.hearing_assignment_id == hearing_assignment_id,
            EmailNotification.event_type == event_type,
            EmailNotification.sent_at.isnot(None),
        )
        .limit(1)
    )
    return result.first() is not None


async def creation_was_sent_for_recipient(
    db: AsyncSession, *, hearing_assignment_id: int, recipient_user_id: int
) -> bool:
    """Used by the worker's send-time cancellation gate: did this specific
    recipient actually receive an assignment_created email for this assignment?

    Scoped per-recipient so reassignment doesn't bleed across users — A's
    cancellation only fires if A got a creation, regardless of B's state."""
    result = await db.execute(
        select(EmailNotification.id)
        .where(
            EmailNotification.hearing_assignment_id == hearing_assignment_id,
            EmailNotification.recipient_user_id == recipient_user_id,
            EmailNotification.event_type == "assignment_created",
            EmailNotification.sent_at.isnot(None),
        )
        .limit(1)
    )
    return result.first() is not None


async def cancellation_queued_after(
    db: AsyncSession,
    *,
    hearing_assignment_id: int,
    recipient_user_id: int,
    after_id: int,
) -> bool:
    """Used by the worker's send-time creation gate: was a cancellation queued
    for this recipient after the given creation row?

    If yes, the assignment was canceled before the worker drained the original,
    so sending the "you've been assigned" email would be stale. State of the
    cancellation row (pending/sent/suppressed) doesn't matter — its existence
    is the signal."""
    result = await db.execute(
        select(EmailNotification.id)
        .where(
            EmailNotification.hearing_assignment_id == hearing_assignment_id,
            EmailNotification.recipient_user_id == recipient_user_id,
            EmailNotification.event_type == "assignment_canceled",
            EmailNotification.id > after_id,
        )
        .limit(1)
    )
    return result.first() is not None


async def has_any_notification(
    db: AsyncSession, hearing_assignment_id: int, event_type: str
) -> bool:
    """Return True if a notification of this event_type already exists for the
    assignment, regardless of state. Used to suppress duplicate cancellation
    rows (per the design)."""
    result = await db.execute(
        select(EmailNotification.id)
        .where(
            EmailNotification.hearing_assignment_id == hearing_assignment_id,
            EmailNotification.event_type == event_type,
        )
        .limit(1)
    )
    return result.first() is not None


async def insert_notification(
    db: AsyncSession,
    *,
    hearing_assignment_id: int,
    workflow_action_id: int,
    template_id: int | None,
    event_type: str,
    recipient_user_id: int | None,
    recipient_email: str,
    subject: str,
    body: str,
    suppressed_reason: str | None = None,
) -> EmailNotification:
    notification = EmailNotification(
        hearing_assignment_id=hearing_assignment_id,
        workflow_action_id=workflow_action_id,
        template_id=template_id,
        event_type=event_type,
        recipient_user_id=recipient_user_id,
        recipient_email=recipient_email,
        subject=subject,
        body=body,
        suppressed_reason=suppressed_reason,
    )
    db.add(notification)
    await db.flush()
    return notification


async def get_thread_root_notification_id(
    db: AsyncSession,
    *,
    hearing_assignment_id: int,
    recipient_user_id: int,
    before_id: int,
) -> int | None:
    """Find the earliest already-delivered notification id for this
    (assignment, recipient) pair, used as the thread root for In-Reply-To /
    References on follow-up messages.

    Restricted to rows the recipient actually received (sent_at IS NOT NULL).
    Threading to a Message-ID their mail client never saw would be a no-op, and
    skipping suppressed/failed rows keeps the chain clean."""
    result = await db.execute(
        select(EmailNotification.id)
        .where(
            EmailNotification.hearing_assignment_id == hearing_assignment_id,
            EmailNotification.recipient_user_id == recipient_user_id,
            EmailNotification.sent_at.isnot(None),
            EmailNotification.id < before_id,
        )
        .order_by(EmailNotification.id.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def fetch_pending_notifications(
    db: AsyncSession, *, limit: int
) -> list[EmailNotification]:
    """Pending = not sent, not failed, not suppressed. The worker query in
    the design uses FOR UPDATE SKIP LOCKED; we add it here for forward-compat
    with multiple workers, but the app currently runs one."""
    result = await db.execute(
        select(EmailNotification)
        .where(
            EmailNotification.sent_at.is_(None),
            EmailNotification.error.is_(None),
            EmailNotification.suppressed_reason.is_(None),
        )
        .order_by(EmailNotification.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list(result.scalars().all())


async def mark_notification_sent(db: AsyncSession, notification_id: int) -> None:
    await db.execute(
        update(EmailNotification)
        .where(EmailNotification.id == notification_id)
        .values(sent_at=datetime.now(timezone.utc), error=None)
    )


async def mark_notification_failed(
    db: AsyncSession, notification_id: int, error_text: str
) -> None:
    await db.execute(
        update(EmailNotification)
        .where(EmailNotification.id == notification_id)
        .values(error=error_text)
    )


async def mark_notification_suppressed(
    db: AsyncSession, notification_id: int, reason: str
) -> None:
    await db.execute(
        update(EmailNotification)
        .where(EmailNotification.id == notification_id)
        .values(suppressed_reason=reason)
    )


async def list_notifications(
    db: AsyncSession,
    *,
    hearing_assignment_id: int | None,
    recipient_user_id: int | None,
    event_type: str | None,
    state: str | None,
    since: datetime | None,
    limit: int,
    offset: int,
) -> list[EmailNotification]:
    q = select(EmailNotification).order_by(desc(EmailNotification.created_at))
    if hearing_assignment_id is not None:
        q = q.where(EmailNotification.hearing_assignment_id == hearing_assignment_id)
    if recipient_user_id is not None:
        q = q.where(EmailNotification.recipient_user_id == recipient_user_id)
    if event_type is not None:
        q = q.where(EmailNotification.event_type == event_type)
    if since is not None:
        q = q.where(EmailNotification.created_at >= since)
    if state == "pending":
        q = q.where(
            EmailNotification.sent_at.is_(None),
            EmailNotification.error.is_(None),
            EmailNotification.suppressed_reason.is_(None),
        )
    elif state == "sent":
        q = q.where(EmailNotification.sent_at.isnot(None))
    elif state == "failed":
        q = q.where(
            EmailNotification.error.isnot(None),
            EmailNotification.sent_at.is_(None),
            EmailNotification.suppressed_reason.is_(None),
        )
    elif state == "suppressed":
        q = q.where(EmailNotification.suppressed_reason.isnot(None))

    result = await db.execute(q.limit(limit).offset(offset))
    return list(result.scalars().all())


async def get_notification_by_id(
    db: AsyncSession, notification_id: int
) -> EmailNotification | None:
    result = await db.execute(
        select(EmailNotification).where(EmailNotification.id == notification_id)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Workflow action messages (cancellation reason etc.)
# ---------------------------------------------------------------------------


async def upsert_workflow_action_message(
    db: AsyncSession,
    *,
    workflow_action_id: int,
    message_type: str,
    action_message: str,
) -> WorkflowActionMessage:
    """Insert (or replace) the message for a (workflow_action, message_type)
    pair. The unique constraint allows on-conflict updates."""
    result = await db.execute(
        select(WorkflowActionMessage).where(
            WorkflowActionMessage.workflow_action_id == workflow_action_id,
            WorkflowActionMessage.message_type == message_type,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        existing.action_message = action_message
        existing.updated_at = datetime.now(timezone.utc)
        await db.flush()
        return existing

    msg = WorkflowActionMessage(
        workflow_action_id=workflow_action_id,
        message_type=message_type,
        action_message=action_message,
    )
    db.add(msg)
    await db.flush()
    return msg


async def get_workflow_action_message(
    db: AsyncSession, workflow_action_id: int, message_type: str
) -> str | None:
    result = await db.execute(
        select(WorkflowActionMessage.action_message).where(
            WorkflowActionMessage.workflow_action_id == workflow_action_id,
            WorkflowActionMessage.message_type == message_type,
        )
    )
    return result.scalar_one_or_none()

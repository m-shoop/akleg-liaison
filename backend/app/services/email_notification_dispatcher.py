"""
High-level dispatcher: turns a hearing-assignment workflow event into a row in
email_notifications.

Called inline from the assignment routes after the workflow_action has been
flushed but before the surrounding transaction commits. The actual SMTP send
happens later, in the worker — this layer's job is template lookup, render,
and recording the snapshot.

If the recipient has opted out, we still insert a row (with
suppressed_reason) so the audit trail shows the email was suppressed rather
than silently dropped — see the design notes.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill import Bill
from app.models.email import EmailEventType, EmailNotification
from app.models.hearing import Hearing
from app.models.user import User
from app.models.workflow import AssignmentType, HearingAssignment
from app.repositories.bill_repository import get_bill_by_id
from app.repositories.comm_prefs_repository import get_email_enabled
from app.repositories.email_repository import (
    get_template_by_key,
    has_any_notification,
    insert_notification,
)
from app.repositories.hearing_repository import get_hearing_by_id
from app.repositories.user_repository import get_user_by_id
from app.services.email_notification_service import (
    build_template_context,
    opt_out_url_for,
    render_subject,
    render_body_html,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event + assignment_type -> template_key resolution
# ---------------------------------------------------------------------------

# The assignment-created event has two templates (one per assignment_type).
# Cancellation has a single template regardless of assignment_type.
_CREATED_TEMPLATE_KEYS: dict[AssignmentType, str] = {
    AssignmentType.MONITORING: "hearing_assignment_monitoring",
    AssignmentType.AWARENESS: "hearing_assignment_awareness",
}
_CANCELED_TEMPLATE_KEY = "hearing_assignment_canceled"
_TYPE_CHANGED_TEMPLATE_KEY = "assignment_type_change"


async def _resolve_template_key_and_type(
    db: AsyncSession,
    event_type: EmailEventType,
    hearing_assignment_id: int,
) -> tuple[str, AssignmentType] | None:
    """Look up the assignment_type for the given hearing_assignment and pick
    the right template_key for the event. Returns None if the assignment is
    missing (caller logs and skips)."""
    result = await db.execute(
        select(HearingAssignment.assignment_type).where(
            HearingAssignment.id == hearing_assignment_id
        )
    )
    assignment_type = result.scalar_one_or_none()
    if assignment_type is None:
        return None

    if event_type == EmailEventType.ASSIGNMENT_CANCELED:
        return _CANCELED_TEMPLATE_KEY, assignment_type
    if event_type == EmailEventType.ASSIGNMENT_TYPE_CHANGED:
        return _TYPE_CHANGED_TEMPLATE_KEY, assignment_type
    return _CREATED_TEMPLATE_KEYS[assignment_type], assignment_type


# ---------------------------------------------------------------------------
# Public dispatcher
# ---------------------------------------------------------------------------


async def queue_assignment_notification(
    db: AsyncSession,
    *,
    hearing_assignment_id: int,
    workflow_action_id: int,
    event_type: EmailEventType,
    recipient_user_id: int,
    hearing_id: int,
    bill_id: int | None,
    cancellation_reason: str | None = None,
    previous_assignment_type: AssignmentType | None = None,
    suppressed_reason_override: str | None = None,
) -> EmailNotification | None:
    """
    Queue an email notification for a hearing assignment event.

    Returns the inserted EmailNotification row, or None if the event was
    skipped (e.g. cancellation when no creation email was ever sent).

    Caller commits the surrounding transaction.
    """
    # ── Duplicate-cancellation guard ──
    # The "is creation actually sent?" gate moved to the worker (it can't be
    # decided at queue time without racing against the in-flight creation).
    # We still suppress duplicate cancellation rows here.
    if event_type == EmailEventType.ASSIGNMENT_CANCELED:
        if await has_any_notification(
            db, hearing_assignment_id, EmailEventType.ASSIGNMENT_CANCELED.value
        ):
            logger.info(
                "[email-dispatch] Skipping cancellation for assignment %s — "
                "cancellation already queued/sent.",
                hearing_assignment_id,
            )
            return None

    resolved = await _resolve_template_key_and_type(db, event_type, hearing_assignment_id)
    if resolved is None:
        logger.warning(
            "[email-dispatch] HearingAssignment %s not found — skipping notification.",
            hearing_assignment_id,
        )
        return None
    template_key, assignment_type = resolved

    template = await get_template_by_key(db, template_key)
    if template is None:
        logger.warning(
            "[email-dispatch] No template found for key %s — skipping notification.",
            template_key,
        )
        return None

    recipient = await get_user_by_id(db, recipient_user_id)
    if recipient is None:
        logger.warning(
            "[email-dispatch] Recipient user %s not found — skipping notification.",
            recipient_user_id,
        )
        return None

    hearing = await get_hearing_by_id(db, hearing_id)
    if hearing is None:
        logger.warning(
            "[email-dispatch] Hearing %s not found — skipping notification.",
            hearing_id,
        )
        return None

    bill: Bill | None = None
    if bill_id is not None:
        bill = await get_bill_by_id(db, bill_id)

    ctx = build_template_context(
        bill=bill,
        hearing=hearing,
        cancellation_reason=cancellation_reason,
        assignment_type=assignment_type,
        previous_assignment_type=previous_assignment_type,
    )
    opt_out_url = opt_out_url_for(recipient)

    subject = render_subject(template.subject_template, ctx)
    body_html = render_body_html(template.body_markdown, ctx, opt_out_url=opt_out_url)

    # ── Pre-insert opt-out check ──
    suppressed_reason = suppressed_reason_override
    if suppressed_reason is None:
        email_enabled = await get_email_enabled(db, recipient_user_id)
        if not email_enabled:
            suppressed_reason = "user opted out"

    return await insert_notification(
        db,
        hearing_assignment_id=hearing_assignment_id,
        workflow_action_id=workflow_action_id,
        template_id=template.id,
        event_type=event_type.value,
        recipient_user_id=recipient_user_id,
        recipient_email=recipient.email,
        subject=subject,
        body=body_html,
        suppressed_reason=suppressed_reason,
    )


async def render_for_user(
    db: AsyncSession,
    *,
    template_key: str,
    hearing_id: int,
    user: User,
    bill_id: int | None = None,
    cancellation_reason: str | None = None,
    assignment_type: AssignmentType | None = None,
    previous_assignment_type: AssignmentType | None = None,
) -> tuple[str, str, str] | None:
    """Render a (subject, html, text) tuple for the admin Live Preview / Test
    Send routes. Returns None if the template doesn't exist."""
    from app.services.email_notification_service import render_body_text

    template = await get_template_by_key(db, template_key)
    if template is None:
        return None

    hearing = await get_hearing_by_id(db, hearing_id)
    if hearing is None:
        return None

    bill: Bill | None = None
    if bill_id is None:
        # If the hearing has any bill agenda items, pick the first for preview.
        for item in hearing.agenda_items:
            if item.is_bill and item.bill_id is not None:
                bill_id = item.bill_id
                break
    if bill_id is not None:
        bill = await get_bill_by_id(db, bill_id)

    # Default the preview's assignment_type from the template_key so an admin
    # editing hearing_assignment_awareness sees "Awareness" without having to
    # set it. The Sample Assignment Type field can override this.
    if assignment_type is None:
        if template_key == "hearing_assignment_awareness":
            assignment_type = AssignmentType.AWARENESS
        else:
            assignment_type = AssignmentType.MONITORING

    # Default the preview's previous_assignment_type to the *opposite* of the
    # current assignment_type so the type-change template renders with both
    # variables populated.
    if previous_assignment_type is None and template_key == _TYPE_CHANGED_TEMPLATE_KEY:
        previous_assignment_type = (
            AssignmentType.AWARENESS
            if assignment_type == AssignmentType.MONITORING
            else AssignmentType.MONITORING
        )

    ctx = build_template_context(
        bill=bill,
        hearing=hearing,
        cancellation_reason=cancellation_reason,
        assignment_type=assignment_type,
        previous_assignment_type=previous_assignment_type,
    )
    opt_out_url = opt_out_url_for(user)
    subject = render_subject(template.subject_template, ctx)
    html = render_body_html(template.body_markdown, ctx, opt_out_url=opt_out_url)
    text = render_body_text(template.body_markdown, ctx, opt_out_url=opt_out_url)
    return subject, html, text

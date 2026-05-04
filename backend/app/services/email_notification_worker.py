"""
Background worker that drains pending email_notifications rows and sends them
via Resend.

Lifecycle: started by app.main as an asyncio.Task. Iterates every
EMAIL_NOTIFICATION_WORKER_INTERVAL_SECONDS seconds, picks up to
EMAIL_NOTIFICATION_WORKER_BATCH_SIZE rows per pass.

State machine (per the design):
- pending → sent if Resend accepts.
- pending → failed if Resend rejects or the request raises.
- pending → suppressed if the user opted out between insert time and send time
  (this layer rechecks the preference; the dispatcher already wrote
  suppressed_reason for users who were opted out at insert time).
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.email import EmailTemplate
from app.repositories.comm_prefs_repository import get_email_enabled
from app.models.email import EmailEventType
from app.repositories.email_repository import (
    cancellation_queued_after,
    creation_was_sent_for_recipient,
    fetch_pending_notifications,
    get_thread_root_notification_id,
    mark_notification_failed,
    mark_notification_sent,
    mark_notification_suppressed,
)
from app.services.email_notification_service import (
    build_thread_headers,
    send_via_resend,
)

logger = logging.getLogger(__name__)


async def _process_batch(batch_size: int) -> int:
    """Process up to batch_size pending notifications. Returns count handled."""
    async with AsyncSessionLocal() as db:
        rows = await fetch_pending_notifications(db, limit=batch_size)
        if not rows:
            return 0

        for row in rows:
            # Recheck opt-out at send time: a user may have opted out between
            # the dispatch (insert) and now.
            try:
                if row.recipient_user_id is not None:
                    enabled = await get_email_enabled(db, row.recipient_user_id)
                    if not enabled:
                        await mark_notification_suppressed(db, row.id, "user opted out")
                        continue
            except Exception as exc:
                logger.warning(
                    "[email-worker] Pre-send opt-out check failed for row %s: %s",
                    row.id, exc,
                )

            # Send-time creation/cancellation gate.
            #
            # The dispatcher inserts every row unconditionally (it can't know
            # at queue time whether an in-flight creation will be drained
            # before a cancellation arrives). The worker decides per row:
            #
            # - Creation: if a cancellation is already queued for this
            #   recipient with a later id, the assignment was canceled before
            #   we could mail the original — sending it now would be stale.
            # - Cancellation: only emit if the corresponding creation actually
            #   reached the recipient. If the creation was suppressed (e.g.
            #   opted out, or race-suppressed by the previous branch), there's
            #   nothing to "cancel" from the recipient's perspective.
            suppress_reason: str | None = None
            if row.recipient_user_id is not None:
                if row.event_type == EmailEventType.ASSIGNMENT_CREATED.value:
                    if await cancellation_queued_after(
                        db,
                        hearing_assignment_id=row.hearing_assignment_id,
                        recipient_user_id=row.recipient_user_id,
                        after_id=row.id,
                    ):
                        suppress_reason = "canceled before send"
                elif row.event_type == EmailEventType.ASSIGNMENT_CANCELED.value:
                    if not await creation_was_sent_for_recipient(
                        db,
                        hearing_assignment_id=row.hearing_assignment_id,
                        recipient_user_id=row.recipient_user_id,
                    ):
                        suppress_reason = "creation was not sent"
            if suppress_reason is not None:
                await mark_notification_suppressed(db, row.id, suppress_reason)
                continue

            # Build the plain-text part from the rendered HTML body. The
            # design calls for multipart, but we don't keep the markdown
            # source in the snapshot — the HTML is the canonical record. A
            # minimal stripped-down text version is fine here.
            text_body = _strip_html(row.body)

            # Look up the template's default CC at send time. The template
            # may have been edited since dispatch — admins editing the CC
            # expect new sends to use the new value. We always reach for the
            # current value rather than snapshotting it on the row.
            cc_email: str | None = None
            if row.template_id is not None:
                cc_email = await db.scalar(
                    select(EmailTemplate.default_cc_email).where(
                        EmailTemplate.id == row.template_id
                    )
                )

            # Threading: cancellation emails should reply-thread to the
            # creation email so the recipient sees them grouped. We point
            # In-Reply-To/References at the earliest sent notification for
            # this (assignment, recipient) pair. If none exists, this is the
            # thread root and we only set Message-ID.
            thread_root_id: int | None = None
            if row.recipient_user_id is not None:
                thread_root_id = await get_thread_root_notification_id(
                    db,
                    hearing_assignment_id=row.hearing_assignment_id,
                    recipient_user_id=row.recipient_user_id,
                    before_id=row.id,
                )
            email_headers = build_thread_headers(
                notification_id=row.id,
                thread_root_notification_id=thread_root_id,
            )

            try:
                await send_via_resend(
                    to_email=row.recipient_email,
                    subject=row.subject,
                    html_body=row.body,
                    text_body=text_body,
                    cc=cc_email,
                    headers=email_headers,
                )
            except Exception as exc:
                logger.warning(
                    "[email-worker] Resend send failed for row %s: %s",
                    row.id, exc,
                )
                await mark_notification_failed(db, row.id, str(exc)[:1000])
                # commit the failure mark so the row no longer locks others
                await db.commit()
                continue

            await mark_notification_sent(db, row.id)

        await db.commit()
        return len(rows)


def _strip_html(html: str) -> str:
    """Minimal text fallback: drop tags. Good enough for the multipart text
    part — clients that prefer text/plain will still see the message body."""
    import re
    text = re.sub(r"<[^>]+>", "", html)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


async def email_notification_worker_loop() -> None:
    """Top-level loop. Sleeps the interval between drains. Runs forever
    (cancelled at app shutdown)."""
    interval = settings.email_notification_worker_interval_seconds
    batch_size = settings.email_notification_worker_batch_size
    logger.info(
        "[email-worker] Started — interval=%ss batch=%s.", interval, batch_size,
    )
    while True:
        try:
            handled = await _process_batch(batch_size)
            if handled:
                logger.info("[email-worker] Sent batch: %d notification(s).", handled)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("[email-worker] Loop iteration error: %s", exc)
        await asyncio.sleep(interval)

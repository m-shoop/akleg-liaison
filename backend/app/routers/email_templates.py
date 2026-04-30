"""
Admin-only API for editing email templates and previewing the rendered output.

Routes use the singular template_key in the path (the seeded keys are
`hearing_assignment_monitoring`, `hearing_assignment_awareness`, and
`hearing_assignment_canceled`). Test sends route the preview email to the
requesting admin's address.
"""

import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import CurrentUser, require_permission
from app.models.hearing import AgendaItem, Hearing, HearingAgendaVersion
from app.repositories.audit_log_repository import log_action
from app.repositories.email_repository import (
    get_template_by_key,
    list_templates,
    update_template,
)
from app.schemas.email import (
    EmailTemplatePreviewRequest,
    EmailTemplatePreviewResponse,
    EmailTemplateRead,
    EmailTemplateUpdate,
    PreviewHearingItem,
)
from app.services.email_notification_dispatcher import render_for_user
from app.services.email_notification_service import (
    TEMPLATE_VARIABLES,
    TemplateRenderError,
    send_via_postmark,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email-templates", tags=["email-templates"])


# ---------------------------------------------------------------------------
# List + read + update
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[EmailTemplateRead],
    dependencies=[Depends(require_permission("email-template:edit"))],
)
async def list_templates_route(db: AsyncSession = Depends(get_db)):
    rows = await list_templates(db)
    return [EmailTemplateRead.model_validate(r) for r in rows]


@router.get(
    "/variables",
    response_model=list[str],
    dependencies=[Depends(require_permission("email-template:edit"))],
)
async def list_template_variables():
    """Variables available in subject and body editors. Surfaced to the admin
    UI as helper text near the editor."""
    return TEMPLATE_VARIABLES


@router.get(
    "/preview-hearings",
    response_model=list[PreviewHearingItem],
    dependencies=[Depends(require_permission("email-template:edit"))],
)
async def list_preview_hearings(db: AsyncSession = Depends(get_db)):
    """Recent + upcoming hearings for the Live Preview dropdown.

    Window: last 7 days through next 14 days, ordered chronologically.
    Label format: '<date> <time> <committee> <bill #s>'.
    """
    today = date.today()
    window_start = today - timedelta(days=7)
    window_end = today + timedelta(days=14)

    result = await db.execute(
        select(Hearing)
        .where(
            Hearing.hearing_date >= window_start,
            Hearing.hearing_date <= window_end,
            Hearing.is_active.is_(True),
        )
        .options(
            selectinload(Hearing.committee_hearing),
            selectinload(Hearing.agenda_versions).selectinload(
                HearingAgendaVersion.agenda_items
            ),
        )
        .order_by(Hearing.hearing_date.asc(), Hearing.hearing_time.asc().nullsfirst())
    )
    hearings = list(result.scalars().all())

    items: list[PreviewHearingItem] = []
    for h in hearings:
        committee = h.committee_name or "Floor"
        time_str = h.hearing_time.strftime("%H:%M") if h.hearing_time else "—"
        bill_numbers = sorted(
            {
                ai.bill_number
                for ai in h.agenda_items
                if ai.is_bill and ai.bill_number
            }
        )
        bills_label = ", ".join(bill_numbers) if bill_numbers else "(no bills)"
        label = f"{h.hearing_date.isoformat()} {time_str} {committee} — {bills_label}"
        items.append(PreviewHearingItem(id=h.id, label=label))

    return items


@router.get(
    "/{template_key}",
    response_model=EmailTemplateRead,
    dependencies=[Depends(require_permission("email-template:edit"))],
)
async def get_template_route(template_key: str, db: AsyncSession = Depends(get_db)):
    template = await get_template_by_key(db, template_key)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return EmailTemplateRead.model_validate(template)


@router.put(
    "/{template_key}",
    response_model=EmailTemplateRead,
)
async def update_template_route(
    template_key: str,
    body: EmailTemplateUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("email-template:edit")),
):
    template = await get_template_by_key(db, template_key)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    # Validate the new content renders against an empty context with all known
    # variables present — catches typos like {bil_number} before they break a
    # live notification.
    sample_ctx = {v: f"{{{v}}}" for v in TEMPLATE_VARIABLES}
    try:
        body.subject_template.format(**sample_ctx)
        body.body_markdown.format(**sample_ctx)
    except KeyError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Template references unknown variable: {exc.args[0]}",
        )

    cc = body.default_cc_email
    if cc is not None:
        cc = cc.strip() or None

    before = {
        "subject_template": template.subject_template,
        "body_markdown": template.body_markdown,
        "default_cc_email": template.default_cc_email,
    }
    after = {
        "subject_template": body.subject_template,
        "body_markdown": body.body_markdown,
        "default_cc_email": cc,
    }
    changed_fields = sorted(k for k in after if before[k] != after[k])

    await update_template(
        db,
        template,
        subject_template=body.subject_template,
        body_markdown=body.body_markdown,
        default_cc_email=cc,
        updated_by=current_user.user.id,
    )
    await log_action(
        db,
        current_user.user,
        "email_template_updated",
        entity_type="email_template",
        entity_id=template.id,
        details={
            "template_key": template_key,
            "changed_fields": changed_fields,
            "before": {k: before[k] for k in changed_fields},
            "after": {k: after[k] for k in changed_fields},
        },
        request=request,
    )
    await db.commit()
    await db.refresh(template)
    return EmailTemplateRead.model_validate(template)


# ---------------------------------------------------------------------------
# Live preview + test send
# ---------------------------------------------------------------------------


@router.post(
    "/{template_key}/preview",
    response_model=EmailTemplatePreviewResponse,
)
async def preview_template_route(
    template_key: str,
    body: EmailTemplatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("email-template:edit")),
):
    try:
        rendered = await render_for_user(
            db,
            template_key=template_key,
            hearing_id=body.hearing_id,
            user=current_user.user,
            cancellation_reason=body.cancellation_reason,
            assignment_type=body.assignment_type,
        )
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if rendered is None:
        raise HTTPException(status_code=404, detail="Template or hearing not found")
    subject, html, text = rendered
    return EmailTemplatePreviewResponse(
        subject=subject, html_body=html, text_body=text
    )


@router.post("/{template_key}/test-send", status_code=202)
async def test_send_template_route(
    template_key: str,
    body: EmailTemplatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("email-template:edit")),
):
    """Send the rendered template to the requesting admin's address. Bypasses
    the queue and the user's opt-out preference (the admin asked for it)."""
    try:
        rendered = await render_for_user(
            db,
            template_key=template_key,
            hearing_id=body.hearing_id,
            user=current_user.user,
            cancellation_reason=body.cancellation_reason,
            assignment_type=body.assignment_type,
        )
    except TemplateRenderError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if rendered is None:
        raise HTTPException(status_code=404, detail="Template or hearing not found")
    subject, html, text = rendered
    try:
        await send_via_postmark(
            to_email=current_user.user.email,
            subject=f"[TEST] {subject}",
            html_body=html,
            text_body=text,
        )
    except Exception as exc:
        logger.warning("[test-send] Postmark failure: %s", exc)
        raise HTTPException(status_code=502, detail=f"Postmark error: {exc}")

    return {"sent_to": current_user.user.email}

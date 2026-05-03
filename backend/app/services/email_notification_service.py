"""
Email notification service for hearing-assignment notifications.

Responsibilities:
- Build the {variable} substitution dict from a HearingAssignment.
- Render a template's subject (plain-text format) and body (markdown -> HTML
  -> CSS-inlined HTML via premailer).
- Issue and verify opt-out tokens via itsdangerous.
- Send rendered notifications through Postmark with a plain-text fallback.

The render functions are pure so they can also serve the admin Live Preview /
Test Send endpoints.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
import markdown as md_lib
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from premailer import transform as premailer_transform

from app.config import settings
from app.models.email import EmailTemplate
from app.models.user import User
from app.models.workflow import AssignmentType

logger = logging.getLogger(__name__)


_POSTMARK_API = "https://api.postmarkapp.com/email"
_FROM_ADDRESS = "contact@aklegup.com"
_SUPPORT_ADDRESS = "contact@aklegup.com"

# Domain we sign Message-ID headers with. Should be a domain we own so the IDs
# are RFC-compliant; reused for the From address keeps it self-consistent.
_MESSAGE_ID_DOMAIN = "aklegup.com"

_OPT_OUT_SALT = "leg-up.opt-out.v1"
_OPT_OUT_INTENT = "opt_out"
# Tokens stay valid for 90 days after issuance. Email clients can sit on
# messages for a while; we want the link to keep working but not forever.
_OPT_OUT_MAX_AGE_SECONDS = 90 * 24 * 60 * 60


# ---------------------------------------------------------------------------
# Template variable resolution
# ---------------------------------------------------------------------------

#: Variables exposed to template authors. Lives here so the admin UI can pull
#: it via the API and render the helper text alongside the editor.
TEMPLATE_VARIABLES: list[str] = [
    "bill_number",
    "bill_number_wo_space",
    "short_title",
    "committee",
    "chamber",
    "hearing_date",
    "bill_status",
    "cancellation_reason",
    "assignment_type",
]


#: Display labels for the {assignment_type} template variable. Templates author
#: against the enum's machine name; rendering substitutes the human-readable
#: form ("Monitoring Reports" / "Awareness").
ASSIGNMENT_TYPE_LABELS: dict[AssignmentType, str] = {
    AssignmentType.MONITORING: "Monitoring Reports",
    AssignmentType.AWARENESS: "Awareness",
}


def _safe(value: object | None) -> str:
    """Render template values defensively — empty string for None so missing
    fields don't crash the send pipeline mid-flight."""
    if value is None:
        return ""
    return str(value)


def build_template_context(
    *,
    bill: Any | None,
    hearing: Any,
    cancellation_reason: str | None = None,
    assignment_type: AssignmentType | None = None,
) -> dict[str, str]:
    """Materialize the {variable} substitution dict for str.format()."""
    committee_name = hearing.committee_name if hasattr(hearing, "committee_name") else None
    bill_number = _safe(getattr(bill, "bill_number", None))
    return {
        "bill_number": bill_number,
        "bill_number_wo_space": bill_number.replace(" ", ""),
        "short_title": _safe(getattr(bill, "short_title", None)),
        "bill_status": _safe(getattr(bill, "status", None)),
        "committee": _safe(committee_name) or "Floor Session",
        "chamber": _safe(getattr(hearing, "chamber", None)),
        "hearing_date": _safe(getattr(hearing, "hearing_date", None)),
        "cancellation_reason": _safe(cancellation_reason),
        "assignment_type": (
            ASSIGNMENT_TYPE_LABELS[assignment_type] if assignment_type else ""
        ),
    }


# ---------------------------------------------------------------------------
# Template rendering
# ---------------------------------------------------------------------------


class TemplateRenderError(ValueError):
    """Raised when a template references a variable we don't expose."""


def _format(template_str: str, ctx: dict[str, str]) -> str:
    try:
        return template_str.format(**ctx)
    except KeyError as exc:
        raise TemplateRenderError(
            f"Template references unknown variable: {exc.args[0]}"
        ) from exc


def render_subject(subject_template: str, ctx: dict[str, str]) -> str:
    return _format(subject_template, ctx)


def render_body_html(body_markdown: str, ctx: dict[str, str], *, opt_out_url: str | None) -> str:
    """Render the email body to inlined HTML.

    Pipeline: substitute variables -> markdown -> wrap in HTML shell with
    inline opt-out footer -> premailer to inline any remaining CSS.
    """
    body_md = _format(body_markdown, ctx)
    body_html = md_lib.markdown(body_md, extensions=["extra"])

    opt_out_block = (
        f"""
<hr style="margin-top:32px;border:none;border-top:1px solid #E2DDD6;" />
<p style="margin:24px 0 0;font-size:12px;color:#5A6E7F;line-height:1.6;">
  Don't want to receive these emails?
  <a href="{opt_out_url}" style="color:#2E4A35;">Opt out</a>.
</p>
"""
        if opt_out_url
        else ""
    )

    full = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
</head>
<body style="margin:0;padding:0;background-color:#F7F4F0;font-family:Arial,sans-serif;color:#1C2B22;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F4F0;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#FFFFFF;border:1px solid #E2DDD6;
                    border-top:4px solid #A8C8C0;border-radius:8px;
                    padding:32px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr><td style="padding-bottom:8px;">
          <p style="margin:0;font-family:Georgia,serif;font-size:20px;font-weight:700;color:#2E4A35;">Leg Up</p>
        </td></tr>
        <tr><td style="padding-bottom:24px;border-bottom:1px solid #E2DDD6;">
          <p style="margin:0;font-size:13px;color:#5A6E7F;">AK Legislative Liaison</p>
        </td></tr>
        <tr><td style="padding-top:24px;font-size:14px;line-height:1.6;color:#1C2B22;">
          {body_html}
          {opt_out_block}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
    # premailer inlines any CSS we (or future template authors) define inside
    # <style> blocks. Most email clients strip those tags on receipt.
    return premailer_transform(full)


def render_body_text(body_markdown: str, ctx: dict[str, str], *, opt_out_url: str | None) -> str:
    """Plain-text fallback for the multipart email — markdown source is fine."""
    text = _format(body_markdown, ctx)
    if opt_out_url:
        text = f"{text}\n\n---\nDon't want to receive these emails? Opt out: {opt_out_url}\n"
    return text


def render_template(
    template: EmailTemplate,
    ctx: dict[str, str],
    *,
    opt_out_url: str | None,
) -> tuple[str, str, str]:
    """Render (subject, html_body, text_body) for a template + context."""
    subject = render_subject(template.subject_template, ctx)
    html_body = render_body_html(template.body_markdown, ctx, opt_out_url=opt_out_url)
    text_body = render_body_text(template.body_markdown, ctx, opt_out_url=opt_out_url)
    return subject, html_body, text_body


# ---------------------------------------------------------------------------
# Opt-out token plumbing (itsdangerous)
# ---------------------------------------------------------------------------


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret_key=settings.secret_key, salt=_OPT_OUT_SALT)


def issue_opt_out_token(user_id: int) -> str:
    """Sign and return a token that authenticates an opt-out request for
    user_id. The intent prevents tokens issued for other purposes from being
    reused here."""
    return _serializer().dumps({"user_id": user_id, "intent": _OPT_OUT_INTENT})


def verify_opt_out_token(token: str) -> int:
    """Return the user_id encoded in the token. Raises ValueError on
    bad/expired/wrong-intent tokens."""
    try:
        payload = _serializer().loads(token, max_age=_OPT_OUT_MAX_AGE_SECONDS)
    except SignatureExpired as exc:
        raise ValueError("token expired") from exc
    except BadSignature as exc:
        raise ValueError("bad token") from exc

    if not isinstance(payload, dict):
        raise ValueError("malformed token")
    if payload.get("intent") != _OPT_OUT_INTENT:
        raise ValueError("wrong intent")
    user_id = payload.get("user_id")
    if not isinstance(user_id, int):
        raise ValueError("malformed token")
    return user_id


def opt_out_url_for(user: User) -> str:
    token = issue_opt_out_token(user.id)
    return f"{settings.frontend_base_url}/opt-out/{token}"


# ---------------------------------------------------------------------------
# Threading headers (Message-ID / In-Reply-To / References)
# ---------------------------------------------------------------------------


def message_id_for_notification(notification_id: int) -> str:
    """Deterministic Message-ID for an email_notifications row.

    All major mail clients thread on the In-Reply-To/References headers, so
    every outbound notification needs a stable, globally-unique Message-ID we
    can reference from later messages. The notification row's primary key is
    already unique within our system; combined with our domain it gives a
    valid RFC 5322 message identifier."""
    return f"<email-notification-{notification_id}@{_MESSAGE_ID_DOMAIN}>"


def build_thread_headers(
    *,
    notification_id: int,
    thread_root_notification_id: int | None,
) -> list[dict[str, str]]:
    """Build the Postmark Headers array for a notification.

    Always sets Message-ID. If thread_root_notification_id is given, also sets
    In-Reply-To and References pointing at that root so the recipient's mail
    client groups this message with the root in their inbox.

    The "thread root" is the first email this recipient received for the
    hearing assignment — typically the assignment_created notification. Any
    cancellation we send afterwards threads back to it.
    """
    headers: list[dict[str, str]] = [
        {"Name": "Message-ID", "Value": message_id_for_notification(notification_id)},
    ]
    if thread_root_notification_id is not None:
        root = message_id_for_notification(thread_root_notification_id)
        headers.append({"Name": "In-Reply-To", "Value": root})
        headers.append({"Name": "References", "Value": root})
    return headers


# ---------------------------------------------------------------------------
# Postmark send
# ---------------------------------------------------------------------------


async def send_via_postmark(
    *,
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
    cc: str | None = None,
    headers: list[dict[str, str]] | None = None,
) -> None:
    """Send an email via Postmark. Raises on non-2xx; the worker translates
    that into the row's error column.

    `headers` is forwarded to Postmark's `Headers` field — used for
    Message-ID / In-Reply-To / References so cancellation emails thread with
    the original assignment notification in the recipient's inbox."""
    payload: dict[str, Any] = {
        "From": _FROM_ADDRESS,
        "To": to_email,
        "Subject": subject,
        "HtmlBody": html_body,
        "TextBody": text_body,
        "MessageStream": "outbound",
    }
    if cc:
        payload["Cc"] = cc
    if headers:
        payload["Headers"] = headers
    async with httpx.AsyncClient() as client:
        response = await client.post(
            _POSTMARK_API,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Postmark-Server-Token": settings.postmark_server_token,
            },
            json=payload,
            timeout=15.0,
        )
        response.raise_for_status()

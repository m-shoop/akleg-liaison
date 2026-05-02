"""
Postmark email service.

Sends transactional emails for account registration and password reset.
The HTML templates mirror the website's color palette.
"""

import httpx

from app.config import settings

_POSTMARK_API = "https://api.postmarkapp.com/email"
_FROM_ADDRESS = "contact@aklegup.com"
_SUPPORT_ADDRESS = "contact@aklegup.com"

# ---------------------------------------------------------------------------
# HTML template helpers
# ---------------------------------------------------------------------------

_BASE_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F4F0;font-family:'Inter',Arial,sans-serif;color:#1C2B22;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F4F0;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;background:#FFFFFF;border:1px solid #E2DDD6;
                      border-top:4px solid #A8C8C0;border-radius:8px;
                      padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <!-- Logo / title -->
          <tr>
            <td style="padding-bottom:8px;">
              <p style="margin:0;font-family:Georgia,serif;font-size:22px;
                         font-weight:700;color:#2E4A35;letter-spacing:0.02em;">
                Leg Up
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:28px;border-bottom:1px solid #E2DDD6;">
              <p style="margin:0;font-size:13px;color:#5A6E7F;">
                AK Legislative Liaison
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding-top:28px;">
              {body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:32px;border-top:1px solid #E2DDD6;margin-top:32px;">
              <p style="margin:0;font-size:12px;color:#5A6E7F;line-height:1.6;">
                If you did not request this email, please reach out to
                <a href="mailto:{support}" style="color:#2E4A35;">{support}</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""

_BUTTON_HTML = """\
<table cellpadding="0" cellspacing="0" style="margin:28px 0;">
  <tr>
    <td style="background-color:#2E4A35;border-radius:4px;">
      <a href="{url}"
         style="display:inline-block;padding:12px 28px;
                font-size:14px;font-weight:600;color:#F7F4F0;
                text-decoration:none;letter-spacing:0.02em;">
        {label}
      </a>
    </td>
  </tr>
</table>
<p style="margin:0 0 16px;font-size:13px;color:#5A6E7F;">
  Or copy and paste this link into your browser:
</p>
<p style="margin:0 0 8px;font-size:12px;word-break:break-all;">
  <a href="{url}" style="color:#2E4A35;">{url}</a>
</p>
"""


def _registration_body(activation_link: str) -> str:
    button = _BUTTON_HTML.format(url=activation_link, label="Activate My Account")
    return f"""\
<p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#2E4A35;
           font-family:Georgia,serif;">
  Welcome to Leg Up!
</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#1C2B22;">
  Thank you for registering your account with Leg Up! Please click on the
  activation link below to set your initial password. This link is valid for
  <strong>30 minutes</strong>.
</p>
{button}
"""


def _password_reset_body(activation_link: str) -> str:
    button = _BUTTON_HTML.format(url=activation_link, label="Reset My Password")
    return f"""\
<p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#2E4A35;
           font-family:Georgia,serif;">
  Password Reset Request
</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#1C2B22;">
  You have requested a password reset for your account. Please click on the
  activation link below to reset your password. This link is valid for
  <strong>30 minutes</strong>.
</p>
{button}
"""


def _build_html(subject: str, body: str) -> str:
    return _BASE_HTML.format(subject=subject, body=body, support=_SUPPORT_ADDRESS)


# ---------------------------------------------------------------------------
# Public send functions
# ---------------------------------------------------------------------------

async def send_registration_email(to_email: str, token: str) -> None:
    activation_link = (
        f"{settings.frontend_base_url}/activate"
        f"?token={token}&type=registration"
    )
    subject = "Activate your Leg Up account"
    html = _build_html(subject, _registration_body(activation_link))
    await _send(to_email, subject, html)


async def send_password_reset_email(to_email: str, token: str) -> None:
    activation_link = (
        f"{settings.frontend_base_url}/activate"
        f"?token={token}&type=password_reset"
    )
    subject = "Reset your Leg Up password"
    html = _build_html(subject, _password_reset_body(activation_link))
    await _send(to_email, subject, html)


async def _send(to_email: str, subject: str, html_body: str) -> None:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            _POSTMARK_API,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Postmark-Server-Token": settings.postmark_server_token,
            },
            json={
                "From": _FROM_ADDRESS,
                "To": to_email,
                "Subject": subject,
                "HtmlBody": html_body,
                "MessageStream": "outbound",
            },
            timeout=10.0,
        )
        response.raise_for_status()

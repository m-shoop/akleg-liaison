"""
Stopgap: issue a one-time activation/reset URL for a user without sending email.

Use when the email provider is unavailable. The operator hand-delivers each URL
out-of-band (Slack, SMS, phone). Mirrors the registration / forgot-password
flows in app/routers/auth.py: same 30-minute TTL, same hashed-token storage,
same audit logging.

Usage (run from backend/):
    python scripts/issue_login_link.py user@example.com
    python scripts/issue_login_link.py a@x.com b@y.com c@z.com
    python scripts/issue_login_link.py user@example.com --type registration
"""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models.user import TokenType, UserStatus
from app.repositories.audit_log_repository import log_system_action
from app.repositories.user_repository import get_user_by_email, upsert_user_token
from app.services.auth_service import generate_token, hash_token

_TOKEN_TTL_MINUTES = 30


async def _issue_one(db: AsyncSession, email: str, forced_type: str | None) -> tuple[str, str]:
    user = await get_user_by_email(db, email.lower())
    if user is None:
        return ("not_found", f"{email}: no such user")
    if user.user_status == UserStatus.deleted:
        return ("deleted", f"{email}: account is deleted, refusing")

    if forced_type == "registration":
        token_type = TokenType.registration
        url_type = "registration"
    elif forced_type == "password_reset":
        token_type = TokenType.password_reset
        url_type = "password_reset"
    elif user.user_status == UserStatus.inactive:
        token_type = TokenType.registration
        url_type = "registration"
    else:
        token_type = TokenType.password_reset
        url_type = "password_reset"

    raw_token = generate_token()
    hashed = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_TOKEN_TTL_MINUTES)
    await upsert_user_token(db, user.id, token_type, hashed, expires_at)

    audit_action = (
        "registration_email_sent" if token_type == TokenType.registration
        else "password_reset_email_sent"
    )
    await log_system_action(
        db,
        audit_action,
        entity_type="user",
        entity_id=user.id,
        target_user_id=user.id,
        details={"channel": "manual", "via": "issue_login_link.py"},
    )
    await db.commit()

    url = f"{settings.frontend_base_url}/activate?token={raw_token}&type={url_type}"
    return ("ok", f"{email}  ({url_type}, expires in {_TOKEN_TTL_MINUTES}m):\n  {url}")


async def main(emails: list[str], forced_type: str | None) -> None:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    results: list[tuple[str, str]] = []
    async with Session() as db:
        for email in emails:
            try:
                results.append(await _issue_one(db, email, forced_type))
            except Exception as exc:
                await db.rollback()
                results.append(("error", f"{email}: {type(exc).__name__}: {exc}"))

    await engine.dispose()

    for status, msg in results:
        prefix = "OK   " if status == "ok" else "SKIP "
        print(f"{prefix}{msg}")
        print()

    failed = sum(1 for s, _ in results if s != "ok")
    if failed:
        raise SystemExit(failed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("emails", nargs="+", help="One or more user email addresses")
    parser.add_argument(
        "--type",
        choices=["registration", "password_reset"],
        default=None,
        help="Force token type. Default: auto-detect from user_status (inactive→registration, active→password_reset).",
    )
    args = parser.parse_args()
    asyncio.run(main(args.emails, args.type))

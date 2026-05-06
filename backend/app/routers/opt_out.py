"""
Public opt-out routes: GET shows a confirmation, POST applies it.

We split GET vs POST so email clients that prefetch URLs (Outlook, virus
scanners, etc.) don't accidentally opt users out — only an explicit form POST
applies the change. The signed itsdangerous token authenticates the request
in lieu of a session cookie.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.repositories.audit_log_repository import log_system_action
from app.repositories.comm_prefs_repository import (
    DEFAULT_EMAIL_ENABLED,
    get_prefs,
    set_email_enabled,
)
from app.repositories.user_repository import get_user_by_id
from app.services.email_notification_service import verify_opt_out_token

router = APIRouter(prefix="/opt-out", tags=["opt-out"])


class OptOutCheckResponse(BaseModel):
    ok: bool
    email: str | None
    detail: str | None = None


class OptOutApplyResponse(BaseModel):
    ok: bool
    email: str | None
    detail: str | None = None


@router.get("/{token}", response_model=OptOutCheckResponse)
async def check_opt_out_token(token: str, db: AsyncSession = Depends(get_db)):
    """Return whether the token is valid and the email it would opt out.
    Does not mutate state — protects against email-client prefetching."""
    try:
        user_id = verify_opt_out_token(token)
    except ValueError as exc:
        return OptOutCheckResponse(ok=False, email=None, detail=str(exc))

    user = await get_user_by_id(db, user_id)
    if user is None:
        return OptOutCheckResponse(ok=False, email=None, detail="user not found")
    return OptOutCheckResponse(ok=True, email=user.email)


@router.post("/{token}", response_model=OptOutApplyResponse)
async def apply_opt_out(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Apply the opt-out. The user themselves is recorded as the changer
    (changed_by = user_id from token); source is 'unsubscribe_link'."""
    try:
        user_id = verify_opt_out_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid token: {exc}")

    user = await get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")

    previous = await get_prefs(db, user_id)
    previous_value = (
        previous.email_enabled if previous is not None else DEFAULT_EMAIL_ENABLED
    )
    await set_email_enabled(
        db,
        user_id=user_id,
        new_value=False,
        changed_by=user_id,
        source="unsubscribe_link",
    )
    if previous_value is not False:
        await log_system_action(
            db,
            "comm_prefs_opted_out_via_token",
            entity_type="user_comm_prefs",
            entity_id=user_id,
            target_user_id=user_id,
            details={
                "field": "email_enabled",
                "from": previous_value,
                "to": False,
                "source": "unsubscribe_link",
                "target_email": user.email,
            },
            request=request,
        )
    await db.commit()
    return OptOutApplyResponse(ok=True, email=user.email)

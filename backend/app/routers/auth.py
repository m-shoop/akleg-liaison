from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.limiter import limiter
from app.models.user import TokenType, UserStatus
from app.repositories.audit_log_repository import log_action
from app.repositories.user_repository import (
    activate_user_with_password,
    delete_user_token,
    get_user_by_email,
    get_user_by_id,
    get_user_permissions,
    get_user_token,
    upsert_user_token,
)
from app.services.auth_service import (
    create_access_token,
    create_set_password_cookie_token,
    decode_set_password_cookie_token,
    generate_token,
    hash_password,
    hash_token,
    validate_password,
    verify_password,
    verify_token,
)
from app.services.email_service import send_password_reset_email, send_registration_email

router = APIRouter(prefix="/auth", tags=["auth"])

_TOKEN_TTL_MINUTES = 30
_COOKIE_NAME = "set_password_session"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    permissions: list[str]


class EmailRequest(BaseModel):
    email: str


class ValidateTokenRequest(BaseModel):
    token: str
    type: str  # "registration" | "password_reset"


class SetPasswordRequest(BaseModel):
    password: str
    confirm_password: str


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _cookie_kwargs(secure: bool) -> dict:
    from app.config import settings
    return dict(
        key=_COOKIE_NAME,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=_TOKEN_TTL_MINUTES * 60,
    )


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    email = form.username.lower()
    user = await get_user_by_email(db, email)

    if user is None or user.hashed_password is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.user_status != UserStatus.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is not active",
            headers={"WWW-Authenticate": "Bearer"},
        )

    permissions = await get_user_permissions(db, user.id)
    await log_action(db, user, "login")
    await db.commit()
    return TokenResponse(
        access_token=create_access_token(user.email, permissions),
        permissions=permissions,
    )


# ---------------------------------------------------------------------------
# Registration workflow
# ---------------------------------------------------------------------------

@router.post("/register/request", status_code=200)
@limiter.limit("10/hour")
async def register_request(
    request: Request,
    body: EmailRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 1 of registration: look up the email and send an activation email
    if the account is inactive.  Rate-limited to 10 requests/hour/IP by the
    limiter applied in main.py.
    """
    email = body.email.lower()
    user = await get_user_by_email(db, email)

    if user is None:
        return {"status": "not_found"}

    if user.user_status == UserStatus.deleted:
        return {"status": "deleted"}

    if user.user_status == UserStatus.active:
        return {"status": "already_active"}

    # Inactive — generate token, store hash, send email
    raw_token = generate_token()
    hashed = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_TOKEN_TTL_MINUTES)

    await upsert_user_token(db, user.id, TokenType.registration, hashed, expires_at)
    await db.commit()

    await send_registration_email(email, raw_token)

    return {"status": "email_sent"}


# ---------------------------------------------------------------------------
# Forgot-password workflow
# ---------------------------------------------------------------------------

@router.post("/forgot-password/check", status_code=200)
async def forgot_password_check(
    body: EmailRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Look up the email and return its account status so the frontend can
    present the correct UI.  Not rate-limited (read-only lookup).
    """
    email = body.email.lower()
    user = await get_user_by_email(db, email)

    if user is None:
        return {"status": "not_found"}

    if user.user_status == UserStatus.inactive:
        return {"status": "inactive"}

    if user.user_status == UserStatus.deleted:
        return {"status": "deleted"}

    return {"status": "active"}


@router.post("/forgot-password/request", status_code=200)
@limiter.limit("10/hour")
async def forgot_password_request(
    request: Request,
    body: EmailRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Send a password-reset email for an active account.
    Rate-limited to 10 requests/hour/IP by the limiter applied in main.py.
    """
    email = body.email.lower()
    user = await get_user_by_email(db, email)

    if user is None or user.user_status != UserStatus.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active account found for that email",
        )

    raw_token = generate_token()
    hashed = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_TOKEN_TTL_MINUTES)

    await upsert_user_token(db, user.id, TokenType.password_reset, hashed, expires_at)
    await db.commit()

    await send_password_reset_email(email, raw_token)

    return {"status": "email_sent"}


# ---------------------------------------------------------------------------
# Token validation (shared by both registration and password-reset flows)
# ---------------------------------------------------------------------------

@router.post("/validate-token", status_code=200)
@limiter.limit("10/hour")
async def validate_token(
    request: Request,
    body: ValidateTokenRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Validate a registration or password-reset token from an email link.
    On success: clears the token from the DB, sets a short-lived httpOnly
    cookie, and returns the purpose so the frontend can navigate to /set-password.
    Rate-limited to 10 requests/hour/IP by the limiter applied in main.py.
    """
    if body.type not in ("registration", "password_reset"):
        raise HTTPException(status_code=400, detail="invalid_token_type")

    token_type = TokenType.registration if body.type == "registration" else TokenType.password_reset

    # Look up users that have a token of this type
    from sqlalchemy import select
    from app.models.user import UserToken
    candidates = (
        await db.scalars(
            select(UserToken).where(UserToken.token_type == token_type)
        )
    ).all()

    matched_token: UserToken | None = None
    for candidate in candidates:
        if verify_token(body.token, candidate.password_token):
            matched_token = candidate
            break

    if matched_token is None:
        raise HTTPException(status_code=400, detail="invalid_token")

    now = datetime.now(timezone.utc)
    if matched_token.password_token_expires_at.replace(tzinfo=timezone.utc) < now:
        # Expired — delete the stale token and signal the frontend to redirect
        await delete_user_token(db, matched_token.user_id, token_type)
        await db.commit()
        raise HTTPException(
            status_code=410,
            detail=body.type,  # "registration" or "password_reset" — used by frontend
        )

    # Valid — clear token, issue set-password cookie
    await delete_user_token(db, matched_token.user_id, token_type)
    await db.commit()

    from app.config import settings
    cookie_token = create_set_password_cookie_token(matched_token.user_id, body.type)
    response.set_cookie(
        key=_COOKIE_NAME,
        value=cookie_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=_TOKEN_TTL_MINUTES * 60,
    )

    return {"ok": True, "purpose": body.type}


# ---------------------------------------------------------------------------
# Set password (consumes the set-password cookie)
# ---------------------------------------------------------------------------

@router.post("/set-password", status_code=200)
async def set_password(
    body: SetPasswordRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    set_password_session: str | None = Cookie(default=None),
):
    """
    Set (or reset) a user's password.  Requires the short-lived httpOnly cookie
    issued by /validate-token.  Clears the cookie on success.
    """
    if set_password_session is None:
        raise HTTPException(status_code=401, detail="Missing session cookie")

    try:
        session_data = decode_set_password_cookie_token(set_password_session)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session cookie")

    if body.password != body.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match")

    failed = validate_password(body.password)
    if failed:
        raise HTTPException(
            status_code=422,
            detail={"message": "Password does not meet requirements", "failed": failed},
        )

    user_id: int = session_data["user_id"]
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    await activate_user_with_password(db, user_id, hash_password(body.password))
    await db.commit()

    # Clear the cookie
    response.delete_cookie(
        key=_COOKIE_NAME,
        httponly=True,
        secure=True,
        samesite="strict",
    )

    return {"detail": "Password set. Your account is now active."}

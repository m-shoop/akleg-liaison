from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.repositories.audit_log_repository import log_action
from app.repositories.user_repository import create_user, get_user_by_username, get_user_permissions
from app.services.auth_service import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

_VALID_ROLES = {"admin", "viewer"}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    permissions: list[str]


class RegisterRequest(BaseModel):
    username: str
    password: str
    registration_key: str
    role: str = "viewer"


@router.post("/login", response_model=TokenResponse)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_username(db, form.username)
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    permissions = await get_user_permissions(db, user.id)
    await log_action(db, user, "login")
    await db.commit()
    return TokenResponse(
        access_token=create_access_token(user.username, permissions),
        permissions=permissions,
    )


@router.post("/register", status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Create a new user account.
    In production this endpoint should be restricted to admins.
    """
    from app.config import settings

    if body.registration_key != settings.registration_key:
        raise HTTPException(status_code=403, detail="Invalid registration key")

    if body.role not in _VALID_ROLES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid role '{body.role}'. Must be 'admin' or 'viewer'.",
        )

    existing = await get_user_by_username(db, body.username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    await create_user(db, body.username, hash_password(body.password), role_name=body.role)
    await db.commit()
    return {"detail": "User created"}

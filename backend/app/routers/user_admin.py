"""Admin user-management API.

Lets admins (gated by user:manage) list manageable users (active +
inactive, excluding soft-deleted), create new inactive users (who must
self-activate via the registration flow), update each user's display name,
and soft-delete users. Email remains the unique identifier; name is purely
a human-readable label surfaced in dropdowns and assignment displays.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, require_permission
from app.models.email import UserCommPrefs
from app.models.user import UserStatus
from app.repositories.audit_log_repository import log_action
from app.repositories.comm_prefs_repository import DEFAULT_EMAIL_ENABLED
from app.repositories.user_repository import (
    create_user,
    get_user_by_email,
    get_user_by_id,
    list_deleted_users,
    list_manageable_users,
    revive_user,
    soft_delete_user,
    update_user_name,
)


router = APIRouter(tags=["user-admin"])


class UserRead(BaseModel):
    id: int
    email: str
    name: str | None
    user_status: UserStatus
    email_enabled: bool


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=255)


class UserNameUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)


def _user_read(u, email_enabled: bool = DEFAULT_EMAIL_ENABLED) -> UserRead:
    return UserRead(
        id=u.id,
        email=u.email,
        name=u.name,
        user_status=u.user_status,
        email_enabled=email_enabled,
    )


async def _email_enabled_map(db: AsyncSession) -> dict[int, bool]:
    """Single-shot fetch of all stored email_enabled prefs. Users without a
    row default to DEFAULT_EMAIL_ENABLED at lookup time."""
    rows = await db.execute(select(UserCommPrefs.user_id, UserCommPrefs.email_enabled))
    return {row.user_id: row.email_enabled for row in rows}


async def _email_enabled_for(db: AsyncSession, user_id: int) -> bool:
    row = await db.execute(
        select(UserCommPrefs.email_enabled).where(UserCommPrefs.user_id == user_id)
    )
    value = row.scalar_one_or_none()
    return DEFAULT_EMAIL_ENABLED if value is None else value


@router.get(
    "/admin/users",
    response_model=list[UserRead],
    dependencies=[Depends(require_permission("user:manage"))],
)
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserRead]:
    users = await list_manageable_users(db)
    prefs = await _email_enabled_map(db)
    return [_user_read(u, prefs.get(u.id, DEFAULT_EMAIL_ENABLED)) for u in users]


@router.get(
    "/admin/users/deleted",
    response_model=list[UserRead],
    dependencies=[Depends(require_permission("user:manage"))],
)
async def list_deleted_admin_users(
    db: AsyncSession = Depends(get_db),
) -> list[UserRead]:
    users = await list_deleted_users(db)
    prefs = await _email_enabled_map(db)
    return [_user_read(u, prefs.get(u.id, DEFAULT_EMAIL_ENABLED)) for u in users]


@router.post(
    "/admin/users",
    response_model=UserRead,
    status_code=201,
)
async def create_admin_user(
    body: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("user:manage")),
) -> UserRead:
    email = body.email.strip().lower()
    name = body.name.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    existing = await get_user_by_email(db, email)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"A user with email {email} already exists (status: {existing.user_status.value})",
        )

    user = await create_user(db, email=email, name=name, user_status=UserStatus.inactive)
    await log_action(
        db,
        current_user.user,
        "admin_user_created",
        entity_type="user",
        entity_id=user.id,
        target_user_id=user.id,
        details={"email": email, "name": name},
        request=request,
    )
    await db.commit()
    return _user_read(user, await _email_enabled_for(db, user.id))


@router.patch(
    "/admin/users/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require_permission("user:manage"))],
)
async def patch_user(
    user_id: int,
    body: UserNameUpdate,
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    cleaned = body.name.strip() if body.name else None
    updated = await update_user_name(db, user_id, cleaned or None)
    await db.commit()
    return _user_read(updated, await _email_enabled_for(db, user_id))


@router.delete(
    "/admin/users/{user_id}",
    response_model=UserRead,
)
async def delete_admin_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("user:manage")),
) -> UserRead:
    user = await get_user_by_id(db, user_id)
    if user is None or user.user_status == UserStatus.deleted:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    updated = await soft_delete_user(db, user_id)
    await log_action(
        db,
        current_user.user,
        "admin_user_deleted",
        entity_type="user",
        entity_id=user_id,
        target_user_id=user_id,
        details={"email": user.email},
        request=request,
    )
    await db.commit()
    return _user_read(updated, await _email_enabled_for(db, user_id))


@router.post(
    "/admin/users/{user_id}/revive",
    response_model=UserRead,
)
async def revive_admin_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("user:manage")),
) -> UserRead:
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.user_status != UserStatus.deleted:
        raise HTTPException(status_code=409, detail="User is not deleted")

    updated = await revive_user(db, user_id)
    await log_action(
        db,
        current_user.user,
        "admin_user_revived",
        entity_type="user",
        entity_id=user_id,
        target_user_id=user_id,
        details={"email": user.email},
        request=request,
    )
    await db.commit()
    return _user_read(updated, await _email_enabled_for(db, user_id))

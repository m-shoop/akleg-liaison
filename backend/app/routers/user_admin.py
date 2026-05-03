"""Admin user-management API.

Lets admins (gated by comm-prefs:admin) list manageable users (active +
inactive, excluding soft-deleted) and update each user's display name. Email
remains the unique identifier; name is purely a human-readable label surfaced
in dropdowns and assignment displays.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.user import UserStatus
from app.repositories.user_repository import (
    get_user_by_id,
    list_manageable_users,
    update_user_name,
)


router = APIRouter(tags=["user-admin"])


class UserRead(BaseModel):
    id: int
    email: str
    name: str | None
    user_status: UserStatus


class UserNameUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)


def _user_read(u) -> UserRead:
    return UserRead(id=u.id, email=u.email, name=u.name, user_status=u.user_status)


@router.get(
    "/admin/users",
    response_model=list[UserRead],
    dependencies=[Depends(require_permission("comm-prefs:admin"))],
)
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserRead]:
    users = await list_manageable_users(db)
    return [_user_read(u) for u in users]


@router.patch(
    "/admin/users/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require_permission("comm-prefs:admin"))],
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
    return _user_read(updated)

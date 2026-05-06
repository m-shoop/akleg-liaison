"""User communication preferences API.

Two surfaces:
- /users/me/comm-prefs* — the logged-in user reads/updates their own preferences
  and views their history. Source recorded as 'settings_page'.
- /admin/users/comm-prefs* — admins (with user:manage) can read and
  override any user's preferences, looked up by ?email=<address>. Source
  recorded as 'admin_override'.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user, require_permission
from app.repositories.audit_log_repository import log_action
from app.repositories.comm_prefs_repository import (
    DEFAULT_EMAIL_ENABLED,
    get_prefs,
    list_history,
    set_email_enabled,
)
from app.repositories.user_repository import get_user_by_email
from app.schemas.email import (
    CommPrefsHistoryItem,
    CommPrefsRead,
    CommPrefsUpdate,
)

router = APIRouter(tags=["comm-prefs"])


def _read(user_id: int, email: str, prefs) -> CommPrefsRead:
    if prefs is None:
        # Lazy-creation: no row yet means "use the default (TRUE)".
        return CommPrefsRead(
            user_id=user_id,
            email=email,
            email_enabled=DEFAULT_EMAIL_ENABLED,
            updated_at=None,
            updated_by=None,
        )
    return CommPrefsRead(
        user_id=prefs.user_id,
        email=email,
        email_enabled=prefs.email_enabled,
        updated_at=prefs.updated_at,
        updated_by=prefs.updated_by,
    )


# ---------------------------------------------------------------------------
# Self
# ---------------------------------------------------------------------------


@router.get("/users/me/comm-prefs", response_model=CommPrefsRead)
async def get_my_comm_prefs(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    prefs = await get_prefs(db, current_user.user.id)
    return _read(current_user.user.id, current_user.user.email, prefs)


@router.put("/users/me/comm-prefs", response_model=CommPrefsRead)
async def update_my_comm_prefs(
    body: CommPrefsUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    previous = await get_prefs(db, current_user.user.id)
    previous_value = (
        previous.email_enabled if previous is not None else DEFAULT_EMAIL_ENABLED
    )
    prefs = await set_email_enabled(
        db,
        user_id=current_user.user.id,
        new_value=body.email_enabled,
        changed_by=current_user.user.id,
        source="settings_page",
    )
    if previous_value != body.email_enabled:
        await log_action(
            db,
            current_user.user,
            "comm_prefs_updated",
            entity_type="user_comm_prefs",
            entity_id=current_user.user.id,
            target_user_id=current_user.user.id,
            details={
                "field": "email_enabled",
                "from": previous_value,
                "to": body.email_enabled,
                "source": "settings_page",
            },
            request=request,
        )
    await db.commit()
    return _read(current_user.user.id, current_user.user.email, prefs)


@router.get(
    "/users/me/comm-prefs/history", response_model=list[CommPrefsHistoryItem]
)
async def get_my_comm_prefs_history(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    rows = await list_history(db, current_user.user.id)
    return [CommPrefsHistoryItem.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------
# Admin override (lookup by email)
# ---------------------------------------------------------------------------


@router.get(
    "/admin/users/comm-prefs",
    response_model=CommPrefsRead,
    dependencies=[Depends(require_permission("user:manage"))],
)
async def admin_get_comm_prefs(
    email: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_email(db, email)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    prefs = await get_prefs(db, user.id)
    return _read(user.id, user.email, prefs)


@router.put(
    "/admin/users/comm-prefs",
    response_model=CommPrefsRead,
)
async def admin_update_comm_prefs(
    body: CommPrefsUpdate,
    request: Request,
    email: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_permission("user:manage")),
):
    user = await get_user_by_email(db, email)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    previous = await get_prefs(db, user.id)
    previous_value = (
        previous.email_enabled if previous is not None else DEFAULT_EMAIL_ENABLED
    )
    prefs = await set_email_enabled(
        db,
        user_id=user.id,
        new_value=body.email_enabled,
        changed_by=current_user.user.id,
        source="admin_override",
    )
    if previous_value != body.email_enabled:
        await log_action(
            db,
            current_user.user,
            "admin_comm_prefs_updated",
            entity_type="user_comm_prefs",
            entity_id=user.id,
            target_user_id=user.id,
            details={
                "field": "email_enabled",
                "from": previous_value,
                "to": body.email_enabled,
                "source": "admin_override",
                "target_email": user.email,
            },
            request=request,
        )
    await db.commit()
    return _read(user.id, user.email, prefs)


@router.get(
    "/admin/users/comm-prefs/history",
    response_model=list[CommPrefsHistoryItem],
    dependencies=[Depends(require_permission("user:manage"))],
)
async def admin_get_comm_prefs_history(
    email: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_email(db, email)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    rows = await list_history(db, user.id)
    return [CommPrefsHistoryItem.model_validate(r) for r in rows]

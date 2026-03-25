from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.repositories.audit_log_repository import log_action
from app.repositories.bill_repository import get_bill_by_id
from app.repositories.tag_repository import (
    add_bill_tag,
    get_tag_by_id,
    get_or_create_tag,
    list_tags,
    remove_bill_tag,
    set_tag_active,
)
from app.schemas.tag import TagCreate, TagRead, TagUpdate

router = APIRouter(tags=["tags"])


# ---------------------------------------------------------------------------
# Global tag management
# ---------------------------------------------------------------------------

@router.get("/tags", response_model=list[TagRead])
async def list_all_tags(db: AsyncSession = Depends(get_db)):
    return await list_tags(db)


@router.patch("/tags/{tag_id}", response_model=TagRead)
async def update_tag(
    tag_id: int,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Toggle a tag's global is_active flag."""
    tag = await set_tag_active(db, tag_id, body.is_active)
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.commit()
    await db.refresh(tag)
    return tag


# ---------------------------------------------------------------------------
# Bill-tag association
# ---------------------------------------------------------------------------

@router.post("/bills/{bill_id}/tags", response_model=TagRead, status_code=201)
async def add_tag_to_bill(
    bill_id: int,
    body: TagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Add a tag (by label) to a bill.
    Creates the tag globally if it does not yet exist.
    Returns the tag that was added.
    """
    bill = await get_bill_by_id(db, bill_id)
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")

    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="Tag label cannot be empty")

    tag = await get_or_create_tag(db, label)
    await add_bill_tag(db, bill_id, tag.id)
    await log_action(db, current_user, "tag_added", entity_type="bill", entity_id=bill_id, details={"bill_number": bill.bill_number, "tag": label})
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/bills/{bill_id}/tags/{tag_id}", status_code=204)
async def remove_tag_from_bill(
    bill_id: int,
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a tag from a bill (deletes the bill_tags row)."""
    bill = await get_bill_by_id(db, bill_id)
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")

    tag = await get_tag_by_id(db, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    await remove_bill_tag(db, bill_id, tag_id)
    await log_action(db, current_user, "tag_removed", entity_type="bill", entity_id=bill_id, details={"bill_number": bill.bill_number, "tag": tag.label})
    await db.commit()

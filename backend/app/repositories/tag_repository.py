from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import BillTag, Tag


async def list_tags(session: AsyncSession) -> list[Tag]:
    result = await session.execute(select(Tag).order_by(Tag.label))
    return list(result.scalars().all())


async def get_tag_by_label(session: AsyncSession, label: str) -> Tag | None:
    result = await session.execute(select(Tag).where(Tag.label == label))
    return result.scalar_one_or_none()


async def get_tag_by_id(session: AsyncSession, tag_id: int) -> Tag | None:
    result = await session.execute(select(Tag).where(Tag.id == tag_id))
    return result.scalar_one_or_none()


async def get_or_create_tag(session: AsyncSession, label: str) -> Tag:
    """Return an existing tag or insert a new one (case-sensitive match)."""
    stmt = (
        insert(Tag)
        .values(label=label, is_active=True)
        .on_conflict_do_nothing(index_elements=["label"])
        .returning(Tag.id)
    )
    result = await session.execute(stmt)
    row = result.one_or_none()
    if row is not None:
        # Just inserted — fetch the full row
        tag = await get_tag_by_id(session, row[0])
    else:
        # Already existed
        tag = await get_tag_by_label(session, label)
    return tag  # type: ignore[return-value]


async def set_tag_active(session: AsyncSession, tag_id: int, is_active: bool) -> Tag | None:
    tag = await get_tag_by_id(session, tag_id)
    if tag is None:
        return None
    tag.is_active = is_active
    return tag


async def add_bill_tag(session: AsyncSession, bill_id: int, tag_id: int) -> None:
    """Link a tag to a bill, ignoring if the link already exists."""
    stmt = (
        insert(BillTag)
        .values(bill_id=bill_id, tag_id=tag_id)
        .on_conflict_do_nothing(constraint="uq_bill_tag")
    )
    await session.execute(stmt)


async def remove_bill_tag(session: AsyncSession, bill_id: int, tag_id: int) -> bool:
    """Remove the link between a bill and a tag. Returns True if a row was deleted."""
    result = await session.execute(
        BillTag.__table__.delete().where(
            BillTag.bill_id == bill_id,
            BillTag.tag_id == tag_id,
        )
    )
    return result.rowcount > 0

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.execute(
        select(User).where(User.username == username)
    )
    return result.scalar_one_or_none()


async def create_user(
    session: AsyncSession, username: str, hashed_password: str
) -> User:
    user = User(username=username, hashed_password=hashed_password)
    session.add(user)
    await session.flush()
    return user

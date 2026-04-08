from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Permission, Role, RolePermission, User, UserRoles


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.execute(
        select(User).where(User.username == username)
    )
    return result.scalar_one_or_none()


async def get_user_permissions(session: AsyncSession, user_id: int) -> list[str]:
    """Return all permission names for a user, aggregated across all their roles."""
    result = await session.execute(
        select(Permission.name)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(UserRoles, UserRoles.role_id == RolePermission.role_id)
        .where(UserRoles.user_id == user_id)
        .distinct()
    )
    return list(result.scalars().all())


async def _assign_user_role(session: AsyncSession, user_id: int, role_name: str) -> None:
    result = await session.execute(select(Role).where(Role.name == role_name))
    role = result.scalar_one_or_none()
    if role is None:
        raise ValueError(f"Role '{role_name}' does not exist in the database")
    session.add(UserRoles(user_id=user_id, role_id=role.id))


async def create_user(
    session: AsyncSession,
    username: str,
    hashed_password: str,
    role_name: str = "viewer",
) -> User:
    user = User(username=username, hashed_password=hashed_password)
    session.add(user)
    await session.flush()  # populate user.id
    await _assign_user_role(session, user.id, role_name)
    return user

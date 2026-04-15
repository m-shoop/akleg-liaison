from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Permission, Role, RolePermission, TokenType, User, UserRoles, UserStatus, UserToken


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(
        select(User).where(User.email == email.lower())
    )
    return result.scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: int) -> User | None:
    result = await session.execute(select(User).where(User.id == user_id))
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
    email: str,
    role_name: str = "viewer",
    hashed_password: str | None = None,
    user_status: UserStatus = UserStatus.inactive,
) -> User:
    user = User(
        email=email.lower(),
        hashed_password=hashed_password,
        user_status=user_status,
    )
    session.add(user)
    await session.flush()  # populate user.id
    await _assign_user_role(session, user.id, role_name)
    return user


# ---------------------------------------------------------------------------
# User token CRUD
# ---------------------------------------------------------------------------

async def get_user_token(
    session: AsyncSession,
    user_id: int,
    token_type: TokenType,
) -> UserToken | None:
    result = await session.execute(
        select(UserToken).where(
            UserToken.user_id == user_id,
            UserToken.token_type == token_type,
        )
    )
    return result.scalar_one_or_none()


async def upsert_user_token(
    session: AsyncSession,
    user_id: int,
    token_type: TokenType,
    hashed_token: str,
    expires_at: datetime,
) -> None:
    """Insert a new token row; if one already exists for (user_id, token_type), replace it."""
    existing = await get_user_token(session, user_id, token_type)
    if existing is not None:
        existing.password_token = hashed_token
        existing.password_token_expires_at = expires_at
    else:
        session.add(
            UserToken(
                user_id=user_id,
                token_type=token_type,
                password_token=hashed_token,
                password_token_expires_at=expires_at,
            )
        )
    await session.flush()


async def delete_user_token(
    session: AsyncSession,
    user_id: int,
    token_type: TokenType,
) -> None:
    existing = await get_user_token(session, user_id, token_type)
    if existing is not None:
        await session.delete(existing)
        await session.flush()


# ---------------------------------------------------------------------------
# Account activation
# ---------------------------------------------------------------------------

async def activate_user_with_password(
    session: AsyncSession,
    user_id: int,
    hashed_password: str,
) -> None:
    """Set the user's password and flip status to Active."""
    user = await get_user_by_id(session, user_id)
    if user is None:
        raise ValueError(f"User {user_id} not found")
    user.hashed_password = hashed_password
    user.user_status = UserStatus.active
    await session.flush()

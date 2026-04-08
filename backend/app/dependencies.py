from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.repositories.user_repository import get_user_by_username
from app.services.auth_service import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        username = decode_token(token)
    except JWTError:
        raise credentials_exception

    user = await get_user_by_username(db, username)
    if user is None or not user.is_active:
        raise credentials_exception
    return user


async def get_optional_current_user(
    token: str | None = Depends(oauth2_scheme_optional),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if token is None:
        return None
    try:
        username = decode_token(token)
    except JWTError:
        return None
    user = await get_user_by_username(db, username)
    if user is None or not user.is_active:
        return None
    return user


async def require_editor(
    current_user: User = Depends(get_current_user),
) -> User:
    """Dependency that requires the user to have the admin (editor) role."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return current_user

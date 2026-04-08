from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
import bcrypt

from app.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(username: str, permissions: list[str]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": username, "exp": expire, "permissions": permissions}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> tuple[str, list[str]]:
    """Returns (username, permissions) from the token, or raises JWTError."""
    payload = jwt.decode(
        token, settings.secret_key, algorithms=[settings.algorithm]
    )
    username: str = payload.get("sub")
    if username is None:
        raise JWTError("Missing subject")
    permissions: list[str] = payload.get("permissions", [])
    return username, permissions

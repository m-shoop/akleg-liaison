import hashlib
import hmac
import os
import re
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import JWTError, jwt

from app.config import settings

_ph = PasswordHasher()  # defaults to argon2id


# ---------------------------------------------------------------------------
# Password hashing (argon2id)
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, plain)
    except (VerifyMismatchError, Exception):
        return False


# ---------------------------------------------------------------------------
# Password strength validation
# ---------------------------------------------------------------------------

def validate_password(password: str) -> list[str]:
    """
    Returns a list of failed requirement keys (empty = password is valid).
    Keys: 'at_least_12_chars', 'has_alpha', 'has_numeric', 'has_special'
    """
    errors: list[str] = []
    if len(password) < 12:
        errors.append("at_least_12_chars")
    if not re.search(r"[a-zA-Z]", password):
        errors.append("has_alpha")
    if not re.search(r"\d", password):
        errors.append("has_numeric")
    if not re.search(r"[^a-zA-Z0-9]", password):
        errors.append("has_special")
    return errors


# ---------------------------------------------------------------------------
# Token generation and hashing (CSPRNG + SHA-256)
# ---------------------------------------------------------------------------

def generate_token() -> str:
    """Generate a 32-byte CSPRNG token returned as a 64-char hex string."""
    return os.urandom(32).hex()


def hash_token(token: str) -> str:
    """Return the SHA-256 hex digest of a token."""
    return hashlib.sha256(token.encode()).hexdigest()


def verify_token(submitted_token: str, stored_hash: str) -> bool:
    """Constant-time comparison: sha256(submitted) vs stored_hash."""
    submitted_hash = hashlib.sha256(submitted_token.encode()).hexdigest()
    return hmac.compare_digest(submitted_hash, stored_hash)


# ---------------------------------------------------------------------------
# Access JWT (long-lived session token)
# ---------------------------------------------------------------------------

def create_access_token(email: str, permissions: list[str]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": email, "exp": expire, "permissions": permissions}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> tuple[str, list[str]]:
    """Returns (email, permissions) from an access token, or raises JWTError."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    email: str = payload.get("sub")
    if email is None:
        raise JWTError("Missing subject")
    permissions: list[str] = payload.get("permissions", [])
    return email, permissions


# ---------------------------------------------------------------------------
# Set-password cookie JWT (short-lived, purpose-tagged)
# ---------------------------------------------------------------------------

_SET_PASSWORD_TYPE = "set_password"
_SET_PASSWORD_TTL_MINUTES = 30


def create_set_password_cookie_token(user_id: int, purpose: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=_SET_PASSWORD_TTL_MINUTES)
    payload = {
        "sub": str(user_id),
        "purpose": purpose,
        "type": _SET_PASSWORD_TYPE,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_set_password_cookie_token(token: str) -> dict:
    """
    Returns {"user_id": int, "purpose": str} or raises JWTError.
    Explicitly rejects tokens that are not of type 'set_password'.
    """
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("type") != _SET_PASSWORD_TYPE:
        raise JWTError("Wrong token type")
    return {"user_id": int(payload["sub"]), "purpose": payload["purpose"]}

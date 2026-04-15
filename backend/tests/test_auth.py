"""Tests for the new email-based auth workflows."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.models.user import TokenType
from tests.conftest import (
    login_user,
    seed_active_user,
    seed_inactive_user,
    seed_user_token,
)

VIEWER_PERMISSIONS = {"hearing-notes:view", "bill-tags:view", "hearing:export-ics"}
ADMIN_ONLY_PERMISSIONS = {
    "bill:track", "hearing:query", "bill:query", "hearing:hide",
    "hearing-notes:edit", "bill-tags:edit",
}


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

async def test_login_viewer_gets_correct_permissions(client: AsyncClient, db, uid: str):
    email = f"frank_{uid}@example.com"
    await seed_active_user(db, email, "Pa$$word123!", role="viewer")

    resp = await client.post(
        "/auth/login",
        data={"username": email, "password": "Pa$$word123!"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert VIEWER_PERMISSIONS == set(body["permissions"])


async def test_login_admin_gets_all_permissions(client: AsyncClient, db, uid: str):
    email = f"grace_{uid}@example.com"
    await seed_active_user(db, email, "Pa$$word123!", role="admin")

    resp = await client.post(
        "/auth/login",
        data={"username": email, "password": "Pa$$word123!"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200
    perms = set(resp.json()["permissions"])
    assert VIEWER_PERMISSIONS.issubset(perms)
    assert ADMIN_ONLY_PERMISSIONS.issubset(perms)


async def test_login_email_normalised_to_lowercase(client: AsyncClient, db, uid: str):
    email = f"Harry_{uid}@Example.COM"
    await seed_active_user(db, email, "Pa$$word123!")

    resp = await client.post(
        "/auth/login",
        data={"username": email.upper(), "password": "Pa$$word123!"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200


async def test_login_wrong_password(client: AsyncClient, db, uid: str):
    email = f"harry_{uid}@example.com"
    await seed_active_user(db, email, "Pa$$word123!")

    resp = await client.post(
        "/auth/login",
        data={"username": email, "password": "wrongpass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 401


async def test_login_inactive_account_rejected(client: AsyncClient, db, uid: str):
    email = f"inactive_{uid}@example.com"
    await seed_inactive_user(db, email)

    resp = await client.post(
        "/auth/login",
        data={"username": email, "password": "Pa$$word123!"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 401


async def test_login_unknown_email(client: AsyncClient):
    resp = await client.post(
        "/auth/login",
        data={"username": "nobody_zzz@example.com", "password": "pass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Registration request
# ---------------------------------------------------------------------------

async def test_register_request_inactive_sends_email(client: AsyncClient, db, uid: str):
    email = f"new_{uid}@example.com"
    await seed_inactive_user(db, email)

    with patch(
        "app.routers.auth.send_registration_email", new_callable=AsyncMock
    ) as mock_send:
        resp = await client.post("/auth/register/request", json={"email": email})

    assert resp.status_code == 200
    assert resp.json()["status"] == "email_sent"
    mock_send.assert_awaited_once()
    assert mock_send.call_args[0][0] == email


async def test_register_request_not_found(client: AsyncClient, uid: str):
    resp = await client.post(
        "/auth/register/request", json={"email": f"ghost_{uid}@example.com"}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


async def test_register_request_already_active(client: AsyncClient, db, uid: str):
    email = f"active_{uid}@example.com"
    await seed_active_user(db, email, "Pa$$word123!")

    resp = await client.post("/auth/register/request", json={"email": email})
    assert resp.status_code == 200
    assert resp.json()["status"] == "already_active"


# ---------------------------------------------------------------------------
# Forgot-password check
# ---------------------------------------------------------------------------

async def test_forgot_password_check_not_found(client: AsyncClient, uid: str):
    resp = await client.post(
        "/auth/forgot-password/check", json={"email": f"ghost_{uid}@example.com"}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


async def test_forgot_password_check_inactive(client: AsyncClient, db, uid: str):
    email = f"inactive_{uid}@example.com"
    await seed_inactive_user(db, email)

    resp = await client.post("/auth/forgot-password/check", json={"email": email})
    assert resp.status_code == 200
    assert resp.json()["status"] == "inactive"


async def test_forgot_password_check_active(client: AsyncClient, db, uid: str):
    email = f"active_{uid}@example.com"
    await seed_active_user(db, email, "Pa$$word123!")

    resp = await client.post("/auth/forgot-password/check", json={"email": email})
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


# ---------------------------------------------------------------------------
# Forgot-password request
# ---------------------------------------------------------------------------

async def test_forgot_password_request_sends_email(client: AsyncClient, db, uid: str):
    email = f"reset_{uid}@example.com"
    await seed_active_user(db, email, "Pa$$word123!")

    with patch(
        "app.routers.auth.send_password_reset_email", new_callable=AsyncMock
    ) as mock_send:
        resp = await client.post("/auth/forgot-password/request", json={"email": email})

    assert resp.status_code == 200
    assert resp.json()["status"] == "email_sent"
    mock_send.assert_awaited_once()


async def test_forgot_password_request_inactive_rejected(client: AsyncClient, db, uid: str):
    email = f"inactive_{uid}@example.com"
    await seed_inactive_user(db, email)

    resp = await client.post("/auth/forgot-password/request", json={"email": email})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------

async def test_validate_registration_token_sets_cookie(client: AsyncClient, db, uid: str):
    email = f"val_{uid}@example.com"
    await seed_inactive_user(db, email)
    raw_token = await seed_user_token(db, email, TokenType.registration)

    resp = await client.post(
        "/auth/validate-token", json={"token": raw_token, "type": "registration"}
    )
    assert resp.status_code == 200
    assert resp.json()["purpose"] == "registration"
    assert "set_password_session" in resp.cookies


async def test_validate_token_invalid_returns_400(client: AsyncClient, uid: str):
    resp = await client.post(
        "/auth/validate-token",
        json={"token": "deadbeef" * 8, "type": "registration"},
    )
    assert resp.status_code == 400


async def test_validate_token_expired_returns_410(client: AsyncClient, db, uid: str):
    from datetime import datetime, timedelta, timezone
    from app.services.auth_service import generate_token, hash_token
    from app.repositories.user_repository import get_user_by_email, upsert_user_token

    email = f"expired_{uid}@example.com"
    await seed_inactive_user(db, email)
    user = await get_user_by_email(db, email)

    raw = generate_token()
    hashed = hash_token(raw)
    # Expiry in the past
    expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await upsert_user_token(db, user.id, TokenType.registration, hashed, expires_at)
    await db.commit()

    resp = await client.post(
        "/auth/validate-token", json={"token": raw, "type": "registration"}
    )
    assert resp.status_code == 410


# ---------------------------------------------------------------------------
# Set password
# ---------------------------------------------------------------------------

async def test_set_password_full_flow(client: AsyncClient, db, uid: str):
    """Full registration flow: seed inactive user → validate token → set password → login."""
    email = f"full_{uid}@example.com"
    await seed_inactive_user(db, email)
    raw_token = await seed_user_token(db, email, TokenType.registration)

    # Step 1: validate token → receive cookie
    val_resp = await client.post(
        "/auth/validate-token", json={"token": raw_token, "type": "registration"}
    )
    assert val_resp.status_code == 200
    cookie = val_resp.cookies.get("set_password_session")
    assert cookie is not None

    # Step 2: set password (client automatically sends the cookie)
    set_resp = await client.post(
        "/auth/set-password",
        json={"password": "NewP@ss1234!", "confirm_password": "NewP@ss1234!"},
    )
    assert set_resp.status_code == 200

    # Step 3: login with new password
    token = await login_user(client, email, "NewP@ss1234!")
    assert token


async def test_set_password_mismatch_rejected(client: AsyncClient, db, uid: str):
    email = f"mismatch_{uid}@example.com"
    await seed_inactive_user(db, email)
    raw_token = await seed_user_token(db, email, TokenType.registration)

    await client.post(
        "/auth/validate-token", json={"token": raw_token, "type": "registration"}
    )

    resp = await client.post(
        "/auth/set-password",
        json={"password": "NewP@ss1234!", "confirm_password": "DifferentP@ss1234!"},
    )
    assert resp.status_code == 422


async def test_set_password_weak_rejected(client: AsyncClient, db, uid: str):
    email = f"weak_{uid}@example.com"
    await seed_inactive_user(db, email)
    raw_token = await seed_user_token(db, email, TokenType.registration)

    await client.post(
        "/auth/validate-token", json={"token": raw_token, "type": "registration"}
    )

    resp = await client.post(
        "/auth/set-password",
        json={"password": "short", "confirm_password": "short"},
    )
    assert resp.status_code == 422


async def test_set_password_no_cookie_rejected(client: AsyncClient):
    resp = await client.post(
        "/auth/set-password",
        json={"password": "NewP@ss1234!", "confirm_password": "NewP@ss1234!"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Password validation edge cases
# ---------------------------------------------------------------------------

async def test_set_password_missing_special_char(client: AsyncClient, db, uid: str):
    email = f"nospecial_{uid}@example.com"
    await seed_inactive_user(db, email)
    raw_token = await seed_user_token(db, email, TokenType.registration)

    await client.post(
        "/auth/validate-token", json={"token": raw_token, "type": "registration"}
    )

    resp = await client.post(
        "/auth/set-password",
        json={"password": "NoSpecialChar1234", "confirm_password": "NoSpecialChar1234"},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "has_special" in detail["failed"]

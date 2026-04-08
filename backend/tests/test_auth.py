"""Tests for /auth/register and /auth/login."""

import pytest
from httpx import AsyncClient

from tests.conftest import REGISTRATION_KEY, login_user, register_user

VIEWER_PERMISSIONS = {"hearing-notes:view", "bill-tags:view", "hearing:export-ics"}
ADMIN_ONLY_PERMISSIONS = {
    "bill:track", "hearing:query", "bill:query", "hearing:hide",
    "hearing-notes:edit", "bill-tags:edit",
}


async def test_register_viewer(client: AsyncClient, uid: str):
    resp = await client.post("/auth/register", json={
        "username": f"alice_{uid}",
        "password": "secret123",
        "registration_key": REGISTRATION_KEY,
        "role": "viewer",
    })
    assert resp.status_code == 201
    assert resp.json() == {"detail": "User created"}


async def test_register_admin(client: AsyncClient, uid: str):
    resp = await client.post("/auth/register", json={
        "username": f"bob_{uid}",
        "password": "secret123",
        "registration_key": REGISTRATION_KEY,
        "role": "admin",
    })
    assert resp.status_code == 201


async def test_register_duplicate_username(client: AsyncClient, uid: str):
    username = f"carol_{uid}"
    await register_user(client, username, "pass1")
    resp = await client.post("/auth/register", json={
        "username": username,
        "password": "pass2",
        "registration_key": REGISTRATION_KEY,
    })
    assert resp.status_code == 400
    assert "already taken" in resp.json()["detail"]


async def test_register_wrong_key(client: AsyncClient, uid: str):
    resp = await client.post("/auth/register", json={
        "username": f"dan_{uid}",
        "password": "pass",
        "registration_key": "wrong-key",
    })
    assert resp.status_code == 403


async def test_register_invalid_role(client: AsyncClient, uid: str):
    resp = await client.post("/auth/register", json={
        "username": f"eve_{uid}",
        "password": "pass",
        "registration_key": REGISTRATION_KEY,
        "role": "superuser",
    })
    assert resp.status_code == 422


async def test_login_viewer_gets_correct_permissions(client: AsyncClient, uid: str):
    username = f"frank_{uid}"
    await register_user(client, username, "mypassword", role="viewer")
    resp = await client.post(
        "/auth/login",
        data={"username": username, "password": "mypassword"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert "permissions" in body
    perms = set(body["permissions"])
    assert VIEWER_PERMISSIONS == perms


async def test_login_admin_gets_all_permissions(client: AsyncClient, uid: str):
    username = f"grace_{uid}"
    await register_user(client, username, "mypassword", role="admin")
    resp = await client.post(
        "/auth/login",
        data={"username": username, "password": "mypassword"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200
    perms = set(resp.json()["permissions"])
    assert VIEWER_PERMISSIONS.issubset(perms)
    assert ADMIN_ONLY_PERMISSIONS.issubset(perms)


async def test_login_wrong_password(client: AsyncClient, uid: str):
    username = f"harry_{uid}"
    await register_user(client, username, "correctpass")
    resp = await client.post(
        "/auth/login",
        data={"username": username, "password": "wrongpass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 401


async def test_login_unknown_user(client: AsyncClient):
    resp = await client.post(
        "/auth/login",
        data={"username": "nobody_zzz", "password": "pass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 401

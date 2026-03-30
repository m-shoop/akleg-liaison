"""Tests for bill endpoints — access control and public list."""

import pytest
from httpx import AsyncClient

from tests.conftest import login_user, register_user


async def _seed_bill(db, uid: str, *, tracked: bool = True) -> int:
    from app.models.bill import Bill
    bill = Bill(bill_number=f"HB {uid[:4]}", session=34, title="Test Bill", is_tracked=tracked)
    db.add(bill)
    await db.commit()
    await db.refresh(bill)
    return bill.id


async def _editor_token(client: AsyncClient, uid: str) -> str:
    await register_user(client, f"editor_{uid}", "pass", role="admin")
    return await login_user(client, f"editor_{uid}", "pass")


async def _viewer_token(client: AsyncClient, uid: str) -> str:
    await register_user(client, f"viewer_{uid}", "pass", role="viewer")
    return await login_user(client, f"viewer_{uid}", "pass")


# ---------------------------------------------------------------------------
# GET /bills — public
# ---------------------------------------------------------------------------

async def test_list_bills_requires_no_auth(client: AsyncClient):
    resp = await client.get("/bills")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def test_list_bills_excludes_untracked_by_default(client: AsyncClient, db, uid: str):
    tracked_id = await _seed_bill(db, uid, tracked=True)
    untracked_id = await _seed_bill(db, uid[::-1], tracked=False)

    resp = await client.get("/bills")
    ids = [b["id"] for b in resp.json()]
    assert tracked_id in ids
    assert untracked_id not in ids


async def test_list_bills_include_untracked(client: AsyncClient, db, uid: str):
    untracked_id = await _seed_bill(db, uid, tracked=False)

    resp = await client.get("/bills", params={"include_untracked": True})
    ids = [b["id"] for b in resp.json()]
    assert untracked_id in ids


# ---------------------------------------------------------------------------
# PATCH /bills/{id}/tracked
# ---------------------------------------------------------------------------

async def test_editor_can_untrack_bill(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid, tracked=True)
    token = await _editor_token(client, uid)

    resp = await client.patch(
        f"/bills/{bill_id}/tracked",
        params={"is_tracked": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["is_tracked"] is False


async def test_editor_can_track_bill(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid, tracked=False)
    token = await _editor_token(client, uid)

    resp = await client.patch(
        f"/bills/{bill_id}/tracked",
        params={"is_tracked": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["is_tracked"] is True


async def test_viewer_cannot_change_tracked(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    token = await _viewer_token(client, uid)

    resp = await client.patch(
        f"/bills/{bill_id}/tracked",
        params={"is_tracked": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_unauthenticated_cannot_change_tracked(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)

    resp = await client.patch(f"/bills/{bill_id}/tracked", params={"is_tracked": False})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /bills/{id}/refresh
# ---------------------------------------------------------------------------

async def test_editor_can_enqueue_refresh(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    token = await _editor_token(client, uid)

    resp = await client.post(
        f"/bills/{bill_id}/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert "id" in body
    assert body["status"] in ("pending", "running")


async def test_viewer_cannot_enqueue_refresh(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    token = await _viewer_token(client, uid)

    resp = await client.post(
        f"/bills/{bill_id}/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_unauthenticated_cannot_enqueue_refresh(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)

    resp = await client.post(f"/bills/{bill_id}/refresh")
    assert resp.status_code == 401


async def test_refresh_nonexistent_bill_returns_404(client: AsyncClient, uid: str):
    token = await _editor_token(client, uid)

    resp = await client.post(
        "/bills/999999/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404

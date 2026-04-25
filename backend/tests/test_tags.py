"""Tests for tag endpoints — verifies viewer vs admin access control."""

import pytest
from httpx import AsyncClient

from tests.conftest import login_user, seed_active_user


async def _seed_bill(db, uid: str) -> int:
    """Insert a minimal bill row and return its id."""
    from app.models.bill import Bill
    bill = Bill(bill_number=f"HB {uid[:4]}", session=34, title="Test Bill")
    db.add(bill)
    await db.commit()
    await db.refresh(bill)
    return bill.id


async def test_viewer_cannot_add_tag(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    resp = await client.post(
        f"/bills/{bill_id}/tags",
        json={"label": "education"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_admin_can_add_and_remove_tag(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    email = f"admin_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="admin")
    token = await login_user(client, email, "pass")

    # Add tag
    resp = await client.post(
        f"/bills/{bill_id}/tags",
        json={"label": f"tag_{uid}"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    tag_id = resp.json()["id"]

    # Remove tag
    resp = await client.delete(
        f"/bills/{bill_id}/tags/{tag_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 204


async def test_viewer_cannot_remove_tag(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)

    # Admin adds a tag first
    admin_email = f"admin2_{uid}@example.com"
    await seed_active_user(db, admin_email, "pass", role="admin")
    admin_token = await login_user(client, admin_email, "pass")
    resp = await client.post(
        f"/bills/{bill_id}/tags",
        json={"label": f"health_{uid}"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    tag_id = resp.json()["id"]

    # Viewer tries to remove it
    viewer_email = f"viewer2_{uid}@example.com"
    await seed_active_user(db, viewer_email, "pass", role="viewer")
    viewer_token = await login_user(client, viewer_email, "pass")
    resp = await client.delete(
        f"/bills/{bill_id}/tags/{tag_id}",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 403


async def test_unauthenticated_cannot_add_tag(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    resp = await client.post(f"/bills/{bill_id}/tags", json={"label": "test"})
    assert resp.status_code == 401

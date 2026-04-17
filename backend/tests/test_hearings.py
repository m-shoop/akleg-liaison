"""Tests for hearing notes and visibility endpoints."""

import datetime
import pytest
from httpx import AsyncClient

from tests.conftest import login_user, register_user


async def _seed_hearing(db, uid: str) -> int:
    from app.models.hearing import CommitteeHearing, Hearing
    hearing = Hearing(
        chamber="H",
        hearing_type="Committee",
        length=60,
        hearing_date=datetime.date(2026, 3, 31),
        legislature_session=34,
    )
    db.add(hearing)
    await db.flush()
    committee = CommitteeHearing(
        hearing_id=hearing.id,
        committee_name=f"Committee {uid}",
        committee_type="Standing",
    )
    db.add(committee)
    await db.commit()
    await db.refresh(hearing)
    return hearing.id


async def _editor_token(client: AsyncClient, uid: str) -> str:
    await register_user(client, f"editor_{uid}", "pass", role="admin")
    return await login_user(client, f"editor_{uid}", "pass")


async def _viewer_token(client: AsyncClient, uid: str) -> str:
    await register_user(client, f"viewer_{uid}", "pass", role="viewer")
    return await login_user(client, f"viewer_{uid}", "pass")


# ---------------------------------------------------------------------------
# DPS notes
# ---------------------------------------------------------------------------

async def test_editor_can_save_notes(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    token = await _editor_token(client, uid)

    resp = await client.patch(
        f"/hearings/{hearing_id}/dps-notes",
        json={"dps_notes": "Important hearing."},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["dps_notes"] == "Important hearing."


async def test_editor_can_clear_notes(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    token = await _editor_token(client, uid)

    await client.patch(
        f"/hearings/{hearing_id}/dps-notes",
        json={"dps_notes": "Some notes"},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = await client.patch(
        f"/hearings/{hearing_id}/dps-notes",
        json={"dps_notes": None},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["dps_notes"] is None


async def test_viewer_cannot_save_notes(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    token = await _viewer_token(client, uid)

    resp = await client.patch(
        f"/hearings/{hearing_id}/dps-notes",
        json={"dps_notes": "Sneaky notes"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_unauthenticated_cannot_save_notes(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)

    resp = await client.patch(
        f"/hearings/{hearing_id}/dps-notes",
        json={"dps_notes": "No auth"},
    )
    assert resp.status_code == 401


async def test_notes_on_nonexistent_hearing_returns_404(client: AsyncClient, uid: str):
    token = await _editor_token(client, uid)

    resp = await client.patch(
        "/hearings/999999/dps-notes",
        json={"dps_notes": "Ghost notes"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Hidden / visibility
# ---------------------------------------------------------------------------

async def test_editor_can_hide_hearing(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    token = await _editor_token(client, uid)

    resp = await client.patch(
        f"/hearings/{hearing_id}/hidden",
        json={"hidden": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["hidden"] is True


async def test_editor_can_unhide_hearing(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    token = await _editor_token(client, uid)

    await client.patch(
        f"/hearings/{hearing_id}/hidden",
        json={"hidden": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = await client.patch(
        f"/hearings/{hearing_id}/hidden",
        json={"hidden": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["hidden"] is False


async def test_viewer_cannot_hide_hearing(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    token = await _viewer_token(client, uid)

    resp = await client.patch(
        f"/hearings/{hearing_id}/hidden",
        json={"hidden": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403

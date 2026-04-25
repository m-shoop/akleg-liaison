"""Tests for bill tracking workflow endpoints.

Covers:
- POST /workflows            — creating a tracking request
- POST /workflows/{id}/actions — admin approve / deny
- GET  /workflows            — per-user visibility
- GET  /workflows/has-open   — per-user open-work flag
"""

from httpx import AsyncClient

from tests.conftest import login_user, seed_active_user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_bill(db, uid: str, *, tracked: bool = False) -> int:
    from app.models.bill import Bill
    bill = Bill(bill_number=f"HB {uid[:4]}", session=34, title="Test Bill", is_tracked=tracked)
    db.add(bill)
    await db.commit()
    await db.refresh(bill)
    return bill.id


async def _viewer_token(client: AsyncClient, db, uid: str, *, suffix: str = "") -> tuple[str, str]:
    email = f"viewer{suffix}_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    return email, await login_user(client, email, "pass")


async def _admin_token(client: AsyncClient, db, uid: str, *, suffix: str = "") -> tuple[str, str]:
    email = f"admin{suffix}_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="admin")
    return email, await login_user(client, email, "pass")


# ---------------------------------------------------------------------------
# POST /workflows — create tracking request
# ---------------------------------------------------------------------------


async def test_viewer_can_request_bill_tracking(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, token = await _viewer_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["type"] == "request_bill_tracking"
    assert body["status"] == "open"
    assert body["bill"]["id"] == bill_id
    assert [a["type"] for a in body["actions"]] == ["request_bill_tracking"]


async def test_unauthenticated_cannot_request_bill_tracking(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    resp = await client.post("/workflows", json={"bill_id": bill_id})
    assert resp.status_code == 401


async def test_request_tracking_for_nonexistent_bill_returns_404(client: AsyncClient, db, uid: str):
    _, token = await _viewer_token(client, db, uid)
    resp = await client.post(
        "/workflows",
        json={"bill_id": 999999},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


async def test_duplicate_open_request_is_rejected(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, token = await _viewer_token(client, db, uid)

    first = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert first.status_code == 201

    second = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert second.status_code == 409
    assert "already requested" in second.json()["detail"].lower()


async def test_previously_denied_request_is_rejected(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, viewer_tok = await _viewer_token(client, db, uid)
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    workflow_id = resp.json()["id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "deny_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 409
    assert "denied" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# POST /workflows/{id}/actions — approve / deny
# ---------------------------------------------------------------------------


async def test_admin_can_approve_bill_tracking(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid, tracked=False)
    _, viewer_tok = await _viewer_token(client, db, uid)
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    workflow_id = resp.json()["id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "approve_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "closed"

    bill_resp = await client.get(f"/bills/{bill_id}")
    assert bill_resp.json()["is_tracked"] is True


async def test_admin_can_deny_bill_tracking(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid, tracked=False)
    _, viewer_tok = await _viewer_token(client, db, uid)
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    workflow_id = resp.json()["id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "deny_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "closed"

    bill_resp = await client.get(f"/bills/{bill_id}")
    assert bill_resp.json()["is_tracked"] is False


async def test_viewer_cannot_approve_bill_tracking(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, viewer_tok = await _viewer_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    workflow_id = resp.json()["id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "approve_bill_tracking"},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 403


async def test_action_on_closed_workflow_returns_409(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, viewer_tok = await _viewer_token(client, db, uid)
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    workflow_id = resp.json()["id"]

    await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "deny_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "approve_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 409


async def test_action_on_nonexistent_workflow_returns_404(client: AsyncClient, db, uid: str):
    _, admin_tok = await _admin_token(client, db, uid)
    resp = await client.post(
        "/workflows/999999/actions",
        json={"type": "approve_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


async def test_invalid_action_type_for_bill_tracking_returns_422(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, viewer_tok = await _viewer_token(client, db, uid)
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    workflow_id = resp.json()["id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /workflows — visibility
# ---------------------------------------------------------------------------


async def test_viewer_sees_only_own_workflows(client: AsyncClient, db, uid: str):
    bill_a = await _seed_bill(db, uid)
    bill_b = await _seed_bill(db, uid[::-1])
    _, alice_tok = await _viewer_token(client, db, uid, suffix="_alice")
    _, bob_tok = await _viewer_token(client, db, uid, suffix="_bob")

    await client.post("/workflows", json={"bill_id": bill_a}, headers={"Authorization": f"Bearer {alice_tok}"})
    await client.post("/workflows", json={"bill_id": bill_b}, headers={"Authorization": f"Bearer {bob_tok}"})

    resp = await client.get("/workflows", headers={"Authorization": f"Bearer {alice_tok}"})
    assert resp.status_code == 200
    bill_ids = {wf["bill"]["id"] for wf in resp.json() if wf["bill"]}
    assert bill_ids == {bill_a}


async def test_admin_sees_all_workflows(client: AsyncClient, db, uid: str):
    bill_a = await _seed_bill(db, uid)
    bill_b = await _seed_bill(db, uid[::-1])
    _, alice_tok = await _viewer_token(client, db, uid, suffix="_alice")
    _, bob_tok = await _viewer_token(client, db, uid, suffix="_bob")
    _, admin_tok = await _admin_token(client, db, uid)

    await client.post("/workflows", json={"bill_id": bill_a}, headers={"Authorization": f"Bearer {alice_tok}"})
    await client.post("/workflows", json={"bill_id": bill_b}, headers={"Authorization": f"Bearer {bob_tok}"})

    resp = await client.get("/workflows", headers={"Authorization": f"Bearer {admin_tok}"})
    assert resp.status_code == 200
    bill_ids = {wf["bill"]["id"] for wf in resp.json() if wf["bill"]}
    assert {bill_a, bill_b}.issubset(bill_ids)


# ---------------------------------------------------------------------------
# GET /workflows/has-open
# ---------------------------------------------------------------------------


async def test_has_open_unauthenticated_returns_false(client: AsyncClient):
    resp = await client.get("/workflows/has-open")
    assert resp.status_code == 200
    assert resp.json() == {"has_open": False}


async def test_has_open_reflects_user_workflows(client: AsyncClient, db, uid: str):
    _, viewer_tok = await _viewer_token(client, db, uid)

    resp = await client.get(
        "/workflows/has-open",
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.json() == {"has_open": False}

    bill_id = await _seed_bill(db, uid)
    await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )

    resp = await client.get(
        "/workflows/has-open",
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.json() == {"has_open": True}


# ---------------------------------------------------------------------------
# POST /workflows/bill-tracking-state
# ---------------------------------------------------------------------------


async def test_bill_tracking_state_reports_open_request(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, viewer_tok = await _viewer_token(client, db, uid)

    await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )

    resp = await client.post(
        "/workflows/bill-tracking-state",
        json={"bill_ids": [bill_id]},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 200
    [state] = resp.json()
    assert state["bill_id"] == bill_id
    assert state["tracking_requested"] is True
    assert state["user_tracking_request_denied"] is False


async def test_bill_tracking_state_reports_denial_per_user(client: AsyncClient, db, uid: str):
    bill_id = await _seed_bill(db, uid)
    _, viewer_tok = await _viewer_token(client, db, uid)
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows",
        json={"bill_id": bill_id},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    workflow_id = resp.json()["id"]
    await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "deny_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )

    resp = await client.post(
        "/workflows/bill-tracking-state",
        json={"bill_ids": [bill_id]},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    [state] = resp.json()
    assert state["user_tracking_request_denied"] is True

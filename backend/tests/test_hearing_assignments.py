"""Tests for hearing assignment workflow endpoints.

Covers:
- POST /workflows/hearing-assignment      — admin creates an assignment
- POST /workflows/{id}/actions            — admin / assignee actions
- GET  /workflows/assignees               — admin-only assignee lookup
- GET  /workflows/has-open                — assignee visibility
"""

import datetime

from httpx import AsyncClient

from tests.conftest import login_user, seed_active_user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


async def _seed_bill(db, uid: str) -> tuple[int, str]:
    from app.models.bill import Bill
    bill = Bill(bill_number=f"HB {uid[:4]}", session=34, title="Test Bill", is_tracked=True)
    db.add(bill)
    await db.commit()
    await db.refresh(bill)
    return bill.id, bill.bill_number


async def _viewer_token(client: AsyncClient, db, uid: str, *, suffix: str = "") -> tuple[str, str]:
    email = f"viewer{suffix}_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    return email, await login_user(client, email, "pass")


async def _admin_token(client: AsyncClient, db, uid: str, *, suffix: str = "") -> tuple[str, str]:
    email = f"admin{suffix}_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="admin")
    return email, await login_user(client, email, "pass")


async def _create_assignment(
    client: AsyncClient,
    admin_tok: str,
    hearing_id: int,
    assignee_email: str,
    *,
    bill_number: str | None = None,
) -> dict:
    """Create a hearing assignment and return the parsed response body."""
    payload: dict = {"hearing_id": hearing_id, "assignee_email": assignee_email}
    if bill_number:
        payload["bill_number"] = bill_number
    resp = await client.post(
        "/workflows/hearing-assignment",
        json=payload,
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# POST /workflows/hearing-assignment
# ---------------------------------------------------------------------------


async def test_admin_can_create_hearing_assignment(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)

    assert body["hearing_id"] == hearing_id
    assert body["bill_id"] is None
    assert "workflow_id" in body
    assert "assignee_id" in body


async def test_admin_can_create_hearing_assignment_with_bill(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    bill_id, bill_number = await _seed_bill(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(
        client, admin_tok, hearing_id, assignee_email, bill_number=bill_number
    )

    assert body["bill_id"] == bill_id


async def test_viewer_cannot_create_hearing_assignment(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, viewer_tok = await _viewer_token(client, db, uid, suffix="_actor")

    resp = await client.post(
        "/workflows/hearing-assignment",
        json={"hearing_id": hearing_id, "assignee_email": assignee_email},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 403


async def test_create_assignment_404_for_nonexistent_hearing(client: AsyncClient, db, uid: str):
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows/hearing-assignment",
        json={"hearing_id": 999999, "assignee_email": assignee_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


async def test_create_assignment_404_for_unknown_assignee(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows/hearing-assignment",
        json={"hearing_id": hearing_id, "assignee_email": "ghost@example.com"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


async def test_create_assignment_404_for_unknown_bill_number(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.post(
        "/workflows/hearing-assignment",
        json={
            "hearing_id": hearing_id,
            "assignee_email": assignee_email,
            "bill_number": "HB 99999",
        },
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /workflows/{id}/actions — assignee flows
# ---------------------------------------------------------------------------


async def test_assignee_can_mark_complete(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, assignee_tok = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_complete"},
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "closed"


async def test_assignee_can_request_reassignment(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, assignee_tok = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "reassignment_request"},
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )
    assert resp.status_code == 201
    # reassignment_request is not terminal — workflow stays open
    assert resp.json()["status"] == "open"


async def test_non_assignee_viewer_cannot_complete(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, bystander_tok = await _viewer_token(client, db, uid, suffix="_bystander")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_complete"},
        headers={"Authorization": f"Bearer {bystander_tok}"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /workflows/{id}/actions — admin flows
# ---------------------------------------------------------------------------


async def test_admin_can_reassign_via_new_assignee_email(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    original_email, _ = await _viewer_token(client, db, uid, suffix="_original")
    new_email, _ = await _viewer_token(client, db, uid, suffix="_new")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, original_email)
    workflow_id = body["workflow_id"]
    original_assignee_id = body["assignee_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned", "new_assignee_email": new_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    from app.models.workflow import HearingAssignment
    from sqlalchemy import select
    result = await db.execute(
        select(HearingAssignment).where(HearingAssignment.workflow_id == workflow_id)
    )
    ha = result.scalar_one()
    assert ha.assignee_id != original_assignee_id


async def test_admin_reassign_404_for_unknown_new_assignee(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned", "new_assignee_email": "ghost@example.com"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


async def test_admin_can_cancel_assignment(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "closed"


async def test_admin_can_discard_assignment(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_discarded"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "closed"


async def test_viewer_cannot_cancel_assignment(client: AsyncClient, db, uid: str):
    """Admin-only actions (cancel/discard) reject even the assignee themselves."""
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, assignee_tok = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled"},
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )
    assert resp.status_code == 403


async def test_action_on_closed_assignment_returns_409(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, assignee_tok = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_complete"},
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "reassignment_request"},
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )
    assert resp.status_code == 409


async def test_invalid_action_type_for_assignment_returns_422(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "approve_bill_tracking"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /workflows/assignees
# ---------------------------------------------------------------------------


async def test_assignees_endpoint_requires_admin(client: AsyncClient, db, uid: str):
    _, viewer_tok = await _viewer_token(client, db, uid)
    resp = await client.get(
        "/workflows/assignees",
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 403


async def test_assignees_endpoint_filters_by_query(client: AsyncClient, db, uid: str):
    target_email, _ = await _viewer_token(client, db, uid, suffix="_target")
    _, admin_tok = await _admin_token(client, db, uid)

    resp = await client.get(
        "/workflows/assignees",
        params={"q": f"viewer_target_{uid}"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200
    assert target_email in resp.json()


# ---------------------------------------------------------------------------
# GET /workflows/has-open — assignee visibility
# ---------------------------------------------------------------------------


async def test_has_open_true_for_assignee(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, assignee_tok = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    # Before any assignment: false
    resp = await client.get(
        "/workflows/has-open",
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )
    assert resp.json() == {"has_open": False}

    await _create_assignment(client, admin_tok, hearing_id, assignee_email)

    resp = await client.get(
        "/workflows/has-open",
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )
    assert resp.json() == {"has_open": True}


async def test_has_open_false_for_unrelated_viewer(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, bystander_tok = await _viewer_token(client, db, uid, suffix="_bystander")
    _, admin_tok = await _admin_token(client, db, uid)

    await _create_assignment(client, admin_tok, hearing_id, assignee_email)

    resp = await client.get(
        "/workflows/has-open",
        headers={"Authorization": f"Bearer {bystander_tok}"},
    )
    assert resp.json() == {"has_open": False}

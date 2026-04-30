"""Tests for hearing assignment workflow endpoints.

Covers:
- POST /workflows/hearing-assignment      — admin creates an assignment
- POST /workflows/{id}/actions            — admin / assignee actions
- GET  /workflows/assignees               — admin-only assignee lookup
- GET  /workflows/has-open                — assignee visibility
"""

import datetime

from httpx import AsyncClient

from tests.conftest import audit_actions_for, login_user, seed_active_user


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
# GET /workflows/assignee-comm-prefs
# ---------------------------------------------------------------------------


async def test_assignee_comm_prefs_requires_admin(client: AsyncClient, db, uid: str):
    target_email, _ = await _viewer_token(client, db, uid, suffix="_target")
    _, viewer_tok = await _viewer_token(client, db, uid)
    resp = await client.get(
        "/workflows/assignee-comm-prefs",
        params={"email": target_email},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 403


async def test_assignee_comm_prefs_default_enabled(client: AsyncClient, db, uid: str):
    target_email, _ = await _viewer_token(client, db, uid, suffix="_target")
    _, admin_tok = await _admin_token(client, db, uid)
    resp = await client.get(
        "/workflows/assignee-comm-prefs",
        params={"email": target_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"email": target_email, "email_enabled": True}


async def test_assignee_comm_prefs_reflects_opt_out(client: AsyncClient, db, uid: str):
    target_email, _ = await _viewer_token(client, db, uid, suffix="_target")
    _, admin_tok = await _admin_token(client, db, uid)

    opt_out = await client.put(
        "/admin/users/comm-prefs",
        params={"email": target_email},
        json={"email_enabled": False},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert opt_out.status_code == 200

    resp = await client.get(
        "/workflows/assignee-comm-prefs",
        params={"email": target_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200
    assert resp.json()["email_enabled"] is False


async def test_assignee_comm_prefs_unknown_email_returns_404(client: AsyncClient, db, uid: str):
    _, admin_tok = await _admin_token(client, db, uid)
    resp = await client.get(
        "/workflows/assignee-comm-prefs",
        params={"email": f"nobody-{uid}@example.com"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


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


# ---------------------------------------------------------------------------
# PATCH /workflows/hearing-assignments/{id} — change type on a suggestion
# ---------------------------------------------------------------------------


async def _seed_suggested_assignment(db, hearing_id: int, assignee_email: str) -> int:
    """Seed an auto_suggested hearing assignment directly via the repository.
    Returns the HearingAssignment.id. The PATCH endpoint only accepts updates
    on assignments that are still in the auto_suggested state, so the API
    create endpoint (which lands in hearing_assigned) doesn't help here."""
    from app.models.workflow import AssignmentType, WorkflowActionType
    from app.repositories.user_repository import get_user_by_email
    from app.repositories.workflow_repository import create_hearing_assignment_workflow

    user = await get_user_by_email(db, assignee_email)
    assert user is not None
    workflow = await create_hearing_assignment_workflow(
        db,
        hearing_id=hearing_id,
        assignee_id=user.id,
        bill_id=None,
        created_by_user_id=user.id,
        initial_action_type=WorkflowActionType.AUTO_SUGGESTED_HEARING_ASSIGNMENT,
        action_actor_user_id=user.id,
        assignment_type=AssignmentType.MONITORING,
    )
    await db.commit()
    await db.refresh(workflow, ["hearing_assignment"])
    return workflow.hearing_assignment.id


async def test_admin_can_change_type_on_suggestion(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)
    assignment_id = await _seed_suggested_assignment(db, hearing_id, assignee_email)

    resp = await client.patch(
        f"/workflows/hearing-assignments/{assignment_id}",
        json={"assignment_type": "awareness"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["assignment_type"] == "awareness"


async def test_change_type_is_idempotent(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)
    assignment_id = await _seed_suggested_assignment(db, hearing_id, assignee_email)

    # Same type as the seeded value — should succeed without error.
    resp = await client.patch(
        f"/workflows/hearing-assignments/{assignment_id}",
        json={"assignment_type": "monitoring"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["assignment_type"] == "monitoring"


async def test_change_type_locked_after_confirmation(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)
    assignment_id = await _seed_suggested_assignment(db, hearing_id, assignee_email)

    # Confirm the suggestion (auto_suggested -> hearing_assigned).
    from app.repositories.workflow_repository import get_hearing_assignment_with_workflow
    ha = await get_hearing_assignment_with_workflow(db, assignment_id)
    workflow_id = ha.workflow_id
    confirm_resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert confirm_resp.status_code == 201, confirm_resp.text

    # Now the type is locked.
    resp = await client.patch(
        f"/workflows/hearing-assignments/{assignment_id}",
        json={"assignment_type": "awareness"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 409


async def test_viewer_cannot_change_type(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, viewer_tok = await _viewer_token(client, db, uid, suffix="_other")
    assignment_id = await _seed_suggested_assignment(db, hearing_id, assignee_email)

    resp = await client.patch(
        f"/workflows/hearing-assignments/{assignment_id}",
        json={"assignment_type": "awareness"},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 403


async def test_change_type_404_for_nonexistent_assignment(client: AsyncClient, db, uid: str):
    _, admin_tok = await _admin_token(client, db, uid)
    resp = await client.patch(
        "/workflows/hearing-assignments/999999",
        json={"assignment_type": "awareness"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Audit log assertions — guard the rename from workflow_action_added to the
# per-action-type names. If anyone renames or drops a name, these tests fail
# instead of analytics quietly losing rows.
# ---------------------------------------------------------------------------


async def test_audit_create_logs_hearing_assignment_created(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)

    actions = await audit_actions_for(db, entity_type="workflow", entity_id=body["workflow_id"])
    assert actions == ["hearing_assignment_created"]


async def test_audit_complete_logs_hearing_assignment_completed(client: AsyncClient, db, uid: str):
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

    actions = await audit_actions_for(db, entity_type="workflow", entity_id=workflow_id)
    assert actions == ["hearing_assignment_created", "hearing_assignment_completed"]
    assert "workflow_action_added" not in actions


async def test_audit_cancel_logs_hearing_assignment_canceled(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "no longer needed"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    actions = await audit_actions_for(db, entity_type="workflow", entity_id=workflow_id)
    assert actions == ["hearing_assignment_created", "hearing_assignment_canceled"]


async def test_audit_discard_logs_hearing_assignment_discarded(client: AsyncClient, db, uid: str):
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

    actions = await audit_actions_for(db, entity_type="workflow", entity_id=workflow_id)
    assert actions == ["hearing_assignment_created", "hearing_assignment_discarded"]


async def test_audit_reassignment_request_logs_hearing_reassignment_requested(client: AsyncClient, db, uid: str):
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

    actions = await audit_actions_for(db, entity_type="workflow", entity_id=workflow_id)
    assert actions == ["hearing_assignment_created", "hearing_reassignment_requested"]


async def test_audit_reassign_via_new_assignee_email_logs_hearing_reassigned(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    original_email, _ = await _viewer_token(client, db, uid, suffix="_original")
    new_email, _ = await _viewer_token(client, db, uid, suffix="_new")
    _, admin_tok = await _admin_token(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, original_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned", "new_assignee_email": new_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    actions = await audit_actions_for(db, entity_type="workflow", entity_id=workflow_id)
    assert actions == ["hearing_assignment_created", "hearing_reassigned"]
    # Distinct from the no-reassign confirm action.
    assert "hearing_assignment_confirmed" not in actions


async def test_audit_confirm_suggestion_logs_hearing_assignment_confirmed(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)
    assignment_id = await _seed_suggested_assignment(db, hearing_id, assignee_email)

    from app.repositories.workflow_repository import get_hearing_assignment_with_workflow
    ha = await get_hearing_assignment_with_workflow(db, assignment_id)
    workflow_id = ha.workflow_id

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    actions = await audit_actions_for(db, entity_type="workflow", entity_id=workflow_id)
    # Suggested assignment was seeded directly via repository (no audit row),
    # so the only audited event here is the confirm.
    assert actions == ["hearing_assignment_confirmed"]


async def test_audit_change_type_logs_hearing_assignment_type_updated(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer_token(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin_token(client, db, uid)
    assignment_id = await _seed_suggested_assignment(db, hearing_id, assignee_email)

    resp = await client.patch(
        f"/workflows/hearing-assignments/{assignment_id}",
        json={"assignment_type": "awareness"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200

    actions = await audit_actions_for(
        db, entity_type="hearing_assignment", entity_id=assignment_id
    )
    assert actions == ["hearing_assignment_type_updated"]

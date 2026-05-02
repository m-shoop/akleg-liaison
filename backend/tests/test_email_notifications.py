"""Tests for the LEG-138 email-notification system.

Covers:
- email_notifications row inserted on assignment creation
- cancellation notification gated on creation having been sent
- reassignment fans out cancellation+creation, suppressed_reason for same-user
- workflow_action_messages stores the cancellation_reason
- /api/email-templates admin CRUD + preview rendering
- /api/users/me/comm-prefs read/update + history
- /api/admin/users/comm-prefs?email=<addr> admin override
- /api/opt-out signed-token round-trip
- Pre-insert opt-out: row inserted with suppressed_reason
"""

from __future__ import annotations

import datetime

from httpx import AsyncClient
from sqlalchemy import select

from app.models.email import EmailNotification, UserCommPrefs
from app.services.email_notification_service import issue_opt_out_token
from tests.conftest import login_user, seed_active_user


# ---------------------------------------------------------------------------
# Helpers (mirror what test_hearing_assignments.py uses)
# ---------------------------------------------------------------------------


async def _seed_hearing(db, uid: str, *, is_active: bool = True) -> int:
    from app.models.hearing import CommitteeHearing, Hearing
    hearing = Hearing(
        chamber="H",
        hearing_type="Committee",
        length=60,
        hearing_date=datetime.date(2026, 5, 1),
        hearing_time=datetime.time(13, 30),
        legislature_session=34,
        is_active=is_active,
    )
    db.add(hearing)
    await db.flush()
    committee = CommitteeHearing(
        hearing_id=hearing.id,
        committee_name=f"State Affairs {uid}",
        committee_type="Standing",
    )
    db.add(committee)
    await db.commit()
    await db.refresh(hearing)
    return hearing.id


async def _seed_bill(db, uid: str) -> tuple[int, str]:
    from app.models.bill import Bill
    bill = Bill(
        bill_number=f"HB{uid[:3]}",
        session=34,
        title="Test Bill",
        short_title="Reading scoring",
        status="In Committee",
        is_tracked=True,
    )
    db.add(bill)
    await db.commit()
    await db.refresh(bill)
    return bill.id, bill.bill_number


async def _viewer(client, db, uid, suffix=""):
    email = f"viewer{suffix}_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    return email, await login_user(client, email, "pass")


async def _admin(client, db, uid, suffix=""):
    email = f"admin{suffix}_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="admin")
    return email, await login_user(client, email, "pass")


async def _create_assignment(client, admin_tok, hearing_id, assignee_email, *, bill_number=None):
    payload = {"hearing_id": hearing_id, "assignee_email": assignee_email}
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
# Assignment creation queues a notification
# ---------------------------------------------------------------------------


async def test_creating_assignment_queues_notification(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    bill_id, bill_number = await _seed_bill(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email, bill_number=bill_number)
    ha_id = body["id"]

    rows = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.event_type == "assignment_created"
    assert row.recipient_email == assignee_email
    assert row.sent_at is None
    assert row.error is None
    assert row.suppressed_reason is None
    assert row.state == "pending"
    assert bill_number in row.subject  # bill_number variable substitution
    assert "Opt out" in row.body  # opt-out link injected


# ---------------------------------------------------------------------------
# Pre-insert opt-out: row inserted with suppressed_reason
# ---------------------------------------------------------------------------


async def test_opted_out_user_gets_suppressed_row(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, assignee_tok = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    # Assignee opts out of emails before any assignment.
    resp = await client.put(
        "/users/me/comm-prefs",
        json={"email_enabled": False},
        headers={"Authorization": f"Bearer {assignee_tok}"},
    )
    assert resp.status_code == 200, resp.text

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    ha_id = body["id"]

    rows = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].suppressed_reason == "user opted out"
    assert rows[0].state == "suppressed"


# ---------------------------------------------------------------------------
# Cancellation gating: cancel only emits if creation was sent
# ---------------------------------------------------------------------------


async def test_cancellation_row_inserted_even_when_creation_pending(
    client: AsyncClient, db, uid: str
):
    """Dispatcher always inserts a cancellation row regardless of creation
    state — the "was creation actually sent?" gate runs at send time in the
    worker so a cancellation queued before the worker drains the creation
    isn't silently dropped."""
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    # Creation row exists but its sent_at is still NULL — no SMTP yet.
    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "Bill removed"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201, resp.text

    rows = (
        await db.execute(
            select(EmailNotification)
            .where(EmailNotification.hearing_assignment_id == ha_id)
            .order_by(EmailNotification.created_at)
        )
    ).scalars().all()
    assert [r.event_type for r in rows] == ["assignment_created", "assignment_canceled"]
    # Both still pending — worker decides at drain time.
    assert all(r.state == "pending" for r in rows)


async def test_cancellation_emitted_when_creation_was_sent(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    # Mark the creation row as sent (simulating the worker having drained it).
    creation_row = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalar_one()
    creation_row.sent_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "Bill removed from agenda"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201, resp.text

    rows = (
        await db.execute(
            select(EmailNotification)
            .where(EmailNotification.hearing_assignment_id == ha_id)
            .order_by(EmailNotification.created_at)
        )
    ).scalars().all()
    assert len(rows) == 2
    cancel_row = rows[-1]
    assert cancel_row.event_type == "assignment_canceled"
    assert "Bill removed from agenda" in cancel_row.body


# ---------------------------------------------------------------------------
# workflow_action_messages records the cancellation reason
# ---------------------------------------------------------------------------


async def test_cancellation_reason_recorded_in_workflow_action_messages(
    client: AsyncClient, db, uid: str
):
    from app.models.email import WorkflowActionMessage

    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "Conflict"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    rows = (
        await db.execute(select(WorkflowActionMessage))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].message_type == "cancellation_reason"
    assert rows[0].action_message == "Conflict"


# ---------------------------------------------------------------------------
# Reassignment fans out cancellation + creation
# ---------------------------------------------------------------------------


async def test_reassignment_fans_out_cancellation_and_creation(
    client: AsyncClient, db, uid: str
):
    hearing_id = await _seed_hearing(db, uid)
    a1_email, a1_tok = await _viewer(client, db, uid, suffix="_a1")
    a2_email, _ = await _viewer(client, db, uid, suffix="_a2")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, a1_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    # Mark the creation row as sent so cancellation fires for old assignee.
    creation_row = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalar_one()
    creation_row.sent_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    # Assignee 1 requests reassignment.
    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "reassignment_request"},
        headers={"Authorization": f"Bearer {a1_tok}"},
    )
    assert resp.status_code == 201

    # Admin reassigns to a2.
    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned", "new_assignee_email": a2_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201, resp.text

    rows = (
        await db.execute(
            select(EmailNotification)
            .where(EmailNotification.hearing_assignment_id == ha_id)
            .order_by(EmailNotification.created_at)
        )
    ).scalars().all()
    # creation (a1, sent) + cancellation (a1) + creation (a2)
    assert len(rows) == 3
    assert rows[0].recipient_email == a1_email and rows[0].event_type == "assignment_created"
    assert rows[1].recipient_email == a1_email and rows[1].event_type == "assignment_canceled"
    assert rows[2].recipient_email == a2_email and rows[2].event_type == "assignment_created"


async def test_reassignment_to_same_user_suppresses_cancellation(
    client: AsyncClient, db, uid: str
):
    hearing_id = await _seed_hearing(db, uid)
    a1_email, a1_tok = await _viewer(client, db, uid, suffix="_a1")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, a1_email)
    workflow_id = body["workflow_id"]
    ha_id = body["id"]

    # Mark first creation as sent.
    creation_row = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalar_one()
    creation_row.sent_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    # Assignee 1 requests reassignment, admin reassigns back to a1 (same user).
    await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "reassignment_request"},
        headers={"Authorization": f"Bearer {a1_tok}"},
    )
    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned", "new_assignee_email": a1_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    rows = (
        await db.execute(
            select(EmailNotification)
            .where(EmailNotification.hearing_assignment_id == ha_id)
            .order_by(EmailNotification.created_at)
        )
    ).scalars().all()
    cancellations = [r for r in rows if r.event_type == "assignment_canceled"]
    assert len(cancellations) == 1
    assert cancellations[0].suppressed_reason == "identical_reassignment"


# ---------------------------------------------------------------------------
# Email Templates admin API
# ---------------------------------------------------------------------------


async def test_admin_can_list_and_get_templates(client: AsyncClient, db, uid: str):
    _, admin_tok = await _admin(client, db, uid)
    resp = await client.get(
        "/email-templates", headers={"Authorization": f"Bearer {admin_tok}"}
    )
    assert resp.status_code == 200
    keys = {t["template_key"] for t in resp.json()}
    assert "hearing_assignment_monitoring" in keys
    assert "hearing_assignment_awareness" in keys
    assert "hearing_assignment_canceled" in keys

    resp = await client.get(
        "/email-templates/hearing_assignment_monitoring",
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200
    assert "subject_template" in resp.json()


async def test_viewer_cannot_access_templates(client: AsyncClient, db, uid: str):
    _, viewer_tok = await _viewer(client, db, uid)
    resp = await client.get(
        "/email-templates", headers={"Authorization": f"Bearer {viewer_tok}"}
    )
    assert resp.status_code == 403


async def test_admin_can_update_template(client: AsyncClient, db, uid: str):
    _, admin_tok = await _admin(client, db, uid)
    resp = await client.put(
        "/email-templates/hearing_assignment_monitoring",
        json={
            "subject_template": "({chamber}) {bill_number}",
            "body_markdown": "Hi! {bill_number} on {hearing_date}.",
        },
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["subject_template"] == "({chamber}) {bill_number}"


async def test_template_update_rejects_unknown_variable(client: AsyncClient, db, uid: str):
    _, admin_tok = await _admin(client, db, uid)
    resp = await client.put(
        "/email-templates/hearing_assignment_monitoring",
        json={
            "subject_template": "{not_a_real_variable}",
            "body_markdown": "ok",
        },
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 422


async def test_template_preview_renders(client: AsyncClient, db, uid: str):
    hearing_id = await _seed_hearing(db, uid)
    _, admin_tok = await _admin(client, db, uid)
    resp = await client.post(
        "/email-templates/hearing_assignment_monitoring/preview",
        json={"hearing_id": hearing_id},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["subject"]
    assert "<" in body["html_body"]
    assert body["text_body"]


# ---------------------------------------------------------------------------
# Comm prefs API
# ---------------------------------------------------------------------------


async def test_get_my_comm_prefs_returns_default(client: AsyncClient, db, uid: str):
    viewer_email, viewer_tok = await _viewer(client, db, uid)
    resp = await client.get(
        "/users/me/comm-prefs", headers={"Authorization": f"Bearer {viewer_tok}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["email_enabled"] is True
    assert body["updated_at"] is None  # no row yet
    assert body["email"] == viewer_email


async def test_update_my_comm_prefs_appends_history(client: AsyncClient, db, uid: str):
    _, viewer_tok = await _viewer(client, db, uid)
    resp = await client.put(
        "/users/me/comm-prefs",
        json={"email_enabled": False},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 200

    resp = await client.get(
        "/users/me/comm-prefs/history",
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 200
    history = resp.json()
    assert len(history) == 1
    assert history[0]["new_value"] is False
    assert history[0]["old_value"] is None
    assert history[0]["source"] == "settings_page"


async def test_admin_can_view_other_users_prefs(client: AsyncClient, db, uid: str):
    target_email, _ = await _viewer(client, db, uid, suffix="_target")
    _, admin_tok = await _admin(client, db, uid)

    resp = await client.get(
        "/admin/users/comm-prefs",
        params={"email": target_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["email_enabled"] is True
    assert body["email"] == target_email

    # Admin override
    resp = await client.put(
        "/admin/users/comm-prefs",
        params={"email": target_email},
        json={"email_enabled": False},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200

    resp = await client.get(
        "/admin/users/comm-prefs/history",
        params={"email": target_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 200
    history = resp.json()
    assert history[0]["source"] == "admin_override"


async def test_admin_lookup_unknown_email_returns_404(client: AsyncClient, db, uid: str):
    _, admin_tok = await _admin(client, db, uid)
    resp = await client.get(
        "/admin/users/comm-prefs",
        params={"email": f"nobody-{uid}@example.com"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 404


async def test_viewer_cannot_use_admin_endpoints(client: AsyncClient, db, uid: str):
    _, viewer_tok = await _viewer(client, db, uid)
    target_email, _ = await _viewer(client, db, uid, suffix="_target")
    resp = await client.get(
        "/admin/users/comm-prefs",
        params={"email": target_email},
        headers={"Authorization": f"Bearer {viewer_tok}"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Opt-out token round-trip
# ---------------------------------------------------------------------------


async def test_opt_out_check_then_apply(client: AsyncClient, db, uid: str):
    target_email, _ = await _viewer(client, db, uid)
    from app.repositories.user_repository import get_user_by_email
    target = await get_user_by_email(db, target_email)
    token = issue_opt_out_token(target.id)

    # GET = check only
    resp = await client.get(f"/opt-out/{token}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["email"] == target_email

    # State unchanged before POST.
    prefs = (
        await db.execute(select(UserCommPrefs).where(UserCommPrefs.user_id == target.id))
    ).scalar_one_or_none()
    assert prefs is None

    resp = await client.post(f"/opt-out/{token}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True

    prefs = (
        await db.execute(select(UserCommPrefs).where(UserCommPrefs.user_id == target.id))
    ).scalar_one()
    assert prefs.email_enabled is False


async def test_opt_out_rejects_garbage(client: AsyncClient, db, uid: str):
    resp = await client.get("/opt-out/not-a-real-token")
    assert resp.status_code == 200
    assert resp.json()["ok"] is False

    resp = await client.post("/opt-out/not-a-real-token")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Threading headers (Message-ID / In-Reply-To / References)
# ---------------------------------------------------------------------------


def test_build_thread_headers_root_only_sets_message_id():
    from app.services.email_notification_service import build_thread_headers

    headers = build_thread_headers(
        notification_id=42, thread_root_notification_id=None
    )
    by_name = {h["Name"]: h["Value"] for h in headers}
    assert by_name["Message-ID"] == "<email-notification-42@aklegup.com>"
    assert "In-Reply-To" not in by_name
    assert "References" not in by_name


def test_build_thread_headers_followup_references_root():
    from app.services.email_notification_service import build_thread_headers

    headers = build_thread_headers(
        notification_id=99, thread_root_notification_id=42
    )
    by_name = {h["Name"]: h["Value"] for h in headers}
    assert by_name["Message-ID"] == "<email-notification-99@aklegup.com>"
    assert by_name["In-Reply-To"] == "<email-notification-42@aklegup.com>"
    assert by_name["References"] == "<email-notification-42@aklegup.com>"


async def test_thread_root_lookup_skips_unsent_and_self(client: AsyncClient, db, uid: str):
    """get_thread_root_notification_id returns the earliest *sent* notification
    for (assignment, recipient), excluding the row we're about to send."""
    from app.repositories.email_repository import get_thread_root_notification_id

    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    creation = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalar_one()

    # While creation is still pending, no thread root exists yet.
    assert (
        await get_thread_root_notification_id(
            db,
            hearing_assignment_id=ha_id,
            recipient_user_id=creation.recipient_user_id,
            before_id=creation.id + 1,
        )
        is None
    )

    creation.sent_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "Bill removed"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    cancel_row = (
        await db.execute(
            select(EmailNotification)
            .where(
                EmailNotification.hearing_assignment_id == ha_id,
                EmailNotification.event_type == "assignment_canceled",
            )
        )
    ).scalar_one()

    root_id = await get_thread_root_notification_id(
        db,
        hearing_assignment_id=ha_id,
        recipient_user_id=cancel_row.recipient_user_id,
        before_id=cancel_row.id,
    )
    assert root_id == creation.id

    # The row itself is excluded — its own id is not its thread root.
    assert (
        await get_thread_root_notification_id(
            db,
            hearing_assignment_id=ha_id,
            recipient_user_id=creation.recipient_user_id,
            before_id=creation.id,
        )
        is None
    )


async def test_thread_root_isolates_recipients_after_reassignment(
    client: AsyncClient, db, uid: str
):
    """After reassignment of an assignment from A to B: when the cancellation
    for A is sent, it must thread to A's creation; B's fresh creation must NOT
    inherit A's thread root (different recipient = different chain)."""
    from app.repositories.email_repository import get_thread_root_notification_id

    hearing_id = await _seed_hearing(db, uid)
    a1_email, a1_tok = await _viewer(client, db, uid, suffix="_a1")
    a2_email, _ = await _viewer(client, db, uid, suffix="_a2")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, a1_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    a1_creation = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalar_one()
    a1_creation.sent_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "reassignment_request"},
        headers={"Authorization": f"Bearer {a1_tok}"},
    )
    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assigned", "new_assignee_email": a2_email},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201, resp.text

    rows = (
        await db.execute(
            select(EmailNotification)
            .where(EmailNotification.hearing_assignment_id == ha_id)
            .order_by(EmailNotification.created_at)
        )
    ).scalars().all()
    a1_cancel = next(r for r in rows if r.event_type == "assignment_canceled")
    a2_creation = next(r for r in rows if r.recipient_email == a2_email)

    # A1's cancellation threads back to A1's original creation.
    a1_root = await get_thread_root_notification_id(
        db,
        hearing_assignment_id=ha_id,
        recipient_user_id=a1_cancel.recipient_user_id,
        before_id=a1_cancel.id,
    )
    assert a1_root == a1_creation.id

    # A2's creation is its own thread root — no link to A1's chain even though
    # the same hearing_assignment_id is reused.
    a2_root = await get_thread_root_notification_id(
        db,
        hearing_assignment_id=ha_id,
        recipient_user_id=a2_creation.recipient_user_id,
        before_id=a2_creation.id,
    )
    assert a2_root is None


# ---------------------------------------------------------------------------
# Send-time gates (cancellation queued before creation drains)
# ---------------------------------------------------------------------------


async def test_send_time_gate_suppresses_creation_when_canceled_first(
    client: AsyncClient, db, uid: str
):
    """Cancel arrives while the creation is still pending. The creation row
    should be flagged as "should suppress" by the worker's send-time gate so
    the user never gets a stale assignment email."""
    from app.repositories.email_repository import cancellation_queued_after

    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    # Don't mark creation as sent — simulate the dev race the user hit.
    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "Bill removed"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    creation = (
        await db.execute(
            select(EmailNotification)
            .where(
                EmailNotification.hearing_assignment_id == ha_id,
                EmailNotification.event_type == "assignment_created",
            )
        )
    ).scalar_one()

    assert await cancellation_queued_after(
        db,
        hearing_assignment_id=ha_id,
        recipient_user_id=creation.recipient_user_id,
        after_id=creation.id,
    )


async def test_send_time_gate_suppresses_cancellation_when_creation_unsent(
    client: AsyncClient, db, uid: str
):
    """Symmetric: the worker won't send a cancellation if no creation has
    actually reached the recipient."""
    from app.repositories.email_repository import creation_was_sent_for_recipient

    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "Bill removed"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    cancel = (
        await db.execute(
            select(EmailNotification)
            .where(
                EmailNotification.hearing_assignment_id == ha_id,
                EmailNotification.event_type == "assignment_canceled",
            )
        )
    ).scalar_one()

    # Creation is still pending — recipient never received it.
    assert not await creation_was_sent_for_recipient(
        db,
        hearing_assignment_id=ha_id,
        recipient_user_id=cancel.recipient_user_id,
    )


async def test_send_time_gate_lets_cancellation_through_if_creation_sent(
    client: AsyncClient, db, uid: str
):
    from app.repositories.email_repository import (
        cancellation_queued_after,
        creation_was_sent_for_recipient,
    )

    hearing_id = await _seed_hearing(db, uid)
    assignee_email, _ = await _viewer(client, db, uid, suffix="_assignee")
    _, admin_tok = await _admin(client, db, uid)

    body = await _create_assignment(client, admin_tok, hearing_id, assignee_email)
    ha_id = body["id"]
    workflow_id = body["workflow_id"]

    creation = (
        await db.execute(
            select(EmailNotification).where(EmailNotification.hearing_assignment_id == ha_id)
        )
    ).scalar_one()
    creation.sent_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    resp = await client.post(
        f"/workflows/{workflow_id}/actions",
        json={"type": "hearing_assignment_canceled", "cancellation_reason": "Bill removed"},
        headers={"Authorization": f"Bearer {admin_tok}"},
    )
    assert resp.status_code == 201

    cancel = (
        await db.execute(
            select(EmailNotification)
            .where(
                EmailNotification.hearing_assignment_id == ha_id,
                EmailNotification.event_type == "assignment_canceled",
            )
        )
    ).scalar_one()

    assert await creation_was_sent_for_recipient(
        db,
        hearing_assignment_id=ha_id,
        recipient_user_id=cancel.recipient_user_id,
    )
    # No cancellation queued AFTER the creation, so creation gate is happy too
    # (this is the "creation was already drained" path — gate is a no-op).
    assert not await cancellation_queued_after(
        db,
        hearing_assignment_id=ha_id,
        recipient_user_id=creation.recipient_user_id,
        after_id=cancel.id,
    )

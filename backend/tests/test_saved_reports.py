"""HTTP-level tests for saved-report endpoints — verifies authorization,
visibility filtering, registry validation, and the inactive-update guard."""

from httpx import AsyncClient

from tests.conftest import login_user, seed_active_user


async def _create_user_report(client, token, *, display_name, registry_name="bills", criteria=None):
    return await client.post(
        "/user-report",
        json={
            "display_name": display_name,
            "registry_name": registry_name,
            "publication_level": "user",
            "report_criteria": criteria or {"filters": {"logic": "AND", "conditions": []}},
        },
        headers={"Authorization": f"Bearer {token}"},
    )


async def _create_system_report(client, token, *, display_name, registry_name="hearing_assignments", allowed_roles=None):
    return await client.post(
        "/user-report",
        json={
            "display_name": display_name,
            "registry_name": registry_name,
            "publication_level": "system",
            "allowed_roles": allowed_roles or [],
            "report_criteria": {"filters": {"logic": "AND", "conditions": []}},
        },
        headers={"Authorization": f"Bearer {token}"},
    )


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def test_viewer_can_create_user_level_report(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    resp = await _create_user_report(client, token, display_name=f"My Bills {uid}")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["publication_level"] == "user"
    assert body["user_id"] is not None
    assert body["allowed_roles"] == []  # ignored on user-level
    assert body["is_active"] is True


async def test_viewer_cannot_create_system_level_report(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    resp = await _create_system_report(client, token, display_name=f"System Report {uid}")
    assert resp.status_code == 403


async def test_admin_can_create_system_level_report(client: AsyncClient, db, uid: str):
    email = f"admin_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="admin")
    token = await login_user(client, email, "pass")

    resp = await _create_system_report(
        client, token,
        display_name=f"Viewer-Visible {uid}",
        allowed_roles=["viewer"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["publication_level"] == "system"
    assert body["user_id"] is None
    assert body["allowed_roles"] == ["viewer"]


async def test_create_rejects_admin_in_allowed_roles(client: AsyncClient, db, uid: str):
    """Admin is enforced via bypass, not via allowed_roles — putting it in the
    array would let an admin lock themselves out of their own report (the bug
    that motivated removing admin from the role picker)."""
    email = f"admin_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="admin")
    token = await login_user(client, email, "pass")

    resp = await _create_system_report(
        client, token,
        display_name=f"BadGate {uid}",
        allowed_roles=["admin"],
    )
    assert resp.status_code == 422
    assert "admin" in resp.json()["detail"].lower()


async def test_create_rejects_unknown_registry(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    resp = await _create_user_report(client, token, display_name=f"X_{uid}", registry_name="nonexistent")
    assert resp.status_code == 422


async def test_create_rejects_unknown_allowed_role(client: AsyncClient, db, uid: str):
    email = f"admin_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="admin")
    token = await login_user(client, email, "pass")

    resp = await _create_system_report(
        client, token,
        display_name=f"Bad {uid}",
        allowed_roles=["totally-fake-role"],
    )
    assert resp.status_code == 422


async def test_create_rejects_duplicate_user_display_name(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    name = f"Dup {uid}"
    r1 = await _create_user_report(client, token, display_name=name)
    assert r1.status_code == 201
    r2 = await _create_user_report(client, token, display_name=name)
    assert r2.status_code == 409


# ---------------------------------------------------------------------------
# List + visibility
# ---------------------------------------------------------------------------

async def test_list_includes_own_user_and_visible_system_only(client: AsyncClient, db, uid: str):
    # Admin creates one admin-only (empty allowed_roles) and one viewer-allowed
    # system report.  Under the new semantics, [] means admin-only; viewers
    # need an explicit role grant.
    admin_email = f"admin_{uid}@example.com"
    await seed_active_user(db, admin_email, "pass", role="admin")
    admin_token = await login_user(client, admin_email, "pass")
    r_admin_only = await _create_system_report(
        client, admin_token, display_name=f"AdminOnly_{uid}", allowed_roles=[],
    )
    r_viewer_allowed = await _create_system_report(
        client, admin_token, display_name=f"ViewerAllowed_{uid}",
        allowed_roles=["viewer"],
    )
    assert r_admin_only.status_code == 201 and r_viewer_allowed.status_code == 201

    viewer_email = f"viewer_{uid}@example.com"
    await seed_active_user(db, viewer_email, "pass", role="viewer")
    viewer_token = await login_user(client, viewer_email, "pass")
    r_user = await _create_user_report(
        client, viewer_token, display_name=f"Viewer_{uid}", registry_name="hearing_assignments",
    )
    assert r_user.status_code == 201

    # Viewer sees their own + the viewer-allowed system report, but NOT the
    # admin-only one.
    resp = await client.get(
        "/user-reports/hearing_assignments",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 200
    names = sorted(r["display_name"] for r in resp.json()["reports"])
    assert f"Viewer_{uid}" in names
    assert f"ViewerAllowed_{uid}" in names
    assert f"AdminOnly_{uid}" not in names

    # Admin sees both system reports (the admin-only one trivially, the
    # viewer-allowed one via the admin bypass).
    resp = await client.get(
        "/user-reports/hearing_assignments",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    admin_names = sorted(r["display_name"] for r in resp.json()["reports"])
    assert f"AdminOnly_{uid}" in admin_names
    assert f"ViewerAllowed_{uid}" in admin_names


async def test_admin_bypass_sees_viewer_gated_system_report(client: AsyncClient, db, uid: str):
    """Regression for the original bug: an admin who creates a viewer-gated
    system report must still see it themselves."""
    admin_email = f"admin_{uid}@example.com"
    await seed_active_user(db, admin_email, "pass", role="admin")
    admin_token = await login_user(client, admin_email, "pass")

    created = await _create_system_report(
        client, admin_token,
        display_name=f"ViewerGated_{uid}",
        allowed_roles=["viewer"],
    )
    assert created.status_code == 201, created.text
    rid = created.json()["id"]

    resp = await client.get(
        "/user-reports/hearing_assignments",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert rid in [r["id"] for r in resp.json()["reports"]]


async def test_list_include_inactive_query_param(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    r = await _create_user_report(client, token, display_name=f"Active_{uid}")
    rid = r.json()["id"]
    # Deactivate it.
    upd = await client.put(f"/user-reports/{rid}", json={"is_active": False},
                           headers={"Authorization": f"Bearer {token}"})
    assert upd.status_code == 200
    assert upd.json()["is_active"] is False

    # Default list excludes it.
    resp = await client.get("/user-reports/bills", headers={"Authorization": f"Bearer {token}"})
    assert rid not in [r["id"] for r in resp.json()["reports"]]

    # include_inactive=true includes it.
    resp = await client.get("/user-reports/bills?include_inactive=true",
                            headers={"Authorization": f"Bearer {token}"})
    assert rid in [r["id"] for r in resp.json()["reports"]]


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def test_user_cannot_edit_others_report(client: AsyncClient, db, uid: str):
    a_email = f"a_{uid}@example.com"
    b_email = f"b_{uid}@example.com"
    await seed_active_user(db, a_email, "pass", role="viewer")
    await seed_active_user(db, b_email, "pass", role="viewer")
    a_token = await login_user(client, a_email, "pass")
    b_token = await login_user(client, b_email, "pass")

    r = await _create_user_report(client, a_token, display_name=f"A's {uid}")
    rid = r.json()["id"]

    resp = await client.put(f"/user-reports/{rid}",
                            json={"display_name": "stolen"},
                            headers={"Authorization": f"Bearer {b_token}"})
    assert resp.status_code == 403


async def test_inactive_report_rejects_content_edits(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    r = await _create_user_report(client, token, display_name=f"Inactive_{uid}")
    rid = r.json()["id"]
    # Deactivate.
    deactivate = await client.put(f"/user-reports/{rid}", json={"is_active": False},
                                  headers={"Authorization": f"Bearer {token}"})
    assert deactivate.status_code == 200

    # Now any content edit must fail with 409.
    resp = await client.put(f"/user-reports/{rid}",
                            json={"display_name": "rename while inactive"},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 409

    # But reactivation alone is allowed.
    resp = await client.put(f"/user-reports/{rid}", json={"is_active": True},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True


async def test_system_level_update_rejects_admin_in_allowed_roles(client: AsyncClient, db, uid: str):
    admin_email = f"admin_{uid}@example.com"
    await seed_active_user(db, admin_email, "pass", role="admin")
    token = await login_user(client, admin_email, "pass")

    r = await _create_system_report(
        client, token,
        display_name=f"BumpRoles_{uid}",
        allowed_roles=["viewer"],
    )
    rid = r.json()["id"]
    resp = await client.put(f"/user-reports/{rid}",
                            json={"allowed_roles": ["admin", "viewer"]},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 422
    assert "admin" in resp.json()["detail"].lower()


async def test_user_level_update_rejects_allowed_roles(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    r = await _create_user_report(client, token, display_name=f"NoRoles_{uid}")
    rid = r.json()["id"]
    resp = await client.put(f"/user-reports/{rid}",
                            json={"allowed_roles": ["admin"]},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Default report
# ---------------------------------------------------------------------------

async def test_set_and_clear_default_report(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    r = await _create_user_report(client, token, display_name=f"DefCandidate_{uid}")
    rid = r.json()["id"]

    # Set default.
    resp = await client.put("/default-user-reports/bills", json={"report_id": rid},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 204

    listed = await client.get("/user-reports/bills", headers={"Authorization": f"Bearer {token}"})
    assert listed.json()["default_report_id"] == rid

    # Clear default.
    resp = await client.put("/default-user-reports/bills", json={"report_id": None},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 204
    listed = await client.get("/user-reports/bills", headers={"Authorization": f"Bearer {token}"})
    assert listed.json()["default_report_id"] is None


async def test_cannot_default_report_not_visible_to_caller(client: AsyncClient, db, uid: str):
    # Two viewers, A and B.  A creates a user-level report; B can't default to it.
    a_email = f"a_{uid}@example.com"
    b_email = f"b_{uid}@example.com"
    await seed_active_user(db, a_email, "pass", role="viewer")
    await seed_active_user(db, b_email, "pass", role="viewer")
    a_token = await login_user(client, a_email, "pass")
    b_token = await login_user(client, b_email, "pass")

    r = await _create_user_report(client, a_token, display_name=f"APrivate_{uid}")
    rid = r.json()["id"]

    resp = await client.put("/default-user-reports/bills",
                            json={"report_id": rid},
                            headers={"Authorization": f"Bearer {b_token}"})
    assert resp.status_code == 403


async def test_default_rejects_registry_mismatch(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    r = await _create_user_report(client, token, display_name=f"BillReport_{uid}", registry_name="bills")
    rid = r.json()["id"]
    # Trying to default this bills-report under hearing_assignments must fail.
    resp = await client.put("/default-user-reports/hearing_assignments",
                            json={"report_id": rid},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 422


async def test_cannot_default_inactive_report(client: AsyncClient, db, uid: str):
    email = f"viewer_{uid}@example.com"
    await seed_active_user(db, email, "pass", role="viewer")
    token = await login_user(client, email, "pass")

    r = await _create_user_report(client, token, display_name=f"InactiveDef_{uid}")
    rid = r.json()["id"]

    deactivate = await client.put(f"/user-reports/{rid}", json={"is_active": False},
                                  headers={"Authorization": f"Bearer {token}"})
    assert deactivate.status_code == 200

    resp = await client.put("/default-user-reports/bills", json={"report_id": rid},
                            headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 409


async def test_deactivating_report_clears_default_for_all_users(client: AsyncClient, db, uid: str):
    # Admin creates a system-level report; two users set it as their default.
    admin_email = f"admin_{uid}@example.com"
    await seed_active_user(db, admin_email, "pass", role="admin")
    admin_token = await login_user(client, admin_email, "pass")

    sys_resp = await _create_system_report(
        client, admin_token, display_name=f"SharedDef_{uid}",
        registry_name="hearing_assignments",
        allowed_roles=["viewer"],
    )
    rid = sys_resp.json()["id"]

    viewer_email = f"viewer_{uid}@example.com"
    await seed_active_user(db, viewer_email, "pass", role="viewer")
    viewer_token = await login_user(client, viewer_email, "pass")

    for tok in (admin_token, viewer_token):
        resp = await client.put("/default-user-reports/hearing_assignments",
                                json={"report_id": rid},
                                headers={"Authorization": f"Bearer {tok}"})
        assert resp.status_code == 204

    # Confirm both users see it as their default.
    for tok in (admin_token, viewer_token):
        listed = await client.get("/user-reports/hearing_assignments",
                                  headers={"Authorization": f"Bearer {tok}"})
        assert listed.json()["default_report_id"] == rid

    # Admin deactivates the report.
    deactivate = await client.put(f"/user-reports/{rid}", json={"is_active": False},
                                  headers={"Authorization": f"Bearer {admin_token}"})
    assert deactivate.status_code == 200

    # Both users' defaults are now cleared.
    for tok in (admin_token, viewer_token):
        listed = await client.get("/user-reports/hearing_assignments?include_inactive=true",
                                  headers={"Authorization": f"Bearer {tok}"})
        assert listed.json()["default_report_id"] is None


# ---------------------------------------------------------------------------
# Role picker
# ---------------------------------------------------------------------------

async def test_only_admins_list_roles(client: AsyncClient, db, uid: str):
    """Picker is admin-only and excludes 'admin' itself — admins satisfy any
    role gate by bypass, so offering it would only enable a self-lockout."""
    viewer_email = f"viewer_{uid}@example.com"
    await seed_active_user(db, viewer_email, "pass", role="viewer")
    viewer_token = await login_user(client, viewer_email, "pass")
    resp = await client.get("/roles", headers={"Authorization": f"Bearer {viewer_token}"})
    assert resp.status_code == 403

    admin_email = f"admin_{uid}@example.com"
    await seed_active_user(db, admin_email, "pass", role="admin")
    admin_token = await login_user(client, admin_email, "pass")
    resp = await client.get("/roles", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    names = [r["name"] for r in resp.json()]
    assert "admin" not in names
    assert "viewer" in names

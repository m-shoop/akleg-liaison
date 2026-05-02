import { apiFetch } from "./apiFetch";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token) {
  return { "Content-Type": "application/json", ...(token ? authHeaders(token) : {}) };
}

async function parseOrThrow(res, fallback) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `${fallback}: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

export async function fetchEmailTemplates(token) {
  const res = await apiFetch("/api/email-templates", { headers: authHeaders(token) });
  return parseOrThrow(res, "Failed to load templates");
}

export async function fetchEmailTemplate(templateKey, token) {
  const res = await apiFetch(`/api/email-templates/${templateKey}`, {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load template");
}

export async function fetchTemplateVariables(token) {
  const res = await apiFetch("/api/email-templates/variables", {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load template variables");
}

export async function fetchPreviewHearings(token) {
  const res = await apiFetch("/api/email-templates/preview-hearings", {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load preview hearings");
}

export async function updateEmailTemplate(templateKey, fields, token) {
  const res = await apiFetch(`/api/email-templates/${templateKey}`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify(fields),
  });
  return parseOrThrow(res, "Failed to update template");
}

export async function previewEmailTemplate(
  templateKey,
  hearingId,
  token,
  { cancellationReason, assignmentType } = {},
) {
  const res = await apiFetch(`/api/email-templates/${templateKey}/preview`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      hearing_id: hearingId,
      cancellation_reason: cancellationReason ?? null,
      assignment_type: assignmentType ?? null,
    }),
  });
  return parseOrThrow(res, "Failed to preview template");
}

export async function testSendEmailTemplate(
  templateKey,
  hearingId,
  token,
  { cancellationReason, assignmentType } = {},
) {
  const res = await apiFetch(`/api/email-templates/${templateKey}/test-send`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      hearing_id: hearingId,
      cancellation_reason: cancellationReason ?? null,
      assignment_type: assignmentType ?? null,
    }),
  });
  return parseOrThrow(res, "Test send failed");
}

// ---------------------------------------------------------------------------
// Notifications (audit log)
// ---------------------------------------------------------------------------

export async function fetchEmailNotifications(token, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.append(k, v);
  });
  const url = `/api/email-notifications${qs.toString() ? `?${qs}` : ""}`;
  const res = await apiFetch(url, { headers: authHeaders(token) });
  return parseOrThrow(res, "Failed to load notifications");
}

export async function fetchEmailNotification(id, token) {
  const res = await apiFetch(`/api/email-notifications/${id}`, {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load notification");
}

// ---------------------------------------------------------------------------
// Comm prefs
// ---------------------------------------------------------------------------

export async function fetchMyCommPrefs(token) {
  const res = await apiFetch("/api/users/me/comm-prefs", {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load comm prefs");
}

export async function updateMyCommPrefs(emailEnabled, token) {
  const res = await apiFetch("/api/users/me/comm-prefs", {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify({ email_enabled: emailEnabled }),
  });
  return parseOrThrow(res, "Failed to update comm prefs");
}

export async function fetchMyCommPrefsHistory(token) {
  const res = await apiFetch("/api/users/me/comm-prefs/history", {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load history");
}

export async function adminFetchCommPrefs(email, token) {
  const qs = new URLSearchParams({ email });
  const res = await apiFetch(`/api/admin/users/comm-prefs?${qs}`, {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load user comm prefs");
}

export async function adminUpdateCommPrefs(email, emailEnabled, token) {
  const qs = new URLSearchParams({ email });
  const res = await apiFetch(`/api/admin/users/comm-prefs?${qs}`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify({ email_enabled: emailEnabled }),
  });
  return parseOrThrow(res, "Failed to update user comm prefs");
}

export async function adminFetchCommPrefsHistory(email, token) {
  const qs = new URLSearchParams({ email });
  const res = await apiFetch(`/api/admin/users/comm-prefs/history?${qs}`, {
    headers: authHeaders(token),
  });
  return parseOrThrow(res, "Failed to load user comm prefs history");
}

// ---------------------------------------------------------------------------
// Public opt-out (no auth)
// ---------------------------------------------------------------------------

export async function checkOptOutToken(token) {
  const res = await apiFetch(`/api/opt-out/${token}`);
  if (!res.ok) {
    return { ok: false, email: null, detail: "request failed" };
  }
  return res.json();
}

export async function applyOptOut(token) {
  const res = await apiFetch(`/api/opt-out/${token}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to opt out");
  }
  return res.json();
}

import { apiFetch } from "./apiFetch";

const BASE = "/api/workflows";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchHasOpen(token) {
  const headers = token ? authHeaders(token) : {};
  const res = await apiFetch(`${BASE}/has-open`, { headers });
  if (!res.ok) return { has_open: false };
  return res.json();
}

export async function fetchWorkflows({ token, includeClosed = false } = {}) {
  const url = includeClosed ? `${BASE}?include_closed=true` : BASE;
  const res = await apiFetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to fetch workflows");
  }
  return res.json();
}

export async function requestBillTracking(billId, token) {
  const res = await apiFetch(BASE, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ bill_id: billId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to request tracking");
  }
  return res.json();
}

export async function fetchBillTrackingState({ billIds, token }) {
  const res = await apiFetch(`${BASE}/bill-tracking-state`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ bill_ids: billIds }),
  });
  if (!res.ok) return [];
  return res.json();
}

export async function createHearingAssignment({ hearingId, assigneeEmail, billNumber = null, token }) {
  const res = await apiFetch(`${BASE}/hearing-assignment`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      hearing_id: hearingId,
      assignee_email: assigneeEmail,
      bill_number: billNumber || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to create assignment");
  }
  return res.json();
}

export async function addWorkflowAction(workflowId, actionType, token, { newAssigneeEmail } = {}) {
  const body = { type: actionType };
  if (newAssigneeEmail) body.new_assignee_email = newAssigneeEmail;
  const res = await apiFetch(`${BASE}/${workflowId}/actions`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to add workflow action");
  }
  return res.json();
}

import { apiFetch } from "./apiFetch";

const BASE = "/api/workflows";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
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

export async function createHearingAssignment({
  hearingId,
  assigneeEmail,
  billNumber = null,
  assignmentType = "monitoring",
  token,
}) {
  const res = await apiFetch(`${BASE}/hearing-assignment`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      hearing_id: hearingId,
      assignee_email: assigneeEmail,
      bill_number: billNumber || null,
      assignment_type: assignmentType,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to create assignment");
  }
  return res.json();
}

export async function updateHearingAssignmentType({ assignmentId, assignmentType, token }) {
  const res = await apiFetch(`${BASE}/hearing-assignments/${assignmentId}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ assignment_type: assignmentType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to update assignment type");
  }
  return res.json();
}

export async function updateHearingAssignmentCallIn({ assignmentId, callIn, token }) {
  const res = await apiFetch(`${BASE}/hearing-assignments/${assignmentId}/call-in`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ call_in: callIn }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to update call-in");
  }
  return res.json();
}

export async function fetchAssigneeCommPrefs(email, token) {
  const qs = new URLSearchParams({ email });
  const res = await apiFetch(`${BASE}/assignee-comm-prefs?${qs}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export async function addWorkflowAction(workflowId, actionType, token, { newAssigneeEmail, cancellationReason, reassignmentReason } = {}) {
  const body = { type: actionType };
  if (newAssigneeEmail) body.new_assignee_email = newAssigneeEmail;
  if (cancellationReason) body.cancellation_reason = cancellationReason;
  if (reassignmentReason) body.reassignment_reason = reassignmentReason;
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

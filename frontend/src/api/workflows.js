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

export async function addWorkflowAction(workflowId, actionType, token) {
  const res = await apiFetch(`${BASE}/${workflowId}/actions`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ type: actionType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to add workflow action");
  }
  return res.json();
}

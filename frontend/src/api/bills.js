import { apiFetch } from "./apiFetch";

const BASE = "/api";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchBills({ includeUntracked = false, token = null } = {}) {
  const url = includeUntracked ? `${BASE}/bills?include_untracked=true` : `${BASE}/bills`;
  const headers = token ? authHeaders(token) : {};
  const res = await apiFetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch bills: ${res.status}`);
  return res.json();
}

export async function setTracked(billId, isTracked, token) {
  const res = await apiFetch(
    `${BASE}/bills/${billId}/tracked?is_tracked=${isTracked}`,
    { method: "PATCH", headers: authHeaders(token) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to update tracking");
  }
  return res.json();
}

export async function fetchAllBills(token) {
  const res = await apiFetch(`${BASE}/bills/fetch-all`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to start import");
  }
  return res.json();
}

export async function refreshBill(billId, token) {
  const res = await apiFetch(`${BASE}/bills/${billId}/refresh`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to refresh bill");
  }
  return res.json();
}

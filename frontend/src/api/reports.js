import { apiFetch } from "./apiFetch";

const BASE = "/api/reports";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchReportMeta(token) {
  const res = await apiFetch(BASE, {
    headers: token ? authHeaders(token) : {},
  });
  if (!res.ok) throw new Error(`Failed to load report metadata: ${res.status}`);
  return res.json();
}

export async function fetchReport({
  reportId,
  columns = [],
  filters = {},
  page = 1,
  pageSize = 2000,
  sortBy = [],
  sortDir = "asc",
  token = null,
} = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(token ? authHeaders(token) : {}),
  };
  const res = await apiFetch(`${BASE}/${reportId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ columns, filters, page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Failed to run report: ${res.status}`);
  }
  return res.json();
}

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

export async function fetchSavedReports({ registryName, includeInactive = false, token }) {
  const qs = includeInactive ? "?include_inactive=true" : "";
  const res = await apiFetch(`/api/user-reports/${registryName}${qs}`, {
    headers: token ? authHeaders(token) : {},
  });
  return parseOrThrow(res, "Failed to load saved reports");
}

export async function createSavedReport({
  displayName,
  registryName,
  publicationLevel = "user",
  allowedRoles = [],
  reportCriteria,
  token,
}) {
  const res = await apiFetch("/api/user-report", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      display_name: displayName,
      registry_name: registryName,
      publication_level: publicationLevel,
      allowed_roles: allowedRoles,
      report_criteria: reportCriteria,
    }),
  });
  return parseOrThrow(res, "Failed to save report");
}

export async function updateSavedReport({ id, fields, token }) {
  // fields is a partial: { display_name?, report_criteria?, is_active?, allowed_roles? }
  const res = await apiFetch(`/api/user-reports/${id}`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify(fields),
  });
  return parseOrThrow(res, "Failed to update report");
}

export async function setDefaultUserReport({ registryName, reportId, token }) {
  const res = await apiFetch(`/api/default-user-reports/${registryName}`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify({ report_id: reportId }),
  });
  return parseOrThrow(res, "Failed to set default report");
}

export async function fetchRoles(token) {
  const res = await apiFetch("/api/roles", {
    headers: token ? authHeaders(token) : {},
  });
  return parseOrThrow(res, "Failed to load roles");
}

export async function reorderSavedReport({ registryName, reportId, afterId, beforeId, token }) {
  const res = await apiFetch(`/api/user-reports/${registryName}/order`, {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      report_id: reportId,
      after_id: afterId ?? null,
      before_id: beforeId ?? null,
    }),
  });
  return parseOrThrow(res, "Failed to reorder report");
}

export async function sortSavedReportsAlphabetically({ registryName, token }) {
  const res = await apiFetch(
    `/api/user-reports/${registryName}/order/sort-alphabetical`,
    {
      method: "POST",
      headers: jsonHeaders(token),
    },
  );
  return parseOrThrow(res, "Failed to sort reports alphabetically");
}

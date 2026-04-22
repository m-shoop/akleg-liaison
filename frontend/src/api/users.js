import { apiFetch } from "./apiFetch";

export async function searchUsers(q, token) {
  const params = new URLSearchParams({ q });
  const res = await apiFetch(`/api/workflows/assignees?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

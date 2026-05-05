import { apiFetch } from "./apiFetch";

// Returns: [{ email, name }, ...]
export async function searchUsers(q, token) {
  const params = new URLSearchParams({ q });
  const res = await apiFetch(`/api/workflows/assignees?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function adminListUsers(token) {
  const res = await apiFetch(`/api/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  return res.json();
}

export async function adminUpdateUserName(userId, name, token) {
  const res = await apiFetch(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Failed to update user name (${res.status})`);
  }
  return res.json();
}

export async function adminCreateUser(email, name, token) {
  const res = await apiFetch(`/api/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Failed to create user (${res.status})`);
  }
  return res.json();
}

export async function adminDeleteUser(userId, token) {
  const res = await apiFetch(`/api/admin/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Failed to delete user (${res.status})`);
  }
  return res.json();
}

export async function adminListDeletedUsers(token) {
  const res = await apiFetch(`/api/admin/users/deleted`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load deleted users (${res.status})`);
  return res.json();
}

export async function adminReviveUser(userId, token) {
  const res = await apiFetch(`/api/admin/users/${userId}/revive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Failed to revive user (${res.status})`);
  }
  return res.json();
}

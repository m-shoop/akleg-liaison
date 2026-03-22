const BASE = "/api";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function fetchTags() {
  const res = await fetch(`${BASE}/tags`);
  if (!res.ok) throw new Error(`Failed to fetch tags: ${res.status}`);
  return res.json();
}

export async function setTagActive(tagId, isActive, token) {
  const res = await fetch(`${BASE}/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to update tag");
  }
  return res.json();
}

export async function addTagToBill(billId, label, token) {
  const res = await fetch(`${BASE}/bills/${billId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to add tag");
  }
  return res.json(); // returns TagRead
}

export async function removeTagFromBill(billId, tagId, token) {
  const res = await fetch(`${BASE}/bills/${billId}/tags/${tagId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to remove tag");
  }
  // 204 No Content — nothing to return
}

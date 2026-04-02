import { apiFetch } from "./apiFetch";

const API = "/api";

export async function fetchMeetings({ startDate, endDate, legislatureSession = 34, includeInactive = false }) {
  const params = new URLSearchParams({
    start_date: startDate,
    legislature_session: legislatureSession,
    include_inactive: includeInactive,
  });
  if (endDate) params.set("end_date", endDate);
  const res = await apiFetch(`${API}/meetings?${params}`);
  if (!res.ok) throw new Error("Failed to fetch meetings");
  return res.json();
}

export async function scrapeMeetings({ startDate, endDate, legislatureSession = 34 }, token) {
  const res = await apiFetch(`${API}/meetings/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      start_date: startDate,
      end_date: endDate,
      legislature_session: legislatureSession,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Scrape failed");
  }
  return res.json();
}

export async function fetchUpcomingHearings({ legislatureSession = 34 } = {}) {
  const params = new URLSearchParams({ legislature_session: legislatureSession });
  const res = await apiFetch(`${API}/meetings/upcoming-bill-hearings?${params}`);
  if (!res.ok) throw new Error("Failed to fetch upcoming hearings");
  return res.json(); // { [bill_id]: "YYYY-MM-DD" }
}

export async function fetchRecentHearings({ legislatureSession = 34 } = {}) {
  const params = new URLSearchParams({ legislature_session: legislatureSession });
  const res = await apiFetch(`${API}/meetings/recent-bill-hearings?${params}`);
  if (!res.ok) throw new Error("Failed to fetch recent hearings");
  return res.json(); // { [bill_id]: "YYYY-MM-DD" }
}

export async function updateHidden(meetingId, hidden, token) {
  const res = await apiFetch(`${API}/meetings/${meetingId}/hidden`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok) throw new Error("Failed to update hidden status");
  return res.json();
}

export async function updateDpsNotes(meetingId, dpsNotes, token) {
  const res = await apiFetch(`${API}/meetings/${meetingId}/dps-notes`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ dps_notes: dpsNotes }),
  });
  if (!res.ok) throw new Error("Failed to update DPS notes");
  return res.json();
}

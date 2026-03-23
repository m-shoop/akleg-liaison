const API = "/api";

export async function fetchMeetings({ startDate, endDate, legislatureSession = 34, includeInactive = false }) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    legislature_session: legislatureSession,
    include_inactive: includeInactive,
  });
  const res = await fetch(`${API}/meetings?${params}`);
  if (!res.ok) throw new Error("Failed to fetch meetings");
  return res.json();
}

export async function scrapeMeetings({ startDate, endDate, legislatureSession = 34 }, token) {
  const res = await fetch(`${API}/meetings/scrape`, {
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

export async function updateDpsNotes(meetingId, dpsNotes, token) {
  const res = await fetch(`${API}/meetings/${meetingId}/dps-notes`, {
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

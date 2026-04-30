import { useEffect, useState } from "react";
import { fetchAssigneeCommPrefs } from "../api/workflows";

export const OPT_OUT_WARNING =
  "Target assignee has opted out of email notifications. No notifications will be sent.";

// Looks up the prospective assignee's email-notification preference and returns
// `true` only when we've confirmed they've opted out. Debounced so combobox
// typing doesn't hammer the endpoint.
export function useAssigneeOptedOut(email, token) {
  const [optedOut, setOptedOut] = useState(false);

  useEffect(() => {
    const trimmed = email?.trim();
    if (!trimmed || !token) {
      setOptedOut(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const prefs = await fetchAssigneeCommPrefs(trimmed, token);
      if (cancelled) return;
      setOptedOut(prefs !== null && prefs.email_enabled === false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email, token]);

  return optedOut;
}

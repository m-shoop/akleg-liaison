import { useEffect, useState } from "react";
import { searchUsers } from "../api/users";

// Fetches the active-user list once when `enabled` flips true. Used to
// populate assignee dropdowns (create/reassign workflows).
export function useAssignees(enabled, token) {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    if (!enabled || !token) return;
    searchUsers("", token).then(setUsers).catch(() => setUsers([]));
  }, [enabled, token]);
  return users;
}

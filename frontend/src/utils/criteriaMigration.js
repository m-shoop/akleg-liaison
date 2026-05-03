/**
 * Translates legacy report-criteria shapes into the current model so the rest
 * of the app can assume one shape.  Runs before `resolveCriteriaSentinels` —
 * once sentinels resolve to literals, we can no longer tell the difference
 * between a user-typed value and a sentinel-derived one.
 *
 * Today this normalizes one case: rows that stored the assignee as the
 * `@current_user_email` sentinel (e.g. the seeded "My Open Assignments" system
 * report) are rewritten to use the explicit `assigneeMode: "relative"` /
 * `assigneeRelative: "me"` shape that the new Relative-mode UI exposes.
 */
export function migrateLegacyCriteria(criteria) {
  if (criteria == null || !Array.isArray(criteria.criteria)) return criteria;
  let changed = false;
  const migratedRows = criteria.criteria.map((row) => {
    const next = migrateRow(row);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? { ...criteria, criteria: migratedRows } : criteria;
}

function migrateRow(row) {
  if (!row?.value) return row;
  const v = row.value;
  let next = v;

  if (v.assignee_email === "@current_user_email") {
    next = { ...next, assigneeMode: "relative", assigneeRelative: "me", assignee_email: "" };
  }

  if (v.advanced && v.advanced.assignment_assignee_email === "@current_user_email") {
    next = {
      ...next,
      advanced: {
        ...next.advanced,
        assignment_assignee_email_mode: "relative",
        assignment_assignee_email_relative: "me",
        assignment_assignee_email: "",
      },
    };
  }

  return next === v ? row : { ...row, value: next };
}

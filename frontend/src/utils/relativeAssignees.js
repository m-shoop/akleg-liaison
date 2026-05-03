export const RELATIVE_ASSIGNEES = [
  { value: "me", label: "Me" },
];

export function relativeAssigneeLabel(name) {
  return RELATIVE_ASSIGNEES.find((o) => o.value === name)?.label ?? null;
}

/**
 * Resolves a symbolic relative assignee selection ("me") to the literal email
 * to filter on.  Returns null when the name is unknown or the context lacks a
 * username, so callers can fall through gracefully.
 */
export function resolveRelativeAssignee(name, ctx = {}) {
  if (name === "me") return ctx.username || null;
  return null;
}

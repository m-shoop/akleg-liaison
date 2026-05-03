import { buildSummary as buildRequestSummary } from "../../components/RequestsFilterBar/RequestsFilterBar";
import { createInitialState } from "../../components/StackingCriteria/createInitialState";
import { resolveRelativeAssignee } from "../../utils/relativeAssignees";

// ─── Hearing Assignments ──────────────────────────────────────────────────

export const ASSIGNMENT_ROW_DEFAULTS = {
  latest_action_type: [],
  assignee_email: "",
  assigneeMode: "email",
  assigneeRelative: "",
  bill_numbers: [],
  hearing_date_from: "",
  hearing_date_to: "",
};

export function makeAssignmentNewRowValue() {
  return { ...ASSIGNMENT_ROW_DEFAULTS, bill_numbers: [] };
}

// Reads the bill-number filter as an array. Falls back to the legacy single-string
// shape so reports/sessions saved before the chip UI keep working.
export function readAssignmentBillNumbers(rowValue) {
  const list = rowValue?.bill_numbers;
  if (Array.isArray(list)) return list;
  const legacy = rowValue?.bill_number;
  if (typeof legacy === "string" && legacy.trim()) return [legacy.trim()];
  return [];
}

export function buildAssignmentRowFilterGroup(rowValue, { canViewAll, username }) {
  if (!rowValue) return null;
  const conditions = [];

  const assigneeMode = rowValue.assigneeMode ?? "email";
  if (assigneeMode === "relative") {
    const resolved = resolveRelativeAssignee(rowValue.assigneeRelative, { username });
    if (resolved) {
      conditions.push({ field: "assignee_email", op: "equals", value: resolved });
    } else if (!canViewAll) {
      conditions.push({ field: "assignee_email", op: "equals", value: username });
    }
  } else if (!canViewAll && !rowValue.assignee_email?.trim()) {
    conditions.push({ field: "assignee_email", op: "equals", value: username });
  } else if (rowValue.assignee_email?.trim()) {
    conditions.push({ field: "assignee_email", op: "contains", value: rowValue.assignee_email.trim() });
  }

  if (rowValue.latest_action_type?.length > 0) {
    conditions.push({ field: "latest_action_type", op: "in", value: rowValue.latest_action_type });
  }
  const billNumbers = readAssignmentBillNumbers(rowValue);
  if (billNumbers.length > 0) {
    conditions.push({ field: "bill_number", op: "in", value: billNumbers });
  }
  if (rowValue.hearing_date_from && rowValue.hearing_date_to) {
    conditions.push({ field: "hearing_date", op: "between", value: [rowValue.hearing_date_from, rowValue.hearing_date_to] });
  } else if (rowValue.hearing_date_from) {
    conditions.push({ field: "hearing_date", op: "after", value: rowValue.hearing_date_from });
  } else if (rowValue.hearing_date_to) {
    conditions.push({ field: "hearing_date", op: "before", value: rowValue.hearing_date_to });
  }

  return { logic: "AND", conditions, groups: [] };
}

const ASSIGNMENT_ACTION_LABELS = {
  hearing_assigned: "Assigned",
  hearing_reassigned: "Assigned",
  reassignment_request: "Reassignment Requested",
  hearing_assignment_complete: "Completed",
  hearing_assignment_canceled: "Canceled",
  hearing_assignment_discarded: "Discarded",
  auto_suggested_hearing_assignment: "Suggested",
};

export function summarizeAssignmentRow(rowValue) {
  if (!rowValue) return null;
  const parts = [];
  if (rowValue.latest_action_type?.length > 0) {
    const labels = rowValue.latest_action_type.map((v) => ASSIGNMENT_ACTION_LABELS[v] ?? v);
    parts.push(`Type: ${labels.join(", ")}`);
  }
  if (rowValue.assigneeMode === "relative") {
    if (rowValue.assigneeRelative === "me") parts.push("Assignee: Me");
  } else if (rowValue.assignee_email) {
    parts.push(`Assignee: "${rowValue.assignee_email}"`);
  }
  const billNumbers = readAssignmentBillNumbers(rowValue);
  if (billNumbers.length > 0) parts.push(`Bill: ${billNumbers.join(", ")}`);
  if (rowValue.hearing_date_from && rowValue.hearing_date_to) {
    parts.push(`Hearing: ${rowValue.hearing_date_from} – ${rowValue.hearing_date_to}`);
  } else if (rowValue.hearing_date_from) {
    parts.push(`Hearing: after ${rowValue.hearing_date_from}`);
  } else if (rowValue.hearing_date_to) {
    parts.push(`Hearing: before ${rowValue.hearing_date_to}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

// ─── Bill Tracking Requests ───────────────────────────────────────────────

export const REQUEST_ROW_DEFAULTS = {
  workflow_status: ["open"],
  outcome: [],
  bill_number: "",
  requestor_email: "",
  bill_is_tracked: null,
  advanced: {
    created_at_from: "",
    created_at_to: "",
    updated_at_from: "",
    updated_at_to: "",
    bill_short_title: "",
    bill_session: [],
    bill_status: "",
  },
};

export function makeRequestNewRowValue() {
  return {
    workflow_status: [],
    outcome: [],
    bill_number: "",
    requestor_email: "",
    bill_is_tracked: null,
    advanced: {
      created_at_from: "",
      created_at_to: "",
      updated_at_from: "",
      updated_at_to: "",
      bill_short_title: "",
      bill_session: [],
      bill_status: "",
    },
  };
}

export function makeDefaultRequestsCriteria() {
  return createInitialState({
    seedRows: [{ ...REQUEST_ROW_DEFAULTS, advanced: { ...REQUEST_ROW_DEFAULTS.advanced } }],
  });
}

export function buildRequestRowFilterGroup(rowValue, { canViewAll, username }) {
  if (!rowValue) return null;
  const f = rowValue;
  const conditions = [];

  if (!canViewAll) {
    conditions.push({ field: "requestor_email", op: "equals", value: username });
  }
  if (f.workflow_status?.length > 0) {
    conditions.push({ field: "workflow_status", op: "in", value: f.workflow_status });
  }
  if (f.outcome?.length > 0) {
    conditions.push({ field: "latest_action_type", op: "in", value: f.outcome });
  }
  if (f.bill_number?.trim()) {
    conditions.push({ field: "bill_number", op: "contains", value: f.bill_number.trim() });
  }
  if (canViewAll && f.requestor_email?.trim()) {
    conditions.push({ field: "requestor_email", op: "contains", value: f.requestor_email.trim() });
  }
  if (f.bill_is_tracked !== null && f.bill_is_tracked !== undefined) {
    conditions.push({ field: "bill_is_tracked", op: "equals", value: f.bill_is_tracked });
  }

  const adv = f.advanced ?? {};
  if (adv.created_at_from && adv.created_at_to) {
    conditions.push({ field: "created_at", op: "between", value: [adv.created_at_from, adv.created_at_to] });
  } else if (adv.created_at_from) {
    conditions.push({ field: "created_at", op: "after", value: adv.created_at_from });
  } else if (adv.created_at_to) {
    conditions.push({ field: "created_at", op: "before", value: adv.created_at_to });
  }
  if (adv.updated_at_from && adv.updated_at_to) {
    conditions.push({ field: "updated_at", op: "between", value: [adv.updated_at_from, adv.updated_at_to] });
  } else if (adv.updated_at_from) {
    conditions.push({ field: "updated_at", op: "after", value: adv.updated_at_from });
  } else if (adv.updated_at_to) {
    conditions.push({ field: "updated_at", op: "before", value: adv.updated_at_to });
  }
  if (adv.bill_short_title?.trim()) {
    conditions.push({ field: "bill_short_title", op: "contains", value: adv.bill_short_title.trim() });
  }
  if (adv.bill_session?.length > 0) {
    conditions.push({ field: "bill_session", op: "in", value: adv.bill_session.map(Number) });
  }
  if (adv.bill_status?.trim()) {
    conditions.push({ field: "bill_status", op: "contains", value: adv.bill_status.trim() });
  }

  return { logic: "AND", conditions, groups: [] };
}

export function summarizeRequestRow(rowValue, canViewAll) {
  if (!rowValue) return null;
  const parts = buildRequestSummary(rowValue, canViewAll);
  return parts.length === 0 ? null : parts.join(" · ");
}

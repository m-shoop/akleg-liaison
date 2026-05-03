import { weekBounds, todayJuneau, resolveRelativeRange } from "../../utils/weekBounds";
import { resolveRelativeAssignee } from "../../utils/relativeAssignees";
import { buildSummary, readBillNumbers } from "../../components/HearingsFilterBar/HearingsFilterBar";
import { createInitialState } from "../../components/StackingCriteria/createInitialState";

export function makeDefaultRowValue() {
  const week = weekBounds();
  return {
    hearingDateMode: "range",
    hearingDateOn: "",
    hearingDateFrom: week.start,
    hearingDateTo: week.end,
    hearingDateRelative: "",
    chamber: [],
    legislature_session: [],
    showInactive: false,
    showHidden: false,
    advanced: {},
  };
}

export function makeNewRowValue() {
  return {
    hearingDateMode: "any",
    hearingDateOn: "",
    hearingDateFrom: "",
    hearingDateTo: "",
    hearingDateRelative: "",
    chamber: [],
    legislature_session: [],
    showInactive: false,
    showHidden: false,
    advanced: {},
  };
}

export function makeDefaultHearingsCriteria() {
  return createInitialState({ seedRows: [makeDefaultRowValue()] });
}

export function buildHearingsRowFilterGroup(rowValue, { canNotes, username }) {
  if (!rowValue) return null;
  const conditions = [];
  const f = rowValue;

  if (f.hearingDateMode === "on" && f.hearingDateOn) {
    conditions.push({ field: "hearing_date", op: "equals", value: f.hearingDateOn });
  } else if (f.hearingDateMode === "range") {
    const { hearingDateFrom: from, hearingDateTo: to } = f;
    if (from && to) conditions.push({ field: "hearing_date", op: "between", value: [from, to] });
    else if (from) conditions.push({ field: "hearing_date", op: "after", value: from });
    else if (to) conditions.push({ field: "hearing_date", op: "before", value: to });
  } else if (f.hearingDateMode === "relative") {
    const r = resolveRelativeRange(f.hearingDateRelative);
    if (r) {
      if (r.start === r.end) {
        conditions.push({ field: "hearing_date", op: "equals", value: r.start });
      } else {
        conditions.push({ field: "hearing_date", op: "between", value: [r.start, r.end] });
      }
    }
  }

  if (f.chamber?.length > 0) {
    conditions.push({ field: "chamber", op: "in", value: f.chamber });
  }
  if (f.legislature_session?.length > 0) {
    conditions.push({ field: "legislature_session", op: "in", value: f.legislature_session });
  }

  if (!f.showInactive) {
    conditions.push({ field: "is_active", op: "equals", value: true });
  }
  if (!f.showHidden) {
    conditions.push({ field: "hidden", op: "equals", value: false });
  }

  const adv = f.advanced ?? {};
  const billNumbers = readBillNumbers(adv);
  if (billNumbers.length > 0) {
    conditions.push({ field: "agenda_bill_number", op: "in", value: billNumbers });
  }
  if (adv.hearing_type?.length > 0) {
    conditions.push({ field: "hearing_type", op: "in", value: adv.hearing_type });
  }
  if (adv.location) {
    conditions.push({ field: "location", op: "contains", value: adv.location });
  }
  if (adv.committee_name) {
    conditions.push({ field: "committee_name", op: "contains", value: adv.committee_name });
  }
  if (adv.committee_type) {
    conditions.push({ field: "committee_type", op: "contains", value: adv.committee_type });
  }
  if (canNotes) {
    const notesMode = adv.dps_notes_mode ?? "any";
    if (notesMode === "has") conditions.push({ field: "dps_notes", op: "is_not_empty" });
    else if (notesMode === "empty") conditions.push({ field: "dps_notes", op: "is_empty" });
    else if (notesMode === "contains" && adv.dps_notes) {
      conditions.push({ field: "dps_notes", op: "contains", value: adv.dps_notes });
    }
  }

  if (adv.has_tracked_bill_without_assignment === true) {
    conditions.push({ field: "has_tracked_bill_without_assignment", op: "equals", value: true });
  }

  if (adv.has_prior_agendas === true) {
    conditions.push({ field: "has_prior_agendas", op: "equals", value: true });
  }

  if (adv.assignment_assignee_email_mode === "relative") {
    const resolved = resolveRelativeAssignee(adv.assignment_assignee_email_relative, { username });
    if (resolved) {
      conditions.push({ field: "assignment_assignee_email", op: "equals", value: resolved });
    }
  } else if (adv.assignment_assignee_email?.trim()) {
    conditions.push({ field: "assignment_assignee_email", op: "contains", value: adv.assignment_assignee_email.trim() });
  }
  if (adv.assignment_bill_number?.trim()) {
    conditions.push({ field: "assignment_bill_number", op: "contains", value: adv.assignment_bill_number.trim() });
  }
  if (adv.assignment_status?.length > 0) {
    conditions.push({ field: "assignment_status", op: "in", value: adv.assignment_status });
  }

  return { logic: "AND", conditions, groups: [] };
}

export function summarizeHearingsRow(rowValue, fields) {
  if (!rowValue) return null;
  const parts = buildSummary(rowValue, fields);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function getRowDateConstraints(criteria) {
  const ranges = [];
  for (const c of criteria) {
    const v = c.value;
    if (!v) continue;
    if (v.hearingDateMode === "on" && v.hearingDateOn) {
      ranges.push({ start: v.hearingDateOn, end: v.hearingDateOn });
    } else if (v.hearingDateMode === "range") {
      const from = v.hearingDateFrom || null;
      const to = v.hearingDateTo || null;
      if (from || to) ranges.push({ start: from, end: to });
    } else if (v.hearingDateMode === "relative") {
      const r = resolveRelativeRange(v.hearingDateRelative);
      if (r) ranges.push({ start: r.start, end: r.end });
    }
  }
  return ranges;
}

function isDateWithinAnyRange(date, ranges) {
  for (const r of ranges) {
    const startOk = !r.start || date >= r.start;
    const endOk = !r.end || date <= r.end;
    if (startOk && endOk) return true;
  }
  return false;
}

function earliestRangeStart(ranges) {
  let earliest = null;
  for (const r of ranges) {
    const candidate = r.start || r.end;
    if (!candidate) continue;
    if (earliest === null || candidate < earliest) earliest = candidate;
  }
  return earliest;
}

export function adjustedCalendarStart(currentStart, criteria) {
  const ranges = getRowDateConstraints(criteria);
  if (currentStart && ranges.length > 0 && isDateWithinAnyRange(currentStart, ranges)) {
    return currentStart;
  }
  return earliestRangeStart(ranges) || todayJuneau();
}

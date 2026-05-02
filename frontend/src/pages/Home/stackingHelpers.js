import { buildSummary, readBillNumbers } from "../../components/FilterBar/FilterBar";
import { createInitialState } from "../../components/StackingCriteria/createInitialState";

export function makeDefaultBillRowValue() {
  return {
    tracked: "tracked",
    hearingDateMode: "any",
    hearingDateOn: "",
    hearingDateFrom: "",
    hearingDateTo: "",
    advanced: {},
  };
}

export function makeNewBillRowValue() {
  return {
    tracked: "all",
    hearingDateMode: "any",
    hearingDateOn: "",
    hearingDateFrom: "",
    hearingDateTo: "",
    advanced: {},
  };
}

export function makeDefaultBillsCriteria({ showUntracked = false, billNumber = null } = {}) {
  const seed = makeDefaultBillRowValue();
  if (showUntracked || billNumber) seed.tracked = "all";
  if (billNumber) {
    seed.advanced = { ...seed.advanced, bill_numbers: [billNumber.toUpperCase()] };
  }
  return createInitialState({ seedRows: [seed] });
}

export function buildBillsRowFilterGroup(rowValue) {
  if (!rowValue) return null;
  const f = rowValue;
  const conditions = [];

  if (f.tracked === "tracked") {
    conditions.push({ field: "is_tracked", op: "equals", value: true });
  } else if (f.tracked === "untracked") {
    conditions.push({ field: "is_tracked", op: "equals", value: false });
  }

  if (f.hearingDateMode === "on" && f.hearingDateOn) {
    conditions.push({ field: "hearing_date", op: "equals", value: f.hearingDateOn });
  } else if (f.hearingDateMode === "range") {
    if (f.hearingDateFrom && f.hearingDateTo) {
      conditions.push({ field: "hearing_date", op: "between", value: [f.hearingDateFrom, f.hearingDateTo] });
    } else if (f.hearingDateFrom) {
      conditions.push({ field: "hearing_date", op: "after", value: f.hearingDateFrom });
    } else if (f.hearingDateTo) {
      conditions.push({ field: "hearing_date", op: "before", value: f.hearingDateTo });
    }
  }

  const adv = f.advanced ?? {};
  const billNumbers = readBillNumbers(adv);
  if (billNumbers.length > 0) {
    conditions.push({ field: "bill_number", op: "in", value: billNumbers });
  }
  if (adv.title) conditions.push({ field: "title", op: "contains", value: adv.title });
  if (adv.short_title) conditions.push({ field: "short_title", op: "contains", value: adv.short_title });
  if (Array.isArray(adv.session) && adv.session.length > 0) {
    conditions.push({ field: "session", op: "in", value: adv.session.map((v) => parseInt(v, 10)) });
  }
  if (Array.isArray(adv.status) && adv.status.length > 0) {
    conditions.push({ field: "status", op: "in", value: adv.status });
  }
  if (Array.isArray(adv.outcome_type) && adv.outcome_type.length > 0) {
    conditions.push({ field: "outcome_type", op: "in", value: adv.outcome_type });
  }
  if (Array.isArray(adv.outcome_committee) && adv.outcome_committee.length > 0) {
    conditions.push({ field: "outcome_committee", op: "in", value: adv.outcome_committee });
  }
  if (adv.outcome_date_from && adv.outcome_date_to) {
    conditions.push({ field: "outcome_date", op: "between", value: [adv.outcome_date_from, adv.outcome_date_to] });
  } else if (adv.outcome_date_from) {
    conditions.push({ field: "outcome_date", op: "after", value: adv.outcome_date_from });
  } else if (adv.outcome_date_to) {
    conditions.push({ field: "outcome_date", op: "before", value: adv.outcome_date_to });
  }
  if (adv.sponsor_name) conditions.push({ field: "sponsor_name", op: "contains", value: adv.sponsor_name });
  if (Array.isArray(adv.fn_department) && adv.fn_department.length > 0) {
    conditions.push({ field: "fn_department", op: "in", value: adv.fn_department });
  }
  if (adv.fn_publish_date_from && adv.fn_publish_date_to) {
    conditions.push({ field: "fn_publish_date", op: "between", value: [adv.fn_publish_date_from, adv.fn_publish_date_to] });
  } else if (adv.fn_publish_date_from) {
    conditions.push({ field: "fn_publish_date", op: "after", value: adv.fn_publish_date_from });
  } else if (adv.fn_publish_date_to) {
    conditions.push({ field: "fn_publish_date", op: "before", value: adv.fn_publish_date_to });
  }
  if (adv.introduced_date_from && adv.introduced_date_to) {
    conditions.push({ field: "introduced_date", op: "between", value: [adv.introduced_date_from, adv.introduced_date_to] });
  } else if (adv.introduced_date_from) {
    conditions.push({ field: "introduced_date", op: "after", value: adv.introduced_date_from });
  } else if (adv.introduced_date_to) {
    conditions.push({ field: "introduced_date", op: "before", value: adv.introduced_date_to });
  }

  return { logic: "AND", conditions, groups: [] };
}

export function summarizeBillsRow(rowValue, fields) {
  if (!rowValue) return null;
  const parts = buildSummary(rowValue, fields);
  return parts.length === 0 ? null : parts.join(" · ");
}

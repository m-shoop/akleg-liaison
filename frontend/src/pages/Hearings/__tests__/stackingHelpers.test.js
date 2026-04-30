import { describe, it, expect } from "vitest";
import { getRowDateConstraints, adjustedCalendarStart } from "../stackingHelpers";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const row = (id, value) => ({ id, value });
const dateRow = (id, mode, opts = {}) =>
  row(id, {
    hearingDateMode: mode,
    hearingDateOn: opts.on ?? "",
    hearingDateFrom: opts.from ?? "",
    hearingDateTo: opts.to ?? "",
  });

describe("getRowDateConstraints", () => {
  it("returns an empty array when there are no rows", () => {
    expect(getRowDateConstraints([])).toEqual([]);
  });

  it("ignores rows whose date mode is 'any'", () => {
    expect(getRowDateConstraints([dateRow("A", "any")])).toEqual([]);
  });

  it("ignores rows missing a value", () => {
    expect(getRowDateConstraints([{ id: "A", value: undefined }])).toEqual([]);
  });

  it("treats 'on' mode as a single-day range", () => {
    expect(getRowDateConstraints([dateRow("A", "on", { on: "2026-04-25" })])).toEqual([
      { start: "2026-04-25", end: "2026-04-25" },
    ]);
  });

  it("ignores 'on' mode with no date set", () => {
    expect(getRowDateConstraints([dateRow("A", "on", { on: "" })])).toEqual([]);
  });

  it("captures a closed range", () => {
    expect(
      getRowDateConstraints([dateRow("A", "range", { from: "2026-04-19", to: "2026-04-25" })]),
    ).toEqual([{ start: "2026-04-19", end: "2026-04-25" }]);
  });

  it("captures an open-ended 'from'-only range", () => {
    expect(
      getRowDateConstraints([dateRow("A", "range", { from: "2026-04-19" })]),
    ).toEqual([{ start: "2026-04-19", end: null }]);
  });

  it("captures an open-ended 'to'-only range", () => {
    expect(
      getRowDateConstraints([dateRow("A", "range", { to: "2026-04-25" })]),
    ).toEqual([{ start: null, end: "2026-04-25" }]);
  });

  it("ignores 'range' mode with both dates blank", () => {
    expect(getRowDateConstraints([dateRow("A", "range")])).toEqual([]);
  });

  it("collects constraints across multiple rows", () => {
    expect(
      getRowDateConstraints([
        dateRow("A", "range", { from: "2026-04-19", to: "2026-04-25" }),
        dateRow("B", "any"),
        dateRow("C", "on", { on: "2026-05-01" }),
      ]),
    ).toEqual([
      { start: "2026-04-19", end: "2026-04-25" },
      { start: "2026-05-01", end: "2026-05-01" },
    ]);
  });
});

describe("adjustedCalendarStart", () => {
  it("keeps the current start when it lies within a row's range", () => {
    const criteria = [dateRow("A", "range", { from: "2026-04-19", to: "2026-04-25" })];
    expect(adjustedCalendarStart("2026-04-22", criteria)).toBe("2026-04-22");
  });

  it("keeps the current start when it equals an 'on' date", () => {
    const criteria = [dateRow("A", "on", { on: "2026-05-01" })];
    expect(adjustedCalendarStart("2026-05-01", criteria)).toBe("2026-05-01");
  });

  it("keeps the current start when it falls within ANY of multiple ranges", () => {
    const criteria = [
      dateRow("A", "range", { from: "2026-04-19", to: "2026-04-25" }),
      dateRow("B", "range", { from: "2026-05-10", to: "2026-05-20" }),
    ];
    expect(adjustedCalendarStart("2026-05-15", criteria)).toBe("2026-05-15");
  });

  it("jumps to the earliest range start when the current start is outside all ranges", () => {
    const criteria = [
      dateRow("A", "range", { from: "2026-05-10", to: "2026-05-20" }),
      dateRow("B", "range", { from: "2026-04-19", to: "2026-04-25" }),
    ];
    expect(adjustedCalendarStart("2026-06-01", criteria)).toBe("2026-04-19");
  });

  it("jumps to the earliest range start when current is null and constraints exist", () => {
    const criteria = [
      dateRow("A", "range", { from: "2026-05-10", to: "2026-05-20" }),
    ];
    expect(adjustedCalendarStart(null, criteria)).toBe("2026-05-10");
  });

  it("uses the 'to' date when the earliest range only has a 'to'", () => {
    const criteria = [dateRow("A", "range", { to: "2026-05-20" })];
    expect(adjustedCalendarStart(null, criteria)).toBe("2026-05-20");
  });

  it("respects open-ended 'from'-only ranges (any date >= from is in range)", () => {
    const criteria = [dateRow("A", "range", { from: "2026-04-19" })];
    expect(adjustedCalendarStart("2099-12-31", criteria)).toBe("2099-12-31");
  });

  it("respects open-ended 'to'-only ranges (any date <= to is in range)", () => {
    const criteria = [dateRow("A", "range", { to: "2026-04-25" })];
    expect(adjustedCalendarStart("1999-01-01", criteria)).toBe("1999-01-01");
  });

  it("falls back to today when no row has a date selection and no current start", () => {
    const result = adjustedCalendarStart(null, [dateRow("A", "any")]);
    expect(result).toMatch(ISO_DATE_RE);
  });

  it("falls back to today when no row has a date selection even if current start is set", () => {
    // Per literal spec: "today if there are no dates selected whatsoever".
    // The page-level handleStackingApply gates calls to adjustedCalendarStart by comparing
    // before/after constraints, so this case is only reached on mount or switchView.
    const result = adjustedCalendarStart("2026-04-22", [dateRow("A", "any")]);
    expect(result).toMatch(ISO_DATE_RE);
    expect(result).not.toBe("2026-04-22");
  });

  it("falls back to today when criteria are empty entirely", () => {
    const result = adjustedCalendarStart(null, []);
    expect(result).toMatch(ISO_DATE_RE);
  });
});

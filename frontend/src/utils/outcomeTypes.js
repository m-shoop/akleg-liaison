/**
 * All valid outcome types, grouped by category, with human-readable labels.
 * This mirrors the OutcomeType enum in the Python backend.
 */
export const OUTCOME_TYPES = [
  {
    group: "Committee",
    outcomes: [
      { value: "heard_and_held",          label: "Heard and Held" },
      { value: "moved_out_of_committee",  label: "Moved Out of Committee" },
    ],
  },
  {
    group: "Floor",
    outcomes: [
      { value: "read_on_floor",           label: "Read on Floor" },
      { value: "referred_to_committee",   label: "Referred to Committee" },
      { value: "rules_to_calendar",       label: "Rules to Calendar" },
      { value: "amended",                 label: "Amended" },
    ],
  },
  {
    group: "Passage",
    outcomes: [
      { value: "passed",                  label: "Passed" },
      { value: "failed",                  label: "Failed" },
      { value: "transmitted",             label: "Transmitted" },
    ],
  },
  {
    group: "Final",
    outcomes: [
      { value: "signed_into_law",         label: "Signed into Law" },
      { value: "vetoed",                  label: "Vetoed" },
      { value: "pocket_vetoed",           label: "Pocket Vetoed" },
    ],
  },
  {
    group: "Other",
    outcomes: [
      { value: "other",                   label: "Other" },
    ],
  },
];

/** Flat list of all outcome values for easy iteration. */
export const ALL_OUTCOME_VALUES = OUTCOME_TYPES.flatMap((g) =>
  g.outcomes.map((o) => o.value)
);

/** The default selected set shown on first load. */
export const DEFAULT_SELECTED = new Set([
  "heard_and_held",
  "moved_out_of_committee",
  "passed",
  "referred_to_committee",
  "signed_into_law",
  "vetoed",
  "pocket_vetoed",
]);

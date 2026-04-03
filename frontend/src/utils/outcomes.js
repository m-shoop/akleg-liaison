/**
 * Flattens a bill's nested events→outcomes into a single deduplicated list.
 *
 * Deduplication key: (event_date, chamber, outcome_type, committee)
 * When duplicates exist the first occurrence (earliest date) is kept.
 *
 * Returns rows sorted by date ascending.
 */
export function flattenOutcomes(events) {
  const seen = new Set();
  const rows = [];

  // Events arrive ordered by date from the API
  for (const event of events) {
    for (const outcome of event.outcomes) {
      const key = `${event.event_date}|${outcome.chamber}|${outcome.outcome_type}|${outcome.committee ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        date: event.event_date,
        source_url: event.source_url,
        outcome_type: outcome.outcome_type,
        committee: outcome.committee,
        description: outcome.description,
        chamber: outcome.chamber,
      });
    }
  }

  return rows;
}

/**
 * Converts a snake_case outcome type enum value to a readable label.
 * e.g. "heard_and_held" → "Heard and Held"
 */
const LOWERCASE_WORDS = new Set(["and", "of", "the", "in", "to"]);

export function formatOutcomeType(type) {
  return type
    .split("_")
    .map((word, i) =>
      i === 0 || !LOWERCASE_WORDS.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(" ");
}

/**
 * Short abbreviations for use in compact/side-by-side views.
 */
const ABBREVIATIONS = {
  heard_and_held:          "H&H",
  moved_out_of_committee:  "MoC",
  passed:                  "Passed",
  failed:                  "Failed",
  transmitted:             "Trans.",
  referred_to_committee:   "Ref.",
  rules_to_calendar:       "Rules→Cal",
  amended:                 "Amd.",
  signed_into_law:         "Signed",
  vetoed:                  "Vetoed",
  pocket_vetoed:           "P.Veto",
  read_on_floor:           "Read",
  other:                   "Other",
};

export function formatOutcomeTypeShort(type) {
  return ABBREVIATIONS[type] ?? formatOutcomeType(type);
}

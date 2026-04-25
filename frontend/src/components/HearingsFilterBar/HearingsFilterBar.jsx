import { useEffect, useRef, useState } from "react";
import { todayJuneau, weekBounds, weekBoundsTitle } from "../../utils/weekBounds";
import styles from "./HearingsFilterBar.module.css";

function EnumMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const safeSelected = Array.isArray(selected) ? selected : [];

  // Normalize: accept either string[] or {value, label}[].
  const normalized = options.map((o) =>
    typeof o === "object" && o !== null
      ? { value: String(o.value), label: String(o.label ?? o.value) }
      : { value: String(o), label: String(o) }
  );

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(value) {
    if (safeSelected.includes(value)) {
      onChange(safeSelected.filter((v) => v !== value));
    } else {
      onChange([...safeSelected, value]);
    }
  }

  const label = safeSelected.length === 0 ? "All" : `${safeSelected.length} selected`;

  return (
    <div className={styles.multiSelect} ref={ref}>
      <button
        type="button"
        className={`${styles.multiSelectTrigger} ${safeSelected.length > 0 ? styles.multiSelectTriggerActive : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label} {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className={styles.multiSelectDropdown}>
          <div className={styles.multiSelectActions}>
            <button type="button" className={styles.multiSelectActionBtn} onClick={() => onChange(normalized.map((o) => o.value))}>All</button>
            <button type="button" className={styles.multiSelectActionBtn} onClick={() => onChange([])}>None</button>
          </div>
          <div className={styles.multiSelectDivider} />
          {normalized.map((opt) => (
            <label key={opt.value} className={styles.multiSelectOption}>
              <input
                type="checkbox"
                checked={safeSelected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const DATE_MODES = [
  { value: "any", label: "Any Date" },
  { value: "on", label: "On Date" },
  { value: "range", label: "In Range" },
];

const ASSIGNMENT_STATUS_LABELS = {
  hearing_assigned: "Assigned",
  reassignment_request: "Reassign",
  auto_suggested_hearing_assignment: "Suggested",
  hearing_assignment_complete: "Completed",
  hearing_assignment_canceled: "Canceled",
  hearing_assignment_discarded: "Discarded",
};

function formatDate(str) {
  if (!str) return "";
  return new Date(str + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildSummary(filters, fields) {
  const parts = [];

  if (filters.hearingDateMode === "on" && filters.hearingDateOn) {
    parts.push(`Date: ${formatDate(filters.hearingDateOn)}`);
  } else if (filters.hearingDateMode === "range") {
    const from = filters.hearingDateFrom;
    const to = filters.hearingDateTo;
    if (from && to) parts.push(`Date: ${formatDate(from)} – ${formatDate(to)}`);
    else if (from) parts.push(`Date: ${formatDate(from)} or after`);
    else if (to) parts.push(`Date: ${formatDate(to)} or before`);
  }

  if (filters.chamber?.length > 0) {
    parts.push(`Chamber: ${filters.chamber.join(", ")}`);
  }

  if (filters.legislature_session?.length > 0) {
    parts.push(`Session: ${filters.legislature_session.join(", ")}`);
  }

  if (filters.advanced?.agenda_bill_number) parts.push(`Bill: "${filters.advanced.agenda_bill_number}"`);
  if (filters.showInactive) parts.push("Including inactive");
  if (filters.showHidden) parts.push("Including hidden");
  if (filters.advanced?.has_tracked_bill_without_assignment) parts.push("Has unassigned tracked bills");

  const adv = filters.advanced ?? {};
  for (const [key, field] of Object.entries(fields ?? {})) {
    if (field.filter_tier !== "advanced" || !field.filterable || field.type === "boolean") continue;
    if (key === "dps_notes") {
      const mode = adv.dps_notes_mode ?? "any";
      if (mode === "has") parts.push("Notes: Has Notes");
      else if (mode === "empty") parts.push("Notes: No Notes");
      else if (mode === "contains" && adv.dps_notes) parts.push(`Notes: "${adv.dps_notes}"`);
    } else if (field.type === "text") {
      const val = adv[key];
      if (val) parts.push(`${field.label}: "${val}"`);
    } else if (field.type === "enum") {
      const vals = adv[key];
      const labelFor = (v) => (key === "assignment_status" ? ASSIGNMENT_STATUS_LABELS[v] ?? v : v);
      if (Array.isArray(vals) && vals.length > 0) parts.push(`${field.label}: ${vals.map(labelFor).join(", ")}`);
      else if (typeof vals === "string" && vals) parts.push(`${field.label}: ${labelFor(vals)}`);
    }
  }

  return parts;
}

export default function HearingsFilterBar({ filters, onChange, fields, canHide, canNotes, hideDateFilter = false }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const today = todayJuneau();

  function set(key, value) {
    onChange({ ...filters, [key]: value });
  }

  function setAdvanced(key, value) {
    onChange({ ...filters, advanced: { ...(filters.advanced ?? {}), [key]: value } });
  }

  function applyDateRange(from, to) {
    onChange({ ...filters, hearingDateMode: "range", hearingDateFrom: from, hearingDateTo: to });
  }

  const sessionOptions = fields?.legislature_session?.enum_options ?? [];
  const hearingTypeOptions = fields?.hearing_type?.enum_options ?? [];

  const advancedTextFields = ["location", "committee_name", "committee_type"];
  const summaryParts = buildSummary(filters, fields);

  return (
    <div className={styles.bar}>
      <div className={styles.summary}>
        {summaryParts.length === 0 ? (
          <span className={styles.summaryEmpty}>No filters active</span>
        ) : (
          summaryParts.map((part, i) => (
            <span key={i} className={styles.summaryPart}>
              {i > 0 && <span className={styles.summarySep}>·</span>}
              {part}
            </span>
          ))
        )}
      </div>

      <div className={styles.basicRow}>
        {/* hearing_date */}
        {!hideDateFilter && <div className={styles.filterGroup}>
          <span className={styles.label}>Date</span>
          <div className={styles.segmented}>
            {DATE_MODES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.seg} ${filters.hearingDateMode === opt.value ? styles.segActive : ""}`}
                onClick={() => set("hearingDateMode", opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {filters.hearingDateMode === "on" && (
            <input
              type="date"
              className={`${styles.dateInput} ${filters.hearingDateOn ? styles.dateInputFilled : ""}`}
              value={filters.hearingDateOn}
              onChange={(e) => set("hearingDateOn", e.target.value)}
            />
          )}
          {filters.hearingDateMode === "range" && (
            <>
              <span className={styles.rangePair}>
                <input
                  type="date"
                  className={`${styles.dateInput} ${filters.hearingDateFrom ? styles.dateInputFilled : ""}`}
                  value={filters.hearingDateFrom}
                  onChange={(e) => set("hearingDateFrom", e.target.value)}
                />
                <span className={styles.rangeSep}>to</span>
                <input
                  type="date"
                  className={`${styles.dateInput} ${filters.hearingDateTo ? styles.dateInputFilled : ""}`}
                  value={filters.hearingDateTo}
                  onChange={(e) => set("hearingDateTo", e.target.value)}
                />
              </span>
              <div className={styles.weekShortcuts}>
                <button type="button" className={`${styles.shortcut} ${filters.hearingDateFrom === today && filters.hearingDateTo === today ? styles.shortcutActive : ""}`} onClick={() => applyDateRange(today, today)}>Today</button>
                <button type="button" className={`${styles.shortcut} ${filters.hearingDateFrom === weekBounds(-1).start && filters.hearingDateTo === weekBounds(-1).end ? styles.shortcutActive : ""}`} onClick={() => { const b = weekBounds(-1); applyDateRange(b.start, b.end); }} title={weekBoundsTitle(-1)}>Last Week</button>
                <button type="button" className={`${styles.shortcut} ${filters.hearingDateFrom === weekBounds(0).start && filters.hearingDateTo === weekBounds(0).end ? styles.shortcutActive : ""}`} onClick={() => { const b = weekBounds(0); applyDateRange(b.start, b.end); }} title={weekBoundsTitle(0)}>This Week</button>
                <button type="button" className={`${styles.shortcut} ${filters.hearingDateFrom === weekBounds(1).start && filters.hearingDateTo === weekBounds(1).end ? styles.shortcutActive : ""}`} onClick={() => { const b = weekBounds(1); applyDateRange(b.start, b.end); }} title={weekBoundsTitle(1)}>Next Week</button>
              </div>
            </>
          )}
        </div>}

        {/* bill coverage - permission-gated by backend field availability */}
        {fields?.has_tracked_bill_without_assignment && (
          <div className={styles.filterGroup}>
            <span className={styles.label}>Bill Coverage</span>
            <div className={styles.segmented}>
              <button
                type="button"
                className={`${styles.seg} ${!filters.advanced?.has_tracked_bill_without_assignment ? styles.segActive : ""}`}
                onClick={() => setAdvanced("has_tracked_bill_without_assignment", false)}
              >
                Any
              </button>
              <button
                type="button"
                className={`${styles.seg} ${filters.advanced?.has_tracked_bill_without_assignment ? styles.segActive : ""}`}
                onClick={() => setAdvanced("has_tracked_bill_without_assignment", true)}
              >
                Has Unassigned Tracked Bills
              </button>
            </div>
          </div>
        )}

        {/* bill on agenda */}
        <div className={styles.filterGroup}>
          <span className={styles.label}>Bill on Agenda</span>
          <input
            type="text"
            className={styles.textInput}
            placeholder="e.g. HB 62"
            value={filters.advanced?.agenda_bill_number ?? ""}
            onChange={(e) => setAdvanced("agenda_bill_number", e.target.value)}
          />
        </div>
      </div>

      <button
        type="button"
        className={`${styles.advancedToggle} ${advancedOpen ? styles.advancedToggleOpen : ""}`}
        onClick={() => setAdvancedOpen((o) => !o)}
      >
        Advanced {advancedOpen ? "▲" : "▼"}
      </button>

      {advancedOpen && (
        <div className={styles.advancedRow}>
          {/* chamber */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Chamber</span>
            <div className={styles.segmented}>
              {[{ value: [], label: "Both" }, { value: ["H"], label: "House" }, { value: ["S"], label: "Senate" }].map((opt) => {
                const isActive = JSON.stringify(filters.chamber ?? []) === JSON.stringify(opt.value);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`${styles.seg} ${isActive ? styles.segActive : ""}`}
                    onClick={() => set("chamber", opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* legislature_session */}
          {sessionOptions.length > 0 && (
            <div className={styles.filterGroup}>
              <span className={styles.label}>Session</span>
              <EnumMultiSelect
                options={sessionOptions}
                selected={filters.legislature_session ?? []}
                onChange={(val) => set("legislature_session", val)}
              />
            </div>
          )}

          {/* is_active toggle */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Status</span>
            <div className={styles.segmented}>
              <button type="button" className={`${styles.seg} ${!filters.showInactive ? styles.segActive : ""}`} onClick={() => set("showInactive", false)}>Active</button>
              <button type="button" className={`${styles.seg} ${filters.showInactive ? styles.segActive : ""}`} onClick={() => set("showInactive", true)}>All</button>
            </div>
          </div>

          {/* hidden */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Visibility</span>
            <div className={styles.segmented}>
              <button type="button" className={`${styles.seg} ${!filters.showHidden ? styles.segActive : ""}`} onClick={() => set("showHidden", false)}>Hide hidden</button>
              <button type="button" className={`${styles.seg} ${filters.showHidden ? styles.segActive : ""}`} onClick={() => set("showHidden", true)}>Show hidden</button>
            </div>
          </div>

          {/* hearing_type */}
          {hearingTypeOptions.length > 0 && (
            <div className={styles.filterGroup}>
              <span className={styles.label}>Type</span>
              <EnumMultiSelect
                options={hearingTypeOptions}
                selected={filters.advanced?.hearing_type ?? []}
                onChange={(val) => setAdvanced("hearing_type", val)}
              />
            </div>
          )}

          {/* text fields: location, committee_name, committee_type */}
          {advancedTextFields.map((key) => {
            const field = fields?.[key];
            if (!field) return null;
            return (
              <div key={key} className={styles.filterGroup}>
                <span className={styles.label}>{field.label}</span>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Search…"
                  value={filters.advanced?.[key] ?? ""}
                  onChange={(e) => setAdvanced(key, e.target.value)}
                />
              </div>
            );
          })}

          {/* notes - permission gated */}
          {canNotes && fields?.dps_notes && (
            <div className={styles.filterGroup}>
              <span className={styles.label}>Notes</span>
              <div className={styles.segmented}>
                {[
                  { value: "any", label: "Any" },
                  { value: "has", label: "Has Notes" },
                  { value: "empty", label: "No Notes" },
                  { value: "contains", label: "Contains…" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.seg} ${(filters.advanced?.dps_notes_mode ?? "any") === opt.value ? styles.segActive : ""}`}
                    onClick={() => setAdvanced("dps_notes_mode", opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {(filters.advanced?.dps_notes_mode ?? "any") === "contains" && (
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Search notes…"
                  value={filters.advanced?.dps_notes ?? ""}
                  onChange={(e) => setAdvanced("dps_notes", e.target.value)}
                />
              )}
            </div>
          )}

          {/* Assignment criteria (permission-gated by backend field availability) */}
          {(fields?.assignment_assignee_email || fields?.assignment_bill_number || fields?.assignment_status) && (
            <div className={styles.filterGroupSection}>
              <p className={styles.filterGroupLabel}>Assignment criteria — all must match the same assignment</p>
              <div className={styles.filterGroupBody}>
                {fields.assignment_assignee_email && (
                  <div className={styles.filterGroup}>
                    <span className={styles.label}>Assignee</span>
                    <input
                      type="text"
                      className={styles.textInput}
                      placeholder="email…"
                      value={filters.advanced?.assignment_assignee_email ?? ""}
                      onChange={(e) => setAdvanced("assignment_assignee_email", e.target.value)}
                    />
                  </div>
                )}
                {fields.assignment_bill_number && (
                  <div className={styles.filterGroup}>
                    <span className={styles.label}>Bill Number</span>
                    <input
                      type="text"
                      className={styles.textInput}
                      placeholder="e.g. HB 62"
                      value={filters.advanced?.assignment_bill_number ?? ""}
                      onChange={(e) => setAdvanced("assignment_bill_number", e.target.value)}
                    />
                  </div>
                )}
                {fields.assignment_status && (
                  <div className={styles.filterGroup}>
                    <span className={styles.label}>Status</span>
                    <EnumMultiSelect
                      options={(fields.assignment_status.enum_options ?? Object.keys(ASSIGNMENT_STATUS_LABELS)).map((v) => ({
                        value: v,
                        label: ASSIGNMENT_STATUS_LABELS[v] ?? v,
                      }))}
                      selected={filters.advanced?.assignment_status ?? []}
                      onChange={(val) => setAdvanced("assignment_status", val)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

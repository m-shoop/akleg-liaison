import { useEffect, useRef, useState } from "react";
import styles from "./FilterBar.module.css";

function EnumMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Guard against stale sessionStorage values that may be strings or invalid types
  const safeSelected = Array.isArray(selected) ? selected : [];

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
            <button type="button" className={styles.multiSelectActionBtn} onClick={() => onChange(options.map(String))}>All</button>
            <button type="button" className={styles.multiSelectActionBtn} onClick={() => onChange([])}>None</button>
          </div>
          <div className={styles.multiSelectDivider} />
          {options.map((opt) => (
            <label key={opt} className={styles.multiSelectOption}>
              <input
                type="checkbox"
                checked={safeSelected.includes(String(opt))}
                onChange={() => toggle(String(opt))}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const TRACKED_OPTIONS = [
  { value: "all", label: "All Measures" },
  { value: "tracked", label: "Tracked" },
  { value: "untracked", label: "Untracked" },
];

const HEARING_DATE_MODES = [
  { value: "any", label: "Any Date" },
  { value: "on", label: "On Date" },
  { value: "range", label: "In Range" },
];

// Reads the bill_number filter as an array. Falls back to the legacy single-string
// shape so reports/sessions saved before the chip UI keep working.
export function readBillNumbers(advanced) {
  const list = advanced?.bill_numbers;
  if (Array.isArray(list)) return list;
  const legacy = advanced?.bill_number;
  if (typeof legacy === "string" && legacy.trim()) return [legacy.trim()];
  return [];
}

function BillNumberChips({ value, onChange }) {
  const list = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim().toUpperCase();
    if (!v) return;
    if (list.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...list, v]);
    setDraft("");
  }

  function remove(v) {
    onChange(list.filter((x) => x !== v));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && list.length > 0) {
      e.preventDefault();
      onChange(list.slice(0, -1));
    }
  }

  return (
    <div className={styles.chipsContainer}>
      {list.map((v) => (
        <span key={v} className={styles.chip}>
          {v}
          <button
            type="button"
            className={styles.chipRemove}
            onClick={() => remove(v)}
            aria-label={`Remove ${v}`}
            title={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className={styles.chipsInput}
        placeholder={list.length === 0 ? "e.g. HB 62" : "Add another…"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={add}
      />
    </div>
  );
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function formatDate(str) {
  if (!str) return "";
  const d = new Date(str + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateLong(str) {
  if (!str) return "";
  const d = new Date(str + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = d.getDate();
  const suffix = ordinalSuffix(day);
  return `${month} ${day}${suffix}, ${d.getFullYear()}`;
}

export function buildSummary(filters, fields) {
  const parts = [];

  const trackedLabel = TRACKED_OPTIONS.find((o) => o.value === (filters.tracked ?? "all"))?.label ?? "All Bills";
  parts.push(trackedLabel);

  if (filters.hearingDateMode === "on" && filters.hearingDateOn) {
    parts.push(`Hearing on ${formatDate(filters.hearingDateOn)}`);
  } else if (filters.hearingDateMode === "range") {
    const from = filters.hearingDateFrom;
    const to = filters.hearingDateTo;
    if (from && to) {
      parts.push(`Hearing ${formatDate(from)} – ${formatDate(to)}`);
    } else if (from) {
      parts.push(`Hearing ${formatDateLong(from)} or after`);
    } else if (to) {
      parts.push(`Hearing ${formatDateLong(to)} or before`);
    }
  }

  const advanced = filters.advanced ?? {};
  for (const [key, field] of Object.entries(fields ?? {})) {
    if (field.filter_tier !== "advanced" || !field.filterable) continue;

    if (field.type === "text") {
      if (key === "bill_number") {
        const chips = readBillNumbers(advanced);
        if (chips.length > 0) parts.push(`${field.label}: ${chips.join(", ")}`);
      } else {
        const val = advanced[key];
        if (val) parts.push(`${field.label}: "${val}"`);
      }
    } else if (field.type === "enum" && field.operators?.includes("in")) {
      const vals = advanced[key];
      if (Array.isArray(vals) && vals.length > 0) {
        parts.push(`${field.label}: ${vals.join(", ")}`);
      }
    } else if (field.type === "enum") {
      const val = advanced[key];
      if (val) parts.push(`${field.label}: ${val}`);
    } else if (field.type === "date") {
      const from = advanced[`${key}_from`];
      const to = advanced[`${key}_to`];
      if (from && to) {
        parts.push(`${field.label}: ${formatDate(from)} – ${formatDate(to)}`);
      } else if (from) {
        parts.push(`${field.label}: ${formatDateLong(from)} or after`);
      } else if (to) {
        parts.push(`${field.label}: ${formatDateLong(to)} or before`);
      }
    }
  }

  return parts;
}

export default function FilterBar({ fields, filters, onChange }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function set(key, value) {
    onChange({ ...filters, [key]: value });
  }

  const advancedFields = Object.entries(fields ?? {}).filter(
    ([key, f]) => f.filter_tier === "advanced" && f.filterable && key !== "introduced_date"
  );

  // Separate ungrouped fields from named groups, preserving registry order
  const ungroupedFields = advancedFields.filter(([, f]) => !f.filter_group);
  const groupMap = {};
  for (const entry of advancedFields) {
    const g = entry[1].filter_group;
    if (g) {
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(entry);
    }
  }

  function renderField([key, field]) {
    return (
      <div key={key} className={styles.filterGroup}>
        <span className={styles.label}>{field.label}</span>
        {key === "bill_number" && (
          <BillNumberChips
            value={readBillNumbers(filters.advanced)}
            onChange={(next) => {
              const adv = { ...(filters.advanced ?? {}) };
              adv.bill_numbers = next;
              delete adv.bill_number;
              onChange({ ...filters, advanced: adv });
            }}
          />
        )}
        {field.type === "text" && key !== "bill_number" && (
          <input
            type="text"
            className={styles.textInput}
            placeholder={`Search ${field.label.toLowerCase()}…`}
            value={filters.advanced?.[key] ?? ""}
            onChange={(e) =>
              onChange({ ...filters, advanced: { ...(filters.advanced ?? {}), [key]: e.target.value } })
            }
          />
        )}
        {field.type === "enum" && field.enum_options && field.operators.includes("in") && (
          <EnumMultiSelect
            options={field.enum_options}
            selected={filters.advanced?.[key] ?? []}
            onChange={(val) =>
              onChange({ ...filters, advanced: { ...(filters.advanced ?? {}), [key]: val } })
            }
          />
        )}
        {field.type === "enum" && field.enum_options && !field.operators.includes("in") && (
          <select
            className={styles.select}
            value={filters.advanced?.[key] ?? ""}
            onChange={(e) =>
              onChange({ ...filters, advanced: { ...(filters.advanced ?? {}), [key]: e.target.value } })
            }
          >
            <option value="">All</option>
            {field.enum_options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}
        {field.type === "date" && (
          <span className={styles.rangePair}>
            <input
              type="date"
              className={`${styles.dateInput} ${filters.advanced?.[`${key}_from`] ? styles.dateInputFilled : ""}`}
              value={filters.advanced?.[`${key}_from`] ?? ""}
              onChange={(e) =>
                onChange({ ...filters, advanced: { ...(filters.advanced ?? {}), [`${key}_from`]: e.target.value } })
              }
            />
            <span className={styles.rangeSep}>to</span>
            <input
              type="date"
              className={`${styles.dateInput} ${filters.advanced?.[`${key}_to`] ? styles.dateInputFilled : ""}`}
              value={filters.advanced?.[`${key}_to`] ?? ""}
              onChange={(e) =>
                onChange({ ...filters, advanced: { ...(filters.advanced ?? {}), [`${key}_to`]: e.target.value } })
              }
            />
          </span>
        )}
      </div>
    );
  }

  const summaryParts = buildSummary(filters, fields);

  return (
    <div className={styles.bar}>
      <div className={styles.summary}>
        {summaryParts.map((part, i) => (
          <span key={i} className={styles.summaryPart}>
            {i > 0 && <span className={styles.summarySep}>·</span>}
            {part}
          </span>
        ))}
      </div>
      <div className={styles.basicRow}>
        {/* is_tracked */}
        <div className={styles.filterGroup}>
          <span className={styles.label}>Tracking</span>
          <div className={styles.segmented}>
            {TRACKED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`${styles.seg} ${filters.tracked === opt.value ? styles.segActive : ""}`}
                onClick={() => set("tracked", opt.value)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* hearing_date */}
        <div className={styles.filterGroup}>
          <span className={styles.label}>Hearing Date</span>
          <div className={styles.segmented}>
            {HEARING_DATE_MODES.map((opt) => (
              <button
                key={opt.value}
                className={`${styles.seg} ${filters.hearingDateMode === opt.value ? styles.segActive : ""}`}
                onClick={() => set("hearingDateMode", opt.value)}
                type="button"
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
          )}
        </div>

      </div>

      <button
        className={`${styles.advancedToggle} ${advancedOpen ? styles.advancedToggleOpen : ""}`}
        onClick={() => setAdvancedOpen((o) => !o)}
        type="button"
      >
        Advanced {advancedOpen ? "▲" : "▼"}
      </button>

      {advancedOpen && advancedFields.length > 0 && (
        <div className={styles.advancedRow}>
          {ungroupedFields.map(renderField)}
          {Object.entries(groupMap).map(([groupName, entries]) => (
            <div key={groupName} className={styles.filterGroupSection}>
              <p className={styles.filterGroupLabel}>{groupName}</p>
              <div className={styles.filterGroupBody}>
                {entries.map(renderField)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

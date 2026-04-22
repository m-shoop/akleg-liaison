import { useEffect, useRef, useState } from "react";
import styles from "./RequestsFilterBar.module.css";

function EnumMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const safeSelected = Array.isArray(selected) ? selected : [];

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(value) {
    const strVal = String(value);
    if (safeSelected.includes(strVal)) {
      onChange(safeSelected.filter((v) => v !== strVal));
    } else {
      onChange([...safeSelected, strVal]);
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
                onChange={() => toggle(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const OUTCOME_OPTS = [
  { value: "request_bill_tracking", label: "Pending" },
  { value: "approve_bill_tracking", label: "Approved" },
  { value: "deny_bill_tracking", label: "Denied" },
];

function outcomeLabel(value) {
  return OUTCOME_OPTS.find((o) => o.value === value)?.label ?? value;
}

function buildSummary(filters, canViewAll) {
  const parts = [];

  if (filters.workflow_status?.length === 1) {
    parts.push(`Status: ${filters.workflow_status[0]}`);
  } else if (filters.workflow_status?.length > 1) {
    parts.push(`Status: ${filters.workflow_status.join(", ")}`);
  }

  if (filters.outcome?.length > 0) {
    parts.push(`Outcome: ${filters.outcome.map(outcomeLabel).join(", ")}`);
  }

  if (filters.bill_number) parts.push(`Bill: "${filters.bill_number}"`);

  if (canViewAll && filters.requestor_email) {
    parts.push(`Requested By: "${filters.requestor_email}"`);
  }

  if (filters.bill_is_tracked === true) parts.push("Tracking: Approved");
  else if (filters.bill_is_tracked === false) parts.push("Tracking: Not Approved");

  const adv = filters.advanced ?? {};
  if (adv.created_at_from && adv.created_at_to) {
    parts.push(`Requested: ${adv.created_at_from} – ${adv.created_at_to}`);
  } else if (adv.created_at_from) {
    parts.push(`Requested: after ${adv.created_at_from}`);
  } else if (adv.created_at_to) {
    parts.push(`Requested: before ${adv.created_at_to}`);
  }

  if (adv.bill_session?.length > 0) parts.push(`Session: ${adv.bill_session.join(", ")}`);
  if (adv.bill_short_title) parts.push(`Title: "${adv.bill_short_title}"`);
  if (adv.bill_status) parts.push(`Bill Status: "${adv.bill_status}"`);

  return parts;
}

export default function RequestsFilterBar({ filters, onChange, fields, canViewAll }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function set(key, value) {
    onChange({ ...filters, [key]: value });
  }

  function setAdvanced(key, value) {
    onChange({ ...filters, advanced: { ...(filters.advanced ?? {}), [key]: value } });
  }

  const sessionOptions = fields?.bill_session?.enum_options ?? [];
  const summaryParts = buildSummary(filters, canViewAll);

  const activeOutcome = filters.outcome?.length === 1 ? filters.outcome[0] : null;

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
        {/* Status */}
        <div className={styles.filterGroup}>
          <span className={styles.label}>Status</span>
          <div className={styles.segmented}>
            {[{ value: null, label: "Any" }, { value: "open", label: "Open" }, { value: "closed", label: "Closed" }].map((opt) => {
              const isActive = opt.value === null
                ? !filters.workflow_status?.length
                : filters.workflow_status?.length === 1 && filters.workflow_status[0] === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  className={`${styles.seg} ${isActive ? styles.segActive : ""}`}
                  onClick={() => set("workflow_status", opt.value ? [opt.value] : [])}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Outcome */}
        <div className={styles.filterGroup}>
          <span className={styles.label}>Outcome</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.seg} ${!activeOutcome ? styles.segActive : ""}`}
              onClick={() => set("outcome", [])}
            >
              Any
            </button>
            {OUTCOME_OPTS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.seg} ${activeOutcome === opt.value ? styles.segActive : ""}`}
                onClick={() => set("outcome", [opt.value])}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bill Number */}
        <div className={styles.filterGroup}>
          <span className={styles.label}>Bill Number</span>
          <input
            type="text"
            className={styles.textInput}
            placeholder="e.g. HB 62"
            value={filters.bill_number ?? ""}
            onChange={(e) => set("bill_number", e.target.value)}
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
          {/* Requested On */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Requested On</span>
            <span className={styles.rangePair}>
              <input
                type="date"
                className={`${styles.dateInput} ${filters.advanced?.created_at_from ? styles.dateInputFilled : ""}`}
                value={filters.advanced?.created_at_from ?? ""}
                onChange={(e) => setAdvanced("created_at_from", e.target.value)}
              />
              <span className={styles.rangeSep}>to</span>
              <input
                type="date"
                className={`${styles.dateInput} ${filters.advanced?.created_at_to ? styles.dateInputFilled : ""}`}
                value={filters.advanced?.created_at_to ?? ""}
                onChange={(e) => setAdvanced("created_at_to", e.target.value)}
              />
            </span>
          </div>

          {/* Last Updated */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Last Updated</span>
            <span className={styles.rangePair}>
              <input
                type="date"
                className={`${styles.dateInput} ${filters.advanced?.updated_at_from ? styles.dateInputFilled : ""}`}
                value={filters.advanced?.updated_at_from ?? ""}
                onChange={(e) => setAdvanced("updated_at_from", e.target.value)}
              />
              <span className={styles.rangeSep}>to</span>
              <input
                type="date"
                className={`${styles.dateInput} ${filters.advanced?.updated_at_to ? styles.dateInputFilled : ""}`}
                value={filters.advanced?.updated_at_to ?? ""}
                onChange={(e) => setAdvanced("updated_at_to", e.target.value)}
              />
            </span>
          </div>

          {/* Bill Title */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Bill Title</span>
            <input
              type="text"
              className={styles.textInput}
              placeholder="Search…"
              value={filters.advanced?.bill_short_title ?? ""}
              onChange={(e) => setAdvanced("bill_short_title", e.target.value)}
            />
          </div>

          {/* Session */}
          {sessionOptions.length > 0 && (
            <div className={styles.filterGroup}>
              <span className={styles.label}>Session</span>
              <EnumMultiSelect
                options={sessionOptions}
                selected={filters.advanced?.bill_session ?? []}
                onChange={(val) => setAdvanced("bill_session", val)}
              />
            </div>
          )}

          {/* Bill Status */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Bill Status</span>
            <input
              type="text"
              className={styles.textInput}
              placeholder="Search…"
              value={filters.advanced?.bill_status ?? ""}
              onChange={(e) => setAdvanced("bill_status", e.target.value)}
            />
          </div>

          {/* Requested By — only for view-all users */}
          {canViewAll && (
            <div className={styles.filterGroup}>
              <span className={styles.label}>Requested By</span>
              <input
                type="text"
                className={styles.textInput}
                placeholder="email…"
                value={filters.requestor_email ?? ""}
                onChange={(e) => set("requestor_email", e.target.value)}
              />
            </div>
          )}

          {/* Tracking Approved */}
          <div className={styles.filterGroup}>
            <span className={styles.label}>Tracking</span>
            <div className={styles.segmented}>
              {[{ value: null, label: "Any" }, { value: true, label: "Approved" }, { value: false, label: "Not Approved" }].map((opt) => {
                const isActive = filters.bill_is_tracked === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`${styles.seg} ${isActive ? styles.segActive : ""}`}
                    onClick={() => set("bill_is_tracked", opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ALL_OUTCOME_VALUES, OUTCOME_TYPES } from "../../utils/outcomeTypes";
import styles from "./OutcomeFilter.module.css";

/**
 * A button that opens a dropdown panel of grouped checkboxes.
 *
 * Props:
 *   selected  — Set<string> of currently selected outcome_type values
 *   onChange  — (newSet: Set<string>) => void
 */
export default function OutcomeFilter({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle(value) {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next);
  }

  function selectAll() {
    onChange(new Set(ALL_OUTCOME_VALUES));
  }

  function clearAll() {
    onChange(new Set());
  }

  const selectedCount = selected.size;

  return (
    <div className={styles.wrapper} ref={panelRef}>
      <button
        className={`${styles.triggerBtn} ${open ? styles.active : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        Filter Outcomes
        <span className={styles.badge}>{selectedCount}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Visible Outcomes</span>
            <div className={styles.bulkActions}>
              <button className={styles.bulkBtn} onClick={selectAll}>All</button>
              <button className={styles.bulkBtn} onClick={clearAll}>None</button>
            </div>
          </div>

          <div className={styles.groups}>
            {OUTCOME_TYPES.map((group) => (
              <div key={group.group} className={styles.group}>
                <p className={styles.groupLabel}>{group.group}</p>
                {group.outcomes.map((outcome) => (
                  <label key={outcome.value} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selected.has(outcome.value)}
                      onChange={() => toggle(outcome.value)}
                    />
                    {outcome.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

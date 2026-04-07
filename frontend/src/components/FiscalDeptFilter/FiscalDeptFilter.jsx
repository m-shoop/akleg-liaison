import { useEffect, useRef, useState } from "react";
import styles from "./FiscalDeptFilter.module.css";

/**
 * A button that opens a dropdown panel of checkboxes for filtering fiscal note departments.
 *
 * Props:
 *   allDepts  — Set<string> of all available department values
 *   selected  — Set<string> | null (null means all departments are selected)
 *   onChange  — (Set<string> | null) => void
 */
export default function FiscalDeptFilter({ allDepts, selected, onChange }) {
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

  const sortedDepts = [...allDepts].sort();
  const isAll = selected === null;
  const selectedCount = isAll ? allDepts.size : selected.size;

  function isChecked(dept) {
    return isAll || selected.has(dept);
  }

  function toggle(dept) {
    const current = isAll ? new Set(allDepts) : new Set(selected);
    current.has(dept) ? current.delete(dept) : current.add(dept);
    // If all departments are checked again, revert to null (all selected)
    onChange(current.size === allDepts.size ? null : current);
  }

  function selectAll() {
    onChange(null);
  }

  function clearAll() {
    onChange(new Set());
  }

  if (allDepts.size === 0) return null;

  return (
    <div className={styles.wrapper} ref={panelRef}>
      <button
        className={`${styles.triggerBtn} ${open ? styles.active : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        Filter Fiscal Note Departments
        <span className={styles.badge}>{selectedCount}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Visible Departments</span>
            <div className={styles.bulkActions}>
              <button className={styles.bulkBtn} onClick={selectAll}>All</button>
              <button className={styles.bulkBtn} onClick={clearAll}>None</button>
            </div>
          </div>

          <div className={styles.list}>
            {sortedDepts.map((dept) => (
              <label key={dept} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isChecked(dept)}
                  onChange={() => toggle(dept)}
                />
                {dept.replace(/^Department of /i, "")}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

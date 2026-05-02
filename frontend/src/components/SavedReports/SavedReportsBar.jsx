import styles from "./SavedReportsBar.module.css";

export default function SavedReportsBar({
  reports,
  defaultReportId,
  loadedReportId,
  includeInactive,
  onIncludeInactiveChange,
  onSelectReport,
  error,
}) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Reports</span>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          />
          Include Inactive
        </label>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {reports.length === 0 ? (
        <div className={styles.empty}>
          No saved reports yet. Build a report below and click Save As to save it here.
        </div>
      ) : (
        <div className={styles.badgeRow}>
          {reports.map((r) => {
            const isLoaded = r.id === loadedReportId;
            const isDefault = r.id === defaultReportId;
            const isSystem = r.publication_level === "system";
            const cls = [
              styles.badge,
              isSystem ? styles.badgeSystem : styles.badgeUser,
              isLoaded ? styles.badgeLoaded : "",
              isDefault ? styles.badgeDefault : "",
              !r.is_active ? styles.badgeInactive : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={r.id}
                type="button"
                className={cls}
                onClick={() => onSelectReport(r.id)}
                title={
                  isDefault
                    ? `${r.display_name} (your default)`
                    : r.display_name
                }
              >
                {isDefault && <span className={styles.defaultMark} aria-hidden="true">★</span>}
                {r.display_name}
                {!r.is_active && <span className={styles.inactiveTag}> (inactive)</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.legend} aria-label="Report types legend">
        <span className={`${styles.legendBadge} ${styles.badgeSystem}`} aria-hidden="true" />
        <span className={styles.legendLabel}>= system report</span>
        <span className={`${styles.legendBadge} ${styles.badgeUser}`} aria-hidden="true" />
        <span className={styles.legendLabel}>= user-specific report</span>
      </div>
    </div>
  );
}

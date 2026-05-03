import styles from "./ReportFiltersSummary.module.css";

/**
 * Renders a friendly read-only summary of the filters currently applied on the
 * page.  Shown to users who don't have access to the StackingCriteria editor
 * (i.e. viewers) so they can understand the report context — especially useful
 * when results are empty and they want to know why.
 *
 * Each criterion row's summary comes from the page's own `summarizeRow`
 * (already used by StackingCriteria itself), so the wording stays consistent
 * across the editor and this read-only view.
 */
export default function ReportFiltersSummary({ criteria, summarizeRow }) {
  if (!criteria || !Array.isArray(criteria.criteria)) return null;
  const rows = criteria.criteria
    .map((c) => ({ id: c.id, text: summarizeRow ? summarizeRow(c.value) : null }))
    .filter((s) => s.text);
  const expression = criteria.expression?.trim() ?? "";

  return (
    <div className={styles.banner}>
      <span className={styles.label}>Report Filters:</span>
      {rows.length === 0 ? (
        <span className={styles.emptyText}>No filters active</span>
      ) : rows.length === 1 ? (
        <span className={styles.inline}>{rows[0].text}</span>
      ) : (
        <ul className={styles.list}>
          {rows.map((s) => (
            <li key={s.id}>
              <strong className={styles.rowId}>{s.id}:</strong> {s.text}
            </li>
          ))}
        </ul>
      )}
      {expression && rows.length > 1 && (
        <div className={styles.logic}>
          <span className={styles.label}>Logic:</span> <code>{expression}</code>
        </div>
      )}
    </div>
  );
}

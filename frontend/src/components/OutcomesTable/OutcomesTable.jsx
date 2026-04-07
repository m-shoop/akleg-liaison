import { flattenOutcomes, formatOutcomeType } from "../../utils/outcomes";
import styles from "./OutcomesTable.module.css";

// Strip "House " or "Senate " prefix — redundant given the Chamber column.
function displayCommittee(name) {
  if (!name) return "—";
  return name.replace(/^(House|Senate)\s+/i, "");
}

export default function OutcomesTable({ events, showDescription, selectedOutcomes }) {
  const rows = flattenOutcomes(events).filter((row) =>
    selectedOutcomes.has(row.outcome_type)
  );

  if (rows.length === 0) return null;

  const formatLabel = formatOutcomeType;

  const formatDate = (iso) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.colDate}>Date</th>
          <th className={styles.colOutcome}>Outcome</th>
          <th className={styles.colChamber}>Chamber</th>
          <th className={styles.colCommittee}>Committee</th>
          {showDescription && (
            <th className={styles.colDescription}>Description</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={i % 2 === 1 ? styles.rowAlt : undefined}>
            <td className={styles.colDate}>
              {row.source_url ? (
                <a
                  href={row.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.dateLink}
                >
                  {formatDate(row.date)}
                </a>
              ) : (
                formatDate(row.date)
              )}
            </td>
            <td className={styles.colOutcome}>
              {formatLabel(row.outcome_type)}
            </td>
            <td className={styles.colChamber}>{row.chamber === "House" ? "H" : "S"}</td>
            <td className={styles.colCommittee}>{displayCommittee(row.committee)}</td>
            {showDescription && (
              <td className={styles.colDescription}>{row.description}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

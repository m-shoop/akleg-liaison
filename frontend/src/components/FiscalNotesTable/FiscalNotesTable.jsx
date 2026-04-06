import styles from "./FiscalNotesTable.module.css";

export default function FiscalNotesTable({ fiscalNotes }) {
  const active = fiscalNotes.filter((n) => n.is_active);
  if (active.length === 0) return null;

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatLastSynced = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.colPublishDate}>Publish Date</th>
          <th className={styles.colIdentifier}>Identifier</th>
          <th className={styles.colDepartment}>Department</th>
          <th className={styles.colAppropriation}>Appropriation</th>
          <th className={styles.colAllocation}>Allocation</th>
          <th className={styles.colCode}>Control Code</th>
        </tr>
      </thead>
      <tbody>
        {active.map((note, i) => (
          <tr key={note.id} className={i % 2 === 1 ? styles.rowAlt : undefined}>
            <td className={styles.colPublishDate}>
              {note.publish_date ? formatDate(note.publish_date) : "—"}
            </td>
            <td className={styles.colIdentifier}>
              <a
                href={note.url}
                target="_blank"
                rel="noreferrer"
                className={styles.identifierLink}
                title={note.last_synced ? `Last Synced: ${formatLastSynced(note.last_synced)}` : undefined}
              >
                {note.fn_identifier ?? "View"}
              </a>
            </td>
            <td className={styles.colDepartment}>{note.fn_department ?? "—"}</td>
            <td className={styles.colAppropriation}>{note.fn_appropriation ?? "—"}</td>
            <td className={styles.colAllocation}>{note.fn_allocation ?? "—"}</td>
            <td className={styles.colCode}>{note.control_code ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

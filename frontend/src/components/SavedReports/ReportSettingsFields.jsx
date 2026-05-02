import styles from "./ReportSettingsFields.module.css";

/**
 * Shared name + roles fields for the Save As and Settings modals.
 *
 * The system-level role picker is shown only when `showSystemRoles` is true.
 * The Save As path also exposes a "save as system-level" checkbox upstream of
 * this component (see SaveAsModal); the Settings path does not, since
 * publication_level isn't editable on existing rows.
 */
export default function ReportSettingsFields({
  name,
  onNameChange,
  nameInputRef,
  showSystemRoles = false,
  availableRoles = [],
  selectedRoles,
  onToggleRole,
}) {
  return (
    <>
      <label className={styles.label}>
        Report name
        <input
          ref={nameInputRef}
          type="text"
          className={styles.input}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={120}
          placeholder="e.g. Bills I track for transportation"
        />
      </label>

      {showSystemRoles && (
        <div className={styles.rolesBlock}>
          <div className={styles.rolesHelp}>
            Check a user role to give them access to this report. Users with
            the admin role always have access to all reports.
          </div>
          {availableRoles.length === 0 ? (
            <div className={styles.empty}>
              No roles available.
            </div>
          ) : (
            <div className={styles.rolesList}>
              {availableRoles.map((r) => (
                <label key={r.name} className={styles.roleItem}>
                  <input
                    type="checkbox"
                    checked={selectedRoles.has(r.name)}
                    onChange={() => onToggleRole(r.name)}
                  />
                  <code>{r.name}</code>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

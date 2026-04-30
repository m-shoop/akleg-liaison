import { useEffect, useRef, useState } from "react";
import ReportSettingsFields from "./ReportSettingsFields";
import styles from "./SavedReportModal.module.css";

/**
 * Edit a loaded report's name and (for system-level rows when the caller has
 * system-report:edit) its allowed_roles.  Publication level is intentionally
 * not editable — the backend doesn't support flipping user/system on existing
 * rows, and SaveAsModal already covers the create-system-from-user flow.
 */
export default function SettingsModal({
  open,
  onClose,
  onSave,
  initialName = "",
  isSystemLevel = false,
  initialAllowedRoles = [],
  canEditRoles = false,
  availableRoles = [],
}) {
  const [name, setName] = useState(initialName);
  const [selectedRoles, setSelectedRoles] = useState(
    () => new Set(initialAllowedRoles),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Re-seed local state every time the modal opens so it reflects the current
  // loaded report's values (the loaded report may have changed since the last
  // time this modal was opened).
  useEffect(() => {
    if (open) {
      setName(initialName);
      setSelectedRoles(new Set(initialAllowedRoles));
      setError(null);
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initialName, initialAllowedRoles]);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  function toggleRole(roleName) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleName)) next.delete(roleName);
      else next.add(roleName);
      return next;
    });
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    // Only system-level rows accept allowed_roles on the backend; for
    // user-level rows we send name only.
    const allowedRoles = isSystemLevel && canEditRoles
      ? [...selectedRoles]
      : undefined;
    const result = await onSave(trimmed, allowedRoles);
    setSubmitting(false);
    if (!result?.ok) setError(result?.error ?? "Save failed");
  }

  const showSystemRoles = isSystemLevel && canEditRoles;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report Settings"
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.heading}>Report Settings</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <ReportSettingsFields
            name={name}
            onNameChange={setName}
            nameInputRef={inputRef}
            showSystemRoles={showSystemRoles}
            availableRoles={availableRoles}
            selectedRoles={selectedRoles}
            onToggleRole={toggleRole}
          />

          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.save} disabled={!canSubmit}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

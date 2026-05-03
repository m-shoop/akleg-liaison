import { useEffect, useRef, useState } from "react";
import ReportSettingsFields from "./ReportSettingsFields";
import styles from "./SavedReportModal.module.css";

export default function SaveAsModal({
  open,
  onClose,
  onSave,
  canCreateSystemReports = false,
  availableRoles = [],
}) {
  const [name, setName] = useState("");
  const [systemLevel, setSystemLevel] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSystemLevel(false);
      // Default to all roles selected so admins don't have to tick every box
      // on the common "share with everyone" path. They can uncheck individual
      // roles before saving if needed.
      setSelectedRoles(new Set(availableRoles.map((r) => r.name)));
      setError(null);
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    // availableRoles intentionally excluded — re-seeding mid-edit would clobber
    // the admin's manual checkbox toggles if the role list re-fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  function toggleRole(name) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const opts = systemLevel
      ? { publicationLevel: "system", allowedRoles: [...selectedRoles] }
      : { publicationLevel: "user", allowedRoles: [] };
    const result = await onSave(trimmed, opts);
    setSubmitting(false);
    if (!result?.ok) setError(result?.error ?? "Save failed");
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save Report As"
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.heading}>Save Report As</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <ReportSettingsFields
            name={name}
            onNameChange={setName}
            nameInputRef={inputRef}
            showSystemRoles={systemLevel}
            availableRoles={availableRoles}
            selectedRoles={selectedRoles}
            onToggleRole={toggleRole}
          />

          {canCreateSystemReports && (
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={systemLevel}
                onChange={(e) => setSystemLevel(e.target.checked)}
              />
              Save as a system-level report (visible to other users)
            </label>
          )}

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

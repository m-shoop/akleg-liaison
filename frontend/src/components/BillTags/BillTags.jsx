import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { addTagToBill, removeTagFromBill, setTagActive } from "../../api/tags";
import styles from "./BillTags.module.css";

export default function BillTags({ bill }) {
  const { isLoggedIn, token } = useAuth();
  const [tags, setTags] = useState(bill.tags ?? []);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleAdd(e) {
    e.preventDefault();
    const label = inputValue.trim();
    if (!label) return;
    setError(null);
    setBusy(true);
    try {
      const newTag = await addTagToBill(bill.id, label, token);
      setTags((prev) => {
        // Avoid duplicates if the tag was already on this bill
        if (prev.some((t) => t.id === newTag.id)) return prev;
        return [...prev, newTag];
      });
      setInputValue("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(tagId) {
    setError(null);
    setBusy(true);
    try {
      await removeTagFromBill(bill.id, tagId, token);
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(tag) {
    setError(null);
    setBusy(true);
    try {
      const updatedTag = await setTagActive(tag.id, !tag.is_active, token);
      setTags((prev) => prev.map((t) => (t.id === updatedTag.id ? updatedTag : t)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.pills}>
        {tags.map((tag) => (
          <span
            key={tag.id}
            className={`${styles.pill} ${!tag.is_active ? styles.pillInactive : ""}`}
          >
            {isLoggedIn ? (
              <button
                className={styles.pillLabel}
                onClick={() => handleToggleActive(tag)}
                disabled={busy}
                title={tag.is_active ? "Click to hide globally" : "Click to show globally"}
              >
                {tag.label}
              </button>
            ) : (
              <span className={styles.pillLabel}>{tag.label}</span>
            )}
            {isLoggedIn && (
              <button
                className={styles.pillRemove}
                onClick={() => handleRemove(tag.id)}
                disabled={busy}
                title="Remove from this bill"
                aria-label={`Remove tag "${tag.label}"`}
              >
                ×
              </button>
            )}
          </span>
        ))}

        {isLoggedIn && (
          <form onSubmit={handleAdd} className={styles.addForm}>
            <input
              className={styles.addInput}
              type="text"
              placeholder="Add tag…"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={busy}
            />
          </form>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

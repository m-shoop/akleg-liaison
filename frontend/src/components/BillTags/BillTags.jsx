import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { addTagToBill, removeTagFromBill } from "../../api/tags";
import styles from "./BillTags.module.css";

export default function BillTags({ bill, allTags = [] }) {
  const { isLoggedIn, isEditor, token } = useAuth();
  const [tags, setTags] = useState(bill.tags ?? []);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef(null);

  const suggestions = inputValue.trim()
    ? allTags.filter(
        (t) =>
          t.label.toLowerCase().includes(inputValue.trim().toLowerCase()) &&
          !tags.some((existing) => existing.id === t.id)
      )
    : [];

  async function addTag(label) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setError(null);
    setBusy(true);
    try {
      const newTag = await addTagToBill(bill.id, trimmed, token);
      setTags((prev) => prev.some((t) => t.id === newTag.id) ? prev : [...prev, newTag]);
      setInputValue("");
      setHighlightedIndex(-1);
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

  function handleKeyDown(e) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      addTag(suggestions[highlightedIndex].label);
    } else if (e.key === "Escape") {
      setHighlightedIndex(-1);
      setInputValue("");
    }
  }

  if (!isLoggedIn) return null;

  return (
    <div className={styles.container}>
      <div className={styles.pills}>
        {tags.filter((tag) => tag.is_active).map((tag) => (
          <span key={tag.id} className={styles.pill}>
            <span className={styles.pillLabel}>{tag.label}</span>
            {isEditor && (
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

        {isEditor && (
          <div className={styles.addWrapper}>
            <form onSubmit={(e) => { e.preventDefault(); addTag(highlightedIndex >= 0 ? suggestions[highlightedIndex].label : inputValue); }} className={styles.addForm}>
              <input
                ref={inputRef}
                className={styles.addInput}
                type="text"
                placeholder="Add tag…"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setHighlightedIndex(-1); }}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setHighlightedIndex(-1), 150)}
                disabled={busy}
                autoComplete="off"
              />
            </form>
            {suggestions.length > 0 && (
              <ul className={styles.dropdown}>
                {suggestions.map((t, i) => (
                  <li
                    key={t.id}
                    className={`${styles.dropdownItem} ${i === highlightedIndex ? styles.dropdownItemHighlighted : ""}`}
                    onMouseDown={() => addTag(t.label)}
                    onMouseEnter={() => setHighlightedIndex(i)}
                  >
                    {t.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

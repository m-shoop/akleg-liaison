import styles from "./StackingCriteria.module.css";
import { paletteClassFor } from "./palette.js";

export default function CriteriaRow({
  criterion,
  index,
  totalCount,
  selected,
  referencedInExpression,
  onSelect,
  onRemove,
  rowSummary,
  disabled = false,
}) {
  const colorClass = paletteClassFor(index, totalCount, styles);
  const mutedClass = referencedInExpression ? "" : styles.rowMuted;

  const handleSelect = () => {
    if (disabled) return;
    onSelect(criterion.id);
  };

  return (
    <div
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? -1 : 0}
      className={[
        styles.row,
        selected ? styles.rowSelected : "",
        mutedClass,
        disabled ? styles.rowLocked : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter") onSelect(criterion.id);
      }}
      title={disabled ? "Click Edit to modify this report" : undefined}
    >
      <span
        className={[styles.letterBadge, colorClass].filter(Boolean).join(" ")}
        aria-label={`Criterion ${criterion.id}`}
      >
        {criterion.id}
      </span>
      <div className={styles.rowSummary}>
        {rowSummary || <span className={styles.rowSummaryPlaceholder}>(no filters set)</span>}
      </div>
      {!disabled && (
        <button
          type="button"
          className={styles.removeButton}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(criterion.id);
          }}
          aria-label={`Delete criterion ${criterion.id}`}
          title="Delete criterion"
        >
          ×
        </button>
      )}
    </div>
  );
}

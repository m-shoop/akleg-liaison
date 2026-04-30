import styles from "./StackingCriteria.module.css";

export default function OperatorButtons({
  onInsert,
  onInsertLetter,
  criteria = [],
  disabled,
}) {
  return (
    <div className={styles.operatorButtons} role="group" aria-label="Expression operators">
      <button
        type="button"
        className={styles.operatorButton}
        onClick={() => onInsert("AND")}
        disabled={disabled}
      >
        AND
      </button>
      <button
        type="button"
        className={styles.operatorButton}
        onClick={() => onInsert("OR")}
        disabled={disabled}
      >
        OR
      </button>
      {criteria.map((c) => (
        <button
          key={c.id}
          type="button"
          className={styles.criterionInsertButton}
          onClick={() => onInsertLetter?.(c.id)}
          disabled={disabled}
          aria-label={`Insert criterion ${c.id} into expression`}
          title={`Insert ${c.id} into expression`}
        >
          +{c.id}
        </button>
      ))}
    </div>
  );
}

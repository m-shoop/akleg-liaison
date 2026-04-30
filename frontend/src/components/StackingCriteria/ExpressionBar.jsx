import { forwardRef } from "react";
import styles from "./StackingCriteria.module.css";

const ExpressionBar = forwardRef(function ExpressionBar(
  { expression, onChange, onCaretChange, errors, disabled, placeholder },
  ref,
) {
  const handleSelect = (e) => {
    onCaretChange?.({
      start: e.target.selectionStart ?? 0,
      end: e.target.selectionEnd ?? 0,
    });
  };

  const invalid = !disabled && errors.length > 0;

  return (
    <div className={styles.expressionContainer}>
      <input
        ref={ref}
        type="text"
        className={[
          styles.expressionInput,
          invalid ? styles.expressionInvalid : "",
          disabled ? styles.expressionDisabled : "",
        ]
          .filter(Boolean)
          .join(" ")}
        value={expression}
        onChange={(e) => onChange(e.target.value)}
        onSelect={handleSelect}
        onKeyUp={handleSelect}
        onClick={handleSelect}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-label="Filter expression"
        spellCheck="false"
        autoCapitalize="characters"
      />
      {invalid && (
        <ul className={styles.expressionErrors}>
          {errors.map((err, i) => (
            <li key={i}>
              {err.message}
              {Number.isInteger(err.pos) ? ` (position ${err.pos + 1})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default ExpressionBar;

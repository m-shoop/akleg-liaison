import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import styles from "./StackingCriteria.module.css";
import CriteriaRow from "./CriteriaRow.jsx";
import ExpressionBar from "./ExpressionBar.jsx";
import OperatorButtons from "./OperatorButtons.jsx";
import {
  addRow,
  removeRow,
  updateRowValue,
  setExpression,
} from "./createInitialState.js";
import { compile } from "./expression/compiler.js";
import { validate, unusedCriteriaIds } from "./expression/validate.js";
import {
  insertLetter as insertLetterAtCaret,
  insertOperator as insertOperatorAtCaret,
} from "./expression/insertHelpers.js";

const EMPTY_EXPRESSION_PLACEHOLDER = "e.g. (A AND B) OR C  -  default is simple AND logic";
const EMPTY_STATE_PLACEHOLDER = "Add a criterion below to begin building your report.";

export default function StackingCriteria({
  value,
  onChange,
  onApply,
  appliedValue,
  RowEditor,
  rowEditorProps = {},
  compileRow,
  emptyRowValue = null,
  summarizeRow,
  mobile = false,
  onSave,
  onSaveAs,
  saveAvailable = false,
  saveAsAvailable = false,
  canRunQuery = true,
  loadedReportName = null,
  isLoadedActive = true,
  isLoadedDefault = false,
  onToggleActive,
  onToggleDefault,
  editMode = false,
  editLocked = false,
  loadedDirty = false,
  onStartEdit,
  onCancelEdit,
  onNewReport,
  onOpenSettings,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [caret, setCaret] = useState(null);
  const [customLogicOpen, setCustomLogicOpen] = useState(false);
  const expressionInputRef = useRef(null);
  const pendingCaretRef = useRef(null);
  const internalAppliedRef = useRef(JSON.stringify(value));

  const appliedJson =
    appliedValue !== undefined ? JSON.stringify(appliedValue) : internalAppliedRef.current;
  const dirty = JSON.stringify(value) !== appliedJson;

  const { ast, errors, referencedIds } = useMemo(
    () => validate(value.expression, value.criteria),
    [value.expression, value.criteria],
  );
  const expressionValid = errors.length === 0;
  const hasCriteria = value.criteria.length > 0;
  const canApply = dirty && expressionValid && hasCriteria && canRunQuery;

  const unusedIds = useMemo(
    () =>
      value.expression.trim() === ""
        ? []
        : unusedCriteriaIds(value.criteria, referencedIds),
    [value.expression, value.criteria, referencedIds],
  );

  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const input = expressionInputRef.current;
    if (!input) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    input.focus();
    input.setSelectionRange(pos, pos);
    setCaret({ start: pos, end: pos });
  }, [value.expression]);

  useEffect(() => {
    if (editLocked && selectedId !== null) setSelectedId(null);
  }, [editLocked, selectedId]);

  function effectiveCaret() {
    return caret ?? { start: value.expression.length, end: value.expression.length };
  }

  function handleAddRow() {
    let next = addRow(value, emptyRowValue);
    const newId = next.criteria[next.criteria.length - 1].id;
    if (next.expression.trim() !== "" && expressionValid) {
      next = setExpression(next, `${next.expression} AND ${newId}`);
    }
    onChange(next);
    setSelectedId(newId);
  }

  function handleRemoveRow(id) {
    onChange(removeRow(value, id));
    if (selectedId === id) setSelectedId(null);
  }

  function handleUpdateSelectedRow(rowValue) {
    if (!selectedId) return;
    onChange(updateRowValue(value, selectedId, rowValue));
  }

  function handleExpressionChange(expression) {
    onChange(setExpression(value, expression));
  }

  function handleInsertLetter(letter) {
    const c = effectiveCaret();
    const result = insertLetterAtCaret(value.expression, c.start, c.end, letter);
    pendingCaretRef.current = result.caret;
    onChange(setExpression(value, result.expression));
  }

  function handleInsertOperator(op) {
    const c = effectiveCaret();
    const result = insertOperatorAtCaret(value.expression, c.start, c.end, op);
    pendingCaretRef.current = result.caret;
    onChange(setExpression(value, result.expression));
  }

  function handleApply() {
    if (!canApply) return;
    const filterGroup = compile(ast, value.criteria, compileRow);
    internalAppliedRef.current = JSON.stringify(value);
    onApply(filterGroup, value);
  }

  if (mobile) {
    const firstRow = value.criteria[0] ?? null;
    return (
      <div className={styles.container}>
        <div className={styles.mobileNotice}>
          Mobile shows a single row of filters. Open on a larger screen to use stacked criteria.
        </div>
        {firstRow && RowEditor && (
          <RowEditor
            value={firstRow.value}
            onChange={(rowValue) => onChange(updateRowValue(value, firstRow.id, rowValue))}
            {...rowEditorProps}
          />
        )}
        <div className={styles.applyBar}>
          <button
            type="button"
            className={styles.applyButton}
            onClick={handleApply}
            disabled={!canApply}
          >
            Run Query
          </button>
        </div>
      </div>
    );
  }

  const runTooltip = !canRunQuery
    ? "Reactivate this report to run it"
    : !dirty
    ? "No changes to run"
    : !hasCriteria
    ? "Add at least one criterion"
    : !expressionValid
    ? "Fix expression errors first"
    : "Run query against the database";

  const saveTooltip = !canRunQuery
    ? "Reactivate this report to save changes"
    : editLocked
    ? "Click Edit to modify this report"
    : saveAvailable
    ? "Save changes to the loaded report"
    : !loadedReportName
    ? "Load a report to enable Save (or use Save As to create one)"
    : "No changes to save";

  return (
    <div className={styles.container}>
      {!loadedReportName && (onNewReport || onSaveAs) && (
        <div className={styles.loadedBanner}>
          <div className={styles.loadedActions}>
            {onNewReport && (
              <button
                type="button"
                className={styles.toggleBadge}
                onClick={onNewReport}
                disabled
                title="You're in a new report — use Save As to keep it, or load an existing report"
              >
                New Report
              </button>
            )}
            {onSaveAs && (
              <button
                type="button"
                className={styles.toggleBadge}
                onClick={onSaveAs}
                disabled={!saveAsAvailable}
                title={saveAsAvailable ? "Save as a new report" : "Add at least one criterion first"}
              >
                Save As
              </button>
            )}
          </div>
        </div>
      )}
      {loadedReportName && (
        <div className={styles.loadedBanner}>
          <span className={styles.loadedName}>
            {editMode ? "Editing: " : "(View Only): "}
            <strong>{loadedReportName}</strong>
            {loadedDirty && (
              <span className={styles.dirtyMark} title="Unsaved changes" aria-label="unsaved changes"> •</span>
            )}
          </span>
          <div className={styles.loadedActions}>
            {editMode && onOpenSettings && (
              <button
                type="button"
                className={styles.toggleBadge}
                onClick={onOpenSettings}
                title="Edit this report's name and visibility"
              >
                Settings
              </button>
            )}
            {editMode
              ? onCancelEdit && (
                  <button
                    type="button"
                    className={styles.toggleBadge}
                    onClick={onCancelEdit}
                    title="Discard changes and exit edit mode"
                  >
                    Cancel
                  </button>
                )
              : onStartEdit && (
                  <button
                    type="button"
                    className={styles.toggleBadge}
                    onClick={onStartEdit}
                    disabled={!isLoadedActive}
                    title={isLoadedActive ? "Edit this report's criteria" : "Reactivate this report to edit"}
                  >
                    Edit
                  </button>
                )}
            {onNewReport && (
              <button
                type="button"
                className={styles.toggleBadge}
                onClick={onNewReport}
                title="Disconnect from this report and start a fresh query"
              >
                New Report
              </button>
            )}
            {onSave && (
              <button
                type="button"
                className={styles.toggleBadge}
                onClick={onSave}
                disabled={!saveAvailable}
                title={saveTooltip}
              >
                Save
              </button>
            )}
            {onSaveAs && (
              <button
                type="button"
                className={styles.toggleBadge}
                onClick={onSaveAs}
                disabled={!saveAsAvailable}
                title={saveAsAvailable ? "Save as a new report" : "Add at least one criterion first"}
              >
                Save As
              </button>
            )}
          </div>
          <div className={styles.loadedToggles}>
            {onToggleDefault && (
              <button
                type="button"
                className={`${styles.toggleBadge} ${isLoadedDefault ? styles.toggleBadgeOn : ""}`}
                onClick={onToggleDefault}
                disabled={!isLoadedActive}
                title={
                  !isLoadedActive
                    ? "Reactivate this report to set as default"
                    : isLoadedDefault
                    ? "Unmark as your default"
                    : "Mark as your default for this tab"
                }
              >
                {isLoadedDefault ? "★ Default Report" : "☆ Default Report"}
              </button>
            )}
            {onToggleActive && (
              <button
                type="button"
                className={`${styles.toggleBadge} ${isLoadedActive ? styles.toggleBadgeOn : styles.toggleBadgeInactive}`}
                onClick={onToggleActive}
                title={isLoadedActive ? "Mark this report inactive" : "Reactivate this report"}
              >
                {isLoadedActive ? "Active" : "Inactive"}
              </button>
            )}
          </div>
        </div>
      )}

      {!expressionValid ? (
        <div className={styles.errorBanner} role="alert">
          Custom Logic has errors that must be fixed before the query can run.
        </div>
      ) : dirty && (
        <div className={styles.dirtyBanner}>
          Your changes have not yet been applied. Click Run Query for them to take effect.
        </div>
      )}

      {!hasCriteria && (
        <div className={styles.emptyHint}>{EMPTY_STATE_PLACEHOLDER}</div>
      )}

      <div className={styles.rowList}>
        {value.criteria.map((c, i) => (
          <Fragment key={c.id}>
            <CriteriaRow
              criterion={c}
              index={i}
              totalCount={value.criteria.length}
              selected={c.id === selectedId}
              referencedInExpression={
                value.expression.trim() === "" || referencedIds.has(c.id)
              }
              onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
              onRemove={handleRemoveRow}
              rowSummary={summarizeRow ? summarizeRow(c.value) : null}
              disabled={editLocked}
            />
            {c.id === selectedId && RowEditor && (
              <div className={styles.editorPane}>
                <div className={styles.editorHeading}>
                  Editing criterion <strong>{c.id}</strong>
                </div>
                <RowEditor
                  value={c.value}
                  onChange={handleUpdateSelectedRow}
                  {...rowEditorProps}
                />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <div className={styles.addRow}>
        <button
          type="button"
          className={styles.addButton}
          onClick={handleAddRow}
          disabled={editLocked}
          title={editLocked ? "Click Edit to modify this report" : undefined}
        >
          + Add criterion
        </button>
      </div>

      <div className={styles.bottomRow}>
        <div className={styles.customLogicSection}>
          <button
            type="button"
            className={styles.customLogicHeader}
            onClick={() => setCustomLogicOpen((o) => !o)}
            aria-expanded={customLogicOpen}
          >
            <span>
              Custom Logic
              {!expressionValid && (
                <span
                  className={styles.headerWarning}
                  role="img"
                  aria-label="Expression has errors"
                  title={`${errors.length} expression error${errors.length === 1 ? "" : "s"}`}
                >
                  ⚠
                </span>
              )}
            </span>
            <span aria-hidden="true">{customLogicOpen ? "▲" : "▼"}</span>
          </button>
          {customLogicOpen && (
            <div className={styles.customLogicBody}>
              <ExpressionBar
                ref={expressionInputRef}
                expression={value.expression}
                onChange={handleExpressionChange}
                onCaretChange={setCaret}
                errors={errors}
                disabled={editLocked || !hasCriteria}
                placeholder={hasCriteria ? EMPTY_EXPRESSION_PLACEHOLDER : EMPTY_STATE_PLACEHOLDER}
              />
              {unusedIds.length > 0 && (
                <div className={styles.unusedWarning} role="status">
                  {unusedIds.length === 1
                    ? `Criterion ${unusedIds[0]} is missing from the expression.`
                    : `Criteria ${unusedIds.join(", ")} are missing from the expression.`}
                </div>
              )}
              <OperatorButtons
                onInsert={handleInsertOperator}
                onInsertLetter={handleInsertLetter}
                criteria={value.criteria}
                disabled={editLocked || !hasCriteria}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.applyButton}
          onClick={handleApply}
          disabled={!canApply}
          title={runTooltip}
        >
          Run Query
        </button>
      </div>
    </div>
  );
}

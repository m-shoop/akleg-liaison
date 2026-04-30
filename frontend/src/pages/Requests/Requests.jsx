import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { addWorkflowAction, updateHearingAssignmentType } from "../../api/workflows";
import { useAssigneeOptedOut, OPT_OUT_WARNING } from "../../hooks/useAssigneeOptedOut";
import UserCombobox from "../../components/UserCombobox/UserCombobox";
import { fetchReport, fetchReportMeta } from "../../api/reports";
import Toast from "../../components/Toast/Toast";
import RequestsFilterBar from "../../components/RequestsFilterBar/RequestsFilterBar";
import StackingCriteria from "../../components/StackingCriteria/StackingCriteria";
import { compile } from "../../components/StackingCriteria/expression/compiler";
import { validate } from "../../components/StackingCriteria/expression/validate";
import SavedReportsBar from "../../components/SavedReports/SavedReportsBar";
import SaveAsModal from "../../components/SavedReports/SaveAsModal";
import SettingsModal from "../../components/SavedReports/SettingsModal";
import { useSavedReports } from "../../hooks/useSavedReports";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import {
  ASSIGNMENT_ROW_DEFAULTS,
  makeAssignmentNewRowValue,
  buildAssignmentRowFilterGroup,
  summarizeAssignmentRow,
  makeRequestNewRowValue,
  makeDefaultRequestsCriteria,
  buildRequestRowFilterGroup,
  summarizeRequestRow,
} from "./stackingHelpers";
import { createInitialState } from "../../components/StackingCriteria/createInitialState";
import styles from "./Requests.module.css";

const REQUESTS_STORAGE_KEY = "requests_stacking";
const REQUESTS_LEGACY_STORAGE_KEY = "requests_filters";

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Anchorage",
    timeZoneName: "shortGeneric",
  });
}

function formatDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Most assignees share dps.alaska.gov, so showing the local-part is enough to
// identify the row; full email lives in the title attribute for hover.
function shortEmail(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

function assignmentTypeLabel(t) {
  return t === "awareness" ? "Awareness" : "Monitoring";
}

// ─── Hearing Assignments ───────────────────────────────────────────────────

const ACTIVE_ASSIGNMENT_ACTIONS = new Set([
  "auto_suggested_hearing_assignment",
  "hearing_assigned",
  "hearing_reassigned",
  "reassignment_request",
]);

const CLOSED_ASSIGNMENT_ACTIONS = new Set([
  "hearing_assignment_complete",
  "hearing_assignment_canceled",
  "hearing_assignment_discarded",
]);

function assignmentStatusLabel(latestActionType) {
  switch (latestActionType) {
    case "auto_suggested_hearing_assignment": return "Suggested";
    case "hearing_assigned":                 return "Assigned";
    case "hearing_reassigned":               return "Assigned";
    case "reassignment_request":             return "Reassign";
    case "hearing_assignment_complete":      return "Completed";
    case "hearing_assignment_canceled":      return "Canceled";
    case "hearing_assignment_discarded":     return "Discarded";
    default:                                 return latestActionType ?? "Unknown";
  }
}

function assignmentStatusClass(latestActionType, styles) {
  if (latestActionType === "auto_suggested_hearing_assignment"
      || latestActionType === "reassignment_request")           return styles.statusSuggested;
  if (CLOSED_ASSIGNMENT_ACTIONS.has(latestActionType))          return styles.statusClosed;
  return styles.statusOpen;
}

const ASSIGNMENT_COLUMNS = [
  "id", "workflow_id", "latest_action_type", "assignment_type", "assignee_email",
  "hearing_id", "hearing_date", "hearing_time", "hearing_chamber", "committee_name",
  "bill_number", "bill_short_title", "created_at", "actions",
];

function rowToAssignment(row) {
  return {
    id:                 row.id,
    workflow_id:        row.workflow_id,
    latest_action_type: row.latest_action_type ?? null,
    assignment_type:    row.assignment_type ?? "monitoring",
    assignee_email:     row.assignee_email ?? null,
    hearing_id:         row.hearing_id ?? null,
    hearing_date:       row.hearing_date ?? null,
    hearing_time:       row.hearing_time ?? null,
    hearing_chamber:    row.hearing_chamber ?? null,
    committee_name:     row.committee_name ?? null,
    bill_number:        row.bill_number ?? null,
    bill_short_title:   row.bill_short_title ?? null,
    created_at:         row.created_at,
    actions:            Array.isArray(row.actions) ? row.actions : [],
  };
}

const ASSIGNMENT_ACTION_TYPE_OPTS = [
  { value: "hearing_assigned",                  label: "Assigned" },
  { value: "reassignment_request",              label: "Reassignment Requested" },
  { value: "hearing_assignment_complete",       label: "Completed" },
  { value: "hearing_assignment_canceled",       label: "Canceled" },
  { value: "hearing_assignment_discarded",      label: "Discarded" },
  { value: "auto_suggested_hearing_assignment", label: "Suggested" },
];

function AssignmentsFilterBar({ filters, onChange, canViewAll, canViewSuggestions }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function set(key, value) { onChange({ ...filters, [key]: value }); }

  const visibleActionOpts = canViewSuggestions
    ? ASSIGNMENT_ACTION_TYPE_OPTS
    : ASSIGNMENT_ACTION_TYPE_OPTS.filter((o) => o.value !== "auto_suggested_hearing_assignment");

  const summaryParts = [];
  if (filters.latest_action_type?.length > 0) {
    const labels = filters.latest_action_type.map(
      (v) => ASSIGNMENT_ACTION_TYPE_OPTS.find((o) => o.value === v)?.label ?? v
    );
    summaryParts.push(`Type: ${labels.join(", ")}`);
  }
  if (filters.assignee_email) summaryParts.push(`Assignee: "${filters.assignee_email}"`);
  if (filters.bill_number) summaryParts.push(`Bill: "${filters.bill_number}"`);
  if (filters.hearing_date_from && filters.hearing_date_to) summaryParts.push(`Hearing: ${filters.hearing_date_from} – ${filters.hearing_date_to}`);
  else if (filters.hearing_date_from) summaryParts.push(`Hearing: after ${filters.hearing_date_from}`);
  else if (filters.hearing_date_to) summaryParts.push(`Hearing: before ${filters.hearing_date_to}`);

  return (
    <div className={styles.filterBar}>
      <div className={styles.filterSummary}>
        {summaryParts.length === 0
          ? <span className={styles.filterSummaryEmpty}>No filters active</span>
          : summaryParts.map((p, i) => (
              <span key={i} className={styles.filterSummaryPart}>
                {i > 0 && <span className={styles.filterSummarySep}>·</span>}
                {p}
              </span>
            ))
        }
      </div>

      <div className={styles.filterBasicRow}>
        {/* Assignment status (action type) */}
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Assignment Status</span>
          <div className={styles.filterCheckboxGroup}>
            {visibleActionOpts.map((opt) => {
              const checked = filters.latest_action_type?.includes(opt.value) ?? false;
              return (
                <label key={opt.value} className={styles.filterCheckboxLabel}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const cur = filters.latest_action_type ?? [];
                      set("latest_action_type", checked ? cur.filter((v) => v !== opt.value) : [...cur, opt.value]);
                    }}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </div>

        {/* Bill number */}
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Bill</span>
          <input type="text" className={styles.filterTextInput} placeholder="e.g. HB 62"
            value={filters.bill_number ?? ""} onChange={(e) => set("bill_number", e.target.value)} />
        </div>

        {/* Assignee — admin only */}
        {canViewAll && (
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Assignee</span>
            <input type="text" className={styles.filterTextInput} placeholder="email…"
              value={filters.assignee_email ?? ""} onChange={(e) => set("assignee_email", e.target.value)} />
          </div>
        )}
      </div>

      <button type="button"
        className={`${styles.filterAdvancedToggle} ${advancedOpen ? styles.filterAdvancedToggleOpen : ""}`}
        onClick={() => setAdvancedOpen((o) => !o)}>
        Advanced {advancedOpen ? "▲" : "▼"}
      </button>

      {advancedOpen && (
        <div className={styles.filterAdvancedRow}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Hearing Date</span>
            <span className={styles.filterRangePair}>
              <input type="date" className={`${styles.filterDateInput} ${filters.hearing_date_from ? styles.filterDateInputFilled : ""}`}
                value={filters.hearing_date_from ?? ""} onChange={(e) => set("hearing_date_from", e.target.value)} />
              <span className={styles.filterRangeSep}>to</span>
              <input type="date" className={`${styles.filterDateInput} ${filters.hearing_date_to ? styles.filterDateInputFilled : ""}`}
                value={filters.hearing_date_to ?? ""} onChange={(e) => set("hearing_date_to", e.target.value)} />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ assignment, canManage, canViewSuggestions, token, onActionTaken, username, isMobile }) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(null);
  const [error, setError] = useState(null);
  const [showReassignForm, setShowReassignForm] = useState(false);
  const [reassignEmail, setReassignEmail] = useState("");
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [updatingType, setUpdatingType] = useState(false);
  const [localAssignmentType, setLocalAssignmentType] = useState(assignment.assignment_type ?? "monitoring");

  // Re-sync the local type if the row's underlying value shifts (e.g. parent
  // refetched after another tab confirmed the suggestion).
  useEffect(() => {
    setLocalAssignmentType(assignment.assignment_type ?? "monitoring");
  }, [assignment.assignment_type]);

  const { latest_action_type, assignee_email, hearing_date, hearing_time, hearing_chamber, committee_name, bill_number } = assignment;
  const chamberPrefix = hearing_chamber ? `(${hearing_chamber}) ` : "";
  const hearingName = `${chamberPrefix}${committee_name || "Floor Session"}`;
  const hearingInfo = hearing_date
    ? `${formatDate(hearing_date)}${hearing_time ? ` · ${formatTime(hearing_time)}` : ""} · ${hearingName}`
    : "";
  const isClosed = CLOSED_ASSIGNMENT_ACTIONS.has(latest_action_type);
  const isSuggested = latest_action_type === "auto_suggested_hearing_assignment";
  const isReassignRequest = latest_action_type === "reassignment_request";
  const isAssigned = latest_action_type === "hearing_assigned";
  const isAssignee = username === assignee_email;

  const reassignAssigneeOptedOut = useAssigneeOptedOut(
    showReassignForm ? reassignEmail : "",
    token,
  );

  async function handleAction(actionType, opts = {}) {
    setError(null);
    setActing(actionType);
    try {
      await addWorkflowAction(assignment.workflow_id, actionType, token, opts);
      setShowReassignForm(false);
      setReassignEmail("");
      setShowCancelForm(false);
      setCancellationReason("");
      onActionTaken();
    } catch (err) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  }

  async function handleTypeChange(newType) {
    if (newType === localAssignmentType) return;
    setError(null);
    setUpdatingType(true);
    // Optimistic local update — the report refetch will reconcile if the
    // server rejects (e.g. another tab confirmed the suggestion).
    const previous = localAssignmentType;
    setLocalAssignmentType(newType);
    try {
      await updateHearingAssignmentType({
        assignmentId: assignment.id,
        assignmentType: newType,
        token,
      });
      onActionTaken();
    } catch (err) {
      setLocalAssignmentType(previous);
      setError(err.message);
    } finally {
      setUpdatingType(false);
    }
  }

  const cols = isMobile ? 3 : 7;

  const typeControl = canManage && isSuggested ? (
    <select
      className={styles.typeSelect}
      value={localAssignmentType}
      onChange={(e) => handleTypeChange(e.target.value)}
      disabled={updatingType || acting !== null}
      aria-label="Assignment type"
    >
      <option value="monitoring">Monitoring</option>
      <option value="awareness">Awareness</option>
    </select>
  ) : (
    <span className={styles.typeLabel}>{assignmentTypeLabel(localAssignmentType)}</span>
  );

  const actionButtons = (
    <div className={styles.actionsCell}>
      {canManage && isSuggested && (
        <>
          <button className={styles.assignBtn} onClick={() => handleAction("hearing_assigned")} disabled={acting !== null || updatingType}>
            {acting === "hearing_assigned" ? "…" : "Assign"}
          </button>
          <button className={styles.discardBtn} onClick={() => handleAction("hearing_assignment_discarded")} disabled={acting !== null || updatingType}>
            {acting === "hearing_assignment_discarded" ? "…" : "Discard"}
          </button>
        </>
      )}
      {canManage && isReassignRequest && !showReassignForm && !showCancelForm && (
        <>
          <button className={styles.assignBtn} onClick={() => { setReassignEmail(assignee_email ?? ""); setShowReassignForm(true); }} disabled={acting !== null}>
            Reassign
          </button>
          <button className={styles.discardBtn} onClick={() => setShowCancelForm(true)} disabled={acting !== null}>
            Cancel
          </button>
        </>
      )}
      {canManage && isAssigned && !showCancelForm && (
        <button className={styles.discardBtn} onClick={() => setShowCancelForm(true)} disabled={acting !== null}>
          Cancel
        </button>
      )}
      {isAssignee && !isClosed && isAssigned && !showCancelForm && (
        <>
          <button className={styles.completeBtn} onClick={() => handleAction("hearing_assignment_complete")} disabled={acting !== null}>
            {acting === "hearing_assignment_complete" ? "…" : "Mark Complete"}
          </button>
          <button className={styles.reassignRequestBtn} onClick={() => handleAction("reassignment_request")} disabled={acting !== null}>
            {acting === "reassignment_request" ? "…" : "Request Reassignment"}
          </button>
        </>
      )}
    </div>
  );

  return (
    <>
      <tr
        className={`${styles.assignmentRow} ${isClosed ? styles.assignmentRowClosed : ""} ${isMobile ? styles.assignmentRowMobile : ""}`}
        onClick={isMobile ? () => setExpanded((v) => !v) : undefined}
        aria-expanded={isMobile ? expanded : undefined}
      >
        <td className={styles.cellEmail} title={assignee_email ?? ""}>{shortEmail(assignee_email)}</td>
        <td className={styles.cellBill}>{bill_number || ""}</td>
        <td>
          <span className={`${styles.statusBadge} ${assignmentStatusClass(latest_action_type, styles)}`}>
            {assignmentStatusLabel(latest_action_type)}
          </span>
          {isMobile && <span className={styles.mobileChevron}>{expanded ? "▴" : "▾"}</span>}
        </td>
        {!isMobile && (
          <>
            <td className={styles.cellType}>{typeControl}</td>
            <td className={styles.cellHearing}>{hearingInfo}</td>
            <td className={styles.cellActions}>{actionButtons}</td>
            <td className={styles.cellHistoryToggle}>
              <button
                className={styles.historyToggle}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                title={expanded ? "Hide history" : "Show history"}
              >
                {expanded ? "▲" : "▼"}
              </button>
            </td>
          </>
        )}
      </tr>

      {isMobile && expanded && (
        <tr className={styles.assignmentSubRow}>
          <td colSpan={cols}>
            <dl className={styles.mobileDetails}>
              {hearingInfo && (
                <>
                  <dt>Hearing</dt>
                  <dd>{hearingInfo}</dd>
                </>
              )}
              <dt>Type</dt>
              <dd>{typeControl}</dd>
              <dt>Actions</dt>
              <dd>{actionButtons}</dd>
            </dl>
          </td>
        </tr>
      )}

      {showReassignForm && (
        <tr className={styles.assignmentSubRow}>
          <td colSpan={cols}>
            <div className={styles.reassignForm}>
              <span className={styles.reassignFormLabel}>New assignee</span>
              <UserCombobox
                value={reassignEmail}
                onChange={setReassignEmail}
                token={token}
                placeholder="staff@dps.alaska.gov"
                autoFocus
              />
              <button
                className={styles.assignBtn}
                onClick={() => handleAction("hearing_assigned", { newAssigneeEmail: reassignEmail.trim() })}
                disabled={!reassignEmail.trim() || acting !== null}
              >
                {acting === "hearing_assigned" ? "…" : "Confirm"}
              </button>
              <button
                className={styles.expandBtn}
                onClick={() => { setShowReassignForm(false); setReassignEmail(""); }}
                disabled={acting !== null}
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}

      {showReassignForm && reassignAssigneeOptedOut && (
        <tr className={styles.assignmentSubRow}>
          <td colSpan={cols}>
            <p className={styles.optOutWarning}>{OPT_OUT_WARNING}</p>
          </td>
        </tr>
      )}

      {showCancelForm && (
        <tr className={styles.assignmentSubRow}>
          <td colSpan={cols}>
            <div className={styles.reassignForm}>
              <span className={styles.reassignFormLabel}>Cancellation reason</span>
              <input
                type="text"
                className={styles.reassignEmailInput}
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="Why is this assignment being canceled?"
                autoFocus
              />
              <button
                className={styles.discardBtn}
                onClick={() =>
                  handleAction("hearing_assignment_canceled", {
                    cancellationReason: cancellationReason.trim() || null,
                  })
                }
                disabled={acting !== null}
              >
                {acting === "hearing_assignment_canceled" ? "…" : "Confirm Cancel"}
              </button>
              <button
                className={styles.expandBtn}
                onClick={() => { setShowCancelForm(false); setCancellationReason(""); }}
                disabled={acting !== null}
              >
                Back
              </button>
            </div>
          </td>
        </tr>
      )}

      {error && (
        <tr className={styles.assignmentSubRow}>
          <td colSpan={cols}>
            <p className={styles.error}>{error}</p>
          </td>
        </tr>
      )}

      {!isMobile && expanded && (
        <tr className={styles.assignmentSubRow}>
          <td colSpan={cols}>
            <table className={styles.actionsTable}>
              <thead>
                <tr><th>Action</th><th>User</th><th>Timestamp</th></tr>
              </thead>
              <tbody>
                {assignment.actions.map((action, i) => (
                  <tr key={i}>
                    <td><span className={styles.actionBadge}>{assignmentStatusLabel(action.type)}</span></td>
                    <td className={styles.actionUser}>{action.actor}</td>
                    <td className={styles.actionTimestamp}>{formatTimestamp(action.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Bill Tracking Requests ────────────────────────────────────────────────

function actionLabel(type) {
  switch (type) {
    case "request_bill_tracking": return "Requested tracking";
    case "approve_bill_tracking": return "Approved";
    case "deny_bill_tracking":    return "Denied";
    default:                      return type;
  }
}

function actionClass(type, styles) {
  switch (type) {
    case "approve_bill_tracking": return styles.actionApproved;
    case "deny_bill_tracking":    return styles.actionDenied;
    default:                      return styles.actionRequested;
  }
}

function rowToRequest(row) {
  return {
    id:               row.id,
    workflow_status:  row.workflow_status,
    created_at:       row.created_at,
    updated_at:       row.updated_at ?? null,
    requestor_email:  row.requestor_email ?? null,
    bill_id:          row.bill_id ?? null,
    bill_number:      row.bill_number ?? null,
    bill_short_title: row.bill_short_title ?? null,
    bill_is_tracked:  row.bill_is_tracked ?? false,
    bill_url:         row.bill_url ?? null,
    latest_action_type: row.latest_action_type ?? null,
    action_count:     row.action_count ?? 0,
    actions:          Array.isArray(row.actions) ? row.actions : [],
  };
}

const REQUEST_COLUMNS = [
  "id", "workflow_status", "created_at", "updated_at", "requestor_email",
  "bill_id", "bill_number", "bill_short_title", "bill_is_tracked", "bill_url",
  "latest_action_type", "action_count", "actions",
];

function groupByBill(requests) {
  const map = new Map();
  for (const req of requests) {
    const key = req.bill_id ?? `no-bill-${req.id}`;
    if (!map.has(key)) {
      map.set(key, {
        bill_id:          req.bill_id,
        bill_number:      req.bill_number ?? "Unknown",
        bill_short_title: req.bill_short_title,
        bill_is_tracked:  req.bill_is_tracked,
        bill_url:         req.bill_url,
        requests:         [],
      });
    }
    map.get(key).requests.push(req);
  }
  return [...map.values()].sort((a, b) =>
    (a.bill_number ?? "").localeCompare(b.bill_number ?? "")
  );
}

function BillRequestGroup({ group, canApprove, token, onActionTaken, isMobile }) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(null);
  const [error, setError] = useState(null);

  const { bill_number, bill_short_title, bill_url, requests } = group;

  const allActions = [];
  const seen = new Set();
  for (const req of requests) {
    for (const action of req.actions) {
      if (action.type === "approve_bill_tracking" || action.type === "deny_bill_tracking") {
        const key = `${action.type}:${action.actor}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      allActions.push(action);
    }
  }
  allActions.sort((a, b) => new Date(a.at) - new Date(b.at));

  const isOpen = requests.some((r) => r.workflow_status === "open");
  const openWorkflowId = requests.find((r) => r.workflow_status === "open")?.id;

  const lastDecision = !isOpen
    ? [...allActions].reverse().find(
        (a) => a.type === "approve_bill_tracking" || a.type === "deny_bill_tracking"
      )
    : null;
  const closedLabel = lastDecision?.type === "approve_bill_tracking" ? "Approved"
                    : lastDecision?.type === "deny_bill_tracking" ? "Denied"
                    : "Closed";
  const closedClass = lastDecision?.type === "approve_bill_tracking" ? styles.statusApproved
                    : lastDecision?.type === "deny_bill_tracking" ? styles.statusDenied
                    : styles.statusClosed;

  async function handleAction(actionType) {
    if (!openWorkflowId) return;
    setError(null);
    setActing(actionType);
    try {
      await addWorkflowAction(openWorkflowId, actionType, token);
      onActionTaken();
    } catch (err) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  }

  const requestorEmails = [...new Set(requests.map((r) => r.requestor_email).filter(Boolean))];

  return (
    <div className={`${styles.requestGroup} ${!isOpen ? styles.requestGroupClosed : ""}`}>
      <div className={styles.requestHeader}>
        <div className={styles.requestMeta}>
          {bill_url ? (
            <a href={bill_url} target="_blank" rel="noreferrer" className={styles.billNumber}>
              {bill_number}
            </a>
          ) : (
            <span className={styles.billNumber}>{bill_number}</span>
          )}
          {bill_short_title && (
            <span className={styles.billTitle}>{bill_short_title}</span>
          )}
          <span className={`${styles.statusBadge} ${isOpen ? styles.statusOpen : closedClass}`}>
            {isOpen ? "Open" : closedLabel}
          </span>
        </div>
        <div className={styles.requestActions}>
          {requestorEmails.length > 0 && (
            <span className={styles.requestorLabel}>
              Requested by: {requestorEmails.join(", ")}
            </span>
          )}
          {canApprove && isOpen && (
            <>
              <button
                className={styles.approveBtn}
                onClick={() => handleAction("approve_bill_tracking")}
                disabled={acting !== null}
              >
                {acting === "approve_bill_tracking" ? "…" : "Approve"}
              </button>
              <button
                className={styles.denyBtn}
                onClick={() => handleAction("deny_bill_tracking")}
                disabled={acting !== null}
              >
                {acting === "deny_bill_tracking" ? "…" : "Deny"}
              </button>
            </>
          )}
          {!isMobile && (
            <button
              className={styles.expandBtn}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide actions ▲" : "Show actions ▼"}
            </button>
          )}
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {expanded && (
        <table className={styles.actionsTable}>
          <thead>
            <tr>
              <th>Action</th>
              <th>User</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {allActions.map((action, i) => (
              <tr key={i}>
                <td>
                  <span className={`${styles.actionBadge} ${actionClass(action.type, styles)}`}>
                    {actionLabel(action.type)}
                  </span>
                </td>
                <td className={styles.actionUser}>{action.actor}</td>
                <td className={styles.actionTimestamp}>{formatTimestamp(action.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

function AssignmentsRowEditor({ value, onChange, canViewAll, canViewSuggestions }) {
  return (
    <AssignmentsFilterBar
      filters={value ?? makeAssignmentNewRowValue()}
      onChange={onChange}
      canViewAll={canViewAll}
      canViewSuggestions={canViewSuggestions}
    />
  );
}

function RequestsRowEditor({ value, onChange, fields, canViewAll }) {
  return (
    <RequestsFilterBar
      filters={value ?? makeRequestNewRowValue()}
      onChange={onChange}
      fields={fields}
      canViewAll={canViewAll}
    />
  );
}

function loadStoredRequestsCriteria() {
  const stored = sessionStorage.getItem(REQUESTS_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (
        parsed &&
        Array.isArray(parsed.criteria) &&
        typeof parsed.expression === "string" &&
        Number.isInteger(parsed.nextLetterIndex)
      ) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  sessionStorage.removeItem(REQUESTS_LEGACY_STORAGE_KEY);
  return makeDefaultRequestsCriteria();
}

export default function Tasks() {
  const { token, username, can } = useAuth();
  const canApprove = can("workflow:approve-tracking");
  const canViewAll = can("workflow:view-all");
  const canManageAssignments = can("workflow:view-all");
  const canViewSuggestions = can("hearing-assignment:view-auto-suggestions");
  const isMobile = useMediaQuery("(max-width: 640px)");

  // ── Hearing Assignment state ──
  const [assignmentCriteria, setAssignmentCriteria] = useState(() =>
    createInitialState({ seedRows: [{ ...ASSIGNMENT_ROW_DEFAULTS }] }),
  );
  const [appliedAssignmentCriteria, setAppliedAssignmentCriteria] = useState(assignmentCriteria);
  const [assignmentCriteriaOpen, setAssignmentCriteriaOpen] = useState(false);
  const [allAssignments, setAllAssignments] = useState(null);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState(null);
  const assignFetchTimerRef = useRef(null);

  // ── Bill Tracking Request state ──
  const [requestsCriteria, setRequestsCriteria] = useState(loadStoredRequestsCriteria);
  const [appliedRequestsCriteria, setAppliedRequestsCriteria] = useState(requestsCriteria);
  // Always collapsed on navigation to keep the page visually quiet; criteria
  // contents are still preserved between visits via REQUESTS_STORAGE_KEY.
  const [reportCriteriaOpen, setReportCriteriaOpen] = useState(false);
  const [allRequests, setAllRequests] = useState(null);
  const [reportFields, setReportFields] = useState(null);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState(null);
  const requestFetchTimerRef = useRef(null);

  const [toast, setToast] = useState(null);

  // ── Load report metadata ──
  useEffect(() => {
    fetchReportMeta(token)
      .then((data) => {
        const meta = data.reports?.find((r) => r.id === "requests");
        setReportFields(meta?.fields ?? null);
      })
      .catch(() => {});
  }, [token]);

  // ── Persist request criteria state ──
  useEffect(() => {
    sessionStorage.setItem(REQUESTS_STORAGE_KEY, JSON.stringify(requestsCriteria));
  }, [requestsCriteria]);

  useEffect(() => {
    sessionStorage.removeItem("requests_reportCriteriaOpen");
  }, []);

  // ── Load hearing assignments ──
  function loadAssignments() {
    clearTimeout(assignFetchTimerRef.current);
    assignFetchTimerRef.current = setTimeout(async () => {
      setAssignmentsLoading(true);
      setAssignmentsError(null);
      try {
        const { ast } = validate(appliedAssignmentCriteria.expression, appliedAssignmentCriteria.criteria);
        const filterGroup = compile(ast, appliedAssignmentCriteria.criteria, (row) =>
          buildAssignmentRowFilterGroup(row.value, { canViewAll: canManageAssignments, username }),
        );
        const data = await fetchReport({
          reportId: "hearing_assignments",
          columns: ASSIGNMENT_COLUMNS,
          filters: filterGroup,
          sortBy: ["sort_priority", "created_at"],
          sortDir: "asc",
          pageSize: 2000,
          token,
        });
        setAllAssignments(data.rows.map(rowToAssignment));
      } catch (e) {
        setAssignmentsError(e.message);
      } finally {
        setAssignmentsLoading(false);
      }
    }, 300);
  }

  useEffect(() => {
    loadAssignments();
    return () => clearTimeout(assignFetchTimerRef.current);
  }, [appliedAssignmentCriteria, token, canManageAssignments, username]);

  // ── Load bill tracking requests ──
  function loadRequests() {
    clearTimeout(requestFetchTimerRef.current);
    requestFetchTimerRef.current = setTimeout(async () => {
      setRequestsLoading(true);
      setRequestsError(null);
      try {
        const { ast } = validate(appliedRequestsCriteria.expression, appliedRequestsCriteria.criteria);
        const filters = compile(ast, appliedRequestsCriteria.criteria, (row) =>
          buildRequestRowFilterGroup(row.value, { canViewAll, username }),
        );
        const data = await fetchReport({
          reportId: "requests",
          columns: REQUEST_COLUMNS,
          filters,
          sortBy: ["created_at"],
          sortDir: "desc",
          pageSize: 2000,
          token,
        });
        setAllRequests(data.rows.map(rowToRequest));
      } catch (e) {
        setRequestsError(e.message);
      } finally {
        setRequestsLoading(false);
      }
    }, 300);
  }

  useEffect(() => {
    loadRequests();
    return () => clearTimeout(requestFetchTimerRef.current);
  }, [appliedRequestsCriteria, token, canViewAll, username]);

  function handleActionTaken() {
    setToast({ message: "Action recorded successfully.", type: "success" });
    loadAssignments();
    loadRequests();
  }

  const canSystemEdit = can("system-report:edit");
  const assignmentSavedReports = useSavedReports({
    registryName: "hearing_assignments",
    currentCriteria: assignmentCriteria,
    onLoad: (criteria) => {
      setAssignmentCriteria(criteria);
      setAppliedAssignmentCriteria(criteria);
    },
    token,
    username,
    canSystemEdit,
  });

  const hadStoredRequestsCriteriaOnMount = useRef(!!sessionStorage.getItem(REQUESTS_STORAGE_KEY));
  const requestSavedReports = useSavedReports({
    registryName: "requests",
    currentCriteria: requestsCriteria,
    onLoad: (criteria) => {
      setRequestsCriteria(criteria);
      setAppliedRequestsCriteria(criteria);
    },
    token,
    username,
    skipDefaultLoad: hadStoredRequestsCriteriaOnMount.current,
    canSystemEdit,
  });

  const assignments = allAssignments ?? [];
  const requests = allRequests ?? [];
  const groups = groupByBill(requests);
  const openAssignmentCount = assignments.filter(
    (a) => !CLOSED_ASSIGNMENT_ACTIONS.has(a.latest_action_type)
  ).length;
  const openRequestCount = requests.filter((r) => r.workflow_status === "open").length;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Tasks</h1>
        <p className={styles.subtitle}>
          {assignmentsLoading || requestsLoading
            ? "Loading…"
            : `${openAssignmentCount} open assignment${openAssignmentCount !== 1 ? "s" : ""} · ${openRequestCount} open request${openRequestCount !== 1 ? "s" : ""}`}
        </p>
      </div>

      <Toast
        message={toast?.message}
        type={toast?.type}
        onDismiss={() => setToast(null)}
      />

      {/* ── Hearing Assignments section ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Hearing Assignments</h2>
        </div>

        {!isMobile && token && (
          <SavedReportsBar
            reports={assignmentSavedReports.reports}
            defaultReportId={assignmentSavedReports.defaultReportId}
            loadedReportId={assignmentSavedReports.loadedReportId}
            includeInactive={assignmentSavedReports.includeInactive}
            onIncludeInactiveChange={assignmentSavedReports.setIncludeInactive}
            onSelectReport={assignmentSavedReports.selectReport}
            error={assignmentSavedReports.error}
          />
        )}

        <div className={styles.additionalFilters}>
          <button className={styles.additionalFiltersHeader} onClick={() => setAssignmentCriteriaOpen((v) => !v)}>
            <span>Report Criteria</span>
            <span className={`${styles.collapseArrow} ${assignmentCriteriaOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
          </button>
          {assignmentCriteriaOpen && (
            <StackingCriteria
              value={assignmentCriteria}
              onChange={setAssignmentCriteria}
              appliedValue={appliedAssignmentCriteria}
              onApply={(_filterGroup, value) => setAppliedAssignmentCriteria(value)}
              RowEditor={AssignmentsRowEditor}
              rowEditorProps={{
                canViewAll: canManageAssignments,
                canViewSuggestions,
              }}
              compileRow={(row) =>
                buildAssignmentRowFilterGroup(row.value, { canViewAll: canManageAssignments, username })
              }
              emptyRowValue={makeAssignmentNewRowValue()}
              summarizeRow={summarizeAssignmentRow}
              mobile={isMobile}
              onSave={isMobile ? undefined : assignmentSavedReports.save}
              onSaveAs={isMobile ? undefined : assignmentSavedReports.openSaveAs}
              saveAvailable={assignmentSavedReports.canSave}
              saveAsAvailable={assignmentSavedReports.canSaveAs}
              canRunQuery={assignmentSavedReports.canRunQuery}
              loadedReportName={isMobile ? null : assignmentSavedReports.loadedReportName}
              isLoadedActive={assignmentSavedReports.isLoadedActive}
              isLoadedDefault={assignmentSavedReports.isLoadedDefault}
              onToggleActive={isMobile ? undefined : assignmentSavedReports.toggleActive}
              onToggleDefault={isMobile ? undefined : assignmentSavedReports.toggleDefault}
              editMode={assignmentSavedReports.editMode}
              editLocked={assignmentSavedReports.editLocked}
              loadedDirty={assignmentSavedReports.loadedDirty}
              onStartEdit={isMobile ? undefined : assignmentSavedReports.startEdit}
              onCancelEdit={isMobile ? undefined : assignmentSavedReports.cancelEdit}
              onNewReport={isMobile ? undefined : assignmentSavedReports.newReport}
              onOpenSettings={isMobile ? undefined : assignmentSavedReports.openSettings}
            />
          )}
        </div>

        {assignmentsLoading && (
          <div className={styles.loadingOverlay}><span className={styles.loadingText}>Loading…</span></div>
        )}
        {assignmentsError && <p className={styles.error}>Error: {assignmentsError}</p>}

        {!assignmentsLoading && !assignmentsError && assignments.length === 0 && (
          <p className={styles.notice}>No hearing assignments found.</p>
        )}

        {!assignmentsLoading && !assignmentsError && assignments.length > 0 && (
          <table className={styles.assignmentTable}>
            <thead>
              <tr>
                <th>Assigned To</th>
                <th>Bill Number</th>
                <th>Status</th>
                {!isMobile && (
                  <>
                    <th>Type</th>
                    <th>Hearing Info</th>
                    <th>Actions to Take</th>
                    <th className={styles.cellHistoryToggle}>Show History</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <AssignmentRow
                  key={a.id}
                  assignment={a}
                  canManage={canManageAssignments}
                  canViewSuggestions={canViewSuggestions}
                  token={token}
                  onActionTaken={handleActionTaken}
                  username={username}
                  isMobile={isMobile}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Bill Tracking Requests section ── */}
      <div className={styles.section} style={{ marginTop: "2.5rem" }}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Bill Tracking Requests</h2>
        </div>

        {!isMobile && token && (
          <SavedReportsBar
            reports={requestSavedReports.reports}
            defaultReportId={requestSavedReports.defaultReportId}
            loadedReportId={requestSavedReports.loadedReportId}
            includeInactive={requestSavedReports.includeInactive}
            onIncludeInactiveChange={requestSavedReports.setIncludeInactive}
            onSelectReport={requestSavedReports.selectReport}
            error={requestSavedReports.error}
          />
        )}

        <div className={styles.additionalFilters}>
          <button
            className={styles.additionalFiltersHeader}
            onClick={() => setReportCriteriaOpen((v) => !v)}
          >
            <span>Report Criteria</span>
            <span className={`${styles.collapseArrow} ${reportCriteriaOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
          </button>
          {reportCriteriaOpen && (
            <StackingCriteria
              value={requestsCriteria}
              onChange={setRequestsCriteria}
              appliedValue={appliedRequestsCriteria}
              onApply={(_filterGroup, value) => setAppliedRequestsCriteria(value)}
              RowEditor={RequestsRowEditor}
              rowEditorProps={{ fields: reportFields, canViewAll }}
              compileRow={(row) =>
                buildRequestRowFilterGroup(row.value, { canViewAll, username })
              }
              emptyRowValue={makeRequestNewRowValue()}
              summarizeRow={(rowValue) => summarizeRequestRow(rowValue, canViewAll)}
              mobile={isMobile}
              onSave={isMobile ? undefined : requestSavedReports.save}
              onSaveAs={isMobile ? undefined : requestSavedReports.openSaveAs}
              saveAvailable={requestSavedReports.canSave}
              saveAsAvailable={requestSavedReports.canSaveAs}
              canRunQuery={requestSavedReports.canRunQuery}
              loadedReportName={isMobile ? null : requestSavedReports.loadedReportName}
              isLoadedActive={requestSavedReports.isLoadedActive}
              isLoadedDefault={requestSavedReports.isLoadedDefault}
              onToggleActive={isMobile ? undefined : requestSavedReports.toggleActive}
              onToggleDefault={isMobile ? undefined : requestSavedReports.toggleDefault}
              editMode={requestSavedReports.editMode}
              editLocked={requestSavedReports.editLocked}
              loadedDirty={requestSavedReports.loadedDirty}
              onStartEdit={isMobile ? undefined : requestSavedReports.startEdit}
              onCancelEdit={isMobile ? undefined : requestSavedReports.cancelEdit}
              onNewReport={isMobile ? undefined : requestSavedReports.newReport}
              onOpenSettings={isMobile ? undefined : requestSavedReports.openSettings}
            />
          )}
        </div>

        {requestsLoading && (
          <div className={styles.loadingOverlay}><span className={styles.loadingText}>Loading…</span></div>
        )}
        {requestsError && <p className={styles.error}>Error: {requestsError}</p>}

        {!requestsLoading && !requestsError && groups.length === 0 && (
          <p className={styles.notice}>No bill tracking requests found.</p>
        )}

        {!requestsLoading && !requestsError && groups.length > 0 && (
          <div className={styles.requestList}>
            {groups.map((group) => (
              <BillRequestGroup
                key={group.bill_id ?? group.requests[0].id}
                group={group}
                canApprove={canApprove}
                token={token}
                onActionTaken={handleActionTaken}
                isMobile={isMobile}
              />
            ))}
          </div>
        )}
      </div>

      <SaveAsModal
        open={assignmentSavedReports.saveAsOpen}
        onClose={assignmentSavedReports.closeSaveAs}
        onSave={assignmentSavedReports.saveAs}
        canCreateSystemReports={assignmentSavedReports.canSystemEdit}
        availableRoles={assignmentSavedReports.availableRoles}
      />
      <SettingsModal
        open={assignmentSavedReports.settingsOpen}
        onClose={assignmentSavedReports.closeSettings}
        onSave={assignmentSavedReports.editSettings}
        initialName={assignmentSavedReports.loadedReport?.display_name ?? ""}
        isSystemLevel={assignmentSavedReports.loadedReport?.publication_level === "system"}
        initialAllowedRoles={assignmentSavedReports.loadedReport?.allowed_roles ?? []}
        canEditRoles={assignmentSavedReports.canSystemEdit}
        availableRoles={assignmentSavedReports.availableRoles}
      />
      <SaveAsModal
        open={requestSavedReports.saveAsOpen}
        onClose={requestSavedReports.closeSaveAs}
        onSave={requestSavedReports.saveAs}
        canCreateSystemReports={requestSavedReports.canSystemEdit}
        availableRoles={requestSavedReports.availableRoles}
      />
      <SettingsModal
        open={requestSavedReports.settingsOpen}
        onClose={requestSavedReports.closeSettings}
        onSave={requestSavedReports.editSettings}
        initialName={requestSavedReports.loadedReport?.display_name ?? ""}
        isSystemLevel={requestSavedReports.loadedReport?.publication_level === "system"}
        initialAllowedRoles={requestSavedReports.loadedReport?.allowed_roles ?? []}
        canEditRoles={requestSavedReports.canSystemEdit}
        availableRoles={requestSavedReports.availableRoles}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { addWorkflowAction } from "../../api/workflows";
import UserCombobox from "../../components/UserCombobox/UserCombobox";
import { fetchReport, fetchReportMeta } from "../../api/reports";
import Toast from "../../components/Toast/Toast";
import RequestsFilterBar from "../../components/RequestsFilterBar/RequestsFilterBar";
import styles from "./Requests.module.css";

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

// ─── Hearing Assignments ───────────────────────────────────────────────────

const ACTIVE_ASSIGNMENT_ACTIONS = new Set([
  "auto_suggested_hearing_assignment",
  "hearing_assigned",
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
    case "reassignment_request":             return "Reassignment Requested";
    case "hearing_assignment_complete":      return "Completed";
    case "hearing_assignment_canceled":      return "Canceled";
    case "hearing_assignment_discarded":     return "Discarded";
    default:                                 return latestActionType ?? "Unknown";
  }
}

function assignmentStatusClass(latestActionType, styles) {
  if (latestActionType === "auto_suggested_hearing_assignment") return styles.statusSuggested;
  if (CLOSED_ASSIGNMENT_ACTIONS.has(latestActionType))          return styles.statusClosed;
  return styles.statusOpen;
}

const ASSIGNMENT_COLUMNS = [
  "id", "workflow_id", "latest_action_type", "assignee_email",
  "hearing_id", "hearing_date", "hearing_time", "hearing_chamber", "committee_name",
  "bill_number", "bill_short_title", "created_at", "actions",
];

function rowToAssignment(row) {
  return {
    id:                 row.id,
    workflow_id:        row.workflow_id,
    latest_action_type: row.latest_action_type ?? null,
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

const ASSIGNMENT_FILTER_DEFAULTS = {
  latest_action_type: [],
  assignee_email: "",
  bill_number: "",
  hearing_date_from: "",
  hearing_date_to: "",
};

function makePresetFilters(preset, username, canViewSuggestions) {
  const openActiveTypes = ["hearing_assigned", "reassignment_request"];
  if (canViewSuggestions) openActiveTypes.push("auto_suggested_hearing_assignment");

  if (preset === "my_open") {
    return { ...ASSIGNMENT_FILTER_DEFAULTS, latest_action_type: ["hearing_assigned", "reassignment_request"], assignee_email: username };
  }
  if (preset === "all_open") {
    return { ...ASSIGNMENT_FILTER_DEFAULTS, latest_action_type: openActiveTypes };
  }
  if (preset === "unassigned") {
    return { ...ASSIGNMENT_FILTER_DEFAULTS, latest_action_type: ["auto_suggested_hearing_assignment", "reassignment_request"] };
  }
  return ASSIGNMENT_FILTER_DEFAULTS;
}

function buildAssignmentFilterGroup(filters, { canViewAll, username }) {
  const conditions = [];

  if (!canViewAll && !filters.assignee_email?.trim()) {
    conditions.push({ field: "assignee_email", op: "equals", value: username });
  } else if (filters.assignee_email?.trim()) {
    conditions.push({ field: "assignee_email", op: "contains", value: filters.assignee_email.trim() });
  }

  if (filters.latest_action_type?.length > 0) {
    conditions.push({ field: "latest_action_type", op: "in", value: filters.latest_action_type });
  }
  if (filters.bill_number?.trim()) {
    conditions.push({ field: "bill_number", op: "contains", value: filters.bill_number.trim() });
  }
  if (filters.hearing_date_from && filters.hearing_date_to) {
    conditions.push({ field: "hearing_date", op: "between", value: [filters.hearing_date_from, filters.hearing_date_to] });
  } else if (filters.hearing_date_from) {
    conditions.push({ field: "hearing_date", op: "after", value: filters.hearing_date_from });
  } else if (filters.hearing_date_to) {
    conditions.push({ field: "hearing_date", op: "before", value: filters.hearing_date_to });
  }

  return { logic: "AND", conditions };
}

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

function HearingAssignmentCard({ assignment, canManage, canViewSuggestions, token, onActionTaken, username }) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(null);
  const [error, setError] = useState(null);
  const [showReassignForm, setShowReassignForm] = useState(false);
  const [reassignEmail, setReassignEmail] = useState("");

  const { latest_action_type, assignee_email, hearing_date, hearing_time, hearing_chamber, committee_name, bill_number } = assignment;
  const chamberLabel = hearing_chamber === "H" ? "House" : hearing_chamber === "S" ? "Senate" : null;
  const hearingName = committee_name || (chamberLabel ? `${chamberLabel} Floor Session` : "Floor Session");
  const isClosed = CLOSED_ASSIGNMENT_ACTIONS.has(latest_action_type);
  const isSuggested = latest_action_type === "auto_suggested_hearing_assignment";
  const isReassignRequest = latest_action_type === "reassignment_request";
  const isAssignee = username === assignee_email;

  async function handleAction(actionType, opts = {}) {
    setError(null);
    setActing(actionType);
    try {
      await addWorkflowAction(assignment.workflow_id, actionType, token, opts);
      setShowReassignForm(false);
      setReassignEmail("");
      onActionTaken();
    } catch (err) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className={`${styles.assignmentCard} ${isClosed ? styles.assignmentCardClosed : ""} ${isSuggested ? styles.assignmentCardSuggested : ""}`}>
      {/* Top: status + email + bill + hearing details */}
      <div className={styles.assignmentTopSection}>
        <span className={`${styles.statusBadge} ${assignmentStatusClass(latest_action_type, styles)}`}>
          {assignmentStatusLabel(latest_action_type)}
        </span>
        <span className={styles.emailBadge}>{assignee_email}</span>
        {bill_number && <span className={styles.billBadge}>{bill_number}</span>}
        {hearing_date && (
          <span className={styles.assignmentHearing}>
            {formatDate(hearing_date)}{hearing_time ? ` · ${formatTime(hearing_time)}` : ""} · {hearingName}
          </span>
        )}
      </div>

      <div className={styles.assignmentDivider} />

      {/* Bottom: action buttons */}
      <div className={styles.assignmentActionsSection}>
        {canManage && isSuggested && (
          <>
            <button className={styles.assignBtn} onClick={() => handleAction("hearing_assigned")} disabled={acting !== null}>
              {acting === "hearing_assigned" ? "…" : "Assign"}
            </button>
            <button className={styles.discardBtn} onClick={() => handleAction("hearing_assignment_discarded")} disabled={acting !== null}>
              {acting === "hearing_assignment_discarded" ? "…" : "Discard"}
            </button>
          </>
        )}
        {canManage && isReassignRequest && !showReassignForm && (
          <>
            <button className={styles.assignBtn} onClick={() => { setReassignEmail(assignee_email ?? ""); setShowReassignForm(true); }} disabled={acting !== null}>
              Reassign
            </button>
            <button className={styles.discardBtn} onClick={() => handleAction("hearing_assignment_canceled")} disabled={acting !== null}>
              {acting === "hearing_assignment_canceled" ? "…" : "Cancel"}
            </button>
          </>
        )}
        {isAssignee && !isClosed && latest_action_type === "hearing_assigned" && (
          <>
            <button className={styles.completeBtn} onClick={() => handleAction("hearing_assignment_complete")} disabled={acting !== null}>
              {acting === "hearing_assignment_complete" ? "…" : "Mark Complete"}
            </button>
            <button className={styles.reassignRequestBtn} onClick={() => handleAction("reassignment_request")} disabled={acting !== null}>
              {acting === "reassignment_request" ? "…" : "Request Reassignment"}
            </button>
          </>
        )}
        <button className={styles.expandBtn} onClick={() => setExpanded((v) => !v)} style={{ marginLeft: "auto" }}>
          {expanded ? "Hide history ▲" : "Show history ▼"}
        </button>
      </div>

      {showReassignForm && (
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
      )}

      {error && <p className={styles.error}>{error}</p>}

      {expanded && (
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
      )}
    </div>
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

const REQUEST_DEFAULT_FILTERS = {
  workflow_status: ["open"],
  outcome: [],
  bill_number: "",
  requestor_email: "",
  bill_is_tracked: null,
  advanced: {
    created_at_from: "",
    created_at_to: "",
    updated_at_from: "",
    updated_at_to: "",
    bill_short_title: "",
    bill_session: [],
    bill_status: "",
  },
};

function buildRequestFilterGroup(filters, { canViewAll, username }) {
  const conditions = [];

  if (!canViewAll) {
    conditions.push({ field: "requestor_email", op: "equals", value: username });
  }
  if (filters.workflow_status?.length > 0) {
    conditions.push({ field: "workflow_status", op: "in", value: filters.workflow_status });
  }
  if (filters.outcome?.length > 0) {
    conditions.push({ field: "latest_action_type", op: "in", value: filters.outcome });
  }
  if (filters.bill_number?.trim()) {
    conditions.push({ field: "bill_number", op: "contains", value: filters.bill_number.trim() });
  }
  if (canViewAll && filters.requestor_email?.trim()) {
    conditions.push({ field: "requestor_email", op: "contains", value: filters.requestor_email.trim() });
  }
  if (filters.bill_is_tracked !== null && filters.bill_is_tracked !== undefined) {
    conditions.push({ field: "bill_is_tracked", op: "equals", value: filters.bill_is_tracked });
  }

  const adv = filters.advanced ?? {};
  if (adv.created_at_from && adv.created_at_to) {
    conditions.push({ field: "created_at", op: "between", value: [adv.created_at_from, adv.created_at_to] });
  } else if (adv.created_at_from) {
    conditions.push({ field: "created_at", op: "after", value: adv.created_at_from });
  } else if (adv.created_at_to) {
    conditions.push({ field: "created_at", op: "before", value: adv.created_at_to });
  }
  if (adv.updated_at_from && adv.updated_at_to) {
    conditions.push({ field: "updated_at", op: "between", value: [adv.updated_at_from, adv.updated_at_to] });
  } else if (adv.updated_at_from) {
    conditions.push({ field: "updated_at", op: "after", value: adv.updated_at_from });
  } else if (adv.updated_at_to) {
    conditions.push({ field: "updated_at", op: "before", value: adv.updated_at_to });
  }
  if (adv.bill_short_title?.trim()) {
    conditions.push({ field: "bill_short_title", op: "contains", value: adv.bill_short_title.trim() });
  }
  if (adv.bill_session?.length > 0) {
    conditions.push({ field: "bill_session", op: "in", value: adv.bill_session.map(Number) });
  }
  if (adv.bill_status?.trim()) {
    conditions.push({ field: "bill_status", op: "contains", value: adv.bill_status.trim() });
  }

  return { logic: "AND", conditions };
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

function BillRequestGroup({ group, canApprove, token, onActionTaken }) {
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
          <span className={`${styles.statusBadge} ${isOpen ? styles.statusOpen : styles.statusClosed}`}>
            {isOpen ? "Open" : "Closed"}
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
          <button
            className={styles.expandBtn}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide actions ▲" : "Show actions ▼"}
          </button>
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

export default function Tasks() {
  const { token, username, can } = useAuth();
  const canApprove = can("workflow:approve-tracking");
  const canViewAll = can("workflow:view-all");
  const canManageAssignments = can("workflow:view-all");
  const canViewSuggestions = can("hearing-assignment:view-auto-suggestions");

  // ── Hearing Assignment state ──
  const [assignmentFilters, setAssignmentFilters] = useState(ASSIGNMENT_FILTER_DEFAULTS);
  const [assignmentCriteriaOpen, setAssignmentCriteriaOpen] = useState(false);
  const [allAssignments, setAllAssignments] = useState(null);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState(null);
  const assignFetchTimerRef = useRef(null);

  // Apply "My Open" preset once username is known
  useEffect(() => {
    if (username) {
      setAssignmentFilters(makePresetFilters("my_open", username, canViewSuggestions));
    }
  }, [username]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bill Tracking Request state ──
  const [requestFilters, setRequestFilters] = useState(() => {
    const stored = sessionStorage.getItem("requests_filters");
    if (stored) { try { return JSON.parse(stored); } catch { /* ignore */ } }
    return REQUEST_DEFAULT_FILTERS;
  });
  const [reportCriteriaOpen, setReportCriteriaOpen] = useState(() =>
    sessionStorage.getItem("requests_reportCriteriaOpen") === "true"
  );
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

  // ── Persist request filter state ──
  useEffect(() => {
    sessionStorage.setItem("requests_filters", JSON.stringify(requestFilters));
  }, [requestFilters]);

  useEffect(() => {
    if (reportCriteriaOpen) sessionStorage.setItem("requests_reportCriteriaOpen", "true");
    else sessionStorage.removeItem("requests_reportCriteriaOpen");
  }, [reportCriteriaOpen]);

  // ── Load hearing assignments ──
  function loadAssignments() {
    clearTimeout(assignFetchTimerRef.current);
    assignFetchTimerRef.current = setTimeout(async () => {
      setAssignmentsLoading(true);
      setAssignmentsError(null);
      try {
        const filterGroup = buildAssignmentFilterGroup(assignmentFilters, {
          canViewAll: canManageAssignments,
          username,
        });
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
  }, [JSON.stringify(assignmentFilters), token, canManageAssignments, username]);

  // ── Load bill tracking requests ──
  function loadRequests() {
    clearTimeout(requestFetchTimerRef.current);
    requestFetchTimerRef.current = setTimeout(async () => {
      setRequestsLoading(true);
      setRequestsError(null);
      try {
        const filters = buildRequestFilterGroup(requestFilters, { canViewAll, username });
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
  }, [JSON.stringify(requestFilters), token, canViewAll, username]);

  function handleActionTaken() {
    setToast({ message: "Action recorded successfully.", type: "success" });
    loadAssignments();
    loadRequests();
  }

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
          <div className={styles.quickButtons}>
            <button className={styles.quickBtn}
              onClick={() => setAssignmentFilters(makePresetFilters("my_open", username, canViewSuggestions))}>
              My Open Assignments
            </button>
            <button className={styles.quickBtn}
              onClick={() => setAssignmentFilters(makePresetFilters("all_open", username, canViewSuggestions))}>
              All Open Assignments
            </button>
            {canViewSuggestions && (
              <button className={styles.quickBtn}
                onClick={() => setAssignmentFilters(makePresetFilters("unassigned", username, canViewSuggestions))}>
                Unassigned Assignments
              </button>
            )}
          </div>
        </div>

        <div className={styles.additionalFilters}>
          <button className={styles.additionalFiltersHeader} onClick={() => setAssignmentCriteriaOpen((v) => !v)}>
            <span>Report Criteria</span>
            <span className={`${styles.collapseArrow} ${assignmentCriteriaOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
          </button>
          {assignmentCriteriaOpen && (
            <AssignmentsFilterBar
              filters={assignmentFilters}
              onChange={setAssignmentFilters}
              canViewAll={canManageAssignments}
              canViewSuggestions={canViewSuggestions}
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
          <div className={styles.assignmentList}>
            {assignments.map((a) => (
              <HearingAssignmentCard
                key={a.id}
                assignment={a}
                canManage={canManageAssignments}
                canViewSuggestions={canViewSuggestions}
                token={token}
                onActionTaken={handleActionTaken}
                username={username}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Bill Tracking Requests section ── */}
      <div className={styles.section} style={{ marginTop: "2.5rem" }}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Bill Tracking Requests</h2>
        </div>

        <div className={styles.additionalFilters}>
          <button
            className={styles.additionalFiltersHeader}
            onClick={() => setReportCriteriaOpen((v) => !v)}
          >
            <span>Report Criteria</span>
            <span className={`${styles.collapseArrow} ${reportCriteriaOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
          </button>
          {reportCriteriaOpen && (
            <RequestsFilterBar
              filters={requestFilters}
              onChange={setRequestFilters}
              fields={reportFields}
              canViewAll={canViewAll}
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

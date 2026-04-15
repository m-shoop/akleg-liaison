import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { fetchWorkflows, addWorkflowAction } from "../../api/workflows";
import Toast from "../../components/Toast/Toast";
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

function actionLabel(type) {
  switch (type) {
    case "request_bill_tracking": return "Requested tracking";
    case "approve_bill_tracking": return "Approved";
    case "deny_bill_tracking": return "Denied";
    default: return type;
  }
}

function actionClass(type, styles) {
  switch (type) {
    case "approve_bill_tracking": return styles.actionApproved;
    case "deny_bill_tracking": return styles.actionDenied;
    default: return styles.actionRequested;
  }
}

/**
 * Groups workflows by bill_id.
 * Returns a list of { bill, workflows } objects sorted by bill_number.
 */
function groupByBill(workflows) {
  const map = new Map();
  for (const wf of workflows) {
    const key = wf.bill?.id ?? `no-bill-${wf.id}`;
    if (!map.has(key)) {
      map.set(key, { bill: wf.bill, workflows: [] });
    }
    map.get(key).workflows.push(wf);
  }
  return [...map.values()].sort((a, b) => {
    const na = a.bill?.bill_number ?? "";
    const nb = b.bill?.bill_number ?? "";
    return na.localeCompare(nb);
  });
}

function BillRequestGroup({ group, canApprove, token, onActionTaken }) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(null);
  const [error, setError] = useState(null);

  const { bill, workflows } = group;

  // Collect all actions across all workflows in this group, deduplicating
  // approve/deny actions (same type + user combo shown once)
  const allActions = [];
  const seen = new Set();
  for (const wf of workflows) {
    for (const action of wf.actions) {
      if (
        action.type === "approve_bill_tracking" ||
        action.type === "deny_bill_tracking"
      ) {
        const key = `${action.type}:${action.user_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      allActions.push(action);
    }
  }
  allActions.sort(
    (a, b) => new Date(a.action_timestamp) - new Date(b.action_timestamp)
  );

  const isOpen = workflows.some((wf) => wf.status === "open");
  const openWorkflowId = workflows.find((wf) => wf.status === "open")?.id;

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

  const requestors = [
    ...new Map(
      workflows.map((wf) => [wf.created_by, wf.created_by_username])
    ).values(),
  ];

  return (
    <div className={`${styles.requestGroup} ${!isOpen ? styles.requestGroupClosed : ""}`}>
      <div className={styles.requestHeader}>
        <div className={styles.requestMeta}>
          <span className={styles.billNumber}>{bill?.bill_number ?? "Unknown"}</span>
          {bill?.short_title && (
            <span className={styles.billTitle}>{bill.short_title}</span>
          )}
          <span className={`${styles.statusBadge} ${isOpen ? styles.statusOpen : styles.statusClosed}`}>
            {isOpen ? "Open" : "Closed"}
          </span>
        </div>
        <div className={styles.requestActions}>
          {requestors.length > 0 && (
            <span className={styles.requestorLabel}>
              Requested by: {requestors.join(", ")}
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
            {allActions.map((action) => (
              <tr key={action.id}>
                <td>
                  <span className={`${styles.actionBadge} ${actionClass(action.type, styles)}`}>
                    {actionLabel(action.type)}
                  </span>
                </td>
                <td className={styles.actionUser}>{action.username}</td>
                <td className={styles.actionTimestamp}>
                  {formatTimestamp(action.action_timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Requests() {
  const { token, can } = useAuth();
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [toast, setToast] = useState(null);

  const canApprove = can("workflow:approve-tracking");

  async function loadWorkflows() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkflows({ token, includeClosed });
      setWorkflows(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkflows();
  }, [includeClosed, token]);

  function handleActionTaken() {
    setToast({ message: "Action recorded successfully.", type: "success" });
    loadWorkflows();
  }

  const groups = groupByBill(workflows);
  const openCount = workflows.filter((wf) => wf.status === "open").length;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Requests</h1>
        <p className={styles.subtitle}>
          {loading
            ? "Loading…"
            : `${openCount} open request${openCount !== 1 ? "s" : ""}`}
        </p>
      </div>

      <Toast
        message={toast?.message}
        type={toast?.type}
        onDismiss={() => setToast(null)}
      />

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Bill Tracking Requests</h2>
          {!closedLoaded && (
            <button
              className={styles.toggleClosedBtn}
              onClick={() => { setIncludeClosed(true); setClosedLoaded(true); }}
            >
              Show Closed Requests
            </button>
          )}
        </div>

        {loading && <p className={styles.notice}>Loading requests…</p>}
        {error && <p className={styles.error}>Error: {error}</p>}

        {!loading && !error && groups.length === 0 && (
          <p className={styles.notice}>
            {closedLoaded ? "No bill tracking requests found." : "No open bill tracking requests."}
          </p>
        )}

        {!loading && !error && groups.length > 0 && (
          <div className={styles.requestList}>
            {groups.map((group) => (
              <BillRequestGroup
                key={group.bill?.id ?? group.workflows[0].id}
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

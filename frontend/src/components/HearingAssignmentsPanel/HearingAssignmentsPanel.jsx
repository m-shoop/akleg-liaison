import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { addWorkflowAction, createHearingAssignment } from "../../api/workflows";
import UserCombobox from "../UserCombobox/UserCombobox";
import styles from "./HearingAssignmentsPanel.module.css";

function fmtDate(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

const ACTIVE_ASSIGNMENT_TYPES = new Set([
  "hearing_assigned",
  "hearing_assignment_complete",
  "reassignment_request",
  "auto_suggested_hearing_assignment",
]);

// Confirmed open or completed — suggestions don't count
const OPEN_OR_COMPLETE_TYPES = new Set([
  "hearing_assigned",
  "hearing_assignment_complete",
  "reassignment_request",
]);

export default function HearingAssignmentsPanel({ hearing, onAssignmentCreated }) {
  const { can, token, username } = useAuth();

  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ assigneeEmail: "", billNumber: "" });
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [createAssignmentError, setCreateAssignmentError] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [assignmentActing, setAssignmentActing] = useState(null);
  const [assignmentActionError, setAssignmentActionError] = useState(null);
  const [reassignEmail, setReassignEmail] = useState("");

  const canViewSuggestions = can("hearing-assignment:view-auto-suggestions");
  const canCreate = can("workflow:view-all");

  const visible = (hearing.hearing_assignments_summary ?? []).filter(
    (a) =>
      ACTIVE_ASSIGNMENT_TYPES.has(a.latest_action_type) &&
      (a.latest_action_type !== "auto_suggested_hearing_assignment" || canViewSuggestions)
  );

  const assignedBillNumbers = new Set(
    (hearing.hearing_assignments_summary ?? [])
      .filter((a) => OPEN_OR_COMPLETE_TYPES.has(a.latest_action_type) && a.bill_number)
      .map((a) => a.bill_number)
  );

  const trackedWithoutAssignment = (hearing.agenda_items ?? [])
    .filter((item) => item.is_bill && item.bill_is_tracked && !assignedBillNumbers.has(item.bill_number))
    .map((item) => item.bill_number)
    .filter(Boolean);

  async function handleCreateAssignment() {
    setCreatingAssignment(true);
    setCreateAssignmentError(null);
    try {
      await createHearingAssignment({
        hearingId: hearing.id,
        assigneeEmail: assignmentForm.assigneeEmail.trim(),
        billNumber: assignmentForm.billNumber.trim() || null,
        token,
      });
      setShowCreateAssignment(false);
      setAssignmentForm({ assigneeEmail: "", billNumber: "" });
      onAssignmentCreated?.();
    } catch (err) {
      setCreateAssignmentError(err.message);
    } finally {
      setCreatingAssignment(false);
    }
  }

  async function handleAssignmentAction(actionType, opts = {}) {
    if (!selectedAssignment) return;
    setAssignmentActionError(null);
    setAssignmentActing(actionType);
    try {
      await addWorkflowAction(selectedAssignment.workflow_id, actionType, token, opts);
      setSelectedAssignment(null);
      setReassignEmail("");
      onAssignmentCreated?.();
    } catch (err) {
      setAssignmentActionError(err.message);
    } finally {
      setAssignmentActing(null);
    }
  }

  const hearingInfo = `${fmtDate(hearing.hearing_date)}${hearing.hearing_time ? ` · ${fmtTime(hearing.hearing_time)}` : ""}${hearing.committee_name ? ` · ${hearing.committee_name}` : " · Floor Session"}`;

  return (
    <>
      <div className={styles.labelRow}>
        <span className={styles.label}>Assignments</span>
        {canCreate && (
          <button
            className={styles.createBtn}
            onClick={() => { setCreateAssignmentError(null); setShowCreateAssignment(true); }}
          >
            + Create Assignment
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>No current assignments</p>
      ) : (
        <ul className={styles.list}>
          {visible.map((a) => (
            <li key={a.id} className={styles.item}>
              <button
                className={styles.itemBtn}
                onClick={() => { setAssignmentActionError(null); setSelectedAssignment(a); }}
              >
                <span className={styles.itemBadges}>
                  <span className={styles.emailBadge}>{a.assignee_email}</span>
                  {a.bill_number && <span className={styles.billBadge}>{a.bill_number}</span>}
                </span>
                {a.latest_action_type === "auto_suggested_hearing_assignment" && (
                  <span className={styles.suggestedTag}>suggested</span>
                )}
                {a.latest_action_type === "hearing_assignment_complete" && (
                  <span className={styles.completeTag}>complete</span>
                )}
                {a.latest_action_type === "reassignment_request" && (
                  <span className={styles.reassignTag}>reassign requested</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {trackedWithoutAssignment.length > 0 && (
        <p className={styles.trackedBillWarning}>
          {trackedWithoutAssignment.length === 1
            ? `Tracked bill ${trackedWithoutAssignment[0]} has no open nor completed assignment.`
            : `Tracked bills ${trackedWithoutAssignment.join(", ")} have no open nor completed assignment.`}
        </p>
      )}

      {showCreateAssignment && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateAssignment(false)}>
          <div className={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Create Assignment</h3>
            <p className={styles.modalHearingInfo}>{hearingInfo}</p>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Assignee email *</label>
              <UserCombobox
                value={assignmentForm.assigneeEmail}
                onChange={(email) => setAssignmentForm((f) => ({ ...f, assigneeEmail: email }))}
                token={token}
                placeholder="staff@dps.alaska.gov"
                autoFocus
              />
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>
                Bill <span className={styles.modalOptional}>(optional)</span>
              </label>
              <select
                className={styles.modalSelect}
                value={assignmentForm.billNumber}
                onChange={(e) => setAssignmentForm((f) => ({ ...f, billNumber: e.target.value }))}
              >
                <option value="">— General assignment (no specific bill) —</option>
                {hearing.agenda_items
                  .filter((item) => item.is_bill && item.bill_number)
                  .map((item) => (
                    <option key={item.id} value={item.bill_number}>
                      {item.bill_number}{item.content ? ` — ${item.content}` : ""}
                    </option>
                  ))}
              </select>
            </div>
            {createAssignmentError && (
              <p className={styles.modalError}>{createAssignmentError}</p>
            )}
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setShowCreateAssignment(false)}
                disabled={creatingAssignment}
              >
                Cancel
              </button>
              <button
                className={styles.modalSubmitBtn}
                onClick={handleCreateAssignment}
                disabled={!assignmentForm.assigneeEmail.trim() || creatingAssignment}
              >
                {creatingAssignment ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAssignment && (() => {
        const a = selectedAssignment;
        const isAssignee = username === a.assignee_email;
        const canManage = can("workflow:view-all");
        const isSuggested = a.latest_action_type === "auto_suggested_hearing_assignment";
        const isReassignRequest = a.latest_action_type === "reassignment_request";
        const isAssigned = a.latest_action_type === "hearing_assigned";
        return (
          <div className={styles.modalOverlay} onClick={() => { setSelectedAssignment(null); setReassignEmail(""); }}>
            <div className={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Assignment</h3>
              <p className={styles.modalHearingInfo}>{hearingInfo}</p>
              <p className={styles.modalHearingInfo}>
                {a.bill_number ? `${a.bill_number} · ` : ""}{a.assignee_email}
              </p>
              {canManage && isReassignRequest && (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>New assignee</label>
                  <UserCombobox
                    value={reassignEmail}
                    onChange={setReassignEmail}
                    token={token}
                    placeholder="New assignee email…"
                    autoFocus
                  />
                </div>
              )}
              {assignmentActionError && (
                <p className={styles.modalError}>{assignmentActionError}</p>
              )}
              <div className={styles.modalActions}>
                <button
                  className={styles.modalCancelBtn}
                  onClick={() => { setSelectedAssignment(null); setReassignEmail(""); }}
                  disabled={assignmentActing !== null}
                >
                  Close
                </button>
                {canManage && isSuggested && (
                  <>
                    <button
                      className={styles.modalSubmitBtn}
                      onClick={() => handleAssignmentAction("hearing_assigned")}
                      disabled={assignmentActing !== null}
                    >
                      {assignmentActing === "hearing_assigned" ? "…" : "Confirm Assign"}
                    </button>
                    <button
                      className={styles.modalDangerBtn}
                      onClick={() => handleAssignmentAction("hearing_assignment_discarded")}
                      disabled={assignmentActing !== null}
                    >
                      {assignmentActing === "hearing_assignment_discarded" ? "…" : "Discard"}
                    </button>
                  </>
                )}
                {canManage && isReassignRequest && (
                  <>
                    <button
                      className={styles.modalSubmitBtn}
                      onClick={() => handleAssignmentAction("hearing_assigned", { newAssigneeEmail: reassignEmail.trim() })}
                      disabled={!reassignEmail.trim() || assignmentActing !== null}
                    >
                      {assignmentActing === "hearing_assigned" ? "…" : "Confirm Reassign"}
                    </button>
                    <button
                      className={styles.modalDangerBtn}
                      onClick={() => handleAssignmentAction("hearing_assignment_canceled")}
                      disabled={assignmentActing !== null}
                    >
                      {assignmentActing === "hearing_assignment_canceled" ? "…" : "Cancel Assignment"}
                    </button>
                  </>
                )}
                {isAssignee && isAssigned && (
                  <>
                    <button
                      className={styles.modalSubmitBtn}
                      onClick={() => handleAssignmentAction("hearing_assignment_complete")}
                      disabled={assignmentActing !== null}
                    >
                      {assignmentActing === "hearing_assignment_complete" ? "…" : "Mark Complete"}
                    </button>
                    <button
                      className={styles.modalSecondaryBtn}
                      onClick={() => handleAssignmentAction("reassignment_request")}
                      disabled={assignmentActing !== null}
                    >
                      {assignmentActing === "reassignment_request" ? "…" : "Request Reassignment"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

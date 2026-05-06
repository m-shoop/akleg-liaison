import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { addWorkflowAction, createHearingAssignment, updateHearingAssignmentCallIn, updateHearingAssignmentType } from "../../api/workflows";
import { useAssigneeOptedOut, OPT_OUT_WARNING } from "../../hooks/useAssigneeOptedOut";
import { useAssignees } from "../../hooks/useAssignees";
import UserSelect from "../UserSelect/UserSelect";
import CallInInfo from "../CallInInfo/CallInInfo";
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

function assignmentTypeLabel(t) {
  return t === "awareness" ? "Awareness" : "Monitoring";
}

// bootstrap-icons "telephone-fill" path; fill via CSS `currentColor`.
function PhoneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.066-2.877.704-2.65-.931-5.055-2.45-7.27-4.665C4.328 9.946 2.808 7.542 1.876 4.892c-.36-1.031-.034-2.137.706-2.877z"/>
    </svg>
  );
}

const ACTIVE_ASSIGNMENT_TYPES = new Set([
  "hearing_assigned",
  "hearing_reassigned",
  "hearing_assignment_complete",
  "reassignment_request",
  "auto_suggested_hearing_assignment",
]);

// Confirmed open or completed — suggestions don't count
const OPEN_OR_COMPLETE_TYPES = new Set([
  "hearing_assigned",
  "hearing_reassigned",
  "hearing_assignment_complete",
  "reassignment_request",
]);

export default function HearingAssignmentsPanel({ hearing, onAssignmentCreated, showCanceled = false }) {
  const { can, token, username } = useAuth();

  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({
    assigneeEmail: "",
    billNumber: "",
    assignmentType: "monitoring",
  });
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [createAssignmentError, setCreateAssignmentError] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [assignmentActing, setAssignmentActing] = useState(null);
  const [assignmentActionError, setAssignmentActionError] = useState(null);
  const [reassignEmail, setReassignEmail] = useState("");
  const [showCancelReason, setShowCancelReason] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [showReassignReasonForm, setShowReassignReasonForm] = useState(false);
  const [reassignmentReason, setReassignmentReason] = useState("");
  const [updatingType, setUpdatingType] = useState(false);

  const canViewSuggestions = can("hearing-assignment:view-auto-suggestions");
  const canCreate = can("workflow:view-all");
  const canManage = can("workflow:view-all");
  const [callInBusyId, setCallInBusyId] = useState(null);

  async function handleToggleCallIn(assignment, e) {
    e.stopPropagation();
    setCallInBusyId(assignment.id);
    try {
      await updateHearingAssignmentCallIn({
        assignmentId: assignment.id,
        callIn: !assignment.call_in,
        token,
      });
      onAssignmentCreated?.();
    } finally {
      setCallInBusyId(null);
    }
  }

  const needsAssigneeList =
    showCreateAssignment ||
    selectedAssignment?.latest_action_type === "reassignment_request";
  const allAssignees = useAssignees(needsAssigneeList, token);

  const createAssigneeOptedOut = useAssigneeOptedOut(
    showCreateAssignment ? assignmentForm.assigneeEmail : "",
    token,
  );
  const isSuggestedSelected =
    selectedAssignment?.latest_action_type === "auto_suggested_hearing_assignment";
  const isReassignSelected =
    selectedAssignment?.latest_action_type === "reassignment_request";
  const suggestedAssigneeOptedOut = useAssigneeOptedOut(
    isSuggestedSelected && !showCancelReason ? selectedAssignment?.assignee_email ?? "" : "",
    token,
  );
  const reassignAssigneeOptedOut = useAssigneeOptedOut(
    isReassignSelected && !showCancelReason ? reassignEmail : "",
    token,
  );

  const visible = (hearing.hearing_assignments_summary ?? []).filter((a) => {
    if (a.latest_action_type === "hearing_assignment_canceled") return showCanceled;
    if (!ACTIVE_ASSIGNMENT_TYPES.has(a.latest_action_type)) return false;
    if (a.latest_action_type === "auto_suggested_hearing_assignment") return canViewSuggestions;
    return true;
  });

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
        assignmentType: assignmentForm.assignmentType,
        token,
      });
      setShowCreateAssignment(false);
      setAssignmentForm({ assigneeEmail: "", billNumber: "", assignmentType: "monitoring" });
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
      setShowCancelReason(false);
      setCancellationReason("");
      setShowReassignReasonForm(false);
      setReassignmentReason("");
      onAssignmentCreated?.();
    } catch (err) {
      setAssignmentActionError(err.message);
    } finally {
      setAssignmentActing(null);
    }
  }

  async function handleAssignmentTypeChange(newType) {
    if (!selectedAssignment || newType === selectedAssignment.assignment_type) return;
    setAssignmentActionError(null);
    setUpdatingType(true);
    try {
      await updateHearingAssignmentType({
        assignmentId: selectedAssignment.id,
        assignmentType: newType,
        token,
      });
      setSelectedAssignment({ ...selectedAssignment, assignment_type: newType });
      onAssignmentCreated?.();
    } catch (err) {
      setAssignmentActionError(err.message);
    } finally {
      setUpdatingType(false);
    }
  }

  function startCancelFlow() {
    // Auto-fill the reason when the linked hearing is no longer on the calendar.
    setCancellationReason(hearing.is_active === false ? "Hearing no longer on calendar" : "");
    setShowCancelReason(true);
  }

  function closeAssignmentModal() {
    setSelectedAssignment(null);
    setReassignEmail("");
    setShowCancelReason(false);
    setCancellationReason("");
    setShowReassignReasonForm(false);
    setReassignmentReason("");
  }

  const chamberPrefix = hearing.chamber ? `(${hearing.chamber}) ` : "";
  const hearingName = `${chamberPrefix}${hearing.committee_name || "Floor Session"}`;
  const hearingInfo = `${fmtDate(hearing.hearing_date)}${hearing.hearing_time ? ` · ${fmtTime(hearing.hearing_time)}` : ""} · ${hearingName}`;

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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Assigned To</th>
              <th>Bill Number</th>
              <th>Type</th>
              <th className={styles.cellCallIn}>Call In</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const statusLabel = {
                hearing_assigned: "Open",
                hearing_reassigned: "Open",
                hearing_assignment_complete: "Complete",
                reassignment_request: "Reassign requested",
                auto_suggested_hearing_assignment: "Suggested",
                hearing_assignment_canceled: "Canceled",
              }[a.latest_action_type];
              const statusClass = {
                hearing_assigned: styles.openTag,
                hearing_reassigned: styles.openTag,
                hearing_assignment_complete: styles.completeTag,
                reassignment_request: styles.reassignTag,
                auto_suggested_hearing_assignment: styles.suggestedTag,
                hearing_assignment_canceled: styles.canceledTag,
              }[a.latest_action_type];
              const isCanceled = a.latest_action_type === "hearing_assignment_canceled";
              const openAssignment = () => { setAssignmentActionError(null); setSelectedAssignment(a); };
              return (
                <tr
                  key={a.id}
                  className={`${styles.row} ${isCanceled ? styles.rowCanceled : ""}`}
                  onClick={openAssignment}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openAssignment();
                    }
                  }}
                >
                  <td className={styles.cellEmail} title={a.assignee_email}>{a.assignee_name || a.assignee_email}</td>
                  <td className={styles.cellBill}>{a.bill_number || ""}</td>
                  <td className={styles.cellType}>{assignmentTypeLabel(a.assignment_type)}</td>
                  <td className={styles.cellCallIn}>
                    {canManage ? (
                      <button
                        type="button"
                        className={`${styles.callInBtn} ${a.call_in ? "" : styles.callInOff}`}
                        onClick={(e) => handleToggleCallIn(a, e)}
                        disabled={callInBusyId === a.id}
                        title={
                          a.call_in
                            ? "Call into this hearing with the call-in information below"
                            : "Click to instruct this user to call into the hearing"
                        }
                        aria-label={a.call_in ? "Call-in required" : "Call-in not required (click to require)"}
                      >
                        <PhoneIcon />
                      </button>
                    ) : a.call_in ? (
                      <span
                        className={styles.callInIcon}
                        title="Call into this hearing with the call-in information below"
                        aria-label="Call-in required"
                      >
                        <PhoneIcon />
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusClass}>{statusLabel}</span>
                    {a.latest_action_type === "reassignment_request" && a.latest_reassignment_reason && (
                      <div className={styles.reassignReason} title={a.latest_reassignment_reason}>
                        {a.latest_reassignment_reason}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {trackedWithoutAssignment.length > 0 && (
        <p className={styles.trackedBillWarning}>
          {trackedWithoutAssignment.length === 1
            ? `Tracked bill ${trackedWithoutAssignment[0]} has no open nor completed assignment.`
            : `Tracked bills ${trackedWithoutAssignment.join(", ")} have no open nor completed assignment.`}
        </p>
      )}

      {showCreateAssignment && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateAssignment(false); }}
        >
          <div className={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Create Assignment</h3>
            <p className={styles.modalHearingInfo}>{hearingInfo}</p>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Assignee *</label>
              <UserSelect
                users={allAssignees}
                value={assignmentForm.assigneeEmail}
                onChange={(email) => setAssignmentForm((f) => ({ ...f, assigneeEmail: email }))}
                className={styles.modalSelect}
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
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Type</label>
              <select
                className={styles.modalSelect}
                value={assignmentForm.assignmentType}
                onChange={(e) => setAssignmentForm((f) => ({ ...f, assignmentType: e.target.value }))}
              >
                <option value="monitoring">Monitoring Reports</option>
                <option value="awareness">Awareness</option>
              </select>
            </div>
            {createAssigneeOptedOut && (
              <p className={styles.optOutWarning}>{OPT_OUT_WARNING}</p>
            )}
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
        const isAssigned =
          a.latest_action_type === "hearing_assigned" ||
          a.latest_action_type === "hearing_reassigned";
        const cancelOpts = { cancellationReason: cancellationReason.trim() || null };
        return (
          <div
            className={styles.modalOverlay}
            onClick={(e) => { if (e.target === e.currentTarget) closeAssignmentModal(); }}
          >
            <div className={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Assignment</h3>
              <p className={styles.modalHearingInfo}>{hearingInfo}</p>
              <p className={styles.modalHearingInfo}>
                {a.bill_number ? `${a.bill_number} · ` : ""}{a.assignee_name || a.assignee_email}
                {a.assignee_name && (
                  <span className={styles.modalReadOnly}> ({a.assignee_email})</span>
                )}
                {a.call_in && (
                  <span
                    className={styles.modalCallInIndicator}
                    title="Call into this hearing with the call-in information below"
                    aria-label="Call-in required"
                  >
                    <PhoneIcon />
                  </span>
                )}
              </p>
              {canManage && (isSuggested || isAssigned || isReassignRequest) && !showCancelReason ? (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Type</label>
                  <select
                    className={styles.modalSelect}
                    value={a.assignment_type ?? "monitoring"}
                    onChange={(e) => handleAssignmentTypeChange(e.target.value)}
                    disabled={updatingType || assignmentActing !== null}
                  >
                    <option value="monitoring">Monitoring Reports</option>
                    <option value="awareness">Awareness</option>
                  </select>
                  {!isSuggested && (
                    <p className={styles.modalHint}>
                      Changing the type will email the assignee.
                    </p>
                  )}
                </div>
              ) : (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Type</label>
                  <p className={styles.modalReadOnly}>{assignmentTypeLabel(a.assignment_type)}</p>
                </div>
              )}
              {canManage && isReassignRequest && !showCancelReason && (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>New assignee</label>
                  <UserSelect
                    users={allAssignees}
                    value={reassignEmail}
                    onChange={setReassignEmail}
                    className={styles.modalSelect}
                    autoFocus
                  />
                </div>
              )}
              {showCancelReason && (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Cancellation Reason</label>
                  <textarea
                    className={styles.modalSelect}
                    rows={3}
                    value={cancellationReason}
                    onChange={(e) => setCancellationReason(e.target.value)}
                    placeholder="Why is this assignment being canceled?"
                    autoFocus
                  />
                </div>
              )}
              {showReassignReasonForm && (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Reassignment Reason</label>
                  <textarea
                    className={styles.modalSelect}
                    rows={3}
                    value={reassignmentReason}
                    onChange={(e) => setReassignmentReason(e.target.value)}
                    placeholder="Why are you requesting reassignment?"
                    autoFocus
                  />
                </div>
              )}
              {!showCancelReason && !showReassignReasonForm
                && a.latest_action_type === "reassignment_request"
                && a.latest_reassignment_reason && (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Reassignment Reason</label>
                  <p className={styles.modalReadOnly}>{a.latest_reassignment_reason}</p>
                </div>
              )}
              {(suggestedAssigneeOptedOut || reassignAssigneeOptedOut) && (
                <p className={styles.optOutWarning}>{OPT_OUT_WARNING}</p>
              )}
              {(hearing.hearing_assignments_summary ?? []).some((x) => x.call_in) && (
                <div className={styles.modalField}>
                  <CallInInfo />
                </div>
              )}
              {assignmentActionError && (
                <p className={styles.modalError}>{assignmentActionError}</p>
              )}
              <div className={styles.modalActions}>
                <button
                  className={styles.modalCancelBtn}
                  onClick={closeAssignmentModal}
                  disabled={assignmentActing !== null}
                >
                  Close
                </button>
                {canManage && isSuggested && !showCancelReason && (
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
                {canManage && isReassignRequest && !showCancelReason && (
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
                      onClick={startCancelFlow}
                      disabled={assignmentActing !== null}
                    >
                      Cancel Assignment
                    </button>
                  </>
                )}
                {canManage && isAssigned && !showCancelReason && (
                  <button
                    className={styles.modalDangerBtn}
                    onClick={startCancelFlow}
                    disabled={assignmentActing !== null}
                  >
                    Cancel Assignment
                  </button>
                )}
                {showCancelReason && (
                  <button
                    className={styles.modalDangerBtn}
                    onClick={() => handleAssignmentAction("hearing_assignment_canceled", cancelOpts)}
                    disabled={assignmentActing !== null}
                  >
                    {assignmentActing === "hearing_assignment_canceled" ? "…" : "Confirm Cancel"}
                  </button>
                )}
                {showReassignReasonForm && (
                  <button
                    className={styles.modalSubmitBtn}
                    onClick={() => handleAssignmentAction("reassignment_request", {
                      reassignmentReason: reassignmentReason.trim() || null,
                    })}
                    disabled={assignmentActing !== null}
                  >
                    {assignmentActing === "reassignment_request" ? "…" : "Confirm Request"}
                  </button>
                )}
                {(isAssignee || canManage) && isAssigned && !showCancelReason && !showReassignReasonForm && (
                  <button
                    className={styles.modalSubmitBtn}
                    onClick={() => handleAssignmentAction("hearing_assignment_complete")}
                    disabled={assignmentActing !== null}
                  >
                    {assignmentActing === "hearing_assignment_complete" ? "…" : "Mark Complete"}
                  </button>
                )}
                {isAssignee && isAssigned && !showCancelReason && !showReassignReasonForm && (
                  <button
                    className={styles.modalSecondaryBtn}
                    onClick={() => setShowReassignReasonForm(true)}
                    disabled={assignmentActing !== null}
                  >
                    Request Reassignment
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

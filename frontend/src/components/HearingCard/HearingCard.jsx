import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { updateDpsNotes, updateHidden } from "../../api/hearings";
import { addWorkflowAction, createHearingAssignment } from "../../api/workflows";
import UserCombobox from "../UserCombobox/UserCombobox";
import { exportToCalendar } from "../../utils/hearingCalendar";
import PriorAgendasModal from "../PriorAgendasModal/PriorAgendasModal";
import styles from "./HearingCard.module.css";

function fmt(isoDate) {
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

function assignmentDisplayLabel(a) {
  const bill = a.bill_number ? `${a.bill_number}` : "general";
  return `${a.assignee_email} assigned to monitor ${bill}`;
}

export default function HearingCard({ hearing, isFirst, globalExpanded, showHidden, onNotesSaved, onHiddenChanged, onAssignmentCreated }) {
  const { can, token, username } = useAuth();
  const [notes, setNotes] = useState(hearing.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hidingBusy, setHidingBusy] = useState(false);
  const [expanded, setExpanded] = useState(globalExpanded);
  const [showPriorAgendas, setShowPriorAgendas] = useState(false);
  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ assigneeEmail: "", billNumber: "" });
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [createAssignmentError, setCreateAssignmentError] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [assignmentActing, setAssignmentActing] = useState(null);
  const [assignmentActionError, setAssignmentActionError] = useState(null);
  const [reassignEmail, setReassignEmail] = useState("");

  const isFloor = !hearing.committee_name;

  useEffect(() => {
    setExpanded(globalExpanded);
  }, [globalExpanded]);

  useEffect(() => {
    if (!dirty) setNotes(hearing.dps_notes ?? "");
  }, [hearing.dps_notes]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateDpsNotes(hearing.id, notes || null, token);
      setDirty(false);
      onNotesSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleHidden() {
    setHidingBusy(true);
    try {
      const updated = await updateHidden(hearing.id, !hearing.hidden, token);
      onHiddenChanged(updated);
    } finally {
      setHidingBusy(false);
    }
  }

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

  const chamberLabel = hearing.chamber === "H" ? "House" : "Senate";
  const inactive = !hearing.is_active;
  const lastSynced = hearing.last_sync
    ? new Date(hearing.last_sync).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Anchorage" })
    : null;

  const lastSyncedFull = hearing.last_sync
    ? new Date(hearing.last_sync).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Anchorage",
        timeZoneName: "shortGeneric",
      })
    : null;

  const notesPlaceholder = isFloor
    ? `Notes for ${chamberLabel} Floor hearing`
    : `Notes for ${chamberLabel} ${hearing.committee_name} hearing`;

  return (
    <article id={isFirst ? "tour-first-meeting" : undefined} className={`${styles.card} ${hearing.chamber === "H" ? styles.house : styles.senate} ${inactive ? styles.inactive : ""} ${hearing.hidden ? styles.hiddenMeeting : ""}`}>
      <div className={styles.cardMain}>
        {inactive && (
          <div className={styles.inactiveBanner}>Deactivated — this hearing was removed from the schedule</div>
        )}

        <div className={styles.cardDate}>
          <span>{fmt(hearing.hearing_date)}</span>
          <div className={styles.cardDateRight}>
            {hearing.hearing_time && <span>{fmtTime(hearing.hearing_time)}</span>}
            {can("hearing:export-ics") && (
              <button className={styles.calBtn} onClick={() => exportToCalendar(hearing, notes)} title="Export to Outlook calendar">
                + Calendar
              </button>
            )}
          </div>
        </div>
        <div className={styles.cardHeader}>
          <span className={styles.chamberBadge}>{hearing.chamber}</span>
          {isFloor ? (
            <span className={styles.committeeName}>Floor Session</span>
          ) : hearing.committee_url ? (
            <a href={hearing.committee_url} target="_blank" rel="noreferrer" className={styles.committeeName}>
              {hearing.committee_name}
            </a>
          ) : (
            <span className={styles.committeeName}>{hearing.committee_name}</span>
          )}
          {!isFloor && <span className={styles.committeeType}>{hearing.committee_type}</span>}
          {hearing.location && (
            <span className={styles.location}>{hearing.location}</span>
          )}
        </div>

        {hearing.agenda_items.length > 0 && (
          <button
            className={styles.agendaToggle}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▾ Hide agenda" : `▸ Show agenda (${hearing.agenda_items.filter(i => i.is_bill).length} bill${hearing.agenda_items.filter(i => i.is_bill).length !== 1 ? "s" : ""})`}
          </button>
        )}
        {expanded && hearing.agenda_items.length > 0 && (
          <table className={styles.agendaTable}>
            <tbody>
              {hearing.agenda_items.map((item) =>
                item.is_bill ? (
                  <tr key={item.id} className={styles.billRow}>
                    <td className={styles.billNum}>
                      {item.prefix && <span className={styles.prefix}>{item.prefix} </span>}
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className={styles.billLink}>
                          {item.bill_number}
                        </a>
                      ) : (
                        item.bill_number
                      )}
                      {" "}<Link
                        to="/"
                        state={{ search: item.bill_number, showUntracked: true }}
                        className={styles.legLink}
                        title={`Find ${item.bill_number} in Legislation tab`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m8 0 6.61 3h.89a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5H15v7a.5.5 0 0 1 .485.38l.5 2a.498.498 0 0 1-.485.62H.5a.498.498 0 0 1-.485-.62l.5-2A.5.5 0 0 1 1 13V6H.5a.5.5 0 0 1-.5-.5v-2A.5.5 0 0 1 .5 3h.89zM3.777 3h8.447L8 1zM2 6v7h1V6zm2 0v7h2.5V6zm3.5 0v7h1V6zm2 0v7H12V6zM13 6v7h1V6zm2-1V4H1v1zm-.39 9H1.39l-.25 1h13.72z"/>
                        </svg>
                      </Link>
                    </td>
                    <td className={styles.billDesc}>{item.content}</td>
                  </tr>
                ) : (
                  <tr key={item.id} className={styles.noteRow}>
                    <td className={styles.notePrefix}>{item.prefix ?? ""}</td>
                    <td className={styles.noteCell}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className={styles.noteLink}>
                          {item.content}
                        </a>
                      ) : (
                        item.content
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
        {can("prior-hearing-agendas:view") && hearing.has_prior_agendas && (
          <div className={styles.priorAgendasRow}>
            <button className={styles.priorAgendasBtn} onClick={() => setShowPriorAgendas(true)}>
              Prior Agendas
            </button>
          </div>
        )}
        {lastSynced && <p className={styles.lastSynced} title={lastSyncedFull}>Synced {lastSynced}</p>}
      </div>

      {can("hearing-notes:view") && (
        <div className={styles.dpsRow}>
          <label className={styles.dpsLabel}>Notes</label>
          {can("hearing-notes:edit") ? (
            <>
              <textarea
                className={styles.dpsInput}
                value={notes}
                placeholder={notesPlaceholder}
                onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              />
              {dirty && (
                <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </>
          ) : (
            <p className={styles.dpsReadOnly}>{notes || ""}</p>
          )}
        </div>
      )}

      {showPriorAgendas && (
        <PriorAgendasModal hearing={hearing} onClose={() => setShowPriorAgendas(false)} />
      )}

      {can("hearing-assignment:view") && (() => {
        const canViewSuggestions = can("hearing-assignment:view-auto-suggestions");
        const canCreate = can("workflow:view-all");
        const visible = (hearing.hearing_assignments_summary ?? []).filter(
          (a) => ACTIVE_ASSIGNMENT_TYPES.has(a.latest_action_type) &&
                 (a.latest_action_type !== "auto_suggested_hearing_assignment" || canViewSuggestions)
        );
        return (
          <div className={styles.assignmentsRow}>
            <div className={styles.assignmentsLabelRow}>
              <span className={styles.assignmentsLabel}>Assignments</span>
              {canCreate && (
                <button
                  className={styles.createAssignmentBtn}
                  onClick={() => { setCreateAssignmentError(null); setShowCreateAssignment(true); }}
                >
                  + Create Assignment
                </button>
              )}
            </div>
            {visible.length === 0 ? (
              <p className={styles.assignmentsEmpty}>No current assignments</p>
            ) : (
              <ul className={styles.assignmentsList}>
                {visible.map((a) => (
                  <li key={a.id} className={styles.assignmentItem}>
                    <button
                      className={styles.assignmentItemBtn}
                      onClick={() => { setAssignmentActionError(null); setSelectedAssignment(a); }}
                    >
                      <span className={styles.assignmentItemBadges}>
                        <span className={styles.assignmentEmailBadge}>{a.assignee_email}</span>
                        {a.bill_number && <span className={styles.assignmentBillBadge}>{a.bill_number}</span>}
                      </span>
                      {a.latest_action_type === "auto_suggested_hearing_assignment" && (
                        <span className={styles.assignmentSuggestedTag}>suggested</span>
                      )}
                      {a.latest_action_type === "hearing_assignment_complete" && (
                        <span className={styles.assignmentCompleteTag}>complete</span>
                      )}
                      {a.latest_action_type === "reassignment_request" && (
                        <span className={styles.assignmentReassignTag}>reassign requested</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      {showCreateAssignment && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateAssignment(false)}>
          <div className={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Create Assignment</h3>
            <p className={styles.modalHearingInfo}>
              {fmt(hearing.hearing_date)}{hearing.hearing_time ? ` · ${fmtTime(hearing.hearing_time)}` : ""}{hearing.committee_name ? ` · ${hearing.committee_name}` : " · Floor Session"}
            </p>
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
              <label className={styles.modalLabel}>Bill <span className={styles.modalOptional}>(optional)</span></label>
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
              <p className={styles.modalHearingInfo}>
                {fmt(hearing.hearing_date)}{hearing.hearing_time ? ` · ${fmtTime(hearing.hearing_time)}` : ""}{hearing.committee_name ? ` · ${hearing.committee_name}` : " · Floor Session"}
              </p>
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

      {can("hearing:hide") && (
        <div className={styles.hideRow}>
          <label className={styles.dpsLabel}>Visibility</label>
          {hearing.hidden && showHidden && (
            <p className={styles.hiddenNote}>Hidden from view and PDF</p>
          )}
          <button
            className={`${styles.hideBtn} ${hearing.hidden ? styles.hideBtnActive : ""}`}
            onClick={handleToggleHidden}
            disabled={hidingBusy}
            title={hearing.hidden ? "Unhide this hearing" : "Hide this hearing and remove it from the PDF export."}
          >
            {hidingBusy ? "…" : hearing.hidden ? "Unhide" : "Hide"}
          </button>
        </div>
      )}
    </article>
  );
}

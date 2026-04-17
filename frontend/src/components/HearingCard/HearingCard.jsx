import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { updateDpsNotes, updateHidden } from "../../api/hearings";
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

export default function HearingCard({ hearing, isFirst, globalExpanded, showHidden, onNotesSaved, onHiddenChanged }) {
  const { can, token } = useAuth();
  const [notes, setNotes] = useState(hearing.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hidingBusy, setHidingBusy] = useState(false);
  const [expanded, setExpanded] = useState(globalExpanded);
  const [showPriorAgendas, setShowPriorAgendas] = useState(false);

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
        {hearing.has_inactive_notes_sibling && (
          <div className={styles.warningBanner}>
            A prior version of this hearing has notes — toggle "Show inactive" to view or clear them
          </div>
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

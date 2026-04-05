import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { updateDpsNotes, updateHidden } from "../../api/meetings";
import styles from "./MeetingCard.module.css";

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

// Convert an Alaska local date+time to a UTC Date object.
//
// Alaska observes AKST (UTC−9) in winter and AKDT (UTC−8) in summer.
// Rather than hard-coding the DST offset, we use Intl.DateTimeFormat to ask
// the browser "what Alaska local time does this UTC moment represent?", then
// correct for any discrepancy. This handles DST transitions automatically via
// the browser's built-in IANA timezone data.
function alaskaLocalToUtc(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, m] = timeStr.split(":").map(Number);

  // Initial estimate: assume AKST (UTC−9)
  let candidate = new Date(Date.UTC(y, mo - 1, d, h + 9, m, 0));

  // Ask the browser what Alaska local time this UTC moment actually is
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Anchorage",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(candidate);

  const akH = parseInt(parts.find((p) => p.type === "hour").value) % 24;
  const akM = parseInt(parts.find((p) => p.type === "minute").value);

  // If the offset was wrong (e.g. AKDT = UTC−8), adjust
  const diffMs = ((h * 60 + m) - (akH * 60 + akM)) * 60000;
  return new Date(candidate.getTime() + diffMs);
}

function exportToCalendar(meeting) {
  const chamberLabel = meeting.chamber === "H" ? "House" : "Senate";
  const summary = `${chamberLabel} ${meeting.committee_name} ${meeting.committee_type}`;
  const dateStr = meeting.meeting_date.replace(/-/g, "");

  let dtStart, dtEnd;
  if (meeting.meeting_time) {
    const pad = (n) => String(n).padStart(2, "0");
    const startUtc = alaskaLocalToUtc(meeting.meeting_date, meeting.meeting_time);
    const endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);

    const fmtUtc = (dt) =>
      `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
      `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;

    dtStart = `DTSTART:${fmtUtc(startUtc)}`;
    dtEnd   = `DTEND:${fmtUtc(endUtc)}`;
  } else {
    dtStart = `DTSTART;VALUE=DATE:${dateStr}`;
    dtEnd   = `DTEND;VALUE=DATE:${dateStr}`;
  }

  // Build description
  const descLines = [];
  if (meeting.dps_notes) {
    descLines.push("Department of Public Safety Notes:");
    descLines.push(meeting.dps_notes);
    descLines.push("--");
  }
  descLines.push("Hearing Schedule:");
  meeting.agenda_items.forEach((item) => {
    const prefix = item.prefix ? `${item.prefix} ` : "";
    if (item.is_bill) {
      descLines.push(`${prefix}${item.bill_number} — ${item.content}`);
    } else {
      descLines.push(`${prefix}${item.content}`);
    }
  });

  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const description = escape(descLines.join("\n")).replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Leg Up//Meeting Export//EN",
    "BEGIN:VEVENT",
    dtStart,
    dtEnd,
    `SUMMARY:${escape(summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escape(meeting.location ?? "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meeting.committee_name.toLowerCase().replace(/\s+/g, "-")}-${meeting.meeting_date}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MeetingCard({ meeting, isFirst, globalExpanded, showHidden, onNotesSaved, onHiddenChanged }) {
  const { isLoggedIn, isEditor, token } = useAuth();
  const [notes, setNotes] = useState(meeting.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hidingBusy, setHidingBusy] = useState(false);
  const [expanded, setExpanded] = useState(globalExpanded);

  useEffect(() => {
    setExpanded(globalExpanded);
  }, [globalExpanded]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateDpsNotes(meeting.id, notes || null, token);
      setDirty(false);
      onNotesSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleHidden() {
    setHidingBusy(true);
    try {
      const updated = await updateHidden(meeting.id, !meeting.hidden, token);
      onHiddenChanged(updated);
    } finally {
      setHidingBusy(false);
    }
  }

  const chamberLabel = meeting.chamber === "H" ? "House" : "Senate";
  const inactive = !meeting.is_active;
  const lastSynced = meeting.last_sync
    ? new Date(meeting.last_sync).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <article id={isFirst ? "tour-first-meeting" : undefined} className={`${styles.card} ${meeting.chamber === "H" ? styles.house : styles.senate} ${inactive ? styles.inactive : ""} ${meeting.hidden ? styles.hiddenMeeting : ""}`}>
      <div className={styles.cardMain}>
        {inactive && (
          <div className={styles.inactiveBanner}>Deactivated — this meeting was removed from the schedule</div>
        )}
        {meeting.has_inactive_notes_sibling && (
          <div className={styles.warningBanner}>
            A prior version of this meeting has notes — toggle "Show inactive" to view or clear them
          </div>
        )}
        <div className={styles.cardDate}>
          <span>{fmt(meeting.meeting_date)}</span>
          <div className={styles.cardDateRight}>
            {meeting.meeting_time && <span>{fmtTime(meeting.meeting_time)}</span>}
            <button className={styles.calBtn} onClick={() => exportToCalendar(meeting)} title="Export to Outlook calendar">
              + Calendar
            </button>
          </div>
        </div>
        <div className={styles.cardHeader}>
          <span className={styles.chamberBadge}>{meeting.chamber}</span>
          {meeting.committee_url ? (
            <a href={meeting.committee_url} target="_blank" rel="noreferrer" className={styles.committeeName}>
              {meeting.committee_name}
            </a>
          ) : (
            <span className={styles.committeeName}>{meeting.committee_name}</span>
          )}
          <span className={styles.committeeType}>{meeting.committee_type}</span>
          {meeting.location && (
            <span className={styles.location}>{meeting.location}</span>
          )}
        </div>

        {meeting.agenda_items.length > 0 && (
          <button
            className={styles.agendaToggle}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▾ Hide agenda" : `▸ Show agenda (${meeting.agenda_items.filter(i => i.is_bill).length} bill${meeting.agenda_items.filter(i => i.is_bill).length !== 1 ? "s" : ""})`}
          </button>
        )}
        {expanded && meeting.agenda_items.length > 0 && (
          <table className={styles.agendaTable}>
            <tbody>
              {meeting.agenda_items.map((item) =>
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
        {lastSynced && <p className={styles.lastSynced}>Synced {lastSynced}</p>}
      </div>

      {isLoggedIn && (
      <div className={styles.dpsRow}>
        <label className={styles.dpsLabel}>Notes</label>
        {isEditor ? (
          <>
            <textarea
              className={styles.dpsInput}
              value={notes}
              placeholder={`Notes for ${chamberLabel} ${meeting.committee_name} meeting`}
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

      {isEditor && (
        <div className={styles.hideRow}>
          <label className={styles.dpsLabel}>Visibility</label>
          {meeting.hidden && showHidden && (
            <p className={styles.hiddenNote}>Hidden from view and PDF</p>
          )}
          <button
            className={`${styles.hideBtn} ${meeting.hidden ? styles.hideBtnActive : ""}`}
            onClick={handleToggleHidden}
            disabled={hidingBusy}
            title={meeting.hidden ? "Unhide this hearing" : "Hide this hearing and remove it from the PDF export."}
          >
            {hidingBusy ? "…" : meeting.hidden ? "Unhide" : "Hide"}
          </button>
        </div>
      )}
    </article>
  );
}

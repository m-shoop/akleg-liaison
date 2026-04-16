import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { updateDpsNotes, updateHidden } from "../../api/meetings";
import { addDays } from "../../utils/weekBounds";
import styles from "./CalendarView.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const PIXEL_PER_HOUR = 60;
const CONTENT_START_HOUR = 6;          // 6:00 AM — top of scrollable area
const CONTENT_END_HOUR = 22;           // 10:00 PM — bottom of scrollable area
const TOTAL_HEIGHT = (CONTENT_END_HOUR - CONTENT_START_HOUR) * PIXEL_PER_HOUR; // 960px
const CONTAINER_HEIGHT = 11 * PIXEL_PER_HOUR; // 660px — visible window (7:30 AM–6:30 PM)
const SCROLL_OFFSET_PX = (7.5 - CONTENT_START_HOUR) * PIXEL_PER_HOUR; // 90px
const ASSUMED_DURATION_MIN = 60;

const HOUR_MARKS = Array.from(
  { length: CONTENT_END_HOUR - CONTENT_START_HOUR + 1 },
  (_, i) => CONTENT_START_HOUR + i,
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeToMin(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function timeToY(timeStr) {
  const totalMin = timeToMin(timeStr);
  return Math.max(0, (totalMin / 60 - CONTENT_START_HOUR) * PIXEL_PER_HOUR);
}

function fmtTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtShortDate(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

// Mirrors the same function in MeetingCard — converts Alaska local time to UTC.
function alaskaLocalToUtc(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, m] = timeStr.split(":").map(Number);
  let candidate = new Date(Date.UTC(y, mo - 1, d, h + 9, m, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Anchorage",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(candidate);
  const akH = parseInt(parts.find((p) => p.type === "hour").value) % 24;
  const akM = parseInt(parts.find((p) => p.type === "minute").value);
  const diffMs = ((h * 60 + m) - (akH * 60 + akM)) * 60000;
  return new Date(candidate.getTime() + diffMs);
}

// Mirrors the same function in MeetingCard.
function exportToCalendar(meeting, notes) {
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
    dtEnd = `DTEND:${fmtUtc(endUtc)}`;
  } else {
    dtStart = `DTSTART;VALUE=DATE:${dateStr}`;
    dtEnd = `DTEND;VALUE=DATE:${dateStr}`;
  }

  const descLines = [];
  if (notes) {
    descLines.push("Department of Public Safety Notes:");
    descLines.push(notes);
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

/**
 * For each timed meeting in a day, compute its display column (col) and the
 * total number of columns in its overlap group (totalCols).
 */
function computeDayLayout(dayMeetings) {
  const timed = dayMeetings.filter((m) => m.meeting_time);

  return timed.map((m) => {
    const start = timeToMin(m.meeting_time);
    const end = start + ASSUMED_DURATION_MIN;

    const concurrent = timed
      .filter((other) => {
        const os = timeToMin(other.meeting_time);
        const oe = os + ASSUMED_DURATION_MIN;
        return start < oe && end > os;
      })
      .sort((a, b) => timeToMin(a.meeting_time) - timeToMin(b.meeting_time));

    const col = concurrent.findIndex((other) => other.id === m.id);
    return { meeting: m, col, totalCols: concurrent.length };
  });
}

// ─── Meeting detail overlay ───────────────────────────────────────────────────

function MeetingDetailOverlay({ meeting, showHidden, onClose, onNotesReload, onHiddenChanged }) {
  const { can, token } = useAuth();
  const [notes, setNotes] = useState(meeting.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hidingBusy, setHidingBusy] = useState(false);

  useEffect(() => {
    if (!dirty) setNotes(meeting.dps_notes ?? "");
  }, [meeting.dps_notes, dirty]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateDpsNotes(meeting.id, notes || null, token);
      setDirty(false);
      onNotesReload(); // keeps overlay open
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleHidden() {
    setHidingBusy(true);
    try {
      const updated = await updateHidden(meeting.id, !meeting.hidden, token);
      onHiddenChanged(updated); // parent updates allMeetings and closes overlay
    } finally {
      setHidingBusy(false);
    }
  }

  const chamberFull = meeting.chamber === "H" ? "House" : "Senate";

  const lastSynced = meeting.last_sync
    ? new Date(meeting.last_sync).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Anchorage",
        timeZoneName: "shortGeneric",
      })
    : null;

  return (
    <>
      <div className={styles.overlayBackdrop} onClick={onClose} />
      <div className={styles.overlayBox} role="dialog" aria-modal="true">
        <button className={styles.overlayClose} onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className={styles.overlayHeader}>
          <span
            className={`${styles.overlayChamberBadge} ${
              meeting.chamber === "H" ? styles.overlayChamberH : styles.overlayChamberS
            }`}
          >
            {meeting.chamber}
          </span>
          <div className={styles.overlayHeaderText}>
            <div className={styles.overlayCommittee}>
              {meeting.committee_url ? (
                <a
                  href={meeting.committee_url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.overlayCommitteeLink}
                >
                  {chamberFull} {meeting.committee_name}
                </a>
              ) : (
                <span>
                  {chamberFull} {meeting.committee_name}
                </span>
              )}
            </div>
            <div className={styles.overlayMeta}>
              {meeting.committee_type && <span>{meeting.committee_type}</span>}
              {meeting.meeting_time && <span>{fmtTime(meeting.meeting_time)}</span>}
              {meeting.location && <span>{meeting.location}</span>}
            </div>
          </div>
          {can("hearing:export-ics") && (
            <button
              className={styles.overlayCalBtn}
              onClick={() => exportToCalendar(meeting, notes)}
              title="Export to Outlook calendar"
            >
              + Calendar
            </button>
          )}
        </div>

        {meeting.agenda_items.length > 0 && (
          <div className={styles.overlayAgenda}>
            <div className={styles.overlaySectionTitle}>Agenda</div>
            <table className={styles.overlayAgendaTable}>
              <tbody>
                {meeting.agenda_items.map((item) =>
                  item.is_bill ? (
                    <tr key={item.id} className={styles.overlayBillRow}>
                      <td className={styles.overlayBillNum}>
                        {item.prefix && (
                          <span className={styles.overlayPrefix}>{item.prefix} </span>
                        )}
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.overlayBillLink}
                          >
                            {item.bill_number}
                          </a>
                        ) : (
                          item.bill_number
                        )}
                        {" "}<Link
                          to="/"
                          state={{ search: item.bill_number }}
                          className={styles.legLink}
                          title={`Find ${item.bill_number} in Legislation tab`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m8 0 6.61 3h.89a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5H15v7a.5.5 0 0 1 .485.38l.5 2a.498.498 0 0 1-.485.62H.5a.498.498 0 0 1-.485-.62l.5-2A.5.5 0 0 1 1 13V6H.5a.5.5 0 0 1-.5-.5v-2A.5.5 0 0 1 .5 3h.89zM3.777 3h8.447L8 1zM2 6v7h1V6zm2 0v7h2.5V6zm3.5 0v7h1V6zm2 0v7H12V6zM13 6v7h1V6zm2-1V4H1v1zm-.39 9H1.39l-.25 1h13.72z"/>
                          </svg>
                        </Link>
                      </td>
                      <td>{item.content}</td>
                    </tr>
                  ) : (
                    <tr key={item.id} className={styles.overlayNoteRow}>
                      <td className={styles.overlayNotePrefix}>{item.prefix ?? ""}</td>
                      <td className={styles.overlayNoteCell}>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer">
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
          </div>
        )}

        {can("hearing-notes:view") && (
          <div className={styles.overlayNotes}>
            <div className={styles.overlaySectionTitle}>Notes</div>
            {can("hearing-notes:edit") ? (
              <>
                <textarea
                  className={styles.overlayNotesInput}
                  value={notes}
                  placeholder={`Notes for ${chamberFull} ${meeting.committee_name} meeting`}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                />
                {dirty && (
                  <button
                    className={styles.overlaySaveBtn}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                )}
              </>
            ) : (
              <p className={styles.overlayNotesReadOnly}>{notes || ""}</p>
            )}
          </div>
        )}

        {can("hearing:hide") && (
          <div className={styles.overlayHideRow}>
            <div className={styles.overlaySectionTitle}>Visibility</div>
            {meeting.hidden && showHidden && (
              <p className={styles.overlayHiddenNote}>Hidden from view and PDF</p>
            )}
            <button
              className={`${styles.overlayHideBtn} ${meeting.hidden ? styles.overlayHideBtnActive : ""}`}
              onClick={handleToggleHidden}
              disabled={hidingBusy}
              title={
                meeting.hidden
                  ? "Unhide this hearing"
                  : "Hide this hearing and remove it from the PDF export."
              }
            >
              {hidingBusy ? "…" : meeting.hidden ? "Unhide" : "Hide"}
            </button>
          </div>
        )}

        {lastSynced && (
          <p className={styles.overlayLastSynced}>Synced {lastSynced}</p>
        )}
      </div>
    </>
  );
}

// ─── CalendarView ─────────────────────────────────────────────────────────────

export default function CalendarView({
  meetings,
  startDate,
  daysShown,
  onDaysShownChange,
  onNavigate,
  isFiltered,
  loading,
  noMeetingsInRange,
  onMeetingReload,
  showHidden,
  onHiddenChanged,
}) {
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const scrollRef = useRef(null);

  // On mobile (≤640px) only 1-day view is supported — enforce it and react to resize/rotation.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const enforce = (e) => { if (e.matches) onDaysShownChange(1); };
    enforce(mq);
    mq.addEventListener("change", enforce);
    return () => mq.removeEventListener("change", enforce);
  }, [onDaysShownChange]);

  // Keep the overlay in sync when the parent refreshes meeting data (e.g. after saving notes).
  useEffect(() => {
    if (!selectedMeeting) return;
    const updated = (meetings ?? []).find((m) => m.id === selectedMeeting.id);
    if (updated) setSelectedMeeting(updated);
  }, [meetings]);

  // Scroll to 7:30 AM on mount and whenever the start date changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = SCROLL_OFFSET_PX;
    }
  }, [startDate]);

  const days = Array.from({ length: daysShown }, (_, i) => addDays(startDate, i));

  const meetingsByDate = {};
  for (const m of meetings ?? []) {
    if (!meetingsByDate[m.meeting_date]) meetingsByDate[m.meeting_date] = [];
    meetingsByDate[m.meeting_date].push(m);
  }

  const dayLabel = daysShown === 1 ? "day" : "days";

  let firstBlockRendered = false;

  return (
    <div className={styles.calendarWrapper}>
      {/* Navigation */}
      <div id="tour-calendar-nav" className={styles.calendarNav}>
        <button
          className={styles.navBtn}
          onClick={() => onNavigate(addDays(startDate, -daysShown))}
          title={`Back ${daysShown} ${dayLabel}`}
        >
          &lt;&lt; {daysShown} {dayLabel}
        </button>
        <div className={styles.daysToggle}>
          <button
            className={`${styles.daysOption} ${daysShown === 1 ? styles.daysSelected : ""}`}
            onClick={() => onDaysShownChange(1)}
          >
            1 day
          </button>
          <button
            className={`${styles.daysOption} ${daysShown === 3 ? styles.daysSelected : ""}`}
            onClick={() => onDaysShownChange(3)}
          >
            3 days
          </button>
        </div>
        <button
          className={styles.navBtn}
          onClick={() => onNavigate(addDays(startDate, daysShown))}
          title={`Forward ${daysShown} ${dayLabel}`}
        >
          {daysShown} {dayLabel} &gt;&gt;
        </button>
        {loading && <span className={styles.navLoading}>Loading…</span>}
        {!loading && noMeetingsInRange && (
          <span className={styles.navLoading}>No meetings found for this date range.</span>
        )}
        {isFiltered && (
          <span className={styles.filterBanner}>
            Search filter active — some hearings may have been hidden.
          </span>
        )}
      </div>

      {/* Calendar grid */}
      <div className={styles.calendarOuter}>
        {/*
          The scroll area contains BOTH the sticky header row and the time body.
          Keeping them in the same scroll container guarantees the vertical lines
          in the header and body stay perfectly aligned regardless of scrollbar width.
        */}
        <div
          className={styles.calendarScrollArea}
          style={{ height: CONTAINER_HEIGHT }}
          ref={scrollRef}
        >
          {/* Sticky day headers */}
          <div className={styles.calendarHeaderRow}>
            <div className={styles.timeSpacer} />
            {days.map((dateStr) => (
              <div key={dateStr} className={styles.dayHeader}>
                {fmtShortDate(dateStr)}
              </div>
            ))}
          </div>

          {/* Time body: gutter + day columns */}
          <div className={styles.calendarBody}>
            <div className={styles.timeGutter} style={{ height: TOTAL_HEIGHT }}>
              {HOUR_MARKS.map((h) => (
                <div
                  key={h}
                  className={styles.timeLabel}
                  style={{ top: (h - CONTENT_START_HOUR) * PIXEL_PER_HOUR }}
                >
                  {fmtHour(h)}
                </div>
              ))}
            </div>

            <div className={styles.calendarDaysRow}>
              {days.map((dateStr) => {
                const dayMeetings = meetingsByDate[dateStr] ?? [];
                const timedLayout = computeDayLayout(dayMeetings);
                const untimedMeetings = dayMeetings.filter((m) => !m.meeting_time);

                return (
                  <div key={dateStr} className={styles.dayColumn} style={{ height: TOTAL_HEIGHT }}>
                    {/* Hour lines */}
                    {HOUR_MARKS.map((h) => (
                      <div
                        key={h}
                        className={styles.hourLine}
                        style={{ top: (h - CONTENT_START_HOUR) * PIXEL_PER_HOUR }}
                      />
                    ))}
                    {/* Half-hour lines */}
                    {HOUR_MARKS.slice(0, -1).map((h) => (
                      <div
                        key={`${h}h`}
                        className={styles.halfHourLine}
                        style={{ top: (h - CONTENT_START_HOUR + 0.5) * PIXEL_PER_HOUR }}
                      />
                    ))}

                    {/* Untimed meetings — anchored at 7:30 AM position */}
                    {untimedMeetings.map((m, idx) => {
                      const bills = m.agenda_items
                        .filter((i) => i.is_bill)
                        .map((i) => i.bill_number)
                        .filter(Boolean);
                      const billsDisplay =
                        bills.length > 3 ? bills.slice(0, 3).join(", ") + "…" : bills.join(", ");
                      const isFirstBlock = !firstBlockRendered;
                      if (isFirstBlock) firstBlockRendered = true;
                      return (
                        <div
                          key={m.id}
                          id={isFirstBlock ? "tour-first-calendar-meeting" : undefined}
                          className={`${styles.meetingBlock} ${
                            m.chamber === "H" ? styles.meetingBlockHouse : styles.meetingBlockSenate
                          }${!m.is_active ? ` ${styles.meetingBlockInactive}` : ""}${m.hidden ? ` ${styles.meetingBlockHidden}` : ""}`}
                          style={{
                            top: SCROLL_OFFSET_PX + 4 + idx * 46,
                            left: 2,
                            right: 2,
                            height: 42,
                          }}
                          onClick={() => setSelectedMeeting(m)}
                        >
                          <div className={styles.blockCommittee}>
                            {m.committee_name} ({m.chamber})
                          </div>
                          {bills.length > 0 && (
                            <div
                              className={styles.blockBills}
                              title={bills.join(", ")}
                            >
                              {billsDisplay}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Timed meetings */}
                    {timedLayout.map(({ meeting: m, col, totalCols }) => {
                      const top = timeToY(m.meeting_time);
                      const height = Math.max(PIXEL_PER_HOUR - 2, 44);
                      const widthPct = 100 / totalCols;
                      const leftPct = col * widthPct;

                      const bills = m.agenda_items
                        .filter((i) => i.is_bill)
                        .map((i) => i.bill_number)
                        .filter(Boolean);
                      const billsDisplay =
                        bills.length > 3
                          ? bills.slice(0, 3).join(", ") + "…"
                          : bills.join(", ");
                      const isFirstBlock = !firstBlockRendered;
                      if (isFirstBlock) firstBlockRendered = true;

                      return (
                        <div
                          key={m.id}
                          id={isFirstBlock ? "tour-first-calendar-meeting" : undefined}
                          className={`${styles.meetingBlock} ${
                            m.chamber === "H" ? styles.meetingBlockHouse : styles.meetingBlockSenate
                          }${!m.is_active ? ` ${styles.meetingBlockInactive}` : ""}${m.hidden ? ` ${styles.meetingBlockHidden}` : ""}`}
                          style={{
                            top,
                            height,
                            left: `calc(${leftPct}% + 2px)`,
                            width:
                              col === totalCols - 1
                                ? `calc(${widthPct}% - 4px)`
                                : `calc(${widthPct}% - 3px)`,
                          }}
                          onClick={() => setSelectedMeeting(m)}
                        >
                          <div className={styles.blockCommittee}>
                            {m.committee_name} ({m.chamber})
                          </div>
                          {bills.length > 0 && (
                            <div
                              className={styles.blockBills}
                              title={bills.join(", ")}
                            >
                              {billsDisplay}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Meeting detail overlay */}
      {selectedMeeting && (
        <MeetingDetailOverlay
          meeting={selectedMeeting}
          showHidden={showHidden}
          onClose={() => setSelectedMeeting(null)}
          onNotesReload={onMeetingReload}
          onHiddenChanged={(updated) => {
            onHiddenChanged(updated);
            setSelectedMeeting(null);
          }}
        />
      )}
    </div>
  );
}

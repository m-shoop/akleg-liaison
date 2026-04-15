import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import { updateDpsNotes } from "../../api/meetings";
import { addDays } from "../../utils/weekBounds";
import styles from "./CalendarView.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const PIXEL_PER_HOUR = 60;
const CONTENT_START_HOUR = 6;          // 6:00 AM — top of scrollable area
const CONTENT_END_HOUR = 22;           // 10:00 PM — bottom of scrollable area
const TOTAL_HEIGHT = (CONTENT_END_HOUR - CONTENT_START_HOUR) * PIXEL_PER_HOUR; // 960px
const CONTAINER_HEIGHT = 11 * PIXEL_PER_HOUR; // 660px — default visible window (7:30–6:30)
const SCROLL_OFFSET_PX = (7.5 - CONTENT_START_HOUR) * PIXEL_PER_HOUR; // 90px — puts 7:30 AM at top
const ASSUMED_DURATION_MIN = 60;

// Hour marks to draw lines and labels for
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

/**
 * For each timed meeting in a day, compute its display column (col) and the
 * total number of columns in its overlap group (totalCols). Meetings that
 * overlap in time are placed side-by-side.
 */
function computeDayLayout(dayMeetings) {
  const timed = dayMeetings.filter((m) => m.meeting_time);

  return timed.map((m) => {
    const start = timeToMin(m.meeting_time);
    const end = start + ASSUMED_DURATION_MIN;

    // All meetings whose [start, end) windows overlap this one
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

function MeetingDetailOverlay({ meeting, onClose, onReload }) {
  const { can, token } = useAuth();
  const [notes, setNotes] = useState(meeting.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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
      onReload();
    } finally {
      setSaving(false);
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
  onMeetingReload,
}) {
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const scrollRef = useRef(null);

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

  let firstBlockRendered = false;

  return (
    <div className={styles.calendarWrapper}>
      {/* Navigation */}
      <div id="tour-calendar-nav" className={styles.calendarNav}>
        <button
          className={styles.navBtn}
          onClick={() => onNavigate(addDays(startDate, -daysShown))}
          title={`Back ${daysShown} day${daysShown !== 1 ? "s" : ""}`}
        >
          ← −{daysShown} days
        </button>
        <div className={styles.daysToggle}>
          <button
            className={`${styles.daysOption} ${daysShown === 3 ? styles.daysSelected : ""}`}
            onClick={() => onDaysShownChange(3)}
          >
            3 days
          </button>
          <button
            className={`${styles.daysOption} ${daysShown === 5 ? styles.daysSelected : ""}`}
            onClick={() => onDaysShownChange(5)}
          >
            5 days
          </button>
        </div>
        <button
          className={styles.navBtn}
          onClick={() => onNavigate(addDays(startDate, daysShown))}
          title={`Forward ${daysShown} day${daysShown !== 1 ? "s" : ""}`}
        >
          +{daysShown} days →
        </button>
      </div>

      {/* Filter banner */}
      {isFiltered && (
        <div className={styles.filterBanner}>
          Search filter is active — not all hearings may be visible in the calendar.
        </div>
      )}

      {/* Calendar grid */}
      <div className={styles.calendarOuter}>
        {/* Day headers (outside scroll area so they stay fixed) */}
        <div className={styles.calendarHeaderRow}>
          <div className={styles.timeSpacer} />
          {days.map((dateStr) => (
            <div key={dateStr} className={styles.dayHeader}>
              {fmtShortDate(dateStr)}
            </div>
          ))}
        </div>

        {/* Scrollable body */}
        <div
          className={styles.calendarScrollArea}
          style={{ height: CONTAINER_HEIGHT }}
          ref={scrollRef}
        >
          {/* Time gutter */}
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

          {/* Day columns */}
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

                  {/* Untimed meetings — placed at top of visible area */}
                  {untimedMeetings.map((m, idx) => {
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
                        }`}
                        style={{
                          top: SCROLL_OFFSET_PX + 4 + idx * 46,
                          left: 2,
                          right: 2,
                          height: 42,
                        }}
                        onClick={() => setSelectedMeeting(m)}
                      >
                        <div className={styles.blockCommittee}>
                          ({m.chamber}) {m.committee_name}
                        </div>
                        {bills.length > 0 && (
                          <div
                            className={styles.blockBills}
                            title={bills.length > 3 ? bills.join(", ") : undefined}
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
                        }`}
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
                          ({m.chamber}) {m.committee_name}
                        </div>
                        {bills.length > 0 && (
                          <div
                            className={styles.blockBills}
                            title={bills.length > 3 ? bills.join(", ") : undefined}
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

      {/* Meeting detail overlay */}
      {selectedMeeting && (
        <MeetingDetailOverlay
          meeting={selectedMeeting}
          onClose={() => setSelectedMeeting(null)}
          onReload={() => {
            onMeetingReload();
            setSelectedMeeting(null);
          }}
        />
      )}
    </div>
  );
}

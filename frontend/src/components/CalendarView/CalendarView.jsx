import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { updateDpsNotes, updateHidden } from "../../api/hearings";
import { addDays, todayJuneau } from "../../utils/weekBounds";
import { alaskaLocalToUtc, exportToCalendar } from "../../utils/hearingCalendar";
import PriorAgendasModal from "../PriorAgendasModal/PriorAgendasModal";
import HearingAssignmentsPanel from "../HearingAssignmentsPanel/HearingAssignmentsPanel";
import styles from "./CalendarView.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const PIXEL_PER_HOUR = 60;
const CONTENT_START_HOUR = 6;          // 6:00 AM — top of scrollable area
const CONTENT_END_HOUR = 22;           // 10:00 PM — bottom of scrollable area
const TOTAL_HEIGHT = (CONTENT_END_HOUR - CONTENT_START_HOUR) * PIXEL_PER_HOUR; // 960px
const CONTAINER_HEIGHT = 11 * PIXEL_PER_HOUR; // 660px — visible window (7:30 AM–6:30 PM)
const SCROLL_OFFSET_PX = (7.5 - CONTENT_START_HOUR) * PIXEL_PER_HOUR; // 90px

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
 * For each timed hearing in a day, compute its display column (col) and the
 * total number of columns in its overlap group (totalCols).
 */
function computeDayLayout(dayHearings) {
  const timed = dayHearings.filter((h) => h.hearing_time);

  return timed.map((h) => {
    const start = timeToMin(h.hearing_time);
    const end = start + (h.length ?? 60);

    const concurrent = timed
      .filter((other) => {
        const os = timeToMin(other.hearing_time);
        const oe = os + (other.length ?? 60);
        return start < oe && end > os;
      })
      .sort((a, b) => timeToMin(a.hearing_time) - timeToMin(b.hearing_time));

    const col = concurrent.findIndex((other) => other.id === h.id);
    return { hearing: h, col, totalCols: concurrent.length };
  });
}

// ─── Hearing detail overlay ───────────────────────────────────────────────────

function HearingDetailOverlay({ hearing, showHidden, onClose, onNotesReload, onHiddenChanged, onAssignmentCreated }) {
  const { can, token } = useAuth();
  const [notes, setNotes] = useState(hearing.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hidingBusy, setHidingBusy] = useState(false);
  const [showPriorAgendas, setShowPriorAgendas] = useState(false);

  const isFloor = !hearing.committee_name;

  useEffect(() => {
    if (!dirty) setNotes(hearing.dps_notes ?? "");
  }, [hearing.dps_notes, dirty]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && !showPriorAgendas) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, showPriorAgendas]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateDpsNotes(hearing.id, notes || null, token);
      setDirty(false);
      onNotesReload();
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

  const chamberFull = hearing.chamber === "H" ? "House" : "Senate";

  const lastSynced = hearing.last_sync
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
    ? `Notes for ${chamberFull} Floor hearing`
    : `Notes for ${chamberFull} ${hearing.committee_name} hearing`;

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
              hearing.chamber === "H" ? styles.overlayChamberH : styles.overlayChamberS
            }`}
          >
            {hearing.chamber}
          </span>
          <div className={styles.overlayHeaderText}>
            <div className={styles.overlayCommittee}>
              {isFloor ? (
                <span>{chamberFull} Floor Hearing</span>
              ) : hearing.committee_url ? (
                <a
                  href={hearing.committee_url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.overlayCommitteeLink}
                >
                  {chamberFull} {hearing.committee_name}
                </a>
              ) : (
                <span>
                  {chamberFull} {hearing.committee_name}
                </span>
              )}
            </div>
            <div className={styles.overlayMeta}>
              {hearing.hearing_date && <span>{fmtShortDate(hearing.hearing_date)}</span>}
              {!isFloor && hearing.committee_type && <span>{hearing.committee_type}</span>}
              {hearing.hearing_time && <span>{fmtTime(hearing.hearing_time)}</span>}
              {hearing.location && <span>{hearing.location}</span>}
            </div>
          </div>
          {can("hearing:export-ics") && (
            <button
              className={styles.overlayCalBtn}
              onClick={() => exportToCalendar(hearing, notes)}
              title="Export to Outlook calendar"
            >
              + Calendar
            </button>
          )}
        </div>

        {hearing.agenda_items.length > 0 && (
          <div className={styles.overlayAgenda}>
            <div className={styles.overlaySectionTitle}>Agenda</div>
            <table className={styles.overlayAgendaTable}>
              <tbody>
                {hearing.agenda_items.map((item) =>
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
                          state={{ search: item.bill_number, showUntracked: true }}
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

        {can("prior-hearing-agendas:view") && hearing.has_prior_agendas && (
          <div className={styles.overlayPriorAgendasRow}>
            <button
              className={styles.overlayPriorAgendasBtn}
              onClick={() => setShowPriorAgendas(true)}
            >
              Prior Agendas
            </button>
          </div>
        )}

        {showPriorAgendas && (
          <PriorAgendasModal
            hearing={hearing}
            onClose={() => setShowPriorAgendas(false)}
          />
        )}

        {can("hearing-assignment:view") && (
          <div className={styles.overlayAssignments}>
            <HearingAssignmentsPanel hearing={hearing} onAssignmentCreated={onAssignmentCreated} />
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
                  placeholder={notesPlaceholder}
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
            {hearing.hidden && showHidden && (
              <p className={styles.overlayHiddenNote}>Hidden from view and PDF</p>
            )}
            <button
              className={`${styles.overlayHideBtn} ${hearing.hidden ? styles.overlayHideBtnActive : ""}`}
              onClick={handleToggleHidden}
              disabled={hidingBusy}
              title={
                hearing.hidden
                  ? "Unhide this hearing"
                  : "Hide this hearing and remove it from the PDF export."
              }
            >
              {hidingBusy ? "…" : hearing.hidden ? "Unhide" : "Hide"}
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
  hearings,
  startDate,
  daysShown,
  onDaysShownChange,
  onNavigate,
  isFiltered,
  loading,
  noHearingsInRange,
  onHearingReload,
  showHidden,
  onHiddenChanged,
}) {
  const [selectedHearing, setSelectedHearing] = useState(null);
  const scrollRef = useRef(null);

  // On mobile (≤640px) only 1-day view is supported — enforce it and react to resize/rotation.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const enforce = (e) => { if (e.matches) onDaysShownChange(1); };
    enforce(mq);
    mq.addEventListener("change", enforce);
    return () => mq.removeEventListener("change", enforce);
  }, [onDaysShownChange]);

  // Keep the overlay in sync when the parent refreshes hearing data (e.g. after saving notes).
  useEffect(() => {
    if (!selectedHearing) return;
    const updated = (hearings ?? []).find((h) => h.id === selectedHearing.id);
    if (updated) setSelectedHearing(updated);
  }, [hearings]);

  // Scroll to 7:30 AM on mount and whenever the start date changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = SCROLL_OFFSET_PX;
    }
  }, [startDate]);

  const days = Array.from({ length: daysShown }, (_, i) => addDays(startDate, i));

  const hearingsByDate = {};
  for (const h of hearings ?? []) {
    if (!hearingsByDate[h.hearing_date]) hearingsByDate[h.hearing_date] = [];
    hearingsByDate[h.hearing_date].push(h);
  }

  const dayLabel = daysShown === 1 ? "day" : "days";

  let firstBlockRendered = false;

  return (
    <div className={styles.calendarWrapper}>
      {/* Navigation */}
      <div id="tour-calendar-nav" className={styles.calendarNav}>
        <div className={styles.calendarNavRow}>
          <div id="tour-calendar-start-date" className={styles.navStartDate}>
            <label className={styles.navStartDateLabel}>
              Starting Date
              <input
                type="date"
                className={styles.navDateInput}
                value={startDate ?? ""}
                onChange={(e) => onNavigate(e.target.value)}
              />
            </label>
            <button
              className={`${styles.navBtn} ${startDate === todayJuneau() ? styles.navBtnActive : ""}`}
              onClick={() => onNavigate(todayJuneau())}
            >
              Today
            </button>
          </div>
          {loading && <span className={styles.navLoading}>Loading…</span>}
          {!loading && noHearingsInRange && (
            <span className={styles.navLoading}>No hearings found for this date range.</span>
          )}
          {isFiltered && (
            <span className={styles.filterBanner}>
              Search filter active — some hearings may have been hidden.
            </span>
          )}
        </div>
        <div className={styles.calendarNavRow}>
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
        </div>
      </div>

      {/* Calendar grid */}
      <div className={styles.calendarOuter}>
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
                const dayHearings = hearingsByDate[dateStr] ?? [];
                const timedLayout = [
                  ...computeDayLayout(dayHearings.filter((h) => h.hearing_time && h.committee_name)),
                  ...computeDayLayout(dayHearings.filter((h) => h.hearing_time && !h.committee_name)),
                ];
                const untimedHearings = dayHearings.filter((h) => !h.hearing_time);

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

                    {/* Untimed hearings — anchored at 7:30 AM position */}
                    {untimedHearings.map((h, idx) => {
                      const bills = h.agenda_items
                        .filter((i) => i.is_bill)
                        .map((i) => i.bill_number)
                        .filter(Boolean);
                      const billsDisplay =
                        bills.length > 3 ? bills.slice(0, 3).join(", ") + "…" : bills.join(", ");
                      const isFirstBlock = !firstBlockRendered;
                      if (isFirstBlock) firstBlockRendered = true;
                      const blockLabel = h.committee_name ?? "Floor Session";
                      return (
                        <div
                          key={h.id}
                          id={isFirstBlock ? "tour-first-calendar-meeting" : undefined}
                          className={`${styles.meetingBlock} ${
                            h.chamber === "H" ? styles.meetingBlockHouse : styles.meetingBlockSenate
                          }${!h.is_active ? ` ${styles.meetingBlockInactive}` : ""}${h.hidden ? ` ${styles.meetingBlockHidden}` : ""}${selectedHearing?.id === h.id ? ` ${styles.meetingBlockSelected}` : ""}`}
                          style={{
                            top: SCROLL_OFFSET_PX + 4 + idx * 46,
                            left: 2,
                            right: 2,
                            height: 42,
                          }}
                          onClick={() => setSelectedHearing(h)}
                        >
                          <div className={styles.blockCommittee}>
                            {blockLabel} ({h.chamber})
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

                    {/* Timed hearings */}
                    {timedLayout.map(({ hearing: h, col, totalCols }) => {
                      const top = timeToY(h.hearing_time);
                      const durationMin = h.length ?? 60;
                      const height = Math.max((durationMin / 60) * PIXEL_PER_HOUR - 2, 44);
                      const widthPct = 100 / totalCols;
                      const leftPct = col * widthPct;

                      const bills = h.agenda_items
                        .filter((i) => i.is_bill)
                        .map((i) => i.bill_number)
                        .filter(Boolean);
                      const billsDisplay =
                        bills.length > 3
                          ? bills.slice(0, 3).join(", ") + "…"
                          : bills.join(", ");
                      const isFirstBlock = !firstBlockRendered;
                      if (isFirstBlock) firstBlockRendered = true;
                      const blockLabel = h.committee_name ?? "Floor Session";

                      return (
                        <div
                          key={h.id}
                          id={isFirstBlock ? "tour-first-calendar-meeting" : undefined}
                          className={`${styles.meetingBlock} ${
                            h.chamber === "H" ? styles.meetingBlockHouse : styles.meetingBlockSenate
                          }${!h.is_active ? ` ${styles.meetingBlockInactive}` : ""}${h.hidden ? ` ${styles.meetingBlockHidden}` : ""}${selectedHearing?.id === h.id ? ` ${styles.meetingBlockSelected}` : ""}`}
                          style={{
                            top,
                            height,
                            left: `calc(${leftPct}% + 2px)`,
                            width:
                              col === totalCols - 1
                                ? `calc(${widthPct}% - 4px)`
                                : `calc(${widthPct}% - 3px)`,
                          }}
                          onClick={() => setSelectedHearing(h)}
                        >
                          <div className={styles.blockCommittee}>
                            {blockLabel} ({h.chamber})
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

      {/* Hearing detail overlay */}
      {selectedHearing && (
        <HearingDetailOverlay
          hearing={selectedHearing}
          showHidden={showHidden}
          onClose={() => setSelectedHearing(null)}
          onNotesReload={onHearingReload}
          onHiddenChanged={(updated) => {
            onHiddenChanged(updated);
            setSelectedHearing(null);
          }}
          onAssignmentCreated={onHearingReload}
        />
      )}
    </div>
  );
}

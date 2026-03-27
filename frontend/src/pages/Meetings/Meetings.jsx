import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { fetchMeetings, scrapeMeetings, updateDpsNotes } from "../../api/meetings";
import { useJob } from "../../hooks/useJob";
import Toast from "../../components/Toast/Toast";
import { createMeetingsTour } from "../../tours/meetingsTour";
import styles from "./Meetings.module.css";

function weekBounds() {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay()); // Sunday of this week
  return sunday.toISOString().slice(0, 10);
}

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

function exportToCalendar(meeting) {
  const chamberLabel = meeting.chamber === "H" ? "House" : "Senate";
  const summary = `${chamberLabel} ${meeting.committee_name} ${meeting.committee_type}`;
  const dateStr = meeting.meeting_date.replace(/-/g, "");

  let dtStart, dtEnd;
  if (meeting.meeting_time) {
    const [h, m] = meeting.meeting_time.split(":").map(Number);
    const start = new Date(2000, 0, 1, h, m);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    dtStart = `TZID=America/Anchorage:${dateStr}T${pad(start.getHours())}${pad(start.getMinutes())}00`;
    dtEnd   = `TZID=America/Anchorage:${dateStr}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  } else {
    dtStart = dateStr;
    dtEnd   = dateStr;
  }

  // Build description: notes first, then agenda items
  const descLines = [];
  if (meeting.dps_notes) {
    descLines.push(`Notes: ${meeting.dps_notes}`);
    descLines.push("");
  }
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
    `DTSTART;${dtStart}`,
    `DTEND;${dtEnd}`,
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

function MeetingCard({ meeting, isFirst, globalExpanded, onNotesSaved }) {
  const { isLoggedIn, token } = useAuth();
  const [notes, setNotes] = useState(meeting.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  const chamberLabel = meeting.chamber === "H" ? "House" : "Senate";
  const inactive = !meeting.is_active;
  const lastSynced = meeting.updated_at
    ? new Date(meeting.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <article id={isFirst ? "tour-first-meeting" : undefined} className={`${styles.card} ${meeting.chamber === "H" ? styles.house : styles.senate} ${inactive ? styles.inactive : ""}`}>
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
                    <td className={styles.teleconf}>{item.is_teleconferenced ? "Teleconf" : ""}</td>
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
                    <td className={styles.teleconf}>{item.is_teleconferenced ? "Teleconf" : ""}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
        {lastSynced && <p className={styles.lastSynced}>Synced {lastSynced}</p>}
      </div>

      <div className={styles.dpsRow}>
        <label className={styles.dpsLabel}>Notes</label>
        {isLoggedIn ? (
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
    </article>
  );
}

export default function Meetings() {
  const { isLoggedIn, token } = useAuth();
  const [startDate, setStartDate] = useState(weekBounds());
  const [endDate, setEndDate] = useState("");
  const [allMeetings, setAllMeetings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scrapeJobId, setScrapeJobId] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [globalExpanded, setGlobalExpanded] = useState(false);

  const { status: jobStatus, result: jobResult, error: jobError } = useJob(scrapeJobId);

  useEffect(() => {
    if (!scrapeJobId) return;
    if (jobStatus === "complete") {
      loadMeetings();
      setToast({ message: `${jobResult?.meetings_saved ?? 0} meetings scraped successfully.`, type: "success" });
      setScrapeJobId(null);
    } else if (jobStatus === "failed") {
      setToast({ message: jobError ?? "Scrape failed.", type: "error" });
      setScrapeJobId(null);
    }
  }, [jobStatus]);

  async function loadMeetings() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMeetings({ startDate, endDate, includeInactive: true });
      setAllMeetings(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeetings();
  }, [startDate, endDate]);

  async function handleScrape() {
    setError(null);
    try {
      const job = await scrapeMeetings({ startDate, endDate }, token);
      setScrapeJobId(job.id);
    } catch (e) {
      setToast({ message: e.message, type: "error" });
    }
  }

  function handleToggleInactive() {
    setShowInactive((v) => !v);
  }

  // Derive visible meetings from allMeetings based on showInactive
  const hasInactive = allMeetings?.some((m) => !m.is_active) ?? false;
  const meetings = allMeetings
    ? showInactive ? allMeetings : allMeetings.filter((m) => m.is_active)
    : null;

  // Filter then group by date
  const query = searchQuery.trim().toLowerCase();
  const filteredMeetings = meetings && query
    ? meetings.filter((m) => {
        const agendaText = m.agenda_items
          .flatMap((i) => [i.bill_number, i.content])
          .filter(Boolean)
          .join(" ");
        const haystack = [
          m.committee_name,
          m.committee_type,
          m.location,
          m.dps_notes,
          agendaText,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
    : meetings;

  const byDate = filteredMeetings
    ? filteredMeetings.reduce((acc, m) => {
        const key = m.meeting_date;
        if (!acc[key]) acc[key] = [];
        acc[key].push(m);
        return acc;
      }, {})
    : {};

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Hearing Schedule</h1>
          {meetings !== null && (
            <p className={styles.subtitle}>
              {query
                ? `${filteredMeetings.length} of ${meetings.length} hearing${meetings.length !== 1 ? "s" : ""}`
                : `${meetings.length} hearing${meetings.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        <div id="tour-legend" className={styles.legend}>
          <span className={styles.legendItem}><code>*</code> first hearing in first committee of referral</span>
          <span className={styles.legendItem}><code>+</code> teleconferenced</span>
          <span className={styles.legendItem}><code>=</code> previously heard / scheduled</span>
        </div>
        <div className={styles.controls}>
          <div id="tour-date-range" className={styles.dateRow}>
            <label>
              From
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={styles.dateInput}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={styles.dateInput}
              />
            </label>
          </div>
          <div id="tour-controls" className={styles.btnRow}>
            {isLoggedIn && (
              <button className={styles.scrapeBtn} onClick={handleScrape} disabled={!!scrapeJobId || !endDate}>
                {scrapeJobId ? "Scraping…" : "Scrape from akleg.gov"}
              </button>
            )}
            {meetings !== null && meetings.length > 0 && (
              <button
                className={`${styles.loadBtn} ${globalExpanded ? styles.loadBtnActive : ""}`}
                onClick={() => setGlobalExpanded((v) => !v)}
              >
                {globalExpanded ? "Collapse agendas" : "Expand agendas"}
              </button>
            )}
            {hasInactive && (
              <button
                className={`${styles.loadBtn} ${showInactive ? styles.loadBtnActive : ""}`}
                onClick={handleToggleInactive}
                disabled={loading}
              >
                {showInactive ? "Hide inactive" : "Show inactive"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.searchRow}>
        <input
          id="tour-meetings-search"
          className={styles.searchInput}
          type="search"
          placeholder="Search committees, bills, locations, notes…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className={styles.helpBtn}
          onClick={() => createMeetingsTour().drive()}
          title="Tour the Meetings page"
        >
          ?
        </button>
      </div>

      {scrapeJobId && (
        <p className={styles.notice}>Scraping meetings from akleg.gov — please stay on this page…</p>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <Toast
        message={toast?.message}
        type={toast?.type}
        onDismiss={() => setToast(null)}
      />

      {meetings !== null && meetings.length === 0 && (
        <p className={styles.notice}>
          No meetings found for this date range.
          {isLoggedIn && ' Use "Scrape from akleg.gov" to import them.'}
        </p>
      )}
      {meetings !== null && meetings.length > 0 && filteredMeetings.length === 0 && (
        <p className={styles.notice}>No meetings match your search.</p>
      )}

      {(() => {
        let firstCardRendered = false;
        return Object.keys(byDate).sort().map((dateKey) => (
          <section key={dateKey} className={styles.daySection}>
            <h2 className={styles.dayHeading}>{fmt(dateKey)}</h2>
            <div className={styles.dayCards}>
              {byDate[dateKey].map((m) => {
                const isFirst = !firstCardRendered;
                if (isFirst) firstCardRendered = true;
                return (
                  <MeetingCard key={m.id} meeting={m} isFirst={isFirst} globalExpanded={globalExpanded} onNotesSaved={() => loadMeetings()} />
                );
              })}
            </div>
          </section>
        ));
      })()}
    </div>
  );
}

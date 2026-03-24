import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { fetchMeetings, scrapeMeetings, updateDpsNotes } from "../../api/meetings";
import { useJob } from "../../hooks/useJob";
import Toast from "../../components/Toast/Toast";
import styles from "./Meetings.module.css";

function weekBounds() {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7) + 7); // next Monday
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return {
    start: monday.toISOString().slice(0, 10),
    end: friday.toISOString().slice(0, 10),
  };
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

function MeetingCard({ meeting, onNotesSaved }) {
  const { isLoggedIn, token } = useAuth();
  const [notes, setNotes] = useState(meeting.dps_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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

  return (
    <article className={`${styles.card} ${meeting.chamber === "H" ? styles.house : styles.senate} ${inactive ? styles.inactive : ""}`}>
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
          {meeting.meeting_time && <span>{fmtTime(meeting.meeting_time)}</span>}
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
      </div>

      {isLoggedIn && (
        <div className={styles.dpsRow}>
          <label className={styles.dpsLabel}>Notes</label>
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
        </div>
      )}
    </article>
  );
}

export default function Meetings() {
  const { isLoggedIn, token } = useAuth();
  const bounds = weekBounds();
  const [startDate, setStartDate] = useState(bounds.start);
  const [endDate, setEndDate] = useState(bounds.end);
  const [meetings, setMeetings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scrapeJobId, setScrapeJobId] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

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

  async function loadMeetings(includeInactive = showInactive) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMeetings({ startDate, endDate, includeInactive });
      setMeetings(data);
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

  async function handleToggleInactive() {
    const next = !showInactive;
    setShowInactive(next);
    if (meetings !== null) {
      await loadMeetings(next);
    }
  }

  // Group meetings by date for display
  const byDate = meetings
    ? meetings.reduce((acc, m) => {
        const key = m.meeting_date;
        if (!acc[key]) acc[key] = [];
        acc[key].push(m);
        return acc;
      }, {})
    : {};

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Meeting Schedule</h1>
        <div className={styles.legend}>
        <span className={styles.legendItem}><code>*</code> first hearing in first committee of referral</span>
        <span className={styles.legendItem}><code>+</code> teleconferenced</span>
        <span className={styles.legendItem}><code>=</code> previously heard / scheduled</span>
      </div>
      <div className={styles.controls}>
          <div className={styles.dateRow}>
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
          <div className={styles.btnRow}>
            {isLoggedIn && (
              <button className={styles.scrapeBtn} onClick={handleScrape} disabled={!!scrapeJobId}>
                {scrapeJobId ? "Scraping…" : "Scrape from akleg.gov"}
              </button>
            )}
            {meetings !== null && (
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

      {Object.keys(byDate).sort().map((dateKey) => (
        <section key={dateKey} className={styles.daySection}>
          <h2 className={styles.dayHeading}>{fmt(dateKey)}</h2>
          <div className={styles.dayCards}>
            {byDate[dateKey].map((m) => (
              <MeetingCard key={m.id} meeting={m} onNotesSaved={() => loadMeetings()} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

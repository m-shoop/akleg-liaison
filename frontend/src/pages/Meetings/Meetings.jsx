import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { fetchMeetings, scrapeMeetings } from "../../api/meetings";
import { useJob } from "../../hooks/useJob";
import SyncSchedule from "../../components/SyncSchedule/SyncSchedule";
import Toast from "../../components/Toast/Toast";
import MeetingCard from "../../components/MeetingCard/MeetingCard";
import { createMeetingsTour } from "../../tours/meetingsTour";
import { todayJuneau, weekBounds, weekBoundsTitle } from "../../utils/weekBounds";
import styles from "./Meetings.module.css";

function fmt(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function Meetings() {
  const { isEditor, isLoggedIn, token } = useAuth();

  const [searchParams] = useSearchParams();
  const [startDate, setStartDate] = useState(() => searchParams.get("start") || weekBounds().start);
  const [endDate, setEndDate] = useState(() => searchParams.get("end") || weekBounds().end);
  const [allMeetings, setAllMeetings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scrapeJobId, setScrapeJobId] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showHidden, setShowHidden] = useState(() => searchParams.get("show_hidden") === "1");
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("search") || "");
  const [globalExpanded, setGlobalExpanded] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState(new Set());

  function toggleDate(dateKey) {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  const { status: jobStatus, result: jobResult, error: jobError } = useJob(scrapeJobId);

  useEffect(() => {
    if (!scrapeJobId) return;
    if (jobStatus === "complete") {
      loadMeetings();
      setToast({ message: `${jobResult?.meetings_saved ?? 0} hearings refreshed successfully.`, type: "success" });
      setScrapeJobId(null);
    } else if (jobStatus === "failed") {
      setToast({ message: jobError ?? "Refresh failed.", type: "error" });
      setScrapeJobId(null);
    }
  }, [jobStatus]);

  async function loadMeetings() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMeetings({ startDate, endDate, includeInactive: true }, token);
      setAllMeetings(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeetings();
  }, [startDate, endDate, token]);

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

  // Derive visible meetings from allMeetings based on showInactive / showHidden
  const hasInactive = allMeetings?.some((m) => !m.is_active) ?? false;
  const meetings = allMeetings
    ? allMeetings
        .filter((m) => showInactive || m.is_active)
        .filter((m) => showHidden || !m.hidden)
    : null;

  // Filter then group by date
  const query = searchQuery.trim().toLowerCase();

  function matchesQuery(m) {
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
  }

  const filteredMeetings = meetings && query
    ? meetings.filter(matchesQuery)
    : meetings;

  const hiddenMatchCount = !showHidden && query && allMeetings
    ? allMeetings.filter((m) => m.hidden && matchesQuery(m)).length
    : 0;

  const byDate = filteredMeetings
    ? filteredMeetings.reduce((acc, m) => {
        const key = m.meeting_date;
        if (!acc[key]) acc[key] = [];
        acc[key].push(m);
        return acc;
      }, {})
    : {};

  const today = todayJuneau();
  const isToday = startDate === today && endDate === today;
  const activeWeek = [-1, 0, 1].find((o) => {
    const b = weekBounds(o);
    return startDate === b.start && endDate === b.end;
  }) ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.headerCol}>
          <h1 className={styles.title}>Hearing Schedule</h1>
          {meetings !== null && (
            <p className={styles.subtitle}>
              {query
                ? `${filteredMeetings.length} of ${meetings.length} hearing${meetings.length !== 1 ? "s" : ""}`
                : `${meetings.length} hearing${meetings.length !== 1 ? "s" : ""}`}
            </p>
          )}
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
          <div className={styles.weekShortcuts}>
            <button
              className={`${styles.loadBtn} ${isToday ? styles.loadBtnActive : ""}`}
              onClick={() => { setStartDate(today); setEndDate(today); }}
            >
              Today
            </button>
            <button
              className={`${styles.loadBtn} ${activeWeek === -1 ? styles.loadBtnActive : ""}`}
              onClick={() => { const b = weekBounds(-1); setStartDate(b.start); setEndDate(b.end); }}
              title={weekBoundsTitle(-1)}
            >
              Last Week
            </button>
            <button
              className={`${styles.loadBtn} ${activeWeek === 0 ? styles.loadBtnActive : ""}`}
              onClick={() => { const b = weekBounds(0); setStartDate(b.start); setEndDate(b.end); }}
              title={weekBoundsTitle(0)}
            >
              This Week
            </button>
            <button
              className={`${styles.loadBtn} ${activeWeek === 1 ? styles.loadBtnActive : ""}`}
              onClick={() => { const b = weekBounds(1); setStartDate(b.start); setEndDate(b.end); }}
              title={weekBoundsTitle(1)}
            >
              Next Week
            </button>
            {(startDate || endDate) && (
              <button
                className={styles.clearDatesBtn}
                onClick={() => { setStartDate(""); setEndDate(""); }}
              >
                Clear Dates
              </button>
            )}
          </div>
        </div>
        <div className={styles.headerCol}>
          <div id="tour-legend" className={styles.legend}>
            <span className={styles.legendItem}><code>*</code> first hearing in first committee of referral</span>
            <span className={styles.legendItem}><code>+</code> teleconferenced</span>
            <span className={styles.legendItem}><code>=</code> previously heard / scheduled</span>
          </div>
          <div id="tour-controls" className={styles.btnRow}>
            {isEditor && (
              <button
                className={styles.scrapeBtn}
                onClick={handleScrape}
                disabled={!!scrapeJobId || !startDate || !endDate}
                title={(!startDate || !endDate) ? "Select both a From and To date to refresh hearings" : undefined}
              >
                {scrapeJobId ? "Refreshing" : "Refresh hearings from akleg.gov"}
              </button>
            )}
            {meetings !== null && meetings.length > 0 && (
              <button
                id="tour-expand-agendas"
                className={`${styles.loadBtn} ${globalExpanded ? styles.loadBtnActive : ""}`}
                onClick={() => setGlobalExpanded((v) => !v)}
              >
                {globalExpanded ? "Collapse agendas" : "Expand agendas"}
              </button>
            )}
            {isLoggedIn && hasInactive && (
              <button
                id="tour-show-inactive"
                className={`${styles.loadBtn} ${showInactive ? styles.loadBtnActive : ""}`}
                onClick={handleToggleInactive}
                disabled={loading}
              >
                {showInactive ? "Hide inactive" : "Show inactive"}
              </button>
            )}
            {isEditor && (
              <div className={styles.toggleGroup}>
                <button
                  className={`${styles.toggleOption} ${!showHidden ? styles.toggleSelected : ""}`}
                  onClick={() => setShowHidden(false)}
                >
                  Hide hidden
                </button>
                <button
                  className={`${styles.toggleOption} ${showHidden ? styles.toggleSelected : ""}`}
                  onClick={() => setShowHidden(true)}
                >
                  Display hidden
                </button>
              </div>
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
          onClick={() => createMeetingsTour({ isEditor, isLoggedIn }).drive()}
          title="Tour the Meetings page"
        >
          ?
        </button>
      </div>

      {hiddenMatchCount > 0 && (
        <p className={styles.notice}>
          {hiddenMatchCount} hidden hearing{hiddenMatchCount !== 1 ? "s" : ""} {hiddenMatchCount !== 1 ? "match" : "matches"} your search — turn on &ldquo;Display hidden&rdquo; to view {hiddenMatchCount !== 1 ? "them" : "it"}.
        </p>
      )}

      {loading && <p className={styles.loading}>Loading hearings…</p>}
      {scrapeJobId && (
        <p className={styles.notice}>Refreshing hearings from akleg.gov — please stay on this page…</p>
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
          {isEditor && ' Use "Refresh hearings from akleg.gov" to import them.'}
        </p>
      )}
      {meetings !== null && meetings.length > 0 && filteredMeetings.length === 0 && (
        <p className={styles.notice}>No meetings match your search.</p>
      )}

      {(() => {
        let firstCardRendered = false;
        return Object.keys(byDate).sort().map((dateKey) => {
          const isCollapsed = collapsedDates.has(dateKey);
          return (
            <section key={dateKey} className={styles.daySection}>
              <h2 className={styles.dayHeading} onClick={() => toggleDate(dateKey)}>
                <span>{isCollapsed ? "▸" : "▾"}</span>
                {fmt(dateKey)}
                <span className={styles.dayCount}>
                  {byDate[dateKey].length} meeting{byDate[dateKey].length !== 1 ? "s" : ""}
                </span>
              </h2>
              {!isCollapsed && (
                <div className={styles.dayCards}>
                  {byDate[dateKey].map((m) => {
                    const isFirst = !firstCardRendered;
                    if (isFirst) firstCardRendered = true;
                    return (
                      <MeetingCard key={m.id} meeting={m} isFirst={isFirst} globalExpanded={globalExpanded} showHidden={showHidden} onNotesSaved={() => loadMeetings()} onHiddenChanged={(updated) => setAllMeetings((prev) => prev.map((x) => x.id === updated.id ? updated : x))} />
                    );
                  })}
                </div>
              )}
            </section>
          );
        });
      })()}
      <SyncSchedule entries={[
        { label: "Hearings", frequency: "Daily at 4:05 AM and 4:05 PM (Juneau time)" },
      ]} />
    </div>
  );
}

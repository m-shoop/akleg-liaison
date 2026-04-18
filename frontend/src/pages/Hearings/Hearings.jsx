import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { fetchHearings, scrapeHearings } from "../../api/hearings";
import { useJob } from "../../hooks/useJob";
import SyncSchedule from "../../components/SyncSchedule/SyncSchedule";
import Toast from "../../components/Toast/Toast";
import HearingCard from "../../components/HearingCard/HearingCard";
import CalendarView from "../../components/CalendarView/CalendarView";
import { createHearingsTour } from "../../tours/hearingsTour";
import { todayJuneau, weekBounds, weekBoundsTitle, addDays } from "../../utils/weekBounds";
import styles from "./Hearings.module.css";

function fmt(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function Hearings() {
  const { can, isLoggedIn, token, isTokenExpired } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // ─── List view state ───────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(() => searchParams.get("start") || sessionStorage.getItem("hearings_startDate") || weekBounds().start);
  const [endDate, setEndDate] = useState(() => searchParams.get("end") || sessionStorage.getItem("hearings_endDate") || weekBounds().end);

  // ─── Calendar view state ───────────────────────────────────────────────────
  const [activeView, setActiveView] = useState(() => {
    if (searchParams.get("view") === "calendar") return "calendar";
    return sessionStorage.getItem("hearings_view") === "calendar" ? "calendar" : "list";
  });
  const [calendarStartDate, setCalendarStartDate] = useState(() =>
    searchParams.get("calStart") || sessionStorage.getItem("hearings_calStart") || null
  );
  const [daysShown, setDaysShown] = useState(3);

  // ─── Shared state ─────────────────────────────────────────────────────────
  const [allHearings, setAllHearings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scrapeJobId, setScrapeJobId] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showHidden, setShowHidden] = useState(() => {
    if (searchParams.get("show_hidden") === "1") return true;
    return sessionStorage.getItem("hearings_showHidden") === "true";
  });
  const [hideWithoutNotes, setHideWithoutNotes] = useState(false);
  const [additionalFiltersOpen, setAdditionalFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("search") || sessionStorage.getItem("hearings_searchQuery") || "");
  const [globalExpanded, setGlobalExpanded] = useState(() => sessionStorage.getItem("hearings_globalExpanded") === "true");
  const [collapsedDates, setCollapsedDates] = useState(new Set());

  // ─── Derived fetch dates ───────────────────────────────────────────────────
  const calendarEndDate = calendarStartDate ? addDays(calendarStartDate, daysShown - 1) : null;
  const effectiveStart = activeView === "calendar" ? calendarStartDate : startDate;
  const effectiveEnd = activeView === "calendar" ? calendarEndDate : endDate;

  // ─── View switching ────────────────────────────────────────────────────────
  function switchView(view) {
    if (view === "calendar" && activeView === "list") {
      setCalendarStartDate(startDate || todayJuneau());
      setActiveView("calendar");
    } else if (view === "list" && activeView === "calendar") {
      if (calendarStartDate) {
        setStartDate(calendarStartDate);
        setEndDate(calendarEndDate);
      }
      setActiveView("list");
    }
  }

  // ─── Date section collapse (list view) ────────────────────────────────────
  function toggleDate(dateKey) {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  // ─── Job polling ───────────────────────────────────────────────────────────
  const { status: jobStatus, result: jobResult, error: jobError } = useJob(scrapeJobId);

  useEffect(() => {
    if (!scrapeJobId) return;
    if (jobStatus === "complete") {
      loadHearings();
      setToast({ message: `${jobResult?.hearings_saved ?? 0} hearings refreshed successfully.`, type: "success" });
      setScrapeJobId(null);
    } else if (jobStatus === "failed") {
      setToast({ message: jobError ?? "Refresh failed.", type: "error" });
      setScrapeJobId(null);
    }
  }, [jobStatus]);

  // ─── Data fetching ─────────────────────────────────────────────────────────
  async function loadHearings() {
    if (!effectiveStart) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHearings({ startDate: effectiveStart, endDate: effectiveEnd, includeInactive: true, token });
      setAllHearings(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHearings();
  }, [effectiveStart, effectiveEnd, token]);

  useEffect(() => {
    if (isTokenExpired && allHearings) {
      setAllHearings((prev) => prev.map((h) => ({ ...h, dps_notes: null })));
    }
  }, [isTokenExpired]);

  // ─── Sync view/calendar date to URL + sessionStorage ─────────────────────
  useEffect(() => {
    if (activeView === "calendar") {
      sessionStorage.setItem("hearings_view", "calendar");
      if (calendarStartDate) sessionStorage.setItem("hearings_calStart", calendarStartDate);
      else sessionStorage.removeItem("hearings_calStart");
    } else {
      sessionStorage.removeItem("hearings_view");
      sessionStorage.removeItem("hearings_calStart");
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (activeView === "calendar") {
        next.set("view", "calendar");
        if (calendarStartDate) next.set("calStart", calendarStartDate);
        else next.delete("calStart");
      } else {
        next.delete("view");
        next.delete("calStart");
      }
      return next;
    }, { replace: true });
  }, [activeView, calendarStartDate]);

  // ─── Persist Hearings tab settings to sessionStorage ─────────────────────
  useEffect(() => {
    if (searchQuery) sessionStorage.setItem("hearings_searchQuery", searchQuery);
    else sessionStorage.removeItem("hearings_searchQuery");
    sessionStorage.setItem("hearings_startDate", startDate);
    sessionStorage.setItem("hearings_endDate", endDate);
    if (showHidden) sessionStorage.setItem("hearings_showHidden", "true");
    else sessionStorage.removeItem("hearings_showHidden");
    if (globalExpanded) sessionStorage.setItem("hearings_globalExpanded", "true");
    else sessionStorage.removeItem("hearings_globalExpanded");
  }, [searchQuery, startDate, endDate, showHidden, globalExpanded]);

  function resetToDefaults() {
    setSearchQuery("");
    setStartDate(weekBounds().start);
    setEndDate(weekBounds().end);
    setShowHidden(false);
    setHideWithoutNotes(false);
    setGlobalExpanded(false);
    setActiveView("list");
    setCalendarStartDate(null);
  }

  // ─── Scrape handler ────────────────────────────────────────────────────────
  async function handleScrape() {
    setError(null);
    try {
      const job = await scrapeHearings({ startDate: effectiveStart, endDate: effectiveEnd }, token);
      setScrapeJobId(job.id);
    } catch (e) {
      setToast({ message: e.message, type: "error" });
    }
  }

  // ─── Filtering ─────────────────────────────────────────────────────────────
  const hasInactive = allHearings?.some((h) => !h.is_active) ?? false;
  const hearings = allHearings
    ? allHearings
        .filter((h) => showInactive || h.is_active)
        .filter((h) => showHidden || !h.hidden)
        .filter((h) => !hideWithoutNotes || h.dps_notes)
    : null;

  const query = searchQuery.trim().toLowerCase();

  function matchesQuery(h) {
    const agendaText = h.agenda_items
      .flatMap((i) => [i.bill_number, i.content])
      .filter(Boolean)
      .join(" ");
    const title = h.committee_name ?? "Floor Session";
    const haystack = [title, h.committee_type, h.location, h.dps_notes, agendaText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  }

  const filteredHearings = hearings && query ? hearings.filter(matchesQuery) : hearings;

  const hiddenMatchCount =
    !showHidden && query && allHearings
      ? allHearings.filter((h) => h.hidden && matchesQuery(h)).length
      : 0;

  // Group by date (list view only)
  const byDate = filteredHearings
    ? filteredHearings.reduce((acc, h) => {
        const key = h.hearing_date;
        if (!acc[key]) acc[key] = [];
        acc[key].push(h);
        return acc;
      }, {})
    : {};

  const today = todayJuneau();
  const isToday = startDate === today && endDate === today;
  const activeWeek =
    [-1, 0, 1].find((o) => {
      const b = weekBounds(o);
      return startDate === b.start && endDate === b.end;
    }) ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        {/* ── Left column ── */}
        <div className={styles.headerCol}>
          <h1 className={styles.title}>Hearing Schedule</h1>
          {hearings !== null && (
            <p className={styles.subtitle}>
              {query
                ? `${filteredHearings.length} of ${hearings.length} hearing${hearings.length !== 1 ? "s" : ""}`
                : `${hearings.length} hearing${hearings.length !== 1 ? "s" : ""}`}
            </p>
          )}

          {/* Date inputs — layout changes per view */}
          {activeView === "list" ? (
            <>
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
            </>
          ) : (
            <div id="tour-calendar-start-date" className={styles.dateRow}>
              <label>
                Starting Date
                <input
                  type="date"
                  value={calendarStartDate ?? ""}
                  onChange={(e) => setCalendarStartDate(e.target.value)}
                  className={styles.dateInput}
                />
              </label>
              <button
                className={`${styles.loadBtn} ${calendarStartDate === today ? styles.loadBtnActive : ""}`}
                onClick={() => setCalendarStartDate(today)}
              >
                Today
              </button>
            </div>
          )}
          <button className={styles.defaultBtn} onClick={resetToDefaults}>
            Default Settings
          </button>
        </div>

        {/* ── Right column ── */}
        <div className={styles.headerCol}>
          {/* View toggle — desktop only */}
          <div id="tour-view-toggle" className={styles.viewToggle}>
            <button
              className={`${styles.toggleOption} ${activeView === "list" ? styles.toggleSelected : ""}`}
              onClick={() => switchView("list")}
              title="List view"
            >
              <svg className={styles.toggleIcon} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <rect x="1" y="3" width="14" height="2" rx="1" />
                <rect x="1" y="7" width="14" height="2" rx="1" />
                <rect x="1" y="11" width="14" height="2" rx="1" />
              </svg>
              List
            </button>
            <button
              className={`${styles.toggleOption} ${activeView === "calendar" ? styles.toggleSelected : ""}`}
              onClick={() => switchView("calendar")}
              title="Calendar view"
            >
              <svg className={styles.toggleIcon} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <rect x="1" y="3" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <line x1="5" y1="1" x2="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="11" y1="1" x2="11" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              Calendar
            </button>
          </div>

          <div id="tour-legend" className={styles.legend}>
            <span className={styles.legendItem}><code>*</code> first hearing in first committee of referral</span>
            <span className={styles.legendItem}><code>+</code> teleconferenced</span>
            <span className={styles.legendItem}><code>=</code> previously heard / scheduled</span>
          </div>
          <div id="tour-controls" className={styles.btnRow}>
            {can("hearing:query") && (
              <button
                className={styles.scrapeBtn}
                onClick={handleScrape}
                disabled={!!scrapeJobId || !effectiveStart || !effectiveEnd}
                title={
                  scrapeJobId
                    ? `Refreshing for dates: ${effectiveStart} through ${effectiveEnd}`
                    : (!effectiveStart || !effectiveEnd)
                    ? "Select dates to refresh hearings"
                    : undefined
                }
              >
                {scrapeJobId ? "Refreshing..." : "Refresh hearings from akleg.gov"}
              </button>
            )}
            {/* Expand agendas — list view only, but state is preserved on switch */}
            {activeView === "list" && hearings !== null && hearings.length > 0 && (
              <button
                id="tour-expand-agendas"
                className={`${styles.loadBtn} ${globalExpanded ? styles.loadBtnActive : ""}`}
                onClick={() => setGlobalExpanded((v) => !v)}
              >
                {globalExpanded ? "Collapse agendas" : "Expand agendas"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Additional Filters collapsible */}
      <div className={styles.additionalFilters}>
        <button
          className={styles.additionalFiltersHeader}
          onClick={() => setAdditionalFiltersOpen((v) => !v)}
        >
          <span>Additional Filters</span>
          <span className={`${styles.collapseArrow} ${additionalFiltersOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
        </button>
        {additionalFiltersOpen && (
          <div className={styles.filtersRow}>
            {isLoggedIn && hasInactive && (
              <div id="tour-show-inactive" className={styles.toggleGroup}>
                <button
                  className={`${styles.toggleOption} ${!showInactive ? styles.toggleSelected : ""}`}
                  onClick={() => setShowInactive(false)}
                  disabled={loading}
                >
                  Hide inactive
                </button>
                <button
                  className={`${styles.toggleOption} ${showInactive ? styles.toggleSelected : ""}`}
                  onClick={() => setShowInactive(true)}
                  disabled={loading}
                >
                  Show inactive
                </button>
              </div>
            )}
            {can("hearing:hide") && (
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
            <div className={styles.toggleGroup}>
              <button
                className={`${styles.toggleOption} ${!hideWithoutNotes ? styles.toggleSelected : ""}`}
                onClick={() => setHideWithoutNotes(false)}
              >
                Display Hearings Without Notes
              </button>
              <button
                className={`${styles.toggleOption} ${hideWithoutNotes ? styles.toggleSelected : ""}`}
                onClick={() => setHideWithoutNotes(true)}
              >
                Hide Hearings Without Notes
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search row */}
      <div className={styles.searchRow}>
        <input
          id="tour-meetings-search"
          className={styles.searchInput}
          type="search"
          placeholder="Search floor and committee hearings…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className={styles.helpBtn}
          onClick={() =>
            createHearingsTour({ isEditor: can("hearing:query"), activeView }).drive()
          }
          title="Tour the Hearings page"
        >
          ?
        </button>
      </div>

      {/* Notices */}
      {hiddenMatchCount > 0 && (
        <p className={styles.notice}>
          {hiddenMatchCount} hidden hearing{hiddenMatchCount !== 1 ? "s" : ""}{" "}
          {hiddenMatchCount !== 1 ? "match" : "matches"} your search — turn on &ldquo;Display
          hidden&rdquo; to view {hiddenMatchCount !== 1 ? "them" : "it"}.
        </p>
      )}
      {loading && activeView === "list" && <p className={styles.loading}>Loading hearings…</p>}
      {error && <p className={styles.error}>{error}</p>}
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />

      {/* Empty state messages — list view only */}
      {activeView === "list" && hearings !== null && hearings.length === 0 && (
        <p className={styles.notice}>
          No hearings found for this date range.
          {can("hearing:query") && ' Use "Refresh hearings from akleg.gov" to import them.'}
        </p>
      )}
      {hearings !== null && hearings.length > 0 && filteredHearings.length === 0 && (
        <p className={styles.notice}>No hearings match your search.</p>
      )}

      {/* ── Calendar view ── */}
      {activeView === "calendar" && calendarStartDate && (
        <CalendarView
          hearings={filteredHearings ?? []}
          startDate={calendarStartDate}
          daysShown={daysShown}
          onDaysShownChange={setDaysShown}
          onNavigate={setCalendarStartDate}
          isFiltered={!!query}
          loading={loading}
          noHearingsInRange={hearings !== null && hearings.length === 0}
          onHearingReload={loadHearings}
          showHidden={showHidden}
          onHiddenChanged={(updated) =>
            setAllHearings((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
          }
        />
      )}

      {/* ── List view ── */}
      {activeView === "list" && (() => {
        let firstCardRendered = false;
        return Object.keys(byDate)
          .sort()
          .map((dateKey) => {
            const isCollapsed = collapsedDates.has(dateKey);
            return (
              <section key={dateKey} className={styles.daySection}>
                <h2 className={styles.dayHeading} onClick={() => toggleDate(dateKey)}>
                  <span>{isCollapsed ? "▸" : "▾"}</span>
                  {fmt(dateKey)}
                  <span className={styles.dayCount}>
                    {byDate[dateKey].length} hearing{byDate[dateKey].length !== 1 ? "s" : ""}
                  </span>
                </h2>
                {!isCollapsed && (
                  <div className={styles.dayCards}>
                    {byDate[dateKey].map((h) => {
                      const isFirst = !firstCardRendered;
                      if (isFirst) firstCardRendered = true;
                      return (
                        <HearingCard
                          key={h.id}
                          hearing={h}
                          isFirst={isFirst}
                          globalExpanded={globalExpanded}
                          showHidden={showHidden}
                          onNotesSaved={() => loadHearings()}
                          onHiddenChanged={(updated) =>
                            setAllHearings((prev) =>
                              prev.map((x) => (x.id === updated.id ? updated : x))
                            )
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          });
      })()}

      <SyncSchedule
        entries={[{ label: "Hearings", frequency: "Daily at 4:05 AM and 4:05 PM (Juneau time)" }]}
      />
    </div>
  );
}

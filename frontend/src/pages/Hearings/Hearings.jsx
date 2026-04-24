import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { scrapeHearings } from "../../api/hearings";
import { fetchReport, fetchReportMeta } from "../../api/reports";
import { useJob } from "../../hooks/useJob";
import SyncSchedule from "../../components/SyncSchedule/SyncSchedule";
import Toast from "../../components/Toast/Toast";
import HearingCard from "../../components/HearingCard/HearingCard";
import CalendarView from "../../components/CalendarView/CalendarView";
import HearingsFilterBar from "../../components/HearingsFilterBar/HearingsFilterBar";
import { createHearingsTour } from "../../tours/hearingsTour";
import { todayJuneau, weekBounds, addDays } from "../../utils/weekBounds";
import styles from "./Hearings.module.css";

function fmt(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const DEFAULT_FILTERS = {
  hearingDateMode: "range",
  hearingDateOn: "",
  hearingDateFrom: weekBounds().start,
  hearingDateTo: weekBounds().end,
  chamber: [],
  legislature_session: [],
  showInactive: false,
  showHidden: false,
  advanced: {},
};

function buildFilterGroup(filters, { canHide, canNotes }) {
  const conditions = [];

  if (filters.hearingDateMode === "on" && filters.hearingDateOn) {
    conditions.push({ field: "hearing_date", op: "equals", value: filters.hearingDateOn });
  } else if (filters.hearingDateMode === "range") {
    const { hearingDateFrom: from, hearingDateTo: to } = filters;
    if (from && to) conditions.push({ field: "hearing_date", op: "between", value: [from, to] });
    else if (from) conditions.push({ field: "hearing_date", op: "after", value: from });
    else if (to) conditions.push({ field: "hearing_date", op: "before", value: to });
  }

  if (filters.chamber?.length > 0) {
    conditions.push({ field: "chamber", op: "in", value: filters.chamber });
  }
  if (filters.legislature_session?.length > 0) {
    conditions.push({ field: "legislature_session", op: "in", value: filters.legislature_session });
  }

  if (!filters.showInactive) {
    conditions.push({ field: "is_active", op: "equals", value: true });
  }
  if (!canHide || !filters.showHidden) {
    conditions.push({ field: "hidden", op: "equals", value: false });
  }

  const adv = filters.advanced ?? {};
  if (adv.agenda_bill_number?.trim()) conditions.push({ field: "agenda_bill_number", op: "contains", value: adv.agenda_bill_number.trim() });
  if (adv.hearing_type?.length > 0) conditions.push({ field: "hearing_type", op: "in", value: adv.hearing_type });
  if (adv.location) conditions.push({ field: "location", op: "contains", value: adv.location });
  if (adv.committee_name) conditions.push({ field: "committee_name", op: "contains", value: adv.committee_name });
  if (adv.committee_type) conditions.push({ field: "committee_type", op: "contains", value: adv.committee_type });
  if (canNotes) {
    const notesMode = adv.dps_notes_mode ?? "any";
    if (notesMode === "has") conditions.push({ field: "dps_notes", op: "is_not_empty" });
    else if (notesMode === "empty") conditions.push({ field: "dps_notes", op: "is_empty" });
    else if (notesMode === "contains" && adv.dps_notes) conditions.push({ field: "dps_notes", op: "contains", value: adv.dps_notes });
  }

  if (adv.has_tracked_bill_without_assignment === true) {
    conditions.push({ field: "has_tracked_bill_without_assignment", op: "equals", value: true });
  }

  return { logic: "AND", conditions };
}

function buildCalendarFilterGroup(calendarFrom, calendarTo, filters, permissions) {
  const calendarFilters = {
    ...filters,
    hearingDateMode: "range",
    hearingDateFrom: calendarFrom,
    hearingDateTo: calendarTo,
  };
  return buildFilterGroup(calendarFilters, permissions);
}

function rowToHearing(row) {
  return {
    id: row.id,
    hearing_date: row.hearing_date,
    hearing_time: row.hearing_time ?? null,
    chamber: row.chamber,
    hearing_type: row.hearing_type,
    location: row.location ?? null,
    committee_name: row.committee_name ?? null,
    committee_type: row.committee_type ?? null,
    committee_url: row.committee_url ?? null,
    legislature_session: row.legislature_session,
    is_active: row.is_active,
    hidden: row.hidden ?? false,
    dps_notes: row.dps_notes ?? null,
    last_sync: row.last_sync ?? null,
    has_prior_agendas: false,
    agenda_items: Array.isArray(row.agenda_items)
      ? [...row.agenda_items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : [],
    hearing_assignments_summary: Array.isArray(row.hearing_assignments_summary)
      ? row.hearing_assignments_summary
      : [],
  };
}

function getColumns(can) {
  const cols = [
    "id", "hearing_date", "hearing_time", "chamber", "hearing_type", "location",
    "legislature_session", "is_active", "last_sync", "committee_name",
    "committee_type", "committee_url", "agenda_items",
  ];
  if (can("hearing:hide")) cols.push("hidden");
  if (can("hearing-notes:view")) cols.push("dps_notes");
  if (can("hearing-assignment:view")) cols.push("hearing_assignments_summary");
  return cols;
}

export default function Hearings() {
  const { can, token, isTokenExpired } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeView, setActiveView] = useState(() => {
    if (searchParams.get("view") === "calendar") return "calendar";
    return sessionStorage.getItem("hearings_view") === "calendar" ? "calendar" : "list";
  });
  const [calendarStartDate, setCalendarStartDate] = useState(() =>
    searchParams.get("calStart") || sessionStorage.getItem("hearings_calStart") || null
  );
  const [daysShown, setDaysShown] = useState(3);

  const [hearingFilters, setHearingFilters] = useState(() => {
    const stored = sessionStorage.getItem("hearings_filters");
    if (stored) { try { return JSON.parse(stored); } catch { /* ignore */ } }
    return DEFAULT_FILTERS;
  });

  const [reportFields, setReportFields] = useState(null);
  const [allHearings, setAllHearings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scrapeJobId, setScrapeJobId] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [globalExpanded, setGlobalExpanded] = useState(() => sessionStorage.getItem("hearings_globalExpanded") === "true");
  const [reportCriteriaOpen, setReportCriteriaOpen] = useState(() => sessionStorage.getItem("hearings_reportCriteriaOpen") === "true");
  const [collapsedDates, setCollapsedDates] = useState(new Set());
  const fetchTimerRef = useRef(null);

  const calendarEndDate = calendarStartDate ? addDays(calendarStartDate, daysShown - 1) : null;
  const permissions = { canHide: can("hearing:hide"), canNotes: can("hearing-notes:view") };

  // ─── Load report field metadata (for enum options in FilterBar) ───────────
  useEffect(() => {
    fetchReportMeta(token)
      .then((data) => {
        const meta = data.reports?.find((r) => r.id === "hearings");
        setReportFields(meta?.fields ?? null);
      })
      .catch(() => {});
  }, [token]);

  // ─── Persist filters and UI state ─────────────────────────────────────────
  useEffect(() => {
    sessionStorage.setItem("hearings_filters", JSON.stringify(hearingFilters));
  }, [hearingFilters]);

  useEffect(() => {
    if (globalExpanded) sessionStorage.setItem("hearings_globalExpanded", "true");
    else sessionStorage.removeItem("hearings_globalExpanded");
    if (reportCriteriaOpen) sessionStorage.setItem("hearings_reportCriteriaOpen", "true");
    else sessionStorage.removeItem("hearings_reportCriteriaOpen");
  }, [globalExpanded, reportCriteriaOpen]);

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

  // ─── View switching ────────────────────────────────────────────────────────
  function switchView(view) {
    if (view === "calendar" && activeView === "list") {
      setCalendarStartDate(hearingFilters.hearingDateFrom || todayJuneau());
      setActiveView("calendar");
    } else if (view === "list" && activeView === "calendar") {
      if (calendarStartDate) {
        setHearingFilters((f) => ({ ...f, hearingDateMode: "range", hearingDateFrom: calendarStartDate, hearingDateTo: calendarEndDate }));
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
  function loadHearings() {
    clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const filters =
          activeView === "calendar" && calendarStartDate
            ? buildCalendarFilterGroup(calendarStartDate, calendarEndDate, hearingFilters, permissions)
            : buildFilterGroup(hearingFilters, permissions);

        const data = await fetchReport({
          reportId: "hearings",
          columns: getColumns(can),
          filters,
          sortBy: ["hearing_date", "hearing_time"],
          sortDir: "asc",
          pageSize: 2000,
          token,
        });
        setAllHearings(data.rows.map(rowToHearing));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  useEffect(() => {
    loadHearings();
    return () => clearTimeout(fetchTimerRef.current);
  }, [JSON.stringify(hearingFilters), activeView, calendarStartDate, calendarEndDate, token]);

  useEffect(() => {
    if (isTokenExpired && allHearings) {
      setAllHearings((prev) => prev.map((h) => ({ ...h, dps_notes: null })));
    }
  }, [isTokenExpired]);

  // ─── Scrape handler ────────────────────────────────────────────────────────
  async function handleScrape() {
    setError(null);
    const from = activeView === "calendar" ? calendarStartDate : hearingFilters.hearingDateFrom;
    const to = activeView === "calendar" ? calendarEndDate : hearingFilters.hearingDateTo;
    try {
      const job = await scrapeHearings({ startDate: from, endDate: to }, token);
      setScrapeJobId(job.id);
    } catch (e) {
      setToast({ message: e.message, type: "error" });
    }
  }

  function resetToDefaults() {
    setHearingFilters(DEFAULT_FILTERS);
    setGlobalExpanded(false);
    setActiveView("list");
    setCalendarStartDate(null);
  }

  // ─── Derived data (list view) ──────────────────────────────────────────────
  const hearings = allHearings ?? [];

  const byDate = hearings.reduce((acc, h) => {
    const key = h.hearing_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(h);
    return acc;
  }, {});

  const effectiveFrom = activeView === "calendar" ? calendarStartDate : hearingFilters.hearingDateFrom;
  const effectiveTo = activeView === "calendar" ? calendarEndDate : hearingFilters.hearingDateTo;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        {/* ── Left column ── */}
        <div className={styles.headerCol}>
          <h1 className={styles.title}>Hearing Schedule</h1>
          {allHearings !== null && (
            <p className={styles.subtitle}>
              {hearings.length} hearing{hearings.length !== 1 ? "s" : ""}
            </p>
          )}

          <button className={styles.defaultBtn} onClick={resetToDefaults}>
            Default Settings
          </button>
        </div>

        {/* ── Right column ── */}
        <div className={styles.headerCol}>
          {/* View toggle */}
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
                disabled={!!scrapeJobId || !effectiveFrom || !effectiveTo}
                title={
                  scrapeJobId
                    ? `Refreshing for dates: ${effectiveFrom} through ${effectiveTo}`
                    : (!effectiveFrom || !effectiveTo)
                    ? "Select dates to refresh hearings"
                    : undefined
                }
              >
                {scrapeJobId ? "Refreshing..." : "Refresh hearings from akleg.gov"}
              </button>
            )}
            {activeView === "list" && allHearings !== null && hearings.length > 0 && (
              <button
                id="tour-expand-agendas"
                className={`${styles.loadBtn} ${globalExpanded ? styles.loadBtnActive : ""}`}
                onClick={() => setGlobalExpanded((v) => !v)}
              >
                {globalExpanded ? "Collapse agendas" : "Expand agendas"}
              </button>
            )}
            <button
              className={styles.helpBtn}
              onClick={() => createHearingsTour({ isEditor: can("hearing:query"), activeView }).drive()}
              title="Tour the Hearings page"
            >
              ?
            </button>
          </div>
        </div>
      </div>

      {/* Report Criteria collapsible */}
      <div className={styles.additionalFilters}>
        <button
          className={styles.additionalFiltersHeader}
          onClick={() => setReportCriteriaOpen((v) => !v)}
        >
          <span>Report Criteria</span>
          <span className={`${styles.collapseArrow} ${reportCriteriaOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
        </button>
        {reportCriteriaOpen && (
          <HearingsFilterBar
            filters={
              activeView === "calendar" && calendarStartDate
                ? { ...hearingFilters, hearingDateMode: "range", hearingDateFrom: calendarStartDate, hearingDateTo: calendarEndDate ?? "" }
                : hearingFilters
            }
            onChange={setHearingFilters}
            fields={reportFields}
            canHide={can("hearing:hide")}
            canNotes={can("hearing-notes:view")}
            hideDateFilter={activeView === "calendar"}
          />
        )}
      </div>

      {/* Notices */}
      {loading && activeView === "list" && <div className={styles.loadingOverlay}><span className={styles.loadingText}>Loading…</span></div>}
      {error && <p className={styles.error}>{error}</p>}
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />

      {activeView === "list" && allHearings !== null && hearings.length === 0 && !loading && (
        <p className={styles.notice}>
          No hearings found for this date range.
          {can("hearing:query") && ' Use "Refresh hearings from akleg.gov" to import them.'}
        </p>
      )}

      {/* ── Calendar view ── */}
      {activeView === "calendar" && calendarStartDate && (
        <CalendarView
          hearings={hearings}
          startDate={calendarStartDate}
          daysShown={daysShown}
          onDaysShownChange={setDaysShown}
          onNavigate={setCalendarStartDate}
          isFiltered={false}
          loading={loading}
          noHearingsInRange={allHearings !== null && hearings.length === 0}
          onHearingReload={loadHearings}
          showHidden={hearingFilters.showHidden}
          onHiddenChanged={(updated) =>
            setAllHearings((prev) => prev.map((x) => (x.id === updated.id ? { ...x, hidden: updated.hidden } : x)))
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
                          showHidden={hearingFilters.showHidden}
                          onNotesSaved={() => loadHearings()}
                          onAssignmentCreated={() => loadHearings()}
                          onHiddenChanged={(updated) =>
                            setAllHearings((prev) =>
                              prev.map((x) => (x.id === updated.id ? { ...x, hidden: updated.hidden } : x))
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { scrapeHearings } from "../../api/hearings";
import { fetchReport, fetchReportMeta } from "../../api/reports";
import { useJob } from "../../hooks/useJob";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import SyncSchedule from "../../components/SyncSchedule/SyncSchedule";
import Toast from "../../components/Toast/Toast";
import HearingCard from "../../components/HearingCard/HearingCard";
import CalendarView from "../../components/CalendarView/CalendarView";
import HearingsFilterBar from "../../components/HearingsFilterBar/HearingsFilterBar";
import StackingCriteria from "../../components/StackingCriteria/StackingCriteria";
import { createInitialState } from "../../components/StackingCriteria/createInitialState";
import { compile } from "../../components/StackingCriteria/expression/compiler";
import { validate } from "../../components/StackingCriteria/expression/validate";
import SavedReportsBar from "../../components/SavedReports/SavedReportsBar";
import SaveAsModal from "../../components/SavedReports/SaveAsModal";
import SettingsModal from "../../components/SavedReports/SettingsModal";
import ReportFiltersSummary from "../../components/SavedReports/ReportFiltersSummary";
import { useSavedReports } from "../../hooks/useSavedReports";
import { createHearingsTour } from "../../tours/hearingsTour";
import { addDays, todayJuneau, weekBounds, weekBoundsTitle } from "../../utils/weekBounds";
import {
  makeDefaultRowValue,
  makeNewRowValue,
  makeDefaultHearingsCriteria,
  buildHearingsRowFilterGroup,
  summarizeHearingsRow,
  adjustedCalendarStart,
  getRowDateConstraints,
} from "./stackingHelpers";
import styles from "./Hearings.module.css";

const STORAGE_KEY = "hearings_stacking";
const LEGACY_STORAGE_KEY = "hearings_filters";

// Search terms for each assignment status. Includes both the user-facing label
// and the raw type so e.g. "complete", "completed", "open", "assigned",
// "reassign", "suggested", and "canceled" all match.
const ASSIGNMENT_STATUS_SEARCH_TERMS = {
  hearing_assigned: "assigned open",
  hearing_reassigned: "assigned open reassigned",
  hearing_assignment_complete: "complete completed",
  reassignment_request: "reassign reassignment requested",
  auto_suggested_hearing_assignment: "suggested suggestion",
  hearing_assignment_canceled: "canceled cancelled",
  hearing_assignment_discarded: "discarded",
};

function fmt(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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
    has_prior_agendas: row.has_prior_agendas ?? false,
    agenda_items: Array.isArray(row.agenda_items)
      ? [...row.agenda_items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : [],
    hearing_assignments_summary: Array.isArray(row.hearing_assignments_summary)
      ? row.hearing_assignments_summary
      : [],
  };
}

function HearingsRowEditor({ value, onChange, fields, canNotes, hideDateFilter }) {
  return (
    <HearingsFilterBar
      filters={value ?? makeNewRowValue()}
      onChange={onChange}
      fields={fields}
      canNotes={canNotes}
      hideDateFilter={hideDateFilter}
    />
  );
}

function getColumns(can) {
  const cols = [
    "id", "hearing_date", "hearing_time", "chamber", "hearing_type", "location",
    "legislature_session", "is_active", "hidden", "last_sync", "committee_name",
    "committee_type", "committee_url", "agenda_items",
  ];
  if (can("hearing-notes:view")) cols.push("dps_notes");
  if (can("hearing-assignment:view")) cols.push("hearing_assignments_summary");
  if (can("prior-hearing-agendas:view")) cols.push("has_prior_agendas");
  return cols;
}

function loadStoredCriteria() {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (
        parsed &&
        Array.isArray(parsed.criteria) &&
        typeof parsed.expression === "string" &&
        Number.isInteger(parsed.nextLetterIndex)
      ) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  return makeDefaultHearingsCriteria();
}

export default function Hearings() {
  const { can, token, isTokenExpired, username } = useAuth();
  const canSystemEdit = can("system-report:edit");
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useMediaQuery("(max-width: 640px)");

  const [activeView, setActiveView] = useState(() => {
    if (searchParams.get("view") === "calendar") return "calendar";
    return sessionStorage.getItem("hearings_view") === "calendar" ? "calendar" : "list";
  });
  const [calendarStartDate, setCalendarStartDate] = useState(() =>
    searchParams.get("calStart") || sessionStorage.getItem("hearings_calStart") || null
  );
  const [daysShown, setDaysShown] = useState(3);

  const [hearingsCriteria, setHearingsCriteria] = useState(loadStoredCriteria);
  const [appliedCriteria, setAppliedCriteria] = useState(hearingsCriteria);
  const [searchQuery, setSearchQuery] = useState(() => sessionStorage.getItem("hearings_searchQuery") ?? "");

  const [reportFields, setReportFields] = useState(null);
  const [allHearings, setAllHearings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scrapeJobId, setScrapeJobId] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [globalExpanded, setGlobalExpanded] = useState(() => sessionStorage.getItem("hearings_globalExpanded") === "true");
  const [showCanceledAssignments, setShowCanceledAssignments] = useState(() => sessionStorage.getItem("hearings_showCanceledAssignments") === "true");
  // Always collapsed on navigation to keep the page visually quiet; the panel
  // contents (criteria, options) are still preserved between visits.
  const [reportCriteriaOpen, setReportCriteriaOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [calendarShowHidden, setCalendarShowHidden] = useState(() => sessionStorage.getItem("hearings_calendarShowHidden") === "true");
  const [calendarShowInactive, setCalendarShowInactive] = useState(() => sessionStorage.getItem("hearings_calendarShowInactive") === "true");
  const [refreshStartDate, setRefreshStartDate] = useState(() => sessionStorage.getItem("hearings_refreshStart") ?? "");
  const [refreshEndDate, setRefreshEndDate] = useState(() => sessionStorage.getItem("hearings_refreshEnd") ?? "");
  const [collapsedDates, setCollapsedDates] = useState(new Set());
  const fetchTimerRef = useRef(null);

  const calendarEndDate = calendarStartDate ? addDays(calendarStartDate, daysShown - 1) : null;
  const canNotes = can("hearing-notes:view");

  // ─── Consume URL params from "Upcoming Hearings" bill links ──────────────
  // Current shape (from BillCard): /hearings?bill=SB+16&start=2026-04-29&end=2027-04-29&show_hidden=1
  // Legacy shape (kept working):  /hearings?search=HB+62&start=2026-04-19&end=2026-04-25&show_hidden=1
  useEffect(() => {
    const bill = searchParams.get("bill");
    const search = searchParams.get("search");
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const hasShowHidden = searchParams.has("show_hidden");
    if (!bill && !search && !start && !end && !hasShowHidden) return;

    // The page-level search box does substring matching, so seeding it from
    // a bill number causes "SB 16" to incorrectly hit "SB 168". The new `bill`
    // param drives the discrete agenda_bill_numbers filter instead and leaves
    // the search box empty.
    setSearchQuery(bill ? "" : (search ?? ""));

    const seedRow = makeDefaultRowValue();
    if (start || end) {
      seedRow.hearingDateMode = "range";
      if (start) seedRow.hearingDateFrom = start;
      if (end) seedRow.hearingDateTo = end;
    }
    if (hasShowHidden) {
      seedRow.showHidden = searchParams.get("show_hidden") === "1";
    }
    if (bill) {
      seedRow.advanced = { ...seedRow.advanced, agenda_bill_numbers: [bill.toUpperCase()] };
    }
    const next = createInitialState({ seedRows: [seedRow] });
    setHearingsCriteria(next);
    setAppliedCriteria(next);

    setActiveView("list");
    setCalendarStartDate(null);

    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      nextParams.delete("bill");
      nextParams.delete("search");
      nextParams.delete("start");
      nextParams.delete("end");
      nextParams.delete("show_hidden");
      return nextParams;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Load report field metadata ───────────────────────────────────────────
  useEffect(() => {
    fetchReportMeta(token)
      .then((data) => {
        const meta = data.reports?.find((r) => r.id === "hearings");
        setReportFields(meta?.fields ?? null);
      })
      .catch(() => {});
  }, [token]);

  // ─── Persist to sessionStorage ────────────────────────────────────────────
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(hearingsCriteria));
  }, [hearingsCriteria]);

  useEffect(() => {
    if (searchQuery) sessionStorage.setItem("hearings_searchQuery", searchQuery);
    else sessionStorage.removeItem("hearings_searchQuery");
  }, [searchQuery]);

  useEffect(() => {
    if (globalExpanded) sessionStorage.setItem("hearings_globalExpanded", "true");
    else sessionStorage.removeItem("hearings_globalExpanded");
    sessionStorage.removeItem("hearings_reportCriteriaOpen");
    sessionStorage.removeItem("hearings_optionsOpen");
    if (showCanceledAssignments) sessionStorage.setItem("hearings_showCanceledAssignments", "true");
    else sessionStorage.removeItem("hearings_showCanceledAssignments");
    if (calendarShowHidden) sessionStorage.setItem("hearings_calendarShowHidden", "true");
    else sessionStorage.removeItem("hearings_calendarShowHidden");
    if (calendarShowInactive) sessionStorage.setItem("hearings_calendarShowInactive", "true");
    else sessionStorage.removeItem("hearings_calendarShowInactive");
  }, [globalExpanded, showCanceledAssignments, calendarShowHidden, calendarShowInactive]);

  useEffect(() => {
    if (refreshStartDate) sessionStorage.setItem("hearings_refreshStart", refreshStartDate);
    else sessionStorage.removeItem("hearings_refreshStart");
    if (refreshEndDate) sessionStorage.setItem("hearings_refreshEnd", refreshEndDate);
    else sessionStorage.removeItem("hearings_refreshEnd");
  }, [refreshStartDate, refreshEndDate]);

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
    setActiveView(view);
  }

  // Auto-adjust calendar start when entering calendar view (mount or switch).
  // Per design: keeps the user's start date if it falls within any row's date
  // selection; otherwise jumps to the earliest selected date, or today if no
  // date selections exist anywhere.
  useEffect(() => {
    if (activeView !== "calendar") return;
    setCalendarStartDate((prev) => adjustedCalendarStart(prev, appliedCriteria.criteria));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

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

  // ─── Compile applied criteria into a FilterGroup ───────────────────────────
  function compileRow(row) {
    return buildHearingsRowFilterGroup(row.value, { canNotes, username });
  }

  function compileAppliedFilterGroup() {
    const { ast } = validate(appliedCriteria.expression, appliedCriteria.criteria);
    return compile(ast, appliedCriteria.criteria, compileRow);
  }

  function buildCalendarFilterGroup() {
    const conditions = [];
    if (calendarStartDate && calendarEndDate) {
      conditions.push({ field: "hearing_date", op: "between", value: [calendarStartDate, calendarEndDate] });
    }
    if (!calendarShowInactive) {
      conditions.push({ field: "is_active", op: "equals", value: true });
    }
    if (!calendarShowHidden) {
      conditions.push({ field: "hidden", op: "equals", value: false });
    }
    return { logic: "AND", conditions, groups: [] };
  }

  // ─── Data fetching ─────────────────────────────────────────────────────────
  function loadHearings() {
    // Calendar view needs a date range to fetch; the activeView effect will set
    // calendarStartDate momentarily and trigger a re-fetch.
    if (activeView === "calendar" && !calendarStartDate) return;
    clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const filters = activeView === "calendar"
          ? buildCalendarFilterGroup()
          : compileAppliedFilterGroup();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeView,
    appliedCriteria,
    calendarStartDate,
    calendarEndDate,
    calendarShowHidden,
    calendarShowInactive,
    token,
  ]);

  useEffect(() => {
    if (isTokenExpired && allHearings) {
      setAllHearings((prev) => prev.map((h) => ({ ...h, dps_notes: null })));
    }
  }, [isTokenExpired]);

  // ─── Scrape handler ────────────────────────────────────────────────────────
  async function handleScrape() {
    setError(null);
    if (!refreshStartDate || !refreshEndDate) return;
    try {
      const job = await scrapeHearings(
        { startDate: refreshStartDate, endDate: refreshEndDate },
        token,
      );
      setScrapeJobId(job.id);
    } catch (e) {
      setToast({ message: e.message, type: "error" });
    }
  }

  function resetToDefaults() {
    setSearchQuery("");
    setGlobalExpanded(false);
    setShowCanceledAssignments(false);
    setCalendarShowHidden(false);
    setCalendarShowInactive(false);
    setActiveView("list");
    setCalendarStartDate(null);

    // Auto-select the seeded "Hearings This Week" system report if active and
    // visible to this user; otherwise reset criteria to the local default.
    const loadedSeed = savedReports.selectSystemReportByName("Hearings This Week");
    if (!loadedSeed) {
      const def = makeDefaultHearingsCriteria();
      setHearingsCriteria(def);
      setAppliedCriteria(def);
      savedReports.clearLoadedReport();
    }
  }

  function handleStackingApply(_filterGroup, value) {
    if (activeView === "calendar") {
      const before = JSON.stringify(getRowDateConstraints(appliedCriteria.criteria));
      const after = JSON.stringify(getRowDateConstraints(value.criteria));
      if (before !== after) {
        setCalendarStartDate((prev) => adjustedCalendarStart(prev, value.criteria));
      }
    }
    setAppliedCriteria(value);
    setReportCriteriaOpen(false);
  }

  const hadStoredCriteriaOnMount = useRef(!!sessionStorage.getItem(STORAGE_KEY));
  const savedReports = useSavedReports({
    registryName: "hearings",
    currentCriteria: hearingsCriteria,
    onLoad: (criteria) => {
      setHearingsCriteria(criteria);
      setAppliedCriteria(criteria);
    },
    token,
    username,
    skipDefaultLoad: hadStoredCriteriaOnMount.current,
    canSystemEdit,
  });

  // ─── Derived data (list view) ──────────────────────────────────────────────
  const query = searchQuery.trim().toLowerCase();
  function matchesQuery(h) {
    const agendaText = h.agenda_items
      .flatMap((i) => [i.bill_number, i.content])
      .filter(Boolean)
      .join(" ");
    const title = h.committee_name ?? "Floor Session";
    const assignmentText = (h.hearing_assignments_summary ?? [])
      .flatMap((a) => [
        a.assignee_email,
        a.assignee_name,
        a.bill_number,
        a.assignment_type,
        ASSIGNMENT_STATUS_SEARCH_TERMS[a.latest_action_type],
      ])
      .filter(Boolean)
      .join(" ");
    const haystack = [title, h.committee_type, h.location, h.dps_notes, agendaText, assignmentText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  }

  const hearings = allHearings ?? [];
  const visibleHearings = query ? hearings.filter(matchesQuery) : hearings;

  const byDate = visibleHearings.reduce((acc, h) => {
    const key = h.hearing_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(h);
    return acc;
  }, {});

  const summarizeRow = useMemo(
    () => (rowValue) => summarizeHearingsRow(rowValue, reportFields),
    [reportFields],
  );

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        {/* ── Left column ── */}
        <div className={styles.headerCol}>
          <h1 className={styles.title}>Hearing Schedule</h1>
          {allHearings !== null && (
            <p className={styles.subtitle}>
              {query
                ? `${visibleHearings.length} of ${hearings.length} hearing${hearings.length !== 1 ? "s" : ""}`
                : `${hearings.length} hearing${hearings.length !== 1 ? "s" : ""}`}
            </p>
          )}

          <button id="tour-default-settings" className={styles.defaultBtn} onClick={resetToDefaults}>
            Default Page Settings
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
            <button
              className={styles.helpBtn}
              onClick={() => createHearingsTour({ isEditor: can("hearing:query"), isLoggedIn: !!token, activeView, canSystemEdit }).drive()}
              title="Tour the Hearings page"
            >
              ?
            </button>
          </div>
        </div>
      </div>

      {activeView === "list" && !isMobile && token && (
        <div id="tour-saved-reports">
          <SavedReportsBar
            reports={savedReports.reports}
            defaultReportId={savedReports.defaultReportId}
            loadedReportId={savedReports.loadedReportId}
            includeInactive={savedReports.includeInactive}
            onIncludeInactiveChange={savedReports.setIncludeInactive}
            onSelectReport={savedReports.selectReport}
            error={savedReports.error}
            isLoadedDefault={savedReports.isLoadedDefault}
            isLoadedActive={savedReports.isLoadedActive}
            onToggleDefault={canSystemEdit ? undefined : savedReports.toggleDefault}
            onReorder={savedReports.reorderReport}
            onSortAlphabetical={savedReports.sortAlphabetical}
          />
        </div>
      )}

      {activeView === "list" && !canSystemEdit && (
        <ReportFiltersSummary criteria={appliedCriteria} summarizeRow={summarizeRow} />
      )}

      {/* Report Criteria collapsible — list view only. Calendar view is intentionally
          a "see everything" view and uses the date-range navigation plus the
          Show Hidden / Show Inactive toggles in Options.  Hidden for non-admins:
          viewers only choose from the system reports listed in the Reports bar. */}
      {activeView === "list" && canSystemEdit && (
        <div id="tour-report-criteria" className={styles.additionalFilters}>
          <button
            className={styles.additionalFiltersHeader}
            onClick={() => setReportCriteriaOpen((v) => !v)}
          >
            <span>Report Criteria</span>
            <span className={`${styles.collapseArrow} ${reportCriteriaOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
          </button>
          {reportCriteriaOpen && (
            <StackingCriteria
              value={hearingsCriteria}
              onChange={setHearingsCriteria}
              appliedValue={appliedCriteria}
              onApply={handleStackingApply}
              RowEditor={HearingsRowEditor}
              rowEditorProps={{
                fields: reportFields,
                canNotes,
              }}
              compileRow={(row) => buildHearingsRowFilterGroup(row.value, { canNotes, username })}
              emptyRowValue={makeNewRowValue()}
              summarizeRow={summarizeRow}
              mobile={isMobile}
              onSave={isMobile ? undefined : async () => {
                await savedReports.save();
                setReportCriteriaOpen(false);
              }}
              onSaveAs={isMobile ? undefined : savedReports.openSaveAs}
              saveAvailable={savedReports.canSave}
              saveAsAvailable={savedReports.canSaveAs}
              canRunQuery={savedReports.canRunQuery}
              loadedReportName={isMobile ? null : savedReports.loadedReportName}
              isLoadedActive={savedReports.isLoadedActive}
              isLoadedDefault={savedReports.isLoadedDefault}
              onToggleActive={isMobile ? undefined : savedReports.toggleActive}
              onToggleDefault={isMobile ? undefined : savedReports.toggleDefault}
              editMode={savedReports.editMode}
              editLocked={savedReports.editLocked}
              loadedDirty={savedReports.loadedDirty}
              onStartEdit={isMobile ? undefined : savedReports.startEdit}
              onCancelEdit={isMobile ? undefined : savedReports.cancelEdit}
              onNewReport={isMobile ? undefined : savedReports.newReport}
              onOpenSettings={isMobile ? undefined : savedReports.openSettings}
            />
          )}
        </div>
      )}

      {activeView === "list" && canSystemEdit && (
        <>
          <SaveAsModal
            open={savedReports.saveAsOpen}
            onClose={savedReports.closeSaveAs}
            onSave={savedReports.saveAs}
            canCreateSystemReports={savedReports.canSystemEdit}
            availableRoles={savedReports.availableRoles}
          />
          <SettingsModal
            open={savedReports.settingsOpen}
            onClose={savedReports.closeSettings}
            onSave={savedReports.editSettings}
            initialName={savedReports.loadedReport?.display_name ?? ""}
            isSystemLevel={savedReports.loadedReport?.publication_level === "system"}
            initialAllowedRoles={savedReports.loadedReport?.allowed_roles ?? []}
            canEditRoles={savedReports.canSystemEdit}
            availableRoles={savedReports.availableRoles}
          />
        </>
      )}

      {/* Options collapsible */}
      {(can("hearing:query") || activeView === "calendar" || (allHearings !== null && hearings.length > 0 && (activeView === "list" || can("hearing-assignment:view")))) && (
        <div id="tour-options" className={styles.additionalFilters}>
          <button
            className={styles.additionalFiltersHeader}
            onClick={() => setOptionsOpen((v) => !v)}
          >
            <span>Options</span>
            <span className={`${styles.collapseArrow} ${optionsOpen ? styles.collapseArrowOpen : ""}`}>▾</span>
          </button>
          {optionsOpen && (
            <div className={styles.optionsBody}>
              {can("hearing:query") && (
                <div id="tour-refresh-hearings" className={styles.optionsRow}>
                  <span className={styles.optionsLabel}>Refresh hearings:</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={refreshStartDate}
                    onChange={(e) => setRefreshStartDate(e.target.value)}
                  />
                  <span className={styles.optionsDateSep}>–</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={refreshEndDate}
                    onChange={(e) => setRefreshEndDate(e.target.value)}
                  />
                  <button
                    className={styles.scrapeBtn}
                    onClick={handleScrape}
                    disabled={!!scrapeJobId || !refreshStartDate || !refreshEndDate}
                    title={
                      scrapeJobId
                        ? `Refreshing for dates: ${refreshStartDate} through ${refreshEndDate}`
                        : (!refreshStartDate || !refreshEndDate)
                        ? "Select start and end dates to refresh hearings"
                        : "Refresh hearings from akleg.gov for the selected date range"
                    }
                  >
                    {scrapeJobId ? "Refreshing..." : "Refresh from akleg.gov"}
                  </button>
                  <div className={styles.weekShortcuts}>
                    <button
                      type="button"
                      className={styles.shortcut}
                      onClick={() => { const d = todayJuneau(); setRefreshStartDate(d); setRefreshEndDate(d); }}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      className={styles.shortcut}
                      onClick={() => { const b = weekBounds(-1); setRefreshStartDate(b.start); setRefreshEndDate(b.end); }}
                      title={weekBoundsTitle(-1)}
                    >
                      Last Week
                    </button>
                    <button
                      type="button"
                      className={styles.shortcut}
                      onClick={() => { const b = weekBounds(0); setRefreshStartDate(b.start); setRefreshEndDate(b.end); }}
                      title={weekBoundsTitle(0)}
                    >
                      This Week
                    </button>
                    <button
                      type="button"
                      className={styles.shortcut}
                      onClick={() => { const b = weekBounds(1); setRefreshStartDate(b.start); setRefreshEndDate(b.end); }}
                      title={weekBoundsTitle(1)}
                    >
                      Next Week
                    </button>
                    {(refreshStartDate || refreshEndDate) && (
                      <button
                        type="button"
                        className={styles.clearDatesBtn}
                        onClick={() => { setRefreshStartDate(""); setRefreshEndDate(""); }}
                      >
                        Clear Dates
                      </button>
                    )}
                  </div>
                </div>
              )}

              {activeView === "calendar" && (
                <div className={styles.optionsRow}>
                  <span className={styles.optionsLabel}>Hearing Visibility:</span>
                  <button
                    className={`${styles.loadBtn} ${calendarShowHidden ? styles.loadBtnActive : ""}`}
                    onClick={() => setCalendarShowHidden((v) => !v)}
                    title="Include hearings that have been hidden from the schedule"
                  >
                    {calendarShowHidden ? "Hide Hidden" : "Show Hidden"}
                  </button>
                  <button
                    className={`${styles.loadBtn} ${calendarShowInactive ? styles.loadBtnActive : ""}`}
                    onClick={() => setCalendarShowInactive((v) => !v)}
                    title="Include hearings that have been removed from the akleg.gov schedule"
                  >
                    {calendarShowInactive ? "Hide Inactive" : "Show Inactive"}
                  </button>
                </div>
              )}

              {allHearings !== null && hearings.length > 0 && (activeView === "list" || can("hearing-assignment:view")) && (
                <div className={styles.optionsRow}>
                  <span className={styles.optionsLabel}>Hearing Card Layout:</span>
                  {activeView === "list" && (
                    <button
                      id="tour-expand-agendas"
                      className={`${styles.loadBtn} ${globalExpanded ? styles.loadBtnActive : ""}`}
                      onClick={() => setGlobalExpanded((v) => !v)}
                    >
                      {globalExpanded ? "Collapse agendas" : "Expand agendas"}
                    </button>
                  )}
                  {can("hearing-assignment:view") && (
                    <button
                      className={`${styles.loadBtn} ${showCanceledAssignments ? styles.loadBtnActive : ""}`}
                      onClick={() => setShowCanceledAssignments((v) => !v)}
                      title="Toggle canceled assignments in the Assignments panel of each hearing"
                    >
                      {showCanceledAssignments ? "Hide Canceled Assignments" : "Show Canceled Assignments"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Notices */}
      {loading && activeView === "list" && <div className={styles.loadingOverlay}><span className={styles.loadingText}>Loading…</span></div>}
      {error && <p className={styles.error}>{error}</p>}
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />

      {activeView === "list" && allHearings !== null && hearings.length === 0 && !loading && (
        <p className={styles.notice}>
          No hearings match the current criteria.
        </p>
      )}

      {allHearings !== null && hearings.length > 0 && (
        <div className={styles.searchRow}>
          <input
            id="tour-meetings-search"
            className={styles.searchInput}
            type="search"
            placeholder="Search hearings on this page…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {activeView === "list" && query && hearings.length > 0 && visibleHearings.length === 0 && (
        <p className={styles.notice}>No hearings match your search.</p>
      )}

      {/* ── Calendar view ── */}
      {activeView === "calendar" && calendarStartDate && (
        <CalendarView
          hearings={visibleHearings}
          startDate={calendarStartDate}
          daysShown={daysShown}
          onDaysShownChange={setDaysShown}
          onNavigate={setCalendarStartDate}
          isFiltered={Boolean(query)}
          loading={loading}
          noHearingsInRange={allHearings !== null && hearings.length === 0}
          onHearingReload={loadHearings}
          onHiddenChanged={(updated) =>
            setAllHearings((prev) => prev.map((x) => (x.id === updated.id ? { ...x, hidden: updated.hidden } : x)))
          }
          showCanceledAssignments={showCanceledAssignments}
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
                          onNotesSaved={() => loadHearings()}
                          onAssignmentCreated={() => loadHearings()}
                          onHiddenChanged={(updated) =>
                            setAllHearings((prev) =>
                              prev.map((x) => (x.id === updated.id ? { ...x, hidden: updated.hidden } : x))
                            )
                          }
                          showCanceledAssignments={showCanceledAssignments}
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
        entries={[{ label: "Hearings", frequency: "Daily at 4:05 AM, 8:05 AM, 12:05 PM, and 4:05 PM (Juneau time)" }]}
      />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { fetchUpcomingHearings } from "../../api/hearings";
import { fetchReport, fetchReportMeta } from "../../api/reports";
import { fetchTags } from "../../api/tags";
import { fetchBillTrackingState } from "../../api/workflows";
import { useAuth } from "../../context/AuthContext";
import BillCard from "../../components/BillCard/BillCard";
import FilterBar from "../../components/FilterBar/FilterBar";
import StackingCriteria from "../../components/StackingCriteria/StackingCriteria";
import { compile } from "../../components/StackingCriteria/expression/compiler";
import { validate } from "../../components/StackingCriteria/expression/validate";
import SavedReportsBar from "../../components/SavedReports/SavedReportsBar";
import SaveAsModal from "../../components/SavedReports/SaveAsModal";
import ReportFiltersSummary from "../../components/SavedReports/ReportFiltersSummary";
import SettingsModal from "../../components/SavedReports/SettingsModal";
import { useSavedReports } from "../../hooks/useSavedReports";
import FiscalDeptFilter from "../../components/FiscalDeptFilter/FiscalDeptFilter";
import OutcomeFilter from "../../components/OutcomeFilter/OutcomeFilter";
import PrintHearingsSection from "../../components/PrintHearingsSection/PrintHearingsSection";
import ReportHeaderEditor from "../../components/ReportHeaderEditor/ReportHeaderEditor";
import SyncSchedule from "../../components/SyncSchedule/SyncSchedule";
import Toast from "../../components/Toast/Toast";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { createBillsTour } from "../../tours/billsTour";
import { DEFAULT_SELECTED } from "../../utils/outcomeTypes";
import { todayJuneau, weekBounds, weekBoundsTitle } from "../../utils/weekBounds";
import {
  makeDefaultBillsCriteria,
  makeNewBillRowValue,
  buildBillsRowFilterGroup,
  summarizeBillsRow,
} from "./stackingHelpers";
import styles from "./Home.module.css";

const STORAGE_KEY = "leg_billsStacking";
const LEGACY_STORAGE_KEY = "leg_billFilters";

function BillsRowEditor({ value, onChange, fields }) {
  return (
    <FilterBar
      filters={value ?? makeNewBillRowValue()}
      onChange={onChange}
      fields={fields}
    />
  );
}

function loadStoredCriteria({ showUntracked, billNumber }) {
  // Direct navigation from a Leg Up icon ignores stored criteria so the user
  // lands on a clean filter focused on the bill they clicked through.
  if (billNumber) {
    return makeDefaultBillsCriteria({ showUntracked: true, billNumber });
  }
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
  return makeDefaultBillsCriteria({ showUntracked });
}

function outcomesToEvents(outcomes) {
  const byKey = new Map();
  for (const o of (outcomes ?? [])) {
    const key = `${o.date}|${o.source_url ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, { date: o.date, source_url: o.source_url ?? null, outcomes: [] });
    byKey.get(key).outcomes.push({
      outcome_type: o.outcome_type?.toLowerCase(),
      committee: o.committee,
      chamber: o.chamber?.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
      description: o.description,
      ai_generated: o.ai_generated ?? false,
    });
  }
  return [...byKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, source_url, outcomes: outcomesForDate }) => ({
      event_date: date,
      source_url,
      outcomes: outcomesForDate,
    }));
}

function rowToBill(row, workflowState) {
  const state = workflowState[row.id] ?? { tracking_requested: false, user_tracking_request_denied: false };
  return {
    id: row.id,
    bill_number: row.bill_number,
    title: row.title,
    short_title: row.short_title,
    session: row.session,
    status: row.status,
    introduced_date: row.introduced_date,
    source_url: row.source_url,
    is_tracked: row.is_tracked,
    last_sync: row.last_sync,
    sponsors: row.sponsors ?? [],
    keywords: row.keywords ?? [],
    tags: row.tags ?? [],
    fiscal_notes: (row.fiscal_notes ?? []).map((fn) => ({ ...fn, is_active: true })),
    fiscal_notes_query_failed: false,
    events: outcomesToEvents(row.outcomes),
    tracking_requested: state.tracking_requested,
    user_tracking_request_denied: state.user_tracking_request_denied,
  };
}

export default function Home() {
  const location = useLocation();
  const { can, token, username } = useAuth();
  const isMobile = useMediaQuery("(max-width: 640px)");
  const canSystemEdit = can("system-report:edit");
  const [toast, setToast] = useState(location.state?.toast ? { message: location.state.toast, type: "success" } : null);
  const [bills, setBills] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDescription, setShowDescription] = useState(() => sessionStorage.getItem("leg_showDescription") === "true");
  const [selectedOutcomes, setSelectedOutcomes] = useState(() => {
    const stored = sessionStorage.getItem("leg_selectedOutcomes");
    if (stored) { try { return new Set(JSON.parse(stored)); } catch { /* ignore */ } }
    return DEFAULT_SELECTED;
  });
  const [selectedDepts, setSelectedDepts] = useState(() => {
    const stored = sessionStorage.getItem("leg_selectedDepts");
    if (stored === "null") return null;
    if (stored) { try { return new Set(JSON.parse(stored)); } catch { /* ignore */ } }
    return new Set(["Department of Public Safety"]);
  });

  const allDepts = useMemo(() => {
    const depts = new Set();
    bills.forEach((b) =>
      (b.fiscal_notes ?? []).forEach((n) => {
        if (n.is_active && n.fn_department) depts.add(n.fn_department);
      })
    );
    return depts;
  }, [bills]);
  const [billsCriteria, setBillsCriteria] = useState(() =>
    loadStoredCriteria({
      showUntracked: !!location.state?.showUntracked,
      billNumber: location.state?.billNumber,
    })
  );
  const [appliedCriteria, setAppliedCriteria] = useState(billsCriteria);
  const fetchTimerRef = useRef(null);
  const [sideBySide, setSideBySide] = useState(() => sessionStorage.getItem("leg_sideBySide") !== "false");
  const [showKeywords, setShowKeywords] = useState(() => sessionStorage.getItem("leg_showKeywords") === "true");
  // location.state?.billNumber drives the discrete bill_number chip filter; the
  // page-level search box stays clean so substring matches don't widen the set.
  // Legacy location.state?.search still seeds the search box for backwards compat.
  const [searchQuery, setSearchQuery] = useState(
    location.state?.billNumber
      ? ""
      : (location.state?.search ?? sessionStorage.getItem("leg_searchQuery") ?? "")
  );
  const [printStartDate, setPrintStartDate] = useState(() => sessionStorage.getItem("leg_printStartDate") ?? "");
  const [printEndDate, setPrintEndDate] = useState(() => sessionStorage.getItem("leg_printEndDate") ?? "");
  const [printMeetings, setPrintMeetings] = useState(null);
  const [upcomingHearings, setUpcomingHearings] = useState({});
  const [pendingPrint, setPendingPrint] = useState(false);
  // Always collapsed on navigation to keep the page visually quiet; the panel
  // contents (criteria, export/display) are still preserved between visits.
  const [reportCriteriaOpen, setReportCriteriaOpen] = useState(false);
  const [exportDisplayOpen, setExportDisplayOpen] = useState(false);
  const contentRef = useRef(null);

  // ─── Persist Legislation tab settings to sessionStorage ───────────────────
  useEffect(() => {
    if (searchQuery) sessionStorage.setItem("leg_searchQuery", searchQuery);
    else sessionStorage.removeItem("leg_searchQuery");
    if (showDescription) sessionStorage.setItem("leg_showDescription", "true");
    else sessionStorage.removeItem("leg_showDescription");
    if (showKeywords) sessionStorage.setItem("leg_showKeywords", "true");
    else sessionStorage.removeItem("leg_showKeywords");
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(billsCriteria));
    if (!sideBySide) sessionStorage.setItem("leg_sideBySide", "false");
    else sessionStorage.removeItem("leg_sideBySide");
    if (printStartDate) sessionStorage.setItem("leg_printStartDate", printStartDate);
    else sessionStorage.removeItem("leg_printStartDate");
    if (printEndDate) sessionStorage.setItem("leg_printEndDate", printEndDate);
    else sessionStorage.removeItem("leg_printEndDate");
    sessionStorage.setItem("leg_selectedOutcomes", JSON.stringify([...selectedOutcomes]));
    sessionStorage.setItem("leg_selectedDepts", selectedDepts === null ? "null" : JSON.stringify([...selectedDepts]));
    sessionStorage.removeItem("leg_reportCriteriaOpen");
    sessionStorage.removeItem("leg_exportDisplayOpen");
  }, [searchQuery, showDescription, showKeywords, billsCriteria, sideBySide, printStartDate, printEndDate, selectedOutcomes, selectedDepts]);

  function resetToDefaults() {
    setSearchQuery("");
    setShowDescription(false);
    setShowKeywords(false);
    setSideBySide(true);
    setPrintStartDate("");
    setPrintEndDate("");
    setSelectedOutcomes(DEFAULT_SELECTED);
    setSelectedDepts(new Set(["Department of Public Safety"]));

    // Auto-select the seeded "Tracked Bills" system report if it's active and
    // visible to this user; otherwise leave the loaded report cleared and reset
    // criteria to the local default.
    const loadedSeed = savedReports.selectSystemReportByName("Tracked Bills");
    if (!loadedSeed) {
      const def = makeDefaultBillsCriteria();
      setBillsCriteria(def);
      setAppliedCriteria(def);
      savedReports.clearLoadedReport();
    }
  }

  function handleStackingApply(_filterGroup, value) {
    setAppliedCriteria(value);
    setReportCriteriaOpen(false);
  }

  const hadStoredCriteriaOnMount = useRef(!!sessionStorage.getItem(STORAGE_KEY));
  // Skip default-report auto-load when arriving from a Leg Up icon — otherwise
  // the default report would clobber the bill-chip seed before the user sees it.
  const hasBillNumberSeed = useRef(!!location.state?.billNumber);
  const savedReports = useSavedReports({
    registryName: "bills",
    currentCriteria: billsCriteria,
    onLoad: (criteria) => {
      setBillsCriteria(criteria);
      setAppliedCriteria(criteria);
    },
    token,
    username,
    skipDefaultLoad: hadStoredCriteriaOnMount.current || hasBillNumberSeed.current,
    canSystemEdit,
  });

  // Fetch hearing bill IDs whenever the filter is on and both dates are set
  useEffect(() => {
    if (can("bill-tags:view")) {
      fetchTags(token).then(setAllTags).catch(() => {});
    }
  }, [can]);

  useEffect(() => {
    fetchReportMeta(token)
      .then((data) => {
        const billsMeta = data.reports?.find((r) => r.id === "bills");
        setReportMeta(billsMeta ?? null);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      setLoading(true);
      const columns = [
        "id", "bill_number", "title", "short_title", "session", "status",
        "introduced_date", "source_url", "is_tracked", "last_sync",
        "sponsors", "keywords", "outcomes", "fiscal_notes",
        ...(can("bill-tags:view") ? ["tags"] : []),
      ];
      const { ast } = validate(appliedCriteria.expression, appliedCriteria.criteria);
      const filters = compile(ast, appliedCriteria.criteria, (row) =>
        buildBillsRowFilterGroup(row.value),
      );

      Promise.all([
        fetchReport({ reportId: "bills", columns, filters, token }),
        fetchUpcomingHearings(),
      ])
        .then(async ([reportData, upcomingData]) => {
          const rows = reportData.rows;
          const untrackedIds = rows.filter((r) => !r.is_tracked).map((r) => r.id);
          let workflowState = {};
          if (untrackedIds.length > 0 && token) {
            try {
              const stateList = await fetchBillTrackingState({ billIds: untrackedIds, token });
              workflowState = Object.fromEntries(stateList.map((s) => [s.bill_id, s]));
            } catch { /* non-critical */ }
          }
          setBills(rows.map((row) => rowToBill(row, workflowState)));
          setUpcomingHearings(upcomingData);
          setError(null);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(fetchTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedCriteria, token]);

  const reportDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const TYPE_ORDER = ["B", "CR", "JR", "R", "SCR"];
  function measureTypeRank(billNumber) {
    const type = billNumber.trim().toUpperCase().replace(/^[HS]/, "").replace(/\s*\d+.*$/, "");
    const idx = TYPE_ORDER.indexOf(type);
    return idx === -1 ? 99 : idx;
  }

  const sortedBills = [...bills].sort((a, b) => {
    const chamberA = a.bill_number.startsWith("H") ? 0 : 1;
    const chamberB = b.bill_number.startsWith("H") ? 0 : 1;
    const typeA = measureTypeRank(a.bill_number);
    const typeB = measureTypeRank(b.bill_number);
    const numA = parseInt(a.bill_number.replace(/\D/g, ""), 10);
    const numB = parseInt(b.bill_number.replace(/\D/g, ""), 10);
    return chamberA - chamberB || typeA - typeB || numA - numB;
  });

  const query = searchQuery.trim().toLowerCase();
  const searchedBills = query
    ? sortedBills.filter((bill) => {
        // Only search outcomes whose type is currently visible in the table
        const visibleOutcomes = bill.events
          .flatMap((e) => e.outcomes)
          .filter((o) => selectedOutcomes.has(o.outcome_type));

        const outcomeFields = visibleOutcomes.flatMap((o) => [
          o.committee,
          o.outcome_type.replace(/_/g, " "),
          showDescription ? o.description : null,
        ]);

        const visibleFiscalNotes = (bill.fiscal_notes ?? []).filter(
          (n) => n.is_active && (selectedDepts === null || selectedDepts.has(n.fn_department))
        );

        const fiscalNoteFields = visibleFiscalNotes.flatMap((n) => [
          n.fn_department?.replace("Department of ", ""),
          n.fn_identifier,
          n.fn_appropriation,
          n.fn_allocation,
          n.control_code,
        ]);

        const sponsorFields = bill.sponsors.map((s) => s.name);

        const keywordFields = showKeywords ? bill.keywords.map((s) => s.keyword) : [];

        const haystack = [bill.bill_number, bill.short_title, bill.status, ...bill.tags.map((t) => t.label), ...outcomeFields, ...keywordFields, ...fiscalNoteFields, ...sponsorFields]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
    : sortedBills;

  const visibleBills = searchedBills;

  const handlePrint = useReactToPrint({
    contentRef,
    onAfterPrint: () => setPrintMeetings(null),
  });

  useEffect(() => {
    if (pendingPrint) {
      setPendingPrint(false);
      handlePrint();
    }
  }, [pendingPrint, handlePrint]);

  const today = todayJuneau();
  const isToday = printStartDate === today && printEndDate === today;
  const activeWeek = [-1, 0, 1].find((o) => {
    const b = weekBounds(o);
    return printStartDate === b.start && printEndDate === b.end;
  }) ?? null;

  async function exportPDF() {
    if (printStartDate && printEndDate) {
      const columns = [
        "id", "hearing_date", "hearing_time", "chamber", "hearing_type", "location",
        "legislature_session", "is_active", "hidden", "last_sync", "committee_name",
        "committee_type", "committee_url", "agenda_items",
      ];
      if (can("hearing-notes:view")) columns.push("dps_notes");
      if (can("hearing-assignment:view")) columns.push("hearing_assignments_summary");
      const filters = {
        logic: "AND",
        conditions: [
          { field: "hearing_date", op: "between", value: [printStartDate, printEndDate] },
          { field: "is_active", op: "equals", value: true },
        ],
        groups: [],
      };
      const data = await fetchReport({
        reportId: "hearings",
        columns,
        filters,
        sortBy: ["hearing_date", "hearing_time"],
        sortDir: "asc",
        pageSize: 2000,
        token,
      });
      const hearings = data.rows.map((row) => ({
        ...row,
        agenda_items: Array.isArray(row.agenda_items)
          ? [...row.agenda_items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          : [],
        hearing_assignments_summary: Array.isArray(row.hearing_assignments_summary)
          ? row.hearing_assignments_summary
          : [],
      }));
      setPrintMeetings(hearings);
      setPendingPrint(true);
    } else {
      setPrintMeetings(null);
      handlePrint();
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>Tracked Legislation</h1>
            <p className={styles.subtitle}>
              34th Alaska Legislature ·{" "}
              {query
                ? `${visibleBills.length} of ${sortedBills.length} measures`
                : `${bills.length} measure${bills.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className={styles.headerLegend}>
            <p className={styles.aiLegend}>
              This is a research tool and not an official legislative record.
            </p>
            <p className={styles.aiLegend}>
              ✨ Content marked with this symbol is AI-generated and may contain false information. Please review for accuracy.
            </p>
          </div>
          <button id="tour-default-settings" className={styles.defaultBtn} onClick={resetToDefaults}>
            Default Page Settings
          </button>
        </div>

        {/* ── Saved Reports ──────────────────────────────────────── */}
        {!isMobile && token && (
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

        {!canSystemEdit && (
          <ReportFiltersSummary
            criteria={appliedCriteria}
            summarizeRow={(rowValue) => summarizeBillsRow(rowValue, reportMeta?.fields ?? {})}
          />
        )}

        {/* ── Report Criteria ────────────────────────────────────── */}
        {canSystemEdit && (
        <div id="tour-report-criteria" className={styles.panelSection}>
          <button
            type="button"
            className={styles.panelSectionHeader}
            onClick={() => setReportCriteriaOpen((o) => !o)}
          >
            <span>Report Criteria</span>
            <span>{reportCriteriaOpen ? "▲" : "▼"}</span>
          </button>
          {reportCriteriaOpen && (
            <div className={styles.panelSectionBody}>
              <p className={styles.panelNote}>
                <em>This section defines which measures are returned from the database.</em>
              </p>
              <StackingCriteria
                value={billsCriteria}
                onChange={setBillsCriteria}
                appliedValue={appliedCriteria}
                onApply={handleStackingApply}
                RowEditor={BillsRowEditor}
                rowEditorProps={{ fields: reportMeta?.fields ?? {} }}
                compileRow={(row) => buildBillsRowFilterGroup(row.value)}
                emptyRowValue={makeNewBillRowValue()}
                summarizeRow={(rowValue) => summarizeBillsRow(rowValue, reportMeta?.fields ?? {})}
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
            </div>
          )}
        </div>
        )}

        {canSystemEdit && (
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

        {/* ── Export and Display Options ─────────────────────────── */}
        <div className={styles.panelSection}>
          <button
            type="button"
            className={styles.panelSectionHeader}
            onClick={() => setExportDisplayOpen((o) => !o)}
          >
            <span>Options</span>
            <span>{exportDisplayOpen ? "▲" : "▼"}</span>
          </button>
          {exportDisplayOpen && (
            <div className={styles.panelSectionBody}>
              <div className={styles.exportDisplayGrid}>
                {/* Left: display toggles */}
                <div className={styles.exportDisplayLeft}>
                  <div className={styles.exportDisplayColHeader}>Display</div>
                  <div id="tour-toggle-descriptions-keywords" className={styles.togglePair}>
                    <div className={styles.toggleGroup}>
                      <button
                        className={`${styles.toggleOption} ${!showDescription ? styles.toggleSelected : ""}`}
                        onClick={() => setShowDescription(false)}
                      >
                        Hide Descriptions
                      </button>
                      <button
                        className={`${styles.toggleOption} ${showDescription ? styles.toggleSelected : ""}`}
                        onClick={() => setShowDescription(true)}
                      >
                        Show Descriptions
                      </button>
                    </div>
                    <div className={styles.toggleGroup}>
                      <button
                        className={`${styles.toggleOption} ${!showKeywords ? styles.toggleSelected : ""}`}
                        onClick={() => setShowKeywords(false)}
                      >
                        Hide Keywords
                      </button>
                      <button
                        className={`${styles.toggleOption} ${showKeywords ? styles.toggleSelected : ""}`}
                        onClick={() => setShowKeywords(true)}
                      >
                        Show Keywords
                      </button>
                    </div>
                  </div>
                  <div id="tour-toggle-layout" className={`${styles.toggleGroup} ${styles.layoutToggle}`}>
                    <button
                      className={`${styles.toggleOption} ${sideBySide ? styles.toggleSelected : ""}`}
                      onClick={() => setSideBySide(true)}
                    >
                      Side by Side
                    </button>
                    <button
                      className={`${styles.toggleOption} ${!sideBySide ? styles.toggleSelected : ""}`}
                      onClick={() => setSideBySide(false)}
                    >
                      Single Column
                    </button>
                  </div>
                  <div id="tour-filter-outcomes-fiscal-notes" className={styles.togglePair}>
                    <OutcomeFilter selected={selectedOutcomes} onChange={setSelectedOutcomes} />
                    <FiscalDeptFilter allDepts={allDepts} selected={selectedDepts} onChange={setSelectedDepts} />
                  </div>
                </div>

                {/* Divider */}
                <div className={styles.exportDisplayDivider} />

                {/* Right: export controls */}
                <div className={styles.exportDisplayRight}>
                  <div className={styles.exportDisplayColHeader}>Export</div>
                  <div id="tour-export-pdf" className={styles.exportRow}>
                    <span className={styles.printRowLabel}>Hearings:</span>
                    <input
                      type="date"
                      className={styles.printDateInput}
                      value={printStartDate}
                      onChange={(e) => setPrintStartDate(e.target.value)}
                    />
                    <span className={styles.printRowSep}>–</span>
                    <input
                      type="date"
                      className={styles.printDateInput}
                      value={printEndDate}
                      onChange={(e) => setPrintEndDate(e.target.value)}
                    />
                    <button
                      className={styles.printBtn}
                      onClick={exportPDF}
                      disabled={pendingPrint || (!!(printStartDate) !== !!(printEndDate))}
                    >
                      {pendingPrint ? "Preparing…" : "Export PDF"}
                    </button>
                  </div>
                  <div className={styles.weekShortcuts}>
                    <button
                      className={`${styles.weekShortcutBtn} ${isToday ? styles.weekShortcutBtnActive : ""}`}
                      onClick={() => { setPrintStartDate(today); setPrintEndDate(today); }}
                    >
                      Today
                    </button>
                    <button
                      className={`${styles.weekShortcutBtn} ${activeWeek === -1 ? styles.weekShortcutBtnActive : ""}`}
                      onClick={() => { const b = weekBounds(-1); setPrintStartDate(b.start); setPrintEndDate(b.end); }}
                      title={weekBoundsTitle(-1)}
                    >
                      Last Week
                    </button>
                    <button
                      className={`${styles.weekShortcutBtn} ${activeWeek === 0 ? styles.weekShortcutBtnActive : ""}`}
                      onClick={() => { const b = weekBounds(0); setPrintStartDate(b.start); setPrintEndDate(b.end); }}
                      title={weekBoundsTitle(0)}
                    >
                      This Week
                    </button>
                    <button
                      className={`${styles.weekShortcutBtn} ${activeWeek === 1 ? styles.weekShortcutBtnActive : ""}`}
                      onClick={() => { const b = weekBounds(1); setPrintStartDate(b.start); setPrintEndDate(b.end); }}
                      title={weekBoundsTitle(1)}
                    >
                      Next Week
                    </button>
                    {(printStartDate || printEndDate) && (
                      <button
                        className={styles.clearDatesBtn}
                        onClick={() => { setPrintStartDate(""); setPrintEndDate(""); }}
                      >
                        Clear Dates
                      </button>
                    )}
                  </div>
                  {!!(printStartDate) !== !!(printEndDate) && (
                    <p className={styles.printDateNotice}>Select both a from and to date to export hearings. Clear both to export only bills.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {error   && <p className={styles.error}>Error: {error}</p>}
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />

      {!loading && !error && bills.length === 0 && (
        <p className={styles.notice}>No bills match the current filters.</p>
      )}

      {/* ── Search Results ─────────────────────────────────────── */}
      <div className={styles.panelSection}>
        <div className={styles.panelSectionHeaderStatic}>Search Results</div>
        <div className={styles.panelSectionBody}>
          <div className={styles.searchRow}>
            <input
              id="tour-search"
              className={styles.searchInput}
              type="search"
              placeholder="Search measures on this page…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              className={styles.helpBtn}
              onClick={() => createBillsTour({ isLoggedIn: !!token, canSystemEdit }).drive()}
              title="Tour the Bills page"
            >
              ?
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className={styles.loadingOverlay}>
          <span className={styles.loadingText}>Loading…</span>
        </div>
      )}

      <div ref={contentRef} style={loading ? { display: "none" } : undefined}>
        <ReportHeaderEditor printStartDate={printStartDate} printEndDate={printEndDate} />
        <PrintHearingsSection
          hearings={printMeetings}
          startDate={printStartDate}
          endDate={printEndDate}
          showAssignments={can("hearing-assignment:view")}
        />

        <p className={styles.aiLegendPrint}>
          ✨ Content marked with this symbol is AI-generated and may contain false information. Please review for accuracy.
        </p>

        <div className={styles.printHeader}>
          <h1 className={styles.printTitle}>Legislative Measures</h1>
          <p className={styles.printMeta}>
            34th Alaska Legislature · {sortedBills.length} measure
            {sortedBills.length !== 1 ? "s" : ""} · Report generated {reportDate}
          </p>
        </div>

        {sideBySide ? (
          <div className={styles.sideBySideGrid}>
            {[
              { label: "Senate Measures", bills: visibleBills.filter((b) => b.bill_number.startsWith("S")) },
              { label: "House Measures",  bills: visibleBills.filter((b) => b.bill_number.startsWith("H")) },
            ].map(({ label, bills: columnBills }) => (
              <div key={label} className={styles.sideColumn}>
                <h2 className={styles.columnHeader}>{label}</h2>
                <ul className={styles.list}>
                  {columnBills.map((bill, idx) => (
                    <li key={bill.id} id={idx === 0 && label === "Senate Measures" ? "tour-first-bill" : undefined}>
                      <BillCard
                        bill={bill}
                        showDescription={showDescription}
                        selectedOutcomes={selectedOutcomes}
                        selectedDepts={selectedDepts}
                        showKeywords={showKeywords}
                        abbreviated={true}
                        allTags={allTags}
                        upcomingHearingDates={upcomingHearings[bill.id] ?? []}
                        onRefreshed={(updated) =>
                          setBills((prev) => prev.map((b) => b.id === updated.id ? updated : b))
                        }
                        onTrackingChanged={(updated) =>
                          setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className={styles.list}>
            {visibleBills.map((bill, idx) => (
              <li key={bill.id} id={idx === 0 ? "tour-first-bill" : undefined}>
                <BillCard
                  bill={bill}
                  showDescription={showDescription}
                  selectedOutcomes={selectedOutcomes}
                  selectedDepts={selectedDepts}
                  showKeywords={showKeywords}
                  allTags={allTags}
                  upcomingHearingDates={upcomingHearings[bill.id] ?? []}
                  onRefreshed={(updated) =>
                    setBills((prev) => prev.map((b) => b.id === updated.id ? updated : b))
                  }
                  onTrackingChanged={(updated) =>
                    setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <SyncSchedule entries={[
        { label: "Bills, Legislative Outcomes & Fiscal Notes", frequency: "Daily at 4:05 AM and 4:05 PM (Juneau time)" },
        { label: "Hearings",                     frequency: "Daily at 4:05 AM, 8:05 AM, 12:05 PM, and 4:05 PM (Juneau time)" },
      ]} />
    </div>

  );
}

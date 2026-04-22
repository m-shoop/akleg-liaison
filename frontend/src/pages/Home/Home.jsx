import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { fetchHearings, fetchUpcomingHearings } from "../../api/hearings";
import { fetchReport, fetchReportMeta } from "../../api/reports";
import { fetchTags } from "../../api/tags";
import { fetchBillTrackingState } from "../../api/workflows";
import { useAuth } from "../../context/AuthContext";
import BillCard from "../../components/BillCard/BillCard";
import FilterBar from "../../components/FilterBar/FilterBar";
import FiscalDeptFilter from "../../components/FiscalDeptFilter/FiscalDeptFilter";
import OutcomeFilter from "../../components/OutcomeFilter/OutcomeFilter";
import PrintHearingsSection from "../../components/PrintHearingsSection/PrintHearingsSection";
import ReportHeaderEditor from "../../components/ReportHeaderEditor/ReportHeaderEditor";
import SyncSchedule from "../../components/SyncSchedule/SyncSchedule";
import Toast from "../../components/Toast/Toast";
import { createBillsTour } from "../../tours/billsTour";
import { DEFAULT_SELECTED } from "../../utils/outcomeTypes";
import { todayJuneau, weekBounds, weekBoundsTitle } from "../../utils/weekBounds";
import styles from "./Home.module.css";

const DEFAULT_BILL_FILTERS = {
  tracked: "tracked",
  hearingDateMode: "any",
  hearingDateOn: "",
  hearingDateFrom: "",
  hearingDateTo: "",
  advanced: {},
};

function buildFilterGroup(f) {
  const conditions = [];

  if (f.tracked === "tracked") {
    conditions.push({ field: "is_tracked", op: "equals", value: true });
  } else if (f.tracked === "untracked") {
    conditions.push({ field: "is_tracked", op: "equals", value: false });
  }

  if (f.hearingDateMode === "on" && f.hearingDateOn) {
    conditions.push({ field: "hearing_date", op: "equals", value: f.hearingDateOn });
  } else if (f.hearingDateMode === "range") {
    if (f.hearingDateFrom && f.hearingDateTo) {
      conditions.push({ field: "hearing_date", op: "between", value: [f.hearingDateFrom, f.hearingDateTo] });
    } else if (f.hearingDateFrom) {
      conditions.push({ field: "hearing_date", op: "after", value: f.hearingDateFrom });
    } else if (f.hearingDateTo) {
      conditions.push({ field: "hearing_date", op: "before", value: f.hearingDateTo });
    }
  }

  const adv = f.advanced ?? {};
  if (adv.bill_number) conditions.push({ field: "bill_number", op: "contains", value: adv.bill_number });
  if (adv.title) conditions.push({ field: "title", op: "contains", value: adv.title });
  if (adv.short_title) conditions.push({ field: "short_title", op: "contains", value: adv.short_title });
  if (Array.isArray(adv.session) && adv.session.length > 0) conditions.push({ field: "session", op: "in", value: adv.session.map((v) => parseInt(v, 10)) });
  if (Array.isArray(adv.status) && adv.status.length > 0) conditions.push({ field: "status", op: "in", value: adv.status });
  if (Array.isArray(adv.outcome_type) && adv.outcome_type.length > 0) conditions.push({ field: "outcome_type", op: "in", value: adv.outcome_type });
  if (Array.isArray(adv.outcome_committee) && adv.outcome_committee.length > 0) conditions.push({ field: "outcome_committee", op: "in", value: adv.outcome_committee });
  if (adv.outcome_date_from && adv.outcome_date_to) {
    conditions.push({ field: "outcome_date", op: "between", value: [adv.outcome_date_from, adv.outcome_date_to] });
  } else if (adv.outcome_date_from) {
    conditions.push({ field: "outcome_date", op: "after", value: adv.outcome_date_from });
  } else if (adv.outcome_date_to) {
    conditions.push({ field: "outcome_date", op: "before", value: adv.outcome_date_to });
  }
  if (adv.sponsor_name) conditions.push({ field: "sponsor_name", op: "contains", value: adv.sponsor_name });
  if (Array.isArray(adv.fn_department) && adv.fn_department.length > 0) conditions.push({ field: "fn_department", op: "in", value: adv.fn_department });
  if (adv.fn_publish_date_from && adv.fn_publish_date_to) {
    conditions.push({ field: "fn_publish_date", op: "between", value: [adv.fn_publish_date_from, adv.fn_publish_date_to] });
  } else if (adv.fn_publish_date_from) {
    conditions.push({ field: "fn_publish_date", op: "after", value: adv.fn_publish_date_from });
  } else if (adv.fn_publish_date_to) {
    conditions.push({ field: "fn_publish_date", op: "before", value: adv.fn_publish_date_to });
  }
  if (adv.introduced_date_from && adv.introduced_date_to) {
    conditions.push({ field: "introduced_date", op: "between", value: [adv.introduced_date_from, adv.introduced_date_to] });
  } else if (adv.introduced_date_from) {
    conditions.push({ field: "introduced_date", op: "after", value: adv.introduced_date_from });
  } else if (adv.introduced_date_to) {
    conditions.push({ field: "introduced_date", op: "before", value: adv.introduced_date_to });
  }

  return { logic: "AND", conditions };
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
  const { can, token } = useAuth();
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
  const [billFilters, setBillFilters] = useState(() => {
    const stored = sessionStorage.getItem("leg_billFilters");
    if (stored) { try { return JSON.parse(stored); } catch { /* ignore */ } }
    return location.state?.showUntracked
      ? { ...DEFAULT_BILL_FILTERS, tracked: "all" }
      : DEFAULT_BILL_FILTERS;
  });
  const fetchTimerRef = useRef(null);
  const [sideBySide, setSideBySide] = useState(() => sessionStorage.getItem("leg_sideBySide") !== "false");
  const [showKeywords, setShowKeywords] = useState(() => sessionStorage.getItem("leg_showKeywords") === "true");
  // location.state?.search (from bill-link navigation) takes priority over stored search
  const [searchQuery, setSearchQuery] = useState(location.state?.search ?? sessionStorage.getItem("leg_searchQuery") ?? "");
  const [printStartDate, setPrintStartDate] = useState(() => sessionStorage.getItem("leg_printStartDate") ?? "");
  const [printEndDate, setPrintEndDate] = useState(() => sessionStorage.getItem("leg_printEndDate") ?? "");
  const [printMeetings, setPrintMeetings] = useState(null);
  const [upcomingHearings, setUpcomingHearings] = useState({});
  const [pendingPrint, setPendingPrint] = useState(false);
  const [reportCriteriaOpen, setReportCriteriaOpen] = useState(() => sessionStorage.getItem("leg_reportCriteriaOpen") === "true");
  const [exportDisplayOpen, setExportDisplayOpen] = useState(() => sessionStorage.getItem("leg_exportDisplayOpen") === "true");
  const contentRef = useRef(null);

  // ─── Persist Legislation tab settings to sessionStorage ───────────────────
  useEffect(() => {
    if (searchQuery) sessionStorage.setItem("leg_searchQuery", searchQuery);
    else sessionStorage.removeItem("leg_searchQuery");
    if (showDescription) sessionStorage.setItem("leg_showDescription", "true");
    else sessionStorage.removeItem("leg_showDescription");
    if (showKeywords) sessionStorage.setItem("leg_showKeywords", "true");
    else sessionStorage.removeItem("leg_showKeywords");
    sessionStorage.setItem("leg_billFilters", JSON.stringify(billFilters));
    if (!sideBySide) sessionStorage.setItem("leg_sideBySide", "false");
    else sessionStorage.removeItem("leg_sideBySide");
    if (printStartDate) sessionStorage.setItem("leg_printStartDate", printStartDate);
    else sessionStorage.removeItem("leg_printStartDate");
    if (printEndDate) sessionStorage.setItem("leg_printEndDate", printEndDate);
    else sessionStorage.removeItem("leg_printEndDate");
    sessionStorage.setItem("leg_selectedOutcomes", JSON.stringify([...selectedOutcomes]));
    sessionStorage.setItem("leg_selectedDepts", selectedDepts === null ? "null" : JSON.stringify([...selectedDepts]));
    if (reportCriteriaOpen) sessionStorage.setItem("leg_reportCriteriaOpen", "true");
    else sessionStorage.removeItem("leg_reportCriteriaOpen");
    if (exportDisplayOpen) sessionStorage.setItem("leg_exportDisplayOpen", "true");
    else sessionStorage.removeItem("leg_exportDisplayOpen");
  }, [searchQuery, showDescription, showKeywords, billFilters, sideBySide, printStartDate, printEndDate, selectedOutcomes, selectedDepts, reportCriteriaOpen, exportDisplayOpen]);

  function resetToDefaults() {
    setSearchQuery("");
    setShowDescription(false);
    setShowKeywords(false);
    setBillFilters(DEFAULT_BILL_FILTERS);
    setSideBySide(true);
    setPrintStartDate("");
    setPrintEndDate("");
    setSelectedOutcomes(DEFAULT_SELECTED);
    setSelectedDepts(new Set(["Department of Public Safety"]));
  }

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
      const filters = buildFilterGroup(billFilters);

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
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(fetchTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(billFilters)]);

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
      const data = await fetchHearings({ startDate: printStartDate, endDate: printEndDate, token });
      setPrintMeetings(data);
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
          <button className={styles.defaultBtn} onClick={resetToDefaults}>
            Default Settings
          </button>
        </div>

        {/* ── Report Criteria ────────────────────────────────────── */}
        <div className={styles.panelSection}>
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
              <FilterBar
                fields={reportMeta?.fields ?? {}}
                filters={billFilters}
                onChange={setBillFilters}
              />
            </div>
          )}
        </div>

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

      <p className={styles.aiLegend}>
        This is a research tool and not an official legislative record.
      </p>
      <p className={styles.aiLegend}>
        ✨ Content marked with this symbol is AI-generated and may contain false information. Please review for accuracy.
      </p>

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
              onClick={() => createBillsTour().drive()}
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
        <PrintHearingsSection hearings={printMeetings} startDate={printStartDate} endDate={printEndDate} />

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
                        onTrackingChanged={(updated) => {
                          if (billFilters.tracked === "tracked" && !updated.is_tracked) {
                            setBills((prev) => prev.filter((b) => b.id !== updated.id));
                          } else if (billFilters.tracked === "untracked" && updated.is_tracked) {
                            setBills((prev) => prev.filter((b) => b.id !== updated.id));
                          } else {
                            setBills((prev) => prev.map((b) => b.id === updated.id ? updated : b));
                          }
                        }}
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
                  onTrackingChanged={(updated) => {
                    if (billFilters.tracked === "tracked" && !updated.is_tracked) {
                      setBills((prev) => prev.filter((b) => b.id !== updated.id));
                    } else if (billFilters.tracked === "untracked" && updated.is_tracked) {
                      setBills((prev) => prev.filter((b) => b.id !== updated.id));
                    } else {
                      setBills((prev) => prev.map((b) => b.id === updated.id ? updated : b));
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <SyncSchedule entries={[
        { label: "Bills, Legislative Outcomes & Fiscal Notes", frequency: "Daily at 4:05 AM and 4:05 PM (Juneau time)" },
        { label: "Hearings",                     frequency: "Daily at 4:05 AM and 4:05 PM (Juneau time)" },
      ]} />
    </div>

  );
}

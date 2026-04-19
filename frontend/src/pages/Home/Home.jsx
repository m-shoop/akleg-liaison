import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { fetchBills } from "../../api/bills";
import { fetchHearings, fetchUpcomingHearings } from "../../api/hearings";
import { fetchTags } from "../../api/tags";
import { useAuth } from "../../context/AuthContext";
import BillCard from "../../components/BillCard/BillCard";
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

export default function Home() {
  const location = useLocation();
  const { can, token } = useAuth();
  const [toast, setToast] = useState(location.state?.toast ? { message: location.state.toast, type: "success" } : null);
  const [bills, setBills] = useState([]);
  const [allTags, setAllTags] = useState([]);
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
  const [showUntracked, setShowUntracked] = useState(location.state?.showUntracked ?? sessionStorage.getItem("leg_showUntracked") === "true");
  const [sideBySide, setSideBySide] = useState(() => sessionStorage.getItem("leg_sideBySide") !== "false");
  const [showKeywords, setShowKeywords] = useState(() => sessionStorage.getItem("leg_showKeywords") === "true");
  // location.state?.search (from bill-link navigation) takes priority over stored search
  const [searchQuery, setSearchQuery] = useState(location.state?.search ?? sessionStorage.getItem("leg_searchQuery") ?? "");
  const [printStartDate, setPrintStartDate] = useState(() => sessionStorage.getItem("leg_printStartDate") ?? "");
  const [printEndDate, setPrintEndDate] = useState(() => sessionStorage.getItem("leg_printEndDate") ?? "");
  const [printMeetings, setPrintMeetings] = useState(null);
  const [upcomingHearings, setUpcomingHearings] = useState({});
  const [pendingPrint, setPendingPrint] = useState(false);
  const [filterToHearings, setFilterToHearings] = useState(() => sessionStorage.getItem("leg_filterToHearings") === "true");
  const [hearingBillIds, setHearingBillIds] = useState(null);
  const contentRef = useRef(null);

  // Auto-off when either date is cleared
  useEffect(() => {
    if (!printStartDate || !printEndDate) {
      setFilterToHearings(false);
    }
  }, [printStartDate, printEndDate]);

  // ─── Persist Legislation tab settings to sessionStorage ───────────────────
  useEffect(() => {
    if (searchQuery) sessionStorage.setItem("leg_searchQuery", searchQuery);
    else sessionStorage.removeItem("leg_searchQuery");
    if (showDescription) sessionStorage.setItem("leg_showDescription", "true");
    else sessionStorage.removeItem("leg_showDescription");
    if (showKeywords) sessionStorage.setItem("leg_showKeywords", "true");
    else sessionStorage.removeItem("leg_showKeywords");
    if (showUntracked) sessionStorage.setItem("leg_showUntracked", "true");
    else sessionStorage.removeItem("leg_showUntracked");
    if (!sideBySide) sessionStorage.setItem("leg_sideBySide", "false");
    else sessionStorage.removeItem("leg_sideBySide");
    if (printStartDate) sessionStorage.setItem("leg_printStartDate", printStartDate);
    else sessionStorage.removeItem("leg_printStartDate");
    if (printEndDate) sessionStorage.setItem("leg_printEndDate", printEndDate);
    else sessionStorage.removeItem("leg_printEndDate");
    if (filterToHearings) sessionStorage.setItem("leg_filterToHearings", "true");
    else sessionStorage.removeItem("leg_filterToHearings");
    sessionStorage.setItem("leg_selectedOutcomes", JSON.stringify([...selectedOutcomes]));
    sessionStorage.setItem("leg_selectedDepts", selectedDepts === null ? "null" : JSON.stringify([...selectedDepts]));
  }, [searchQuery, showDescription, showKeywords, showUntracked, sideBySide, printStartDate, printEndDate, filterToHearings, selectedOutcomes, selectedDepts]);

  function resetToDefaults() {
    setSearchQuery("");
    setShowDescription(false);
    setShowKeywords(false);
    setShowUntracked(false);
    setSideBySide(true);
    setPrintStartDate("");
    setPrintEndDate("");
    setFilterToHearings(false);
    setSelectedOutcomes(DEFAULT_SELECTED);
    setSelectedDepts(new Set(["Department of Public Safety"]));
  }

  // Fetch hearing bill IDs whenever the filter is on and both dates are set
  useEffect(() => {
    if (!filterToHearings || !printStartDate || !printEndDate) {
      setHearingBillIds(null);
      return;
    }
    fetchHearings({ startDate: printStartDate, endDate: printEndDate, token })
      .then((hearings) => {
        const ids = new Set(
          hearings
            .flatMap((m) => m.agenda_items)
            .filter((item) => item.is_bill && item.bill_id != null)
            .map((item) => item.bill_id)
        );
        setHearingBillIds(ids);
      })
      .catch(() => setHearingBillIds(new Set()));
  }, [filterToHearings, printStartDate, printEndDate]);

  useEffect(() => {
    if (can("bill-tags:view")) {
      fetchTags(token).then(setAllTags).catch(() => {});
    }
  }, [can]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchBills({ includeUntracked: showUntracked, token }),
      fetchUpcomingHearings(),
    ])
      .then(([billsData, upcomingData]) => {
        setBills(billsData);
        setUpcomingHearings(upcomingData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [showUntracked]);

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

  const visibleBills = filterToHearings && hearingBillIds !== null
    ? searchedBills.filter((b) => hearingBillIds.has(b.id))
    : searchedBills;

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
          <div className={styles.titleBlock}>
            <div>
              <h1 className={styles.title}>Tracked Legislation</h1>
              <p className={styles.subtitle}>
                34th Alaska Legislature ·{" "}
                {(query || filterToHearings)
                  ? `${visibleBills.length} of ${sortedBills.length} measures`
                  : `${bills.length} measure${bills.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            <div className={styles.searchRow}>
              <input
                id="tour-search"
                className={styles.searchInput}
                type="search"
                placeholder="Search bills, outcomes, committees…"
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
            <button className={styles.defaultBtn} onClick={resetToDefaults}>
              Default Settings
            </button>
          </div>
          <div className={styles.controls}>
            <div id="tour-filter-outcomes-fiscal-notes" className={styles.togglePair}>
              <OutcomeFilter
                selected={selectedOutcomes}
                onChange={setSelectedOutcomes}
              />
              <FiscalDeptFilter
                allDepts={allDepts}
                selected={selectedDepts}
                onChange={setSelectedDepts}
              />
            </div>
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
            <div id="tour-toggle-untracked" className={styles.toggleGroup}>
              <button
                className={`${styles.toggleOption} ${!showUntracked ? styles.toggleSelected : ""}`}
                onClick={() => setShowUntracked(false)}
              >
                Hide Untracked
              </button>
              <button
                className={`${styles.toggleOption} ${showUntracked ? styles.toggleSelected : ""}`}
                onClick={() => setShowUntracked(true)}
              >
                Show Untracked
              </button>
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
            <div id="tour-export-pdf" className={styles.printRow}>
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
              <button className={styles.printBtn} onClick={exportPDF} disabled={pendingPrint || (!!(printStartDate) !== !!(printEndDate))}>
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
            <div
              className={styles.hearingFilterRow}
              title={(!printStartDate || !printEndDate) ? "Add dates to use this filter" : undefined}
            >
              <div id="tour-toggle-filter-bills-with-hearings">
                <span className={styles.hearingFilterLabel}>Filter to Measures with Hearings on These Dates</span>
                <div className={`${styles.toggleGroup} ${(!printStartDate || !printEndDate) ? styles.toggleDisabled : ""}`}>
                  <button
                    className={`${styles.toggleOption} ${!filterToHearings ? styles.toggleSelected : ""}`}
                    onClick={() => setFilterToHearings(false)}
                    disabled={!printStartDate || !printEndDate}
                  >
                    Off
                  </button>
                  <button
                    className={`${styles.toggleOption} ${filterToHearings ? styles.toggleSelected : ""}`}
                    onClick={() => setFilterToHearings(true)}
                    disabled={!printStartDate || !printEndDate}
                  >
                    On
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className={styles.aiLegend}>
        This is a research tool and not an official legislative record.
      </p>
      <p className={styles.aiLegend}>
        ✨ Content marked with this symbol is AI-generated and may contain false information. Please review for accuracy.
      </p>

      {loading && <p className={styles.notice}>Loading measures…</p>}
      {error   && <p className={styles.error}>Error: {error}</p>}
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />

      {!loading && !error && bills.length === 0 && (
        <p className={styles.notice}>No bills have been tracked yet.</p>
      )}

      <div ref={contentRef}>
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
                          if (!showUntracked && !updated.is_tracked) {
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
                    if (!showUntracked && !updated.is_tracked) {
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

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { fetchBills } from "../../api/bills";
import { fetchMeetings, fetchUpcomingHearings } from "../../api/meetings";
import BillCard from "../../components/BillCard/BillCard";
import OutcomeFilter from "../../components/OutcomeFilter/OutcomeFilter";
import Toast from "../../components/Toast/Toast";
import { createBillsTour } from "../../tours/billsTour";
import { DEFAULT_SELECTED } from "../../utils/outcomeTypes";
import { todayJuneau, weekBounds, weekBoundsTitle } from "../../utils/weekBounds";
import styles from "./Home.module.css";

function fmtDate(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function fmtTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

const _MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtDateRange(startIso, endIso) {
  if (!startIso || !endIso) return "";
  const s = new Date(startIso + "T00:00:00");
  const e = new Date(endIso + "T00:00:00");
  if (startIso === endIso) {
    return `${_MONTHS[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()}`;
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${_MONTHS[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${_MONTHS[s.getMonth()]} ${s.getDate()} \u2013 ${_MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

function fmtUpdated(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  return `${_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const DEFAULT_HEADER_BODY =
`Call from Juneau: 586-9085
Call from Anchorage: 563-9085
Anywhere else (toll free): 844-586-9085

Let the operator know which committee hearing you need to be connected to, as a testifier.
Please also use the chat feature in MS Teams so we can send each other notes during the hearing.

Hearings will be teleconferenced and/or streamed live at www.AKL.tv. *Remember there is a considerable delay while streaming so be sure to rely on your copy of the slide deck and refer to slide #'s when speaking.`;

function groupByDate(meetings) {
  return meetings.reduce((acc, m) => {
    if (!acc[m.meeting_date]) acc[m.meeting_date] = [];
    acc[m.meeting_date].push(m);
    return acc;
  }, {});
}

export default function Home() {
  const location = useLocation();
  const [toast, setToast] = useState(location.state?.toast ? { message: location.state.toast, type: "success" } : null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDescription, setShowDescription] = useState(false);
  const [selectedOutcomes, setSelectedOutcomes] = useState(DEFAULT_SELECTED);
  const [showUntracked, setShowUntracked] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const [showKeywords, setShowKeywords] = useState(false);
  const [searchQuery, setSearchQuery] = useState(location.state?.search ?? "");
  const [printStartDate, setPrintStartDate] = useState("");
  const [printEndDate, setPrintEndDate] = useState("");
  const [printMeetings, setPrintMeetings] = useState(null);
  const [upcomingHearings, setUpcomingHearings] = useState({});
  const [pendingPrint, setPendingPrint] = useState(false);
  const [filterToHearings, setFilterToHearings] = useState(false);
  const [hearingBillIds, setHearingBillIds] = useState(null);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [headerIncluded, setHeaderIncluded] = useState(
    () => localStorage.getItem("rh_included") === "true"
  );
  const [headerUpdated, setHeaderUpdated] = useState(todayJuneau);
  const [headerBody, setHeaderBody] = useState(
    () => localStorage.getItem("rh_body") || DEFAULT_HEADER_BODY
  );
  const contentRef = useRef(null);

  useEffect(() => { localStorage.setItem("rh_body", headerBody); }, [headerBody]);
  useEffect(() => { localStorage.setItem("rh_included", headerIncluded); }, [headerIncluded]);

  // Auto-off when either date is cleared
  useEffect(() => {
    if (!printStartDate || !printEndDate) {
      setFilterToHearings(false);
    }
  }, [printStartDate, printEndDate]);

  // Fetch hearing bill IDs whenever the filter is on and both dates are set
  useEffect(() => {
    if (!filterToHearings || !printStartDate || !printEndDate) {
      setHearingBillIds(null);
      return;
    }
    fetchMeetings({ startDate: printStartDate, endDate: printEndDate })
      .then((meetings) => {
        const ids = new Set(
          meetings
            .flatMap((m) => m.agenda_items)
            .filter((item) => item.is_bill && item.bill_id != null)
            .map((item) => item.bill_id)
        );
        setHearingBillIds(ids);
      })
      .catch(() => setHearingBillIds(new Set()));
  }, [filterToHearings, printStartDate, printEndDate]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchBills({ includeUntracked: showUntracked }),
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

        const keywordFields = showKeywords ? bill.keywords.map((s) => s.keyword) : [];

        const haystack = [bill.bill_number, bill.short_title, bill.status, ...bill.tags.map((t) => t.label), ...outcomeFields, ...keywordFields]
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
      const data = await fetchMeetings({ startDate: printStartDate, endDate: printEndDate });
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
          </div>
          <div className={styles.controls}>
            <div id="tour-filter-outcomes">
              <OutcomeFilter
                selected={selectedOutcomes}
                onChange={setSelectedOutcomes}
              />
            </div>
            <div id="tour-toggle-descriptions" className={styles.toggleGroup}>
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
            <div id="tour-toggle-layout" className={styles.toggleGroup}>
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
            <div id="tour-toggle-keywords" className={styles.toggleGroup}>
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
      <p className={styles.aiLegend}>
        This is a research tool and not an official legislative record.
      </p>
      <p className={styles.aiLegend}>
        ✨ Content marked with this symbol is AI-generated and may contain false information. Please review for accuracy.
      </p>

      {loading && <p className={styles.notice}>Loading bills…</p>}
      {error   && <p className={styles.error}>Error: {error}</p>}
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />

      {!loading && !error && bills.length === 0 && (
        <p className={styles.notice}>No bills have been tracked yet.</p>
      )}

      <div ref={contentRef}>
        {headerIncluded && (
          <div className={styles.printReportHeader}>
            <p className={styles.printRhTitle}>Legislative Committee Hearing Schedule</p>
            <p className={styles.printRhSubtitle}>Department of Public Safety (DPS)</p>
            {fmtDateRange(printStartDate, printEndDate) && (
              <p className={styles.printRhMeta}>{fmtDateRange(printStartDate, printEndDate)}</p>
            )}
            <p className={styles.printRhMeta}>Updated {fmtUpdated(headerUpdated)}</p>
            <p className={styles.printRhBody}>{headerBody}</p>
          </div>
        )}
        {printMeetings !== null && (
          <div className={styles.printMeetingsSection}>
            <div className={styles.printSectionHeader}>
              <span className={styles.printSectionTitle}>Committee Hearings</span>
              {printStartDate && printEndDate && (
                <span className={styles.printSectionMeta}>
                  {fmtDate(printStartDate)} – {fmtDate(printEndDate)}
                </span>
              )}
            </div>
            {printMeetings.filter((m) => !m.hidden).length === 0 ? (
              <p className={styles.printEmpty}>No meetings found for this date range.</p>
            ) : (
              Object.keys(groupByDate(printMeetings.filter((m) => !m.hidden))).sort().map((dateKey) => (
                <div key={dateKey} className={styles.printDayBlock}>
                  <div className={styles.printDayHeading}>{fmtDate(dateKey)}</div>
                  <div className={styles.printDayMeetings}>
                    {groupByDate(printMeetings.filter((m) => !m.hidden))[dateKey].map((m) => (
                      <div key={m.id}>
                      <div
                        className={`${styles.printMeetingCard} ${m.chamber === "H" ? styles.printHouse : styles.printSenate}`}
                      >
                        <div className={styles.printMeetingMain}>
                          <div className={styles.printMeetingDate}>
                            <span>{fmtDate(m.meeting_date)}</span>
                            {m.meeting_time && <span>{fmtTime(m.meeting_time)}</span>}
                          </div>
                          <div className={styles.printMeetingHeader}>
                            <span className={styles.printChamberBadge}>{m.chamber}</span>
                            {m.committee_url ? (
                              <a href={m.committee_url} className={styles.printMeetingName}>{m.committee_name}</a>
                            ) : (
                              <span className={styles.printMeetingName}>{m.committee_name}</span>
                            )}
                            <span className={styles.printMeetingType}>{m.committee_type}</span>
                            {m.location && (
                              <span className={styles.printMeetingLoc}>{m.location}</span>
                            )}
                          </div>
                          {m.agenda_items.length > 0 && (
                            <table className={styles.printAgendaTable}>
                              <tbody>
                                {m.agenda_items.map((item) =>
                                  item.is_bill ? (
                                    <tr key={item.id}>
                                      <td className={styles.printBillNum}>
                                        {item.prefix && `${item.prefix} `}
                                        {item.url ? (
                                          <a href={item.url}>{item.bill_number}</a>
                                        ) : (
                                          item.bill_number
                                        )}
                                      </td>
                                      <td className={styles.printBillDesc}>{item.content}</td>
                                      <td className={styles.printTeleconf}>{item.is_teleconferenced ? "TC" : ""}</td>
                                    </tr>
                                  ) : (
                                    <tr key={item.id}>
                                      <td className={styles.printNotePrefix}>{item.prefix ?? ""}</td>
                                      <td className={styles.printNoteContent}>{item.content}</td>
                                      <td className={styles.printTeleconf}>{item.is_teleconferenced ? "TC" : ""}</td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          )}
                        </div>
                        <div className={styles.printDpsNotes}>{m.dps_notes ?? ""}</div>
                      </div>
                      {m.last_sync && (
                        <p className={styles.printLastSynced}>
                          Synced {new Date(m.last_sync).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
            <div className={styles.printSectionDivider} />
          </div>
        )}

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

        <div id="tour-report-header" className={`${styles.reportHeaderToggleRow} ${!headerIncluded ? styles.reportHeaderExcluded : ""}`}>
          <button className={styles.reportHeaderToggle} onClick={() => setHeaderOpen((v) => !v)}>
            {headerOpen ? "▾ Hide report header" : "▸ Report header"}
          </button>
        </div>

        {headerOpen && (
          <div className={`${styles.reportHeader} ${!headerIncluded ? styles.reportHeaderExcluded : ""}`}>
            <label className={styles.rhIncludeLabel}>
              <input
                type="checkbox"
                checked={headerIncluded}
                onChange={(e) => {
                  setHeaderIncluded(e.target.checked);
                  if (!e.target.checked) setHeaderOpen(false);
                }}
              />
              Include in PDF
            </label>
            <div className={styles.reportHeaderPreview}>
              <p className={styles.rhTitle}>Legislative Committee Hearing Schedule</p>
              <p className={styles.rhSubtitle}>Department of Public Safety (DPS)</p>
              {fmtDateRange(printStartDate, printEndDate) && (
                <p className={styles.rhMeta}>{fmtDateRange(printStartDate, printEndDate)}</p>
              )}
              <p className={styles.rhMeta}>Updated {fmtUpdated(headerUpdated)}</p>
              <p className={styles.rhBody}>{headerBody}</p>
            </div>
            <div className={styles.reportHeaderControls}>
              <label className={styles.rhControlLabel}>
                Updated date
                <input
                  type="date"
                  value={headerUpdated}
                  onChange={(e) => setHeaderUpdated(e.target.value)}
                  className={styles.rhDateInput}
                />
              </label>
              <label className={styles.rhControlLabel}>
                Body text
                <textarea
                  className={styles.rhTextarea}
                  value={headerBody}
                  onChange={(e) => setHeaderBody(e.target.value)}
                  rows={8}
                />
              </label>
              <p className={styles.rhNote}>Date range is pulled from the meeting date fields in the print controls above.</p>
            </div>
          </div>
        )}

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
                        showKeywords={showKeywords}
                        abbreviated={true}
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
                  showKeywords={showKeywords}
                  upcomingHearingDates={upcomingHearings[bill.id] ?? []}
                  recentHearingDates={recentHearings[bill.id] ?? []}
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
    </div>
  );
}

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
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${_MONTHS[s.getMonth()]} ${s.getDate()}-${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${_MONTHS[s.getMonth()]} ${s.getDate()} \u2013 ${_MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

function fmtUpdated(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
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
  const [headerOpen, setHeaderOpen] = useState(false);
  const [headerIncluded, setHeaderIncluded] = useState(
    () => localStorage.getItem("rh_included") === "true"
  );
  const [headerUpdated, setHeaderUpdated] = useState(
    () => localStorage.getItem("rh_updated") || new Date().toISOString().slice(0, 10)
  );
  const [headerBody, setHeaderBody] = useState(
    () => localStorage.getItem("rh_body") || DEFAULT_HEADER_BODY
  );
  const contentRef = useRef(null);

  useEffect(() => { localStorage.setItem("rh_updated", headerUpdated); }, [headerUpdated]);
  useEffect(() => { localStorage.setItem("rh_body", headerBody); }, [headerBody]);
  useEffect(() => { localStorage.setItem("rh_included", headerIncluded); }, [headerIncluded]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchBills({ includeUntracked: showUntracked }),
      fetchUpcomingHearings(),
    ])
      .then(([billsData, hearingsData]) => {
        setBills(billsData);
        setUpcomingHearings(hearingsData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [showUntracked]);

  const reportDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const sortedBills = [...bills].sort((a, b) => {
    const chamberA = a.bill_number.startsWith("HB") ? 0 : 1;
    const chamberB = b.bill_number.startsWith("HB") ? 0 : 1;
    const numA = parseInt(a.bill_number.replace(/\D/g, ""), 10);
    const numB = parseInt(b.bill_number.replace(/\D/g, ""), 10);
    return chamberA - chamberB || numA - numB;
  });

  const query = searchQuery.trim().toLowerCase();
  const visibleBills = query
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
              <h1 className={styles.title}>Tracked Bills</h1>
              <p className={styles.subtitle}>
                34th Alaska Legislature ·{" "}
                {query
                  ? `${visibleBills.length} of ${sortedBills.length} bills`
                  : `${bills.length} bill${bills.length !== 1 ? "s" : ""}`}
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
              <span className={styles.printRowLabel}>Meetings:</span>
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
              <button className={styles.printBtn} onClick={exportPDF} disabled={pendingPrint}>
                {pendingPrint ? "Preparing…" : "Export PDF"}
              </button>
            </div>
          </div>
        </div>
      </div>

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
                      {m.updated_at && (
                        <p className={styles.printLastSynced}>
                          Synced {new Date(m.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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

        <div className={styles.printHeader}>
          <h1 className={styles.printTitle}>Legislative Bills</h1>
          <p className={styles.printMeta}>
            34th Alaska Legislature · {sortedBills.length} bill
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
              { label: "Senate Bills", bills: visibleBills.filter((b) => b.bill_number.startsWith("SB")) },
              { label: "House Bills",  bills: visibleBills.filter((b) => b.bill_number.startsWith("HB")) },
            ].map(({ label, bills: columnBills }) => (
              <div key={label} className={styles.sideColumn}>
                <h2 className={styles.columnHeader}>{label}</h2>
                <ul className={styles.list}>
                  {columnBills.map((bill, idx) => (
                    <li key={bill.id} id={idx === 0 && label === "Senate Bills" ? "tour-first-bill" : undefined}>
                      <BillCard
                        bill={bill}
                        showDescription={showDescription}
                        selectedOutcomes={selectedOutcomes}
                        showKeywords={showKeywords}
                        abbreviated={true}
                        nextHearingDate={upcomingHearings[bill.id] ?? null}
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
                  nextHearingDate={upcomingHearings[bill.id] ?? null}
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

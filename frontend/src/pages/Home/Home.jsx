import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { fetchBills } from "../../api/bills";
import { fetchMeetings } from "../../api/meetings";
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
  const [pendingPrint, setPendingPrint] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    fetchBills({ includeUntracked: showUntracked })
      .then(setBills)
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
        {printMeetings !== null && (
          <div className={styles.printMeetingsSection}>
            <div className={styles.printSectionHeader}>
              <span className={styles.printSectionTitle}>Alaska State Legislative Meeting Schedule</span>
              {printStartDate && printEndDate && (
                <span className={styles.printSectionMeta}>
                  {fmtDate(printStartDate)} – {fmtDate(printEndDate)}
                </span>
              )}
            </div>
            {printMeetings.length === 0 ? (
              <p className={styles.printEmpty}>No meetings found for this date range.</p>
            ) : (
              Object.keys(groupByDate(printMeetings)).sort().map((dateKey) => (
                <div key={dateKey} className={styles.printDayBlock}>
                  <div className={styles.printDayHeading}>{fmtDate(dateKey)}</div>
                  <div className={styles.printDayMeetings}>
                    {groupByDate(printMeetings)[dateKey].map((m) => (
                      <div
                        key={m.id}
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
                    ))}
                  </div>
                </div>
              ))
            )}
            <div className={styles.printSectionDivider} />
          </div>
        )}

        <div className={styles.printHeader}>
          <h1 className={styles.printTitle}>Tracked Bills</h1>
          <p className={styles.printMeta}>
            34th Alaska Legislature · {sortedBills.length} bill
            {sortedBills.length !== 1 ? "s" : ""} · Report generated {reportDate}
          </p>
        </div>

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

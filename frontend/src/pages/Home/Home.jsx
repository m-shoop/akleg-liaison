import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { fetchBills } from "../../api/bills";
import BillCard from "../../components/BillCard/BillCard";
import OutcomeFilter from "../../components/OutcomeFilter/OutcomeFilter";
import { DEFAULT_SELECTED } from "../../utils/outcomeTypes";
import styles from "./Home.module.css";

export default function Home() {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDescription, setShowDescription] = useState(false);
  const [selectedOutcomes, setSelectedOutcomes] = useState(DEFAULT_SELECTED);
  const [showUntracked, setShowUntracked] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
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

        const haystack = [bill.bill_number, bill.short_title, bill.status, ...bill.tags.map((t) => t.label), ...outcomeFields]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
    : sortedBills;

  const handlePrint = useReactToPrint({ contentRef });

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
                className={styles.searchInput}
                type="search"
                placeholder="Search bills, outcomes, committees…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.controls}>
            <OutcomeFilter
              selected={selectedOutcomes}
              onChange={setSelectedOutcomes}
            />
            <button
              className={styles.toggleBtn}
              onClick={() => setShowDescription((v) => !v)}
            >
              {showDescription ? "Hide" : "Show"} Descriptions
            </button>
            <button
              className={styles.toggleBtn}
              onClick={() => setShowUntracked((v) => !v)}
            >
              {showUntracked ? "Hide Untracked" : "Show Untracked"}
            </button>
            <button
              className={styles.toggleBtn}
              onClick={() => setSideBySide((v) => !v)}
            >
              {sideBySide ? "Single Column" : "Side by Side"}
            </button>
            <button className={styles.printBtn} onClick={handlePrint}>
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {loading && <p className={styles.notice}>Loading bills…</p>}
      {error   && <p className={styles.error}>Error: {error}</p>}

      {!loading && !error && bills.length === 0 && (
        <p className={styles.notice}>No bills have been tracked yet.</p>
      )}

      <div ref={contentRef}>
        <div className={styles.printHeader}>
          <h1 className={styles.printTitle}>AK Leg Liaison — Tracked Bills</h1>
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
                  {columnBills.map((bill) => (
                    <li key={bill.id}>
                      <BillCard
                        bill={bill}
                        showDescription={showDescription}
                        selectedOutcomes={selectedOutcomes}
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
            {visibleBills.map((bill) => (
              <li key={bill.id}>
                <BillCard
                  bill={bill}
                  showDescription={showDescription}
                  selectedOutcomes={selectedOutcomes}
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

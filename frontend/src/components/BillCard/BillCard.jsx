import { useState } from "react";
import { Link } from "react-router-dom";
import { setTracked } from "../../api/bills";
import { useAuth } from "../../context/AuthContext";
import BillTags from "../BillTags/BillTags";
import OutcomesTable from "../OutcomesTable/OutcomesTable";
import styles from "./BillCard.module.css";

function sundayOfWeek(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}


function fmtHearingDate(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

export default function BillCard({ bill, showDescription, selectedOutcomes, showKeywords = false, abbreviated = false, nextHearingDate = null, onRefreshed: _onRefreshed, onTrackingChanged }) {
  const { isEditor, token } = useAuth();
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState(null);

  const lastSynced = bill.updated_at
    ? new Date(bill.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const introduced = bill.introduced_date
    ? new Date(bill.introduced_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  async function handleToggleTracked() {
    setError(null);
    setTracking(true);
    try {
      const updated = await setTracked(bill.id, !bill.is_tracked, token);
      onTrackingChanged?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setTracking(false);
    }
  }

  return (
    <article className={`${styles.card}${!bill.is_tracked ? ` ${styles.cardUntracked}` : ""}`}>
      <div className={styles.headerRow}>
        {bill.source_url ? (
          <a
            href={bill.source_url}
            target="_blank"
            rel="noreferrer"
            className={styles.billNumber}
          >
            {bill.bill_number}
          </a>
        ) : (
          <span className={styles.billNumber}>{bill.bill_number}</span>
        )}
        <p className={styles.shortTitle}>{bill.short_title ?? "Untitled"}</p>
      </div>

      <div className={styles.metaRow}>
        <span className={styles.status}>{bill.status ?? "Unknown"}</span>
        <span className={styles.introduced}>Introduced {introduced}</span>
        {isEditor && (
          <button
            className={styles.trackBtn}
            onClick={handleToggleTracked}
            disabled={tracking}
            title={bill.is_tracked ? "Mark as untracked" : "Mark as tracked"}
          >
            {tracking ? "…" : bill.is_tracked ? "Untrack" : "Track"}
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {nextHearingDate && (
        <Link
          to={`/meetings?search=${encodeURIComponent(bill.bill_number)}&start=${sundayOfWeek(nextHearingDate)}&show_hidden=1`}
          className={styles.hearingBadge}
        >
          Next Hearing: {fmtHearingDate(nextHearingDate)}
        </Link>
      )}

      <OutcomesTable
        events={bill.events}
        showDescription={showDescription}
        selectedOutcomes={selectedOutcomes}
        abbreviated={abbreviated}
      />
      <div className={styles.bottomRow}>
        <BillTags bill={bill} />
        {showKeywords && bill.keywords?.length > 0 && (
          <div className={styles.keywords}>
            {bill.keywords.map((s) =>
              s.url ? (
                <a key={s.keyword} href={s.url} target="_blank" rel="noreferrer" className={styles.keywordPill}>
                  {s.keyword}
                </a>
              ) : (
                <span key={s.keyword} className={styles.keywordPill}>{s.keyword}</span>
              )
            )}
          </div>
        )}
      </div>
      {lastSynced && (
        <p className={styles.lastSynced}>Synced {lastSynced}</p>
      )}
    </article>
  );
}

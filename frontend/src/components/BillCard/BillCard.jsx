import { useState } from "react";
import { setTracked } from "../../api/bills";
import { useAuth } from "../../context/AuthContext";
import BillTags from "../BillTags/BillTags";
import OutcomesTable from "../OutcomesTable/OutcomesTable";
import styles from "./BillCard.module.css";

export default function BillCard({ bill, showDescription, selectedOutcomes, abbreviated = false, onRefreshed: _onRefreshed, onTrackingChanged }) {
  const { isLoggedIn, token } = useAuth();
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState(null);

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
      <div className={styles.header}>
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
        <div className={styles.headerRight}>
          <span className={styles.status}>{bill.status ?? "Unknown"}</span>
          {isLoggedIn && (
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
      </div>

      <p className={styles.shortTitle}>{bill.short_title ?? "Untitled"}</p>
      <p className={styles.introduced}>Introduced {introduced}</p>

      {error && <p className={styles.error}>{error}</p>}

      <OutcomesTable
        events={bill.events}
        showDescription={showDescription}
        selectedOutcomes={selectedOutcomes}
        abbreviated={abbreviated}
      />
      <BillTags bill={bill} />
    </article>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { setTracked } from "../../api/bills";
import { useAuth } from "../../context/AuthContext";
import BillTags from "../BillTags/BillTags";
import FiscalNotesTable from "../FiscalNotesTable/FiscalNotesTable";
import OutcomesTable from "../OutcomesTable/OutcomesTable";
import { flattenOutcomes } from "../../utils/outcomes";
import styles from "./BillCard.module.css";

function weekOf(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - d.getDay());
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  return {
    start: sunday.toISOString().slice(0, 10),
    end: saturday.toISOString().slice(0, 10),
  };
}

function hearingLink(billNumber, isoDate) {
  const { start, end } = weekOf(isoDate);
  return `/meetings?search=${encodeURIComponent(billNumber)}&start=${start}&end=${end}&show_hidden=1`;
}

function committeeLink(status) {
  const match = status?.match(/^\(([HS])\)(.+)/);
  if (!match) return null;
  return `https://www.akleg.gov/basis/Committee/Details/34?code=${match[1]}${match[2].trim()}`;
}

function CalendarIcon({ isoDate, billNumber }) {
  const d = new Date(isoDate + "T00:00:00");
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <Link to={hearingLink(billNumber, isoDate)} className={`${styles.calIcon} ${styles.calIconUpcoming}`}>
      <span className={styles.calIconTop}>{weekday}</span>
      <span className={styles.calIconBottom}>{monthDay}</span>
    </Link>
  );
}

export default function BillCard({ bill, showDescription, selectedOutcomes, selectedDepts = null, showKeywords = false, abbreviated = false, allTags = [], upcomingHearingDates = [], onRefreshed: _onRefreshed, onTrackingChanged }) {
  const { can, token } = useAuth();
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState(null);

  const visibleOutcomes = flattenOutcomes(bill.events).filter((r) => selectedOutcomes.has(r.outcome_type));
  const hasAiOutcomes = bill.events.some((e) => e.outcomes.some((o) => o.ai_generated));
  const hasVisibleFiscalNotes = bill.fiscal_notes?.some(
    (n) => n.is_active && (selectedDepts === null || selectedDepts.has(n.fn_department))
  );

  const lastSynced = bill.last_sync
    ? new Date(bill.last_sync).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const introduced = bill.introduced_date
    ? new Date(bill.introduced_date + "T00:00:00").toLocaleDateString("en-US", {
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

      {bill.sponsors?.length > 0 && (
        <p className={styles.sponsors}>
          <span className={styles.sponsorsLabel}>Sponsor{bill.sponsors.length > 1 ? "s" : ""}:</span>{" "}
          {bill.sponsors.map((s) => s.name).join(", ")}
        </p>
      )}

      <div className={styles.metaRow}>
        {committeeLink(bill.status) ? (
          <a href={committeeLink(bill.status)} target="_blank" rel="noreferrer" className={styles.status}>
            {bill.status}
          </a>
        ) : (
          <span className={styles.status}>{bill.status ?? "Unknown"}</span>
        )}
        <span className={styles.introduced}>Introduced {introduced}</span>
        {can("bill:track") && (
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

      {visibleOutcomes.length > 0 && (
        <>
          <p className={styles.sectionTitle}>
            Legislative Outcomes
            {hasAiOutcomes && (
              <span
                className={styles.aiIndicator}
                title="AI-generated — may contain inaccuracies"
              >
                {" "}✨
              </span>
            )}
          </p>
          <div className={styles.outcomesSection}>
            <OutcomesTable
              events={bill.events}
              showDescription={showDescription}
              selectedOutcomes={selectedOutcomes}
              abbreviated={abbreviated}
            />
          </div>
        </>
      )}

      {bill.fiscal_notes_query_failed ? (
        <>
          <p className={styles.sectionTitle}>Active Fiscal Notes</p>
          <p className={styles.fiscalNotesWarning}>Failed to retrieve fiscal notes on most recent query</p>
        </>
      ) : hasVisibleFiscalNotes && (
        <>
          <p className={styles.sectionTitle}>Active Fiscal Notes</p>
          <div className={styles.outcomesSection}>
            <FiscalNotesTable fiscalNotes={bill.fiscal_notes} selectedDepts={selectedDepts} />
          </div>
        </>
      )}
      <div className={styles.bottomRow}>
        <div className={styles.bottomLeft}>
          <BillTags bill={bill} allTags={allTags} />
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
        {upcomingHearingDates.length > 0 && (
          <div className={styles.hearingsSection}>
            <div className={styles.hearingsTitle}>Upcoming Hearings</div>
            <div className={styles.hearingsRow}>
              {upcomingHearingDates.map((d) => (
                <CalendarIcon key={d} isoDate={d} billNumber={bill.bill_number} />
              ))}
            </div>
          </div>
        )}
      </div>
      {lastSynced && (
        <p className={styles.lastSynced}>Synced {lastSynced}</p>
      )}
    </article>
  );
}

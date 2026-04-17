import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import { fetchPriorAgendas } from "../../api/hearings";
import styles from "./PriorAgendasModal.module.css";

function fmtDate(isoDate) {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtJuneauDate(isoDatetime) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Juneau",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoDatetime));
}

function AgendaTable({ items }) {
  if (items.length === 0) {
    return <p className={styles.emptyNote}>No agenda items</p>;
  }
  return (
    <table className={styles.agendaTable}>
      <tbody>
        {items.map((item) =>
          item.is_bill ? (
            <tr key={item.id} className={styles.billRow}>
              <td className={styles.billNum}>
                {item.prefix && <span className={styles.prefix}>{item.prefix} </span>}
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className={styles.billLink}>
                    {item.bill_number}
                  </a>
                ) : (
                  item.bill_number
                )}
              </td>
              <td className={styles.billDesc}>{item.content}</td>
            </tr>
          ) : (
            <tr key={item.id} className={styles.noteRow}>
              <td className={styles.notePrefix}>{item.prefix ?? ""}</td>
              <td className={styles.noteCell}>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className={styles.noteLink}>
                    {item.content}
                  </a>
                ) : (
                  item.content
                )}
              </td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

export default function PriorAgendasModal({ hearing, onClose }) {
  const { token } = useAuth();
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchPriorAgendas(hearing.id, token)
      .then(setVersions)
      .catch(() => setError("Failed to load prior agendas."));
  }, [hearing.id, token]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const currentDate = hearing.current_agenda_created_at
    ? fmtJuneauDate(hearing.current_agenda_created_at)
    : null;

  const chamberFull = hearing.chamber === "H" ? "House" : "Senate";
  const isFloor = !hearing.committee_name;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.layout} role="dialog" aria-modal="true" aria-label="Agenda versions">
        {/* Left: current version */}
        <div className={styles.currentPanel}>
          <div className={styles.meetingContext}>
            <span className={styles.contextCommittee}>
              {chamberFull} {isFloor ? "Floor Hearing" : hearing.committee_name}
            </span>
            {!isFloor && <span className={styles.contextType}>{hearing.committee_type}</span>}
            <span className={styles.contextDate}>{fmtDate(hearing.hearing_date)}</span>
            {fmtTime(hearing.hearing_time) && (
              <span className={styles.contextTime}>{fmtTime(hearing.hearing_time)}</span>
            )}
          </div>

          <div className={styles.currentHeader}>
            <span className={styles.dateLabel}>Current Agenda</span>
          </div>
          <div className={styles.connector} />
          <div className={styles.agendaBox}>
            <AgendaTable items={hearing.agenda_items} />
          </div>
        </div>

        {/* Right: prior versions */}
        <div className={styles.priorPanel}>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>

          <div className={styles.priorPanelHeader}>
            <span className={styles.priorPanelTitle}>Prior Versions of Agenda</span>
            <span className={styles.priorPanelSubtitle}>in reverse-chronological order by date version was first downloaded</span>
          </div>

          {!versions && !error && (
            <p className={styles.priorStatus}>Loading…</p>
          )}
          {error && (
            <p className={styles.priorStatus}>{error}</p>
          )}
          {versions && versions.length === 0 && (
            <p className={styles.priorStatus}>No prior versions.</p>
          )}

          {versions && versions.map((v) => (
            <div key={v.version} className={styles.versionEntry}>
              <span className={styles.priorDateLabel}>{fmtJuneauDate(v.created_at)}</span>
              <div className={styles.priorConnector} />
              <div className={styles.priorAgendaBox}>
                <AgendaTable items={v.agenda_items} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}

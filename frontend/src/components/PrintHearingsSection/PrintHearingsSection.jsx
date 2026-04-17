import styles from "./PrintHearingsSection.module.css";

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

function groupByDate(hearings) {
  return hearings.reduce((acc, h) => {
    if (!acc[h.hearing_date]) acc[h.hearing_date] = [];
    acc[h.hearing_date].push(h);
    return acc;
  }, {});
}

export default function PrintHearingsSection({ hearings, startDate, endDate }) {
  if (hearings === null) return null;

  const visible = hearings.filter((h) => !h.hidden);
  const byDate = groupByDate(visible);

  return (
    <div className={styles.printMeetingsSection}>
      <div className={styles.printSectionHeader}>
        <span className={styles.printSectionTitle}>Hearings</span>
        {startDate && endDate && (
          <span className={styles.printSectionMeta}>
            {fmtDate(startDate)} – {fmtDate(endDate)}
          </span>
        )}
      </div>
      {visible.length === 0 ? (
        <p className={styles.printEmpty}>No hearings found for this date range.</p>
      ) : (
        Object.keys(byDate).sort().map((dateKey) => (
          <div key={dateKey} className={styles.printDayBlock}>
            <div className={styles.printDayHeading}>{fmtDate(dateKey)}</div>
            <div className={styles.printDayMeetings}>
              {byDate[dateKey].map((h) => {
                const isFloor = !h.committee_name;
                return (
                  <div key={h.id}>
                    <div className={`${styles.printMeetingCard} ${h.chamber === "H" ? styles.printHouse : styles.printSenate}`}>
                      <div className={styles.printMeetingMain}>
                        <div className={styles.printMeetingDate}>
                          <span>{fmtDate(h.hearing_date)}</span>
                          {h.hearing_time && <span>{fmtTime(h.hearing_time)}</span>}
                        </div>
                        <div className={styles.printMeetingHeader}>
                          <span className={styles.printChamberBadge}>{h.chamber}</span>
                          {isFloor ? (
                            <span className={styles.printMeetingName}>Floor Session</span>
                          ) : h.committee_url ? (
                            <a href={h.committee_url} className={styles.printMeetingName}>{h.committee_name}</a>
                          ) : (
                            <span className={styles.printMeetingName}>{h.committee_name}</span>
                          )}
                          {!isFloor && <span className={styles.printMeetingType}>{h.committee_type}</span>}
                          {h.location && (
                            <span className={styles.printMeetingLoc}>{h.location}</span>
                          )}
                        </div>
                        {h.agenda_items.length > 0 && (
                          <table className={styles.printAgendaTable}>
                            <tbody>
                              {h.agenda_items.map((item) =>
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
                      <div className={styles.printDpsNotes}>{h.dps_notes ?? ""}</div>
                    </div>
                    {h.last_sync && (
                      <p className={styles.printLastSynced}>
                        Synced {new Date(h.last_sync).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
      <div className={styles.printSectionDivider} />
    </div>
  );
}

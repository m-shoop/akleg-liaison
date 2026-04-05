import styles from "./PrintMeetingsSection.module.css";

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

export default function PrintMeetingsSection({ meetings, startDate, endDate }) {
  if (meetings === null) return null;

  const visible = meetings.filter((m) => !m.hidden);
  const byDate = groupByDate(visible);

  return (
    <div className={styles.printMeetingsSection}>
      <div className={styles.printSectionHeader}>
        <span className={styles.printSectionTitle}>Committee Hearings</span>
        {startDate && endDate && (
          <span className={styles.printSectionMeta}>
            {fmtDate(startDate)} – {fmtDate(endDate)}
          </span>
        )}
      </div>
      {visible.length === 0 ? (
        <p className={styles.printEmpty}>No meetings found for this date range.</p>
      ) : (
        Object.keys(byDate).sort().map((dateKey) => (
          <div key={dateKey} className={styles.printDayBlock}>
            <div className={styles.printDayHeading}>{fmtDate(dateKey)}</div>
            <div className={styles.printDayMeetings}>
              {byDate[dateKey].map((m) => (
                <div key={m.id}>
                  <div className={`${styles.printMeetingCard} ${m.chamber === "H" ? styles.printHouse : styles.printSenate}`}>
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
  );
}

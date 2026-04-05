import { useState } from "react";
import styles from "./SyncSchedule.module.css";

export default function SyncSchedule({ entries }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrapper}>
      <button className={styles.toggle} onClick={() => setOpen((v) => !v)}>
        <span>{open ? "▾" : "▸"}</span> Sync Schedule
      </button>
      {open && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colData}>Data</th>
              <th className={styles.colFreq}>Frequency</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.label}>
                <td className={styles.colData}>{e.label}</td>
                <td className={styles.colFreq}>{e.frequency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

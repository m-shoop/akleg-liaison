import { useEffect, useState } from "react";
import { todayJuneau } from "../../utils/weekBounds";
import styles from "./ReportHeaderEditor.module.css";

const _MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtDateRange(startIso, endIso) {
  if (!startIso || !endIso) return "";
  const s = new Date(startIso + "T00:00:00");
  const e = new Date(endIso + "T00:00:00");
  if (startIso === endIso) {
    return `${_MONTHS[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()}`;
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${_MONTHS[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${_MONTHS[s.getMonth()]} ${s.getDate()} \u2013 ${_MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

function fmtUpdated(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  return `${_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const DEFAULT_HEADER_BODY =
`Call from Juneau: 586-9085
Call from Anchorage: 563-9085
Anywhere else (toll free): 844-586-9085

Let the operator know which committee hearing you need to be connected to, as a testifier.
Please also use the chat feature in MS Teams so we can send each other notes during the hearing.

Hearings will be teleconferenced and/or streamed live at www.AKL.tv. *Remember there is a considerable delay while streaming so be sure to rely on your copy of the slide deck and refer to slide #'s when speaking.`;

export default function ReportHeaderEditor({ printStartDate, printEndDate }) {
  const [headerOpen, setHeaderOpen] = useState(false);
  const [headerIncluded, setHeaderIncluded] = useState(
    () => localStorage.getItem("rh_included") === "true"
  );
  const [headerUpdated, setHeaderUpdated] = useState(todayJuneau);
  const [headerBody, setHeaderBody] = useState(
    () => localStorage.getItem("rh_body") || DEFAULT_HEADER_BODY
  );

  useEffect(() => { localStorage.setItem("rh_body", headerBody); }, [headerBody]);
  useEffect(() => { localStorage.setItem("rh_included", headerIncluded); }, [headerIncluded]);

  const dateRange = fmtDateRange(printStartDate, printEndDate);

  return (
    <>
      {headerIncluded && (
        <div className={styles.printReportHeader}>
          <p className={styles.printRhTitle}>Legislative Committee Hearing Schedule</p>
          <p className={styles.printRhSubtitle}>Department of Public Safety (DPS)</p>
          {dateRange && <p className={styles.printRhMeta}>{dateRange}</p>}
          <p className={styles.printRhMeta}>Updated {fmtUpdated(headerUpdated)}</p>
          <p className={styles.printRhBody}>{headerBody}</p>
        </div>
      )}

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
            {dateRange && <p className={styles.rhMeta}>{dateRange}</p>}
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
    </>
  );
}

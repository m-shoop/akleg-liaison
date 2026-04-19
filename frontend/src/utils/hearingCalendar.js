/**
 * Convert an Alaska local date+time to a UTC Date object.
 *
 * Alaska observes AKST (UTC−9) in winter and AKDT (UTC−8) in summer.
 * Rather than hard-coding the DST offset, we use Intl.DateTimeFormat to ask
 * the browser "what Alaska local time does this UTC moment represent?", then
 * correct for any discrepancy. This handles DST transitions automatically via
 * the browser's built-in IANA timezone data.
 */
export function alaskaLocalToUtc(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, m] = timeStr.split(":").map(Number);

  // Initial estimate: assume AKST (UTC−9)
  let candidate = new Date(Date.UTC(y, mo - 1, d, h + 9, m, 0));

  // Ask the browser what Alaska local time this UTC moment actually is
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Anchorage",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(candidate);

  const akH = parseInt(parts.find((p) => p.type === "hour").value) % 24;
  const akM = parseInt(parts.find((p) => p.type === "minute").value);

  // If the offset was wrong (e.g. AKDT = UTC−8), adjust
  const diffMs = ((h * 60 + m) - (akH * 60 + akM)) * 60000;
  return new Date(candidate.getTime() + diffMs);
}

/**
 * Export a hearing to an ICS file and trigger a browser download.
 *
 * Supports both committee hearings (has committee_name) and floor hearings
 * (committee_name is null). Uses hearing.length for the event duration.
 */
export function exportToCalendar(hearing, notes) {
  const chamberLabel = hearing.chamber === "H" ? "House" : "Senate";
  const isFloor = !hearing.committee_name;

  const summary = isFloor
    ? `${chamberLabel} Floor Hearing`
    : `${chamberLabel} ${hearing.committee_name} ${hearing.committee_type}`;

  const dateStr = hearing.hearing_date.replace(/-/g, "");
  const durationMin = hearing.length ?? 60;

  let dtStart, dtEnd;
  if (hearing.hearing_time) {
    const pad = (n) => String(n).padStart(2, "0");
    const startUtc = alaskaLocalToUtc(hearing.hearing_date, hearing.hearing_time);
    const endUtc = new Date(startUtc.getTime() + durationMin * 60 * 1000);

    const fmtUtc = (dt) =>
      `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
      `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;

    dtStart = `DTSTART:${fmtUtc(startUtc)}`;
    dtEnd   = `DTEND:${fmtUtc(endUtc)}`;
  } else {
    dtStart = `DTSTART;VALUE=DATE:${dateStr}`;
    dtEnd   = `DTEND;VALUE=DATE:${dateStr}`;
  }

  // Build description
  const descLines = [];
  if (notes) {
    descLines.push("Department of Public Safety Notes:");
    descLines.push(notes);
    descLines.push("--");
  }
  descLines.push("Hearing Schedule:");
  hearing.agenda_items.forEach((item) => {
    const prefix = item.prefix ? `${item.prefix} ` : "";
    if (item.is_bill) {
      descLines.push(`${prefix}${item.bill_number} — ${item.content}`);
    } else {
      descLines.push(`${prefix}${item.content}`);
    }
  });

  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const description = escape(descLines.join("\n")).replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Leg Up//Hearing Export//EN",
    "BEGIN:VEVENT",
    dtStart,
    dtEnd,
    `SUMMARY:${escape(summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escape(hearing.location ?? "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const filename = isFloor
    ? `${hearing.hearing_date}-${hearing.chamber.toLowerCase()}-floor-hearing.ics`
    : `${hearing.committee_name.toLowerCase().replace(/\s+/g, "-")}-${hearing.hearing_date}.ics`;

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtLongDate(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const str = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return str.replace(/\d+$/, (n) => ordinal(Number(n)));
}

export function todayJuneau() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Juneau" });
}

export function weekBounds(offsetWeeks = 0) {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay() + offsetWeeks * 7);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  return {
    start: sunday.toISOString().slice(0, 10),
    end: saturday.toISOString().slice(0, 10),
  };
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + "th";
  switch (v % 10) {
    case 1: return n + "st";
    case 2: return n + "nd";
    case 3: return n + "rd";
    default: return n + "th";
  }
}

export function weekBoundsTitle(offsetWeeks) {
  const { start, end } = weekBounds(offsetWeeks);
  const fmt = (iso) => {
    const d = new Date(iso + "T00:00:00");
    const str = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    return str.replace(/\d+$/, (n) => ordinal(Number(n)));
  };
  return `${fmt(start)} through ${fmt(end)}`;
}

import { weekBounds, todayJuneau } from "./weekBounds";

/**
 * Sentinels stored in saved_reports.report_criteria that are resolved on the
 * frontend at load time so seeded system reports stay correct over time.
 *
 * Stored values are matched as exact strings; anything else passes through.
 * Mirrors the constants in alembic/versions/8c9d0e1f2a3b_seed_system_reports.py.
 */
export function resolveCriteriaSentinels(criteria, ctx = {}) {
  if (criteria == null) return criteria;
  const week = weekBounds();
  const subs = {
    "@today": todayJuneau(),
    "@week_start": week.start,
    "@week_end": week.end,
    "@current_user_email": ctx.username ?? "",
  };
  return walk(criteria, subs);
}

function walk(value, subs) {
  if (typeof value === "string") {
    return Object.prototype.hasOwnProperty.call(subs, value) ? subs[value] : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, subs));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, subs);
    return out;
  }
  return value;
}

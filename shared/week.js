// ISO-8601 week helpers. Weeks start on Monday; week ids look like "2026-W45".
// Dates are plain "YYYY-MM-DD" strings so nothing drifts across time zones.
// Shared by the server (Node) and the browser.

const DAY_MS = 86400000;
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function toUTC(dateStr) {
  if (!isValidDate(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Today's date in the local time zone of whoever runs this. */
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(dateStr, n) {
  return fromUTC(toUTC(dateStr) + n * DAY_MS);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(dateStr) {
  return (new Date(toUTC(dateStr)).getUTCDay() + 6) % 7;
}

export function weekIdOf(dateStr) {
  const ms = toUTC(dateStr);
  const thursday = ms + (3 - weekdayIndex(dateStr)) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7);
  return `${year}-W${pad(week)}`;
}

export function isValidWeekId(id) {
  const m = typeof id === 'string' && /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) return false;
  const week = Number(m[2]);
  if (week < 1 || week > 53) return false;
  // Week 53 only exists in some years: round-trip to check.
  return weekIdOf(weekMonday(id, true)) === id;
}

function weekMonday(id, skipCheck = false) {
  if (!skipCheck && !isValidWeekId(id)) throw new Error(`Invalid week id: ${id}`);
  const [y, w] = [Number(id.slice(0, 4)), Number(id.slice(6))];
  const jan4 = fromUTC(Date.UTC(y, 0, 4));
  const week1Monday = addDays(jan4, -weekdayIndex(jan4));
  return addDays(week1Monday, (w - 1) * 7);
}

/** The 7 dates (Mon..Sun) of a week id. */
export function weekDates(id) {
  const monday = weekMonday(id);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function shiftWeek(id, n) {
  return weekIdOf(addDays(weekMonday(id), n * 7));
}

export function currentWeekId(now = new Date()) {
  return weekIdOf(todayLocal(now));
}

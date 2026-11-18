export const pad = (n) => String(n).padStart(2, '0');
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => dateKey(new Date());
export function parseKey(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};

/** "Monday, 16 November 2026" */
export function fmtLong(k) {
  const d = parseKey(k);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "Mon 16 Nov 2026" */
export function fmtShort(k) {
  const d = parseKey(k);
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}
/** "16 Nov" */
export function fmtDayMonth(k) {
  const d = parseKey(k);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/** "10:42 AM" from Date */
export function fmtClock(d = new Date()) {
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ap}`;
}

/** ISO -> "Mon 16 Nov 2026, 10:42 AM" */
export function fmtStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${fmtShort(dateKey(d))}, ${fmtClock(d)}`;
}

/** "08:20" -> "8:20AM", "08:00" -> "8AM" (report style) */
export function fmtReportTime(t) {
  if (!t) return '';
  const [H, M] = t.split(':').map(Number);
  const ap = H >= 12 ? 'PM' : 'AM';
  const h = H % 12 || 12;
  return M ? `${h}:${pad(M)}${ap}` : `${h}${ap}`;
}

/** Current time rounded down to 5 minutes as "HH:MM" */
export function nowHM(round = 5) {
  const d = new Date();
  const m = Math.floor(d.getMinutes() / round) * round;
  return `${pad(d.getHours())}:${pad(m)}`;
}

export function relGroup(k) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  const d = parseKey(k);
  const diff = (parseKey(t) - d) / 86400000;
  if (diff > 0 && diff < 7) return 'This week';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}

export const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function safeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
}

export function weekStart(k) {
  const d = parseKey(k);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return dateKey(d);
}

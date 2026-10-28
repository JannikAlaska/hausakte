// Small shared helpers: ids, dates, number formatting.

export const uid = (prefix = '') => prefix + Math.random().toString(36).slice(2, 10);

const z2 = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
export const todayISO = () => toISO(new Date());
export const parseISO = (s) => (s ? new Date(s + 'T12:00:00') : null);
export const addDays = (iso, n) => {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
export const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const MONTHS = MON;

export function fmtDate(iso) {
  const d = parseISO(iso);
  return d ? `${z2(d.getDate())}.${z2(d.getMonth() + 1)}.${d.getFullYear()}` : '–';
}
export function fmtDateShort(iso) {
  const d = parseISO(iso);
  return d ? `${WD[d.getDay()]} ${z2(d.getDate())}.${z2(d.getMonth() + 1)}.` : '–';
}
export function fmtDayMonth(iso) {
  const d = parseISO(iso);
  return d ? `${z2(d.getDate())}.${z2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}` : '–';
}
export function fmtMonth(iso) {
  const d = parseISO(iso);
  return d ? `${MON[d.getMonth()]} ${d.getFullYear()}` : '–';
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${WD[d.getDay()]} ${z2(d.getDate())}.${z2(d.getMonth() + 1)}. ${z2(d.getHours())}:${z2(d.getMinutes())}`;
}

export const fmtNum = (n, digits = 1) =>
  n == null || isNaN(n)
    ? '–'
    : Number(n).toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmtFixed = (n, digits = 1) =>
  n == null || isNaN(n)
    ? '–'
    : Number(n).toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const fmtEuro = (n) =>
  n == null || isNaN(n)
    ? '–'
    : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const fmtArea = (n) => (n == null ? '–' : fmtFixed(n, 1) + ' m²');
export const fmtLen = (n) => (n == null ? '–' : fmtFixed(n, 2) + ' m');

// Parses German or English decimal input ("1.234,5" / "1234.5"). Returns null when empty/invalid.
export function parseNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s|€|m²|m/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round = (v, step = 0.01) => Math.round(v / step) * step;
export const deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const byKey = (key) => (a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0);

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

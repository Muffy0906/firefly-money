import { type ApiData, App, isoDate, pad } from './base';

/* Small shared helpers: dates, local settings, downloads. */
export function saveBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name || 'download'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); };
export const fmtSize = (b: number) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B';
export const LS = {
  get(k: string, d?: unknown): ApiData { try { const v = localStorage.getItem('money.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem('money.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } if (App.prefChanged) App.prefChanged(k); },
};
// n days for a chart over time: today and the last day of each period of `step` months before it, oldest first
export function monthEnds(today: string, n: number, step = 1) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7) - 1, out = [today];
  for (let i = 1; i < n; i++) {
    const d = new Date(y, m - (i - 1) * step, 0);      // day 0 = the last day of the month before
    out.unshift(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
  }
  return out;
}
export const daysBetween = (a: string, b: string) => Math.round((+new Date(b + 'T12:00:00') - +new Date(a + 'T12:00:00')) / 864e5);
export function bizDay(y: number, m: number, day: number) {            // that day of the month (clamped), moved back to Friday if it's a weekend
  const d = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return isoDate(d);
}
export function monthsFrom(from: string, to: string) { const out: [number, number][] = []; let d = new Date(from + 'T12:00:00'); d.setDate(1); const end = new Date(to + 'T12:00:00'); while (d <= end) { out.push([d.getFullYear(), d.getMonth()]); d.setMonth(d.getMonth() + 1); } return out; }
// Budgets at or past this share of their amount get a warning (Settings → Months & budgets)
export const budgetAlert = () => { const v = +LS.get('budgetAlert', 85); return v >= 10 && v <= 100 ? v : 85; };

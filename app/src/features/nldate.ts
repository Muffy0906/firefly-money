import { isoDate } from '../core/base';

/* Dates written the way people type them in quick add: "yesterday", "3 days ago", "last mon", "9/12", "sep 12". */

const WDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// The date the words at ws[i] spell, and how many words that took
export function nlDate(ws: string[], i: number): [string, number] | null {
  const w = ws[i].toLowerCase().replace(/[,.]$/, ''), t = new Date(); t.setHours(12, 0, 0, 0);
  const iso = (d: Date) => isoDate(d);
  if (w === 'today') return [iso(t), 1];
  if (w === 'yesterday') { t.setDate(t.getDate() - 1); return [iso(t), 1]; }
  if (w === 'tomorrow') { t.setDate(t.getDate() + 1); return [iso(t), 1]; }
  if (/^\d{1,2}$/.test(w) && /^days?$/i.test(ws[i + 1] || '') && /^ago$/i.test(ws[i + 2] || '')) { t.setDate(t.getDate() - +w); return [iso(t), 3]; }
  const wd = WDAYS.findIndex(d => w.length >= 3 && d.startsWith(w) && (w.length >= 3 && (w === d || w === d.slice(0, 3) || w === d.slice(0, 4))));
  if (wd >= 0) { let back = (t.getDay() - wd + 7) % 7; if (back === 0 && /^last$/i.test(ws[i - 1] || '')) back = 7; t.setDate(t.getDate() - back); return [iso(t), 1]; }
  let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(w);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : t.getFullYear(); const d = new Date(y, +m[1] - 1, +m[2], 12); if (!m[3] && d > t) d.setFullYear(y - 1); return [iso(d), 1]; }
  const mi = MONS.findIndex((x, k) => w === x || w === MONTHS[k] || (k === 8 && w === 'sept'));   // real month spellings only, so "Market 20" stays a merchant
  if (mi >= 0 && /^\d{1,2}(st|nd|rd|th)?,?$/i.test(ws[i + 1] || '')) { const d = new Date(t.getFullYear(), mi, parseInt(ws[i + 1], 10), 12); if (d > t) d.setFullYear(d.getFullYear() - 1); return [iso(d), 2]; }
  return null;
}

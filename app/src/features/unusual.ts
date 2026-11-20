import { anomaly, quantile } from './predict';
import { getAll } from '../core/api';
import { S, money0, monthOf, monthRange, nowMonth, todayIso, type ApiData } from '../core/base';
import { type Group, normGroup, payeeOf } from '../core/feed';
import { addDays, daysBetween } from '../core/helpers';
import { t } from '../core/spanish';

/* ================= Unusual charges and merchant trends =================
   Both read the same six months of spending (one request, fetched when asked, kept in memory for the session only
   while Firefly answers: a failed request gives nothing, never an older copy). Nothing here is stored.
   Unusual charges, over the last 30 days: a charge repeated within a day (unless that merchant does that routinely),
   a charge far above that merchant's usual (median/MAD, see predict.ts; its category when the merchant is too new to
   have a usual), and a large charge from a merchant never seen before.
   Trends, this month so far against the same days of the three months before: who rose and fell most, and who is new. */
export interface Charge { id: string, date: string, key: string, payee: string, payeeId: string, cat: string, amount: number }
export type FlagKind = 'duplicate' | 'spike' | 'new-large';
export interface Flag { kind: FlagKind, charge: Charge, typical: number, why: string }
export interface Mover { key: string, payee: string, payeeId: string, now: number, base: number, delta: number }
export interface Unusual { flags: Flag[], risers: Mover[], fallers: Mover[], fresh: Mover[], since: string }

export const WINDOW_DAYS = 30;
const SPIKE_MIN_GAP = 25, SPIKE_RATIO = 2, CAT_RATIO = 3, CAT_MIN_GAP = 50, NEW_LARGE = 100, TREND_GAP = 30, MIN_HISTORY_DAYS = 60;

export function chargesOf(groups: Group[]): Charge[] {
  return groups.filter(g => g.type === 'withdrawal' && g.total > 0).map(g => {
    const p = payeeOf(g), id = g.splits.length === 1 ? g.splits[0].destination_id : '';
    return { id: g.id, date: String(g.date).slice(0, 10), key: id ? 'a' + id : 'n' + String(p.name).trim().toLowerCase(), payee: String(p.name), payeeId: id,
      cat: g.splits.find(s => s.category)?.category || '', amount: g.total };
  });
}

const cents = (x: number) => Math.round(x * 100);
const by = <T>(xs: T[], f: (x: T) => string) => { const m = new Map<string, T[]>(); xs.forEach(x => { const k = f(x), a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }); return m; };
const usd = (x: number) => money0(x);

export function findUnusual(charges: Charge[], today: string): Unusual {
  const since = addDays(today, -WINDOW_DAYS + 1), flags: Flag[] = [], seen = new Set<string>();
  const old = charges.filter(c => c.date < since), recent = charges.filter(c => c.date >= since && c.date <= today);
  const oldByKey = by(old, c => c.key), oldByCat = by(old.filter(c => c.cat), c => c.cat);
  const add = (kind: FlagKind, charge: Charge, typical: number, why: string) => { if (!seen.has(charge.id)) { seen.add(charge.id); flags.push({ kind, charge, typical, why }); } };

  // Repeated: same merchant, same amount, within a day. Skipped when the merchant has done that before (two coffees).
  const twice = (xs: Charge[]) => xs.some((a, i) => xs.some((b, j) => i < j && cents(a.amount) === cents(b.amount) && Math.abs(daysBetween(a.date, b.date)) <= 1));
  by(recent, c => c.key + '|' + cents(c.amount)).forEach(xs => {
    if (xs.length < 2 || twice((oldByKey.get(xs[0].key) || []).filter(o => cents(o.amount) === cents(xs[0].amount)))) return;
    const s = [...xs].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < s.length; i++) if (Math.abs(daysBetween(s[i - 1].date, s[i].date)) <= 1) add('duplicate', s[i], s[i].amount, t('Charged twice: {amount} again within a day', { amount: usd(s[i].amount) }));
  });

  // Far above the merchant's usual; a merchant with under four past charges is judged against its category instead
  const all = old.map(c => c.amount), p95 = all.length >= 20 ? quantile(all, .95) : Infinity;
  const hasHistory = old.length > 0 && daysBetween(old.reduce((m, c) => c.date < m ? c.date : m, today), since) >= MIN_HISTORY_DAYS;
  recent.forEach(c => {
    const mine = (oldByKey.get(c.key) || []).map(o => o.amount);
    if (mine.length >= 4) {
      const a = anomaly(mine, c.amount);
      if (a.flag === 'high' && c.amount >= a.median * SPIKE_RATIO && c.amount - a.median >= SPIKE_MIN_GAP) add('spike', c, a.median, t('{amount} at {merchant}, usually about {typical}', { amount: usd(c.amount), merchant: c.payee, typical: usd(a.median) }));
    } else if (!mine.length) {
      if (hasHistory && c.amount >= NEW_LARGE && c.amount >= p95) add('new-large', c, 0, t('{amount} at a merchant you haven’t used before', { amount: usd(c.amount) }));
    }
    if (mine.length < 4 && c.cat) {
      const cat = (oldByCat.get(c.cat) || []).map(o => o.amount), a = anomaly(cat, c.amount, { min: 8 });
      if (a.flag === 'high' && c.amount >= a.median * CAT_RATIO && c.amount - a.median >= CAT_MIN_GAP) add('spike', c, a.median, t('{amount} in {category}, usually about {typical} each', { amount: usd(c.amount), category: c.cat, typical: usd(a.median) }));
    }
  });
  flags.sort((a, b) => (b.charge.amount - b.typical) - (a.charge.amount - a.typical));
  return { flags, ...trends(charges, today), since };
}

// This month so far against the same days of the three months before (a month with no charges at all counts as zero)
export function trends(charges: Charge[], today: string) {
  const [y, m] = monthOf(new Date(today + 'T12:00:00')), cur = monthRange(y, m), n = daysBetween(cur.start, today) + 1;
  const past = [1, 2, 3].map(i => { const r = monthRange(y, m - i); const e = addDays(r.start, n - 1); return { start: r.start, end: e < r.end ? e : r.end }; });
  const names = new Map<string, Charge>(), now = new Map<string, number>(), base = new Map<string, number>(), ever = new Set<string>();
  charges.forEach(c => {
    names.set(c.key, c);
    if (c.date >= cur.start && c.date <= today) now.set(c.key, (now.get(c.key) || 0) + c.amount);
    else if (c.date < cur.start) ever.add(c.key);
    past.forEach(w => { if (c.date >= w.start && c.date <= w.end) base.set(c.key, (base.get(c.key) || 0) + c.amount / 3); });
  });
  const earliest = charges.reduce((e, c) => !e || c.date < e ? c.date : e, '');
  const known = !!earliest && daysBetween(earliest, cur.start) >= MIN_HISTORY_DAYS;     // enough history for "new" to mean something
  const mover = (k: string): Mover => { const c = names.get(k)!, a = now.get(k) || 0, b = base.get(k) || 0; return { key: k, payee: c.payee, payeeId: c.payeeId, now: a, base: b, delta: a - b }; };
  const keys = [...new Set([...now.keys(), ...base.keys()])].map(mover);
  const fresh = known ? keys.filter(x => x.now > 0 && !ever.has(x.key)).sort((a, b) => b.now - a.now) : [];
  const old = keys.filter(x => ever.has(x.key));
  const risers = old.filter(x => x.delta >= TREND_GAP && x.now >= x.base * 1.5).sort((a, b) => b.delta - a.delta);
  const fallers = old.filter(x => -x.delta >= TREND_GAP && x.now <= x.base * .5).sort((a, b) => a.delta - b.delta);
  return { risers: risers.slice(0, 5), fallers: fallers.slice(0, 5), fresh: fresh.slice(0, 5) };
}

// Six months of spending, up to today. One request shared by the Overview row and the page; dropped on any failure.
let memo: { key: string, p: Promise<Unusual> } | null = null;
export function loadUnusual(): Promise<Unusual> {
  const today = todayIso(), key = today + ':' + S.dirtyAt;
  if (memo && memo.key === key) return memo.p;
  const [y, m] = nowMonth(), start = monthRange(y, m - 5).start;
  const p = getAll('/transactions', { type: 'withdrawal', start, end: today }).then((raw: ApiData[]) => findUnusual(chargesOf(raw.map(normGroup)), today));
  memo = { key, p };
  p.catch(() => { if (memo && memo.p === p) memo = null; });
  return p;
}
export const unusualCount = (u: Unusual) => u.flags.length;

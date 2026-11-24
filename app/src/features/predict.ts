import { sum } from '../core/helpers';
/* Local prediction engine: deterministic, no network, no storage. Pure logic, tested in test/predict.test.ts.
   - monthEnd: where a month's spending will end, with a likely range from how well the same method called past months.
   - cashBands: p10/p50/p90 balance for each day ahead, simulated from the scheduled events (seeded, so repeatable).
   - anomaly: is this amount unusual for its history (median/MAD, robust to one-off spikes).
   - backtest: scores a month-end predictor on past months so a change to the method can be measured. */

export const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// q in 0..1, linear between neighbours
export function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * Math.min(1, Math.max(0, q)), lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
// Weighted median: the value where half the weight lies on each side
function wMedian(v: number[], w: number[]) {
  const o = v.map((x, i) => [x, w[i]]).sort((a, b) => a[0] - b[0]), half = w.reduce((s, x) => s + x, 0) / 2;
  let acc = 0;
  for (const [x, wt] of o) { acc += wt; if (acc >= half) return x; }
  return o.length ? o[o.length - 1][0] : 0;
}
// Small seeded generator (mulberry32), so the same inputs always give the same numbers
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

/* ---------- Month-end spending ----------
   spent: so far through day `sofar` of a month of `dim` days. past: daily spending of earlier months, newest first.
   Each past month gives an estimate (the same share of the month as it had reached by now, and today's total plus
   what it still spent after this point, averaged); the estimates are combined by a weighted median, newest
   weighing most, so one odd month doesn't drag the result. The range comes from running the same method on the
   past months themselves (each called from the others): the spread of how far off it was. */
export interface MonthEnd { mid: number; lo: number; hi: number; months: number; low: boolean }
function estimate(spent: number, sofar: number, past: number[][]) {
  const est: number[] = [], w: number[] = [];
  past.forEach((p, i) => {
    const total = sum(p), then = sum(p.slice(0, sofar));
    if (!(total > 0 && then > 0)) return;
    const share = then / total, carry = spent + (total - then), shape = share >= .25 ? spent / share : carry;
    est.push((carry + shape) / 2); w.push(Math.pow(.7, i));
  });
  return est.length ? Math.max(spent, wMedian(est, w)) : 0;
}
export function monthEnd(spent: number, sofar: number, dim: number, past: number[][]): MonthEnd | null {
  if (!(sofar >= 1) || sofar >= dim || !(spent >= 0)) return null;
  const used = past.filter(p => sum(p) > 0 && sum(p.slice(0, sofar)) > 0), mid = estimate(spent, sofar, used);
  if (!mid) return null;
  // Each past month called from the ones before it (the ones after it too, for the oldest): how far off was the call?
  const ratios: number[] = [];
  if (used.length >= 3) used.forEach((p, j) => {
    const others = used.filter((_, k) => k !== j), then = sum(p.slice(0, sofar)), call = estimate(then, sofar, others);
    if (call > 0) ratios.push(sum(p) / call);
  });
  const low = used.length < 3;
  // Too little history to measure the spread: assume a miss of up to 35% of what is still to come
  const rest = Math.max(0, mid - spent), lo = ratios.length >= 3 ? mid * quantile(ratios, .1) : spent + rest * .65, hi = ratios.length >= 3 ? mid * quantile(ratios, .9) : spent + rest * 1.35;
  return { mid, lo: Math.max(spent, Math.min(lo, mid)), hi: Math.max(hi, mid), months: used.length, low };
}

/* ---------- Anomalies ----------
   Modified z-score: 0.6745 × (x − median) ÷ MAD. Needs 4 past values; flags |z| > 3.5. With no spread at all
   (every past value identical) it flags a change of more than half instead. */
export interface Anomaly { flag: 'high' | 'low' | null; z: number; median: number }
export function anomaly(history: number[], value: number, opts: { min?: number, threshold?: number } = {}): Anomaly {
  const h = history.filter(x => Number.isFinite(x)), m = median(h);
  if (h.length < (opts.min ?? 4)) return { flag: null, z: 0, median: m };
  let mad = median(h.map(x => Math.abs(x - m)));
  if (!mad) mad = sum(h.map(x => Math.abs(x - m))) / h.length * 1.2533;        // mean absolute deviation, when more than half are identical
  const z = mad ? .6745 * (value - m) / mad : (Math.abs(value - m) > Math.abs(m) * .5 ? Math.sign(value - m) * Infinity : 0), t = opts.threshold ?? 3.5;
  return { flag: z > t ? 'high' : z < -t ? 'low' : null, z, median: m };
}

/* ---------- Balance bands ----------
   events: dated amounts already in the forecast. Each run draws a size for the flexible ones (bills, recurring and
   projected payments, card payoffs: lognormal around the planned amount) and may miss an irregular income; paydays
   and fixed items are exact. Many runs give the p10, p50 and p90 of the balance for each day. Only what is
   scheduled is simulated: day-to-day spending isn't, and the forecast doesn't pretend it is. */
export interface BandEvent { day: number; amount: number; kind: string }
export interface Bands { p10: number[]; p50: number[]; p90: number[]; pNeg: number[]; minP10: number; pBelowZero: number; runs: number }
const SIGMA: Record<string, number> = { Bill: .08, Recurring: .08, Projected: .15, Card: .25, Loan: .03 };
export function cashBands(start: number, days: number, events: BandEvent[], opts: { runs?: number, seed?: number } = {}): Bands | null {
  const ev = events.filter(e => e.day >= 0 && e.day <= days && e.amount);
  if (ev.length < 3 || days < 1) return null;
  const runs = opts.runs ?? 300, r = rng(opts.seed ?? (ev.length * 7919 + Math.round(start) + days)), n = days + 1;
  const bal = new Float64Array(runs * n), neg = new Float64Array(n), mins = new Float64Array(runs);
  const byDay: BandEvent[][] = Array.from({ length: n }, () => []);
  ev.forEach(e => byDay[Math.min(days, e.day)].push(e));
  let below = 0;
  for (let k = 0; k < runs; k++) {
    let b = start, mn = start;
    for (let d = 0; d < n; d++) {
      for (const e of byDay[d]) {
        let a = e.amount;
        const s = SIGMA[e.kind];
        if (s && a < 0) a *= Math.exp(s * gauss(r) - s * s / 2);          // mean stays at the planned amount
        else if (e.kind === 'Income' && r() < .2) a = 0;
        b += a;
      }
      bal[k * n + d] = b; if (b < mn) mn = b; if (b < 0) neg[d]++;
    }
    mins[k] = mn; if (mn < 0) below++;
  }
  const p10: number[] = [], p50: number[] = [], p90: number[] = [], col: number[] = Array.from({ length: runs });
  for (let d = 0; d < n; d++) {
    for (let k = 0; k < runs; k++) col[k] = bal[k * n + d];
    p10.push(quantile(col, .1)); p50.push(quantile(col, .5)); p90.push(quantile(col, .9));
  }
  return { p10, p50, p90, pNeg: Array.from(neg, x => x / runs), minP10: quantile(Array.from(mins), .1), pBelowZero: below / runs, runs };
}

/* ---------- Backtest ----------
   months: daily spending of consecutive months, oldest first. For every month with at least `warm` months before it,
   and each checkpoint day, the predictor is called with what was spent by then and the earlier months (newest first);
   the result is scored against the month's real total. */
export type Predictor = (spent: number, sofar: number, dim: number, past: number[][]) => number;
export function backtest(months: number[][], predict: Predictor, opts: { days?: number[], warm?: number } = {}) {
  const days = opts.days ?? [7, 14, 21], warm = opts.warm ?? 3, errs: number[] = [];
  for (let i = warm; i < months.length; i++) {
    const m = months[i], actual = sum(m), past = months.slice(0, i).reverse();
    if (!(actual > 0)) continue;
    days.forEach(d => { if (d >= m.length) return; const p = predict(sum(m.slice(0, d)), d, m.length, past); if (p > 0) errs.push(Math.abs(p - actual) / actual); });
  }
  return { n: errs.length, mape: errs.length ? sum(errs) / errs.length : NaN };
}
// Does the range hold? Share of checkpoints where the real total fell inside lo..hi
export function coverage(months: number[][], opts: { days?: number[], warm?: number } = {}) {
  const days = opts.days ?? [7, 14, 21], warm = opts.warm ?? 4; let hit = 0, n = 0;
  for (let i = warm; i < months.length; i++) {
    const m = months[i], actual = sum(m), past = months.slice(0, i).reverse();
    days.forEach(d => { const e = monthEnd(sum(m.slice(0, d)), d, m.length, past); if (e && actual > 0) { n++; if (actual >= e.lo - .5 && actual <= e.hi + .5) hit++; } });
  }
  return { n, share: n ? hit / n : NaN };
}

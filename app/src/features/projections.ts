/* Projects recurring outflows that have no fixed amount (credit card payments, utilities) from what they were before:
   the month before and the same month last year (averaged when both exist). A month already in the history is real,
   so only the months after it are projected, each one building on the one before. Pure logic, tested in test/projections.test.ts. */
export type Hist = { date: string, amount: number }
export type Series = { key: string, name: string, day: number, hist: Hist[], known?: Record<string, number> }
export type Projected = { date: string, key: string, name: string, amount: number, basis: string }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ym = (y: number, m: number) => { const d = new Date(Date.UTC(y, m, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const monthName = (k: string, year: boolean) => MON[+k.slice(5, 7) - 1] + (year ? ' ' + k.slice(0, 4) : '');
// The day of the month a series usually lands on: the middle of its last few dates
export const usualDay = (hist: Hist[]) => {
  const ds = hist.map(h => +h.date.slice(8, 10)).slice(-3).sort((a, b) => a - b);
  return ds.length ? ds[ds.length >> 1] : 0;
};

export function projectMonthly(s: Series, from: string, to: string): Projected[] {
  const out: Projected[] = [], tot: Record<string, number> = Object.assign({}, s.known);
  s.hist.forEach(h => { const k = h.date.slice(0, 7); if (!(s.known && k in s.known)) tot[k] = (tot[k] || 0) + h.amount; });
  if (!s.day) return out;
  const y0 = +from.slice(0, 4), m0 = +from.slice(5, 7) - 1, y1 = +to.slice(0, 4), m1 = +to.slice(5, 7) - 1;
  for (let i = 0, n = (y1 - y0) * 12 + m1 - m0; i <= n; i++) {
    const k = ym(y0, m0 + i);
    if (k in tot) continue;                                              // already happened (or is known)
    const lastK = ym(y0, m0 + i - 1), yearK = ym(y0, m0 + i - 12), a = tot[lastK], b = tot[yearK];
    const parts = [a, b].filter(x => x > 0) as number[];
    if (!parts.length) break;
    const amount = Math.round(parts.reduce((t, x) => t + x, 0) / parts.length);
    tot[k] = amount;
    const basis = (a > 0 ? monthName(lastK, false) : '') + (a > 0 && b > 0 ? ' & ' : '') + (b > 0 ? monthName(yearK, true) : '');
    const last = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
    const date = k + '-' + String(Math.min(s.day, last)).padStart(2, '0');
    if (date >= from && date <= to) out.push({ date, key: s.key, name: s.name, amount, basis });
  }
  return out;
}

/* Where this month's spending is heading. Spending is front-loaded (rent and bills land early), so a straight line
   (spent so far ÷ days so far × days in month) overshoots. With last month's day-by-day spending we blend two
   estimates: the same share of the month as last month had reached by now (shape), and today's total plus whatever
   last month still spent after this point (carry-on). No history: a straight line, but only once a week is in. 0 = no estimate. */
export function paceForecast(spent: number, sofar: number, dim: number, prevDaily: number[]): number {
  if (!(sofar >= 1) || sofar >= dim || !(spent >= 0)) return 0;
  const total = prevDaily.reduce((s, v) => s + v, 0), then = prevDaily.slice(0, sofar).reduce((s, v) => s + v, 0);
  if (total > 0 && then > 0) {
    const share = then / total, carry = spent + (total - then), shape = share >= .25 ? spent / share : carry;
    return Math.max(spent, (carry + shape) / 2);
  }
  return sofar >= 7 ? spent / sofar * dim : 0;
}

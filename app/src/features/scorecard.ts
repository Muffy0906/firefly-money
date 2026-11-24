import { isoDate, parseIso } from '../core/base';
import { daysBetween, sum } from '../core/helpers';
import { type Acct, INTEREST_RE, runway } from './moneyhealth';
import { type Charge, findRecurring } from './subs';

/* ================= Money scorecard: six plain-word ratings and a money personality =================
   Worked out on this device from the last 12 months of purchases and deposits, the bills, the accounts and the loans
   Firefly already holds. Nothing is kept or sent anywhere. The ratings are Strong, Steady, Building and Needs attention
   (no letters), each with one line of reason, a small trend against the six months before, and a place to improve it.
   The maths is pure and tested in test/scorecard.test.ts; the page that fetches the data is pages/scorecard.ts. */
export type Rating = 'Strong' | 'Steady' | 'Building' | 'Needs attention';
export const RATINGS: Rating[] = ['Needs attention', 'Building', 'Steady', 'Strong'];
export type GradeKey = 'savings' | 'consistency' | 'bills' | 'cushion' | 'tidiness' | 'debt';
export type Trend = 'up' | 'same' | 'down';
export type Grade = { key: GradeKey, name: string, rating: Rating, rank: number, reason: string, detail: string, trend: Trend | null, move: number, href: string, action: string };
export type Tx = { date: string, amount: number, category: string, desc: string, payee: string };
export type BillCount = { paid: number, late: number };
export type ScoreIn = {
  today: string,
  out: Tx[], inc: Tx[],                                  // purchases and deposits in the last 12 months
  charges: Charge[],                                     // the same purchases, for finding payments that repeat
  bills: { cur: BillCount, prev: BillCount } | null,
  cash: { now: Acct[], ago: Acct[] | null } | null,     // the asset accounts now and as they stood six months ago
  debt: { now: number, ago: number | null } | null,     // what is owed in total, now and six months ago
};
export type Trait = { name: string, text: string };
export type PersonKey = 'planner' | 'weekend' | 'sprinter' | 'subscriber' | 'fresh' | 'balancer';
export type Personality = { key: PersonKey, label: string, line: string, traits: Trait[], nudge: string, href: string };
export type Score = { fresh: boolean, months: number, grades: Grade[], improved: Grade | null, best: Grade | null, person: Personality };

const pct = (v: number) => Math.round(v);
const mean = (v: number[]) => v.length ? sum(v) / v.length : 0;
export const FRESH_DAYS = 90;
export const rank = (r: Rating) => RATINGS.indexOf(r);

/* ---------- Thresholds: the value for each rating, in one place ---------- */
// Lower is better for consistency (how much monthly spending swings, as a share of the average month)
export function rateOf(key: GradeKey, v: number): Rating {
  const up = (a: number, b: number, c: number): Rating => v >= a ? 'Strong' : v >= b ? 'Steady' : v >= c ? 'Building' : 'Needs attention';
  switch (key) {
    case 'savings': return up(20, 10, 0);                         // % of income kept
    case 'bills': return up(95, 85, 70);                          // % of bills paid when due
    case 'cushion': return up(6, 3, 1);                           // months of spending the cash and savings cover
    case 'tidiness': return up(95, 85, 65);                       // % of purchases with a category
    case 'consistency': return v <= .15 ? 'Strong' : v <= .3 ? 'Steady' : v <= .5 ? 'Building' : 'Needs attention';
    case 'debt': return v <= -10 ? 'Strong' : v < -2 ? 'Steady' : v <= 2 ? 'Building' : 'Needs attention';     // change in what is owed over six months, %
  }
}
// How big a change must be before it counts as a change, and whether a lower value is the better one
const STEP: Record<GradeKey, [number, boolean]> = { savings: [3, false], bills: [5, false], cushion: [.5, false], tidiness: [3, false], consistency: [.05, true], debt: [10, true] };
export function trendOf(key: GradeKey, cur: number | null, prev: number | null): { trend: Trend | null, move: number } {
  if (cur === null || prev === null) return { trend: null, move: 0 };
  const [eps, lower] = STEP[key], d = (cur - prev) * (lower ? -1 : 1);
  return Math.abs(d) < eps ? { trend: 'same', move: 0 } : { trend: d > 0 ? 'up' : 'down', move: d / eps };
}
export const TREND_WORD: Record<Trend, string> = { up: 'Improving', same: 'Holding', down: 'Dipping' };

/* ---------- Months ---------- */
const monthKey = (d: string) => d.slice(0, 7);
// The 12 full calendar months before this one, oldest first
export function lastMonths(today: string, n = 12): string[] {
  let y = +today.slice(0, 4), m = +today.slice(5, 7);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { m--; if (m < 1) { m = 12; y--; } out.unshift(y + '-' + String(m).padStart(2, '0')); }
  return out;
}
const byMonth = (xs: Tx[], months: string[]) => months.map(k => sum(xs.filter(x => monthKey(x.date) === k).map(x => x.amount)));
const monthEnd = (k: string) => isoDate(new Date(+k.slice(0, 4), +k.slice(5, 7), 0, 12));
const sd = (v: number[]) => { const a = mean(v); return Math.sqrt(mean(v.map(x => (x - a) ** 2))); };
const s = (n: number) => n === 1 ? '' : 's';

type Period = { months: string[], out: Tx[], inc: Tx[], spend: number[], income: number[] };
const period = (months: string[], out: Tx[], inc: Tx[]): Period => {
  const set = new Set(months), o = out.filter(x => set.has(monthKey(x.date))), i = inc.filter(x => set.has(monthKey(x.date)));
  return { months, out: o, inc: i, spend: byMonth(o, months), income: byMonth(i, months) };
};

/* ---------- The six ratings ---------- */
type Raw = { savings: number | null, consistency: number | null, bills: number | null, cushion: number | null, tidiness: number | null, debt: number | null };
const rawOf = (p: Period, bills: BillCount | null, months: number | null): Pick<Raw, 'savings' | 'consistency' | 'tidiness' | 'bills' | 'cushion'> => {
  const inc = sum(p.income), spend = sum(p.spend), nonEmpty = p.spend.filter(v => v > 0);
  const cat = p.out.length >= 20 ? p.out.filter(x => x.category).length / p.out.length * 100 : null;
  const total = bills ? bills.paid + bills.late : 0;
  return {
    savings: p.months.length >= 2 && inc > 0 ? (inc - spend) / inc * 100 : null,
    consistency: nonEmpty.length >= 3 && mean(nonEmpty) > 0 ? sd(nonEmpty) / mean(nonEmpty) : null,
    tidiness: cat,
    bills: bills && total >= 3 ? bills.paid / total * 100 : null,
    cushion: months,
  };
};
const interestIn = (p: Period) => sum(p.out.filter(x => INTEREST_RE.test(x.desc) || INTEREST_RE.test(x.category) || INTEREST_RE.test(x.payee)).map(x => x.amount));
const cushionMonths = (accts: Acct[] | null, monthly: number[]) => { if (!accts) return null; const r = runway(accts, monthly, 6); return r ? r.months : null; };

const COPY: Record<GradeKey, { name: string, href: string, action: string }> = {
  savings: { name: 'Savings rate', href: '#/budgets', action: 'Review budgets' },
  consistency: { name: 'Consistency', href: '#/recap', action: 'See the monthly recap' },
  bills: { name: 'Bills on time', href: '#/bills', action: 'Open bills' },
  cushion: { name: 'Cushion', href: '#/piggy', action: 'Set a savings goal' },
  tidiness: { name: 'Tidiness', href: '#/inbox', action: 'Categorize purchases' },
  debt: { name: 'Debt', href: '#/loans', action: 'Open the loan planner' },
};
const REASON: Record<GradeKey, (v: number, r: Rating) => string> = {
  savings: v => v >= 0 ? 'You kept ' + pct(v) + '% of what came in.' : 'About ' + pct(-v) + '% more went out than came in.',
  consistency: (_v, r) => r === 'Strong' ? 'Your monthly spending stays in a narrow range.' : r === 'Steady' ? 'Most months land close to your usual.' : r === 'Building' ? 'Spending moves around from month to month.' : 'Spending swings quite a bit from month to month.',
  bills: v => pct(v) + '% of bills were paid when due.',
  cushion: v => v < 1 ? 'Cash and savings cover less than a month of spending.' : 'Cash and savings cover about ' + (Math.round(v * 10) / 10) + ' month' + s(Math.round(v * 10) / 10) + ' of spending.',
  tidiness: v => pct(v) + '% of purchases have a category.',
  debt: v => v <= -99.5 ? 'What you owed six months ago is paid off.' : v < -2 ? 'Balances are down ' + pct(-v) + '% in six months.' : v <= 2 ? 'Balances are about the same as six months ago.' : 'Balances are up ' + pct(v) + '% in six months.',
};
function grade(key: GradeKey, value: number, prev: number | null, detail = '', trendIn?: { trend: Trend | null, move: number }): Grade {
  const rating = rateOf(key, value), t = trendIn || trendOf(key, value, prev), c = COPY[key];
  return { key, name: c.name, rating, rank: rank(rating), reason: REASON[key](value, rating), detail, trend: t.trend, move: t.move, href: c.href, action: c.action };
}

export type Behaviour = {
  fresh: boolean,
  weekend: { share: number, dining: boolean } | null,        // share of spending (dining when there is such a category) on Friday to Sunday
  subs: { n: number, share: number } | null,                 // payments that repeat, and their share of spending
  saver: { share: number, months: number } | null,           // the share of what was saved that came in the two best months
  ranks: Partial<Record<GradeKey, number>>,
};
const DINING_RE = /dining|restaurant|eating out|takeout|take-out|take out|coffee|caf[eé]|\bbars?\b|drinks|fast food|delivery/i;
const weekendDay = (d: string) => { const w = parseIso(d.slice(0, 10)).getDay(); return w === 5 || w === 6 || w === 0; };
export function behaviour(inp: ScoreIn, cur: Period, ranks: Behaviour['ranks'], fresh: boolean): Behaviour {
  if (fresh) return { fresh, weekend: null, subs: null, saver: null, ranks };
  const share = (xs: Tx[]) => { const t = sum(xs.map(x => x.amount)); return t > 0 ? sum(xs.filter(x => weekendDay(x.date)).map(x => x.amount)) / t : 0; };
  const dine = cur.out.filter(x => DINING_RE.test(x.category));
  const weekend = dine.length >= 8 ? { share: share(dine), dining: true } : cur.out.length >= 20 ? { share: share(cur.out), dining: false } : null;
  const set = new Set(cur.months), rec = findRecurring(inp.charges.filter(c => set.has(monthKey(c.date))), inp.today, { all: true });
  const ids = new Set(rec.map(r => r.payeeId || r.payee.toLowerCase())), spend = sum(cur.spend);
  const mine = inp.charges.filter(c => set.has(monthKey(c.date)) && ids.has(c.payeeId || c.payee.trim().toLowerCase()));
  const subs = { n: rec.length, share: spend > 0 ? sum(mine.map(c => c.amount)) / spend : 0 };
  const kept = cur.months.map((_, i) => cur.income[i] - cur.spend[i]).filter((_, i) => cur.income[i] > 0 || cur.spend[i] > 0), pos = kept.filter(v => v > 0).sort((a, b) => b - a);
  const saver = kept.length >= 4 && sum(kept) > 0 && pos.length ? { share: sum(pos.slice(0, 2)) / sum(pos), months: kept.length } : null;
  return { fresh, weekend, subs, saver, ranks };
}

/* ---------- The money personality ---------- */
const AVERAGE_WEEKEND = 3 / 7;
export function pickPersonality(b: Behaviour): PersonKey {
  if (b.fresh) return 'fresh';
  const rs = [b.ranks.consistency, b.ranks.bills, b.ranks.tidiness].filter((x): x is number => x !== undefined);
  const planner = rs.length >= 2 && rs.every(r => r >= 2), plannerScore = mean(rs) / 3;
  if (planner && plannerScore >= .8) return 'planner';
  const c: [PersonKey, number][] = [];
  if (b.weekend && b.weekend.share >= .55) c.push(['weekend', .5 + b.weekend.share - AVERAGE_WEEKEND]);
  if (b.subs && (b.subs.share >= .2 || b.subs.n >= 6)) c.push(['subscriber', Math.min(1, Math.max(b.subs.share / .4, b.subs.n / 12))]);
  if (b.saver && b.saver.share >= .65) c.push(['sprinter', b.saver.share]);
  if (c.length) return c.sort((x, y) => y[1] - x[1])[0][0];
  return planner ? 'planner' : 'balancer';
}
const PERSON: Record<PersonKey, { label: string, line: string, nudge: string, href: string }> = {
  planner: { label: 'Steady Planner', line: 'Your months look alike, your bills get paid and your records are in order.', nudge: 'Try this: set up a small automatic transfer on payday, so the steady habit builds savings too.', href: '#/piggy' },
  weekend: { label: 'Weekend Spender', line: 'Most of your discretionary spending lands from Friday to Sunday.', nudge: 'Try this: give the weekend its own small budget, so Friday to Sunday has room and nothing surprises you on Monday.', href: '#/budgets' },
  sprinter: { label: 'Saver Sprinter', line: 'You save in bursts: a couple of strong months carry most of it.', nudge: 'Try this: move a small amount every month, even in the lean ones, so saving doesn’t depend on the big months.', href: '#/piggy' },
  subscriber: { label: 'Subscriber', line: 'A lot of your spending runs on repeat: memberships, plans and regular payments.', nudge: 'Try this: look over your repeating payments once a season and keep the ones you would choose again today.', href: '#/recurring' },
  fresh: { label: 'Fresh Starter', line: 'There isn’t enough history yet to see a pattern, and that is fine.', nudge: 'Try this: give your first purchases a category and check back in a few months. The picture fills in by itself.', href: '#/inbox' },
  balancer: { label: 'Everyday Balancer', line: 'No single habit stands out. Your money is a mix, and that is a fair place to start from.', nudge: 'Try this: pick the lowest rating below and nudge that one up this month.', href: '#/' },
};
const PREFER: Record<PersonKey, string[]> = {
  planner: ['steady', 'bills', 'tidy', 'savings', 'mix'], weekend: ['weekend', 'mix', 'steady', 'bills', 'tidy'],
  sprinter: ['saver', 'savings', 'steady', 'bills', 'mix'], subscriber: ['subs', 'mix', 'bills', 'steady', 'tidy'],
  fresh: ['months', 'activity', 'mix'], balancer: ['mix', 'activity', 'steady', 'bills', 'tidy', 'savings'],
};
export function traitsFor(key: PersonKey, b: Behaviour, grades: Grade[], cur: Period, months: number): Trait[] {
  const g = (k: GradeKey) => grades.find(x => x.key === k);
  const all: Record<string, Trait | null> = {
    weekend: b.weekend ? { name: 'Weekend spending', text: pct(b.weekend.share * 100) + '% of ' + (b.weekend.dining ? 'dining' : 'your spending') + ' happens Fri–Sun' } : null,
    subs: b.subs && b.subs.n >= 2 ? { name: 'Repeat payments', text: b.subs.n + ' repeating payments, ' + pct(b.subs.share * 100) + '% of spending' } : null,
    saver: b.saver ? { name: 'Saving pattern', text: pct(b.saver.share * 100) + '% of what you saved came in 2 of ' + b.saver.months + ' months' } : null,
    steady: g('consistency') && g('consistency')!.rank >= 2 ? { name: 'Steady months', text: 'Monthly spending stays close to your usual' } : null,
    bills: g('bills') && g('bills')!.rank >= 2 ? { name: 'Bills', text: g('bills')!.reason.replace(' were paid when due.', ' paid when due') } : null,
    tidy: g('tidiness') && g('tidiness')!.rank >= 2 ? { name: 'Tidy records', text: g('tidiness')!.reason.replace(/\.$/, '') } : null,
    savings: g('savings') && g('savings')!.rank >= 2 ? { name: 'Savings', text: g('savings')!.reason.replace(/\.$/, '') } : null,
    months: { name: 'History', text: months + ' month' + s(months) + ' of history so far' },
    activity: cur.out.length ? { name: 'Activity', text: 'About ' + Math.max(1, Math.round(cur.out.length / Math.max(1, cur.months.length))) + ' purchases a month' } : null,
    mix: null,
  };
  const top = new Map<string, number>(); cur.out.forEach(x => { if (x.category) top.set(x.category, (top.get(x.category) || 0) + x.amount); });
  const best = [...top.entries()].sort((a, c) => c[1] - a[1])[0], spend = sum(cur.spend);
  if (best && spend > 0) all.mix = { name: 'Biggest category', text: best[0] + ' is ' + pct(best[1] / spend * 100) + '% of spending' };
  const out: Trait[] = [];
  for (const k of [...PREFER[key], 'activity', 'months']) { const t = all[k]; if (t && !out.includes(t) && out.length < 3) out.push(t); }
  return out;
}

/* ---------- The whole scorecard ---------- */
export function scorecard(inp: ScoreIn): Score {
  const all = [...inp.out, ...inp.inc].map(x => x.date.slice(0, 10)).sort(), first = all[0];
  const person = (key: PersonKey, traits: Trait[]): Personality => ({ key, ...PERSON[key], traits });
  const monthsSince = first ? Math.floor(daysBetween(first, inp.today) / 30) : 0;
  if (!first || daysBetween(first, inp.today) < FRESH_DAYS) return { fresh: true, months: monthsSince, grades: [], improved: null, best: null, person: person('fresh', traitsFor('fresh', behaviour(inp, period([], [], []), {}, true), [], period([], [], []), monthsSince)) };
  const months = lastMonths(inp.today), fm = monthKey(first), usable = (ks: string[]) => ks.filter(k => k > fm);     // the month of the first purchase may be only part of one
  const cur = period(usable(months.slice(6)), inp.out, inp.inc), prev = period(usable(months.slice(0, 6)), inp.out, inp.inc);
  const prevOk = prev.months.length >= 3;
  const lastSpend = (p: Period) => p.spend.slice(-3);
  const nowCush = inp.cash ? cushionMonths(inp.cash.now, lastSpend(cur)) : null;
  const thenCush = inp.cash && inp.cash.ago && prevOk ? cushionMonths(inp.cash.ago, lastSpend(prev)) : null;
  const rc = rawOf(cur, inp.bills ? inp.bills.cur : null, nowCush), rp = prevOk ? rawOf(prev, inp.bills ? inp.bills.prev : null, thenCush) : null;
  const grades: Grade[] = [];
  (['savings', 'consistency', 'bills', 'cushion', 'tidiness'] as const).forEach(k => {
    const v = rc[k]; if (v === null) return;
    grades.push(grade(k, k === 'consistency' ? Math.round(v * 1000) / 1000 : v, rp ? rp[k] : null));
  });
  if (inp.debt && (inp.debt.now > 0 || (inp.debt.ago || 0) > 0)) {
    const then = inp.debt.ago, now = inp.debt.now;
    if (then !== null) {
      const change = then > 0 ? (now - then) / then * 100 : 100, ic = interestIn(cur), ip = interestIn(prev);
      grades.push(grade('debt', change, null, ic > 0 ? 'Interest paid: ' + Math.round(ic) : '', prevOk ? trendOf('debt', ic, ip) : { trend: null, move: 0 }));
    }
  }
  const ranks: Behaviour['ranks'] = {}; grades.forEach(x => { ranks[x.key] = x.rank; });
  const b = behaviour(inp, cur, ranks, false), key = pickPersonality(b);
  const improved = grades.filter(x => x.trend === 'up').sort((a, c) => c.move - a.move)[0] || null;
  const PRIORITY: GradeKey[] = ['bills', 'tidiness', 'consistency', 'savings', 'cushion', 'debt'];
  const best = [...grades].sort((a, c) => c.rank - a.rank || PRIORITY.indexOf(a.key) - PRIORITY.indexOf(c.key))[0] || null;
  return { fresh: false, months: usable(months).length, grades, improved, best: best && best.rank >= 2 ? best : null, person: person(key, traitsFor(key, b, grades, cur, usable(months).length)) };
}
export { monthEnd };

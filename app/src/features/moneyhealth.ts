import { type Html, html, htmlList } from '../core/html';
import { money0 } from '../core/base';
import { type Share, barChart, shareChart, twoLines } from './charts';
import type { Tone } from './budgetinsight';
import { t } from '../core/spanish';

/* ================= Money health: runway, debt payoff, fees and interest =================
   Three read-outs worked out from what Firefly already holds, nothing kept: how many months the cash and savings would
   last (Accounts), what the loans have cost and how to finish them sooner (Loans), and what fees and interest cost over
   a year (Reports). The maths is here; the pages fetch the data. Tested in test/moneyhealth.test.ts. */

/* ---------- Savings runway ---------- */
export type Acct = { name: string, role: string, balance: number };
// Money that is invested, not set aside: left out of the cushion
export const INVEST_RE = /brokerage|invest|stock|401\s?k|\bira\b|retire|pension|crypto|bitcoin|\betf\b/i;
export const EMERGENCY_RE = /emergency|rainy|safety net/i;
export const TARGETS = [3, 6, 9, 12];
export type Runway = {
  cash: number, savings: number, total: number,
  avg: number, monthsUsed: number,                      // the usual month's spending, and how many months it is the average of
  months: number, cashMonths: number,                   // how long it all lasts, and how long the cash alone would
  fund: number, fundName: string, target: number, targetMonths: number, pct: number, gap: number,
  tone: Tone, head: string, text: string,
};
export const monthsText = (m: number) => m < 1 ? t('under a month') : m >= 120 ? t('10+ years') : Math.round(m * 10) / 10 === 1 ? t('1 month') : t('{count} months', { count: m >= 10 ? Math.round(m) : Math.round(m * 10) / 10 });
// monthly: the spending of each full month, oldest first (months before the first spending don't count)
export function runway(accts: Acct[], monthly: number[], targetMonths: number): Runway | null {
  const spend = monthly.slice(Math.max(0, monthly.findIndex(v => v > 0)));
  if (!spend.length || !spend.some(v => v > 0)) return null;
  const avg = spend.reduce((s, v) => s + v, 0) / spend.length;
  const own = accts.filter(a => !INVEST_RE.test(a.name) && a.balance > 0), saving = own.filter(a => a.role === 'savingAsset');
  const cash = own.filter(a => a.role !== 'savingAsset').reduce((s, a) => s + a.balance, 0), savings = saving.reduce((s, a) => s + a.balance, 0);
  const named = saving.filter(a => EMERGENCY_RE.test(a.name));
  const fund = (named.length ? named : saving).reduce((s, a) => s + a.balance, 0), fundName = named.length ? named.map(a => a.name).join(' + ') : 'Savings';
  const total = cash + savings, months = total / avg, target = avg * targetMonths;
  const tone: Tone = months < 3 ? 'over' : months < 6 ? 'warn' : 'good';
  const head = tone === 'over' ? 'Thin cushion' : tone === 'warn' ? 'Building up' : 'Well covered';
  const text = t('Cash and savings cover about {months} of your usual {amount} a month.', { months: monthsText(months), amount: money0(avg) });
  return { cash, savings, total, avg, monthsUsed: spend.length, months, cashMonths: cash / avg, fund, fundName, target, targetMonths,
    pct: target > 0 ? Math.min(100, fund / target * 100) : 0, gap: Math.max(0, target - fund), tone, head, text };
}
export function runwayPanel(r: Runway): Html {
  const stat = (label: string, val: string, cls = '') => html`<div><dt>${label}</dt><dd class="num ${cls}">${val}</dd></div>`;
  const done = r.gap <= 0;
  return html`<section class="panel mh" aria-label="Savings runway"><header class="mh-head"><div><h2>Savings runway</h2><p class="lead">How long your cash and savings would last</p></div><span class="chip ${r.tone === 'over' ? 'bad' : r.tone}">${r.head}</span></header>
<div class="mh-big"><strong class="num">${monthsText(r.months)}</strong><span class="sub-s">${t('of spending covered · {amount}', { amount: money0(r.total) })}</span></div>
<dl class="bi-stats">${stat('Usual month', t('{amount} · average of {count}', { amount: money0(r.avg), count: r.monthsUsed }))}${stat('Cash alone lasts', monthsText(r.cashMonths))}${stat('In cash', money0(r.cash))}${stat('In savings', money0(r.savings))}</dl>
<div class="mh-fund"><div class="mh-line"><span>Emergency fund</span><label class="sub-s">Goal<select class="mh-sel" data-onchange="App.fundMonths(this.value)" aria-label="Emergency fund goal in months of spending">${htmlList(TARGETS.map(m => html`<option value="${m}"${m === r.targetMonths ? ' selected' : ''}>${t('{count} months', { count: m })}</option>`))}</select></label></div>
<div class="track" role="img" aria-label="${t('{percent}% of the emergency fund goal', { percent: Math.round(r.pct) })}"><div class="fill ${done ? 'good' : ''}" style="width:${r.pct.toFixed(1)}%"></div></div>
<div class="sub-s">${done
    ? t('{fund} of {target} ({name}) · goal reached', { fund: money0(r.fund), target: money0(r.target), name: r.fundName })
    : t('{fund} of {target} ({name}) · {gap} to go', { fund: money0(r.fund), target: money0(r.target), name: r.fundName, gap: money0(r.gap) })}</div></div></section>`;
}

/* ---------- Debt payoff ---------- */
// Interest paid on a loan so far. Borrowed counts any interest written to the loan as a charge (explicit); what was
// repaid beyond the borrowed money that is still owed went on interest.
export function interestPaid(borrowed: number, repaid: number, debt: number, explicit = 0) {
  const accrued = Math.max(0, repaid + debt - (borrowed - explicit));
  return Math.min(accrued, repaid);
}
type Sim = { months: number | null, interest: number, totals: number[] };
export type DebtInsight = {
  paid: number, left: number, months: number | null,
  saved: { interest: number, months: number } | null,                            // the plan against paying as now
  more: { extra: number, interest: number, months: number } | null,              // a bit more each month against the plan
};
export function debtInsight(paid: number, base: Sim, sim: Sim, plus: Sim, extra: number): DebtInsight {
  const gain = (a: Sim, b: Sim) => a.months !== null && b.months !== null && (a.interest - b.interest >= 1 || a.months - b.months >= 1)
    ? { interest: Math.max(0, a.interest - b.interest), months: Math.max(0, a.months - b.months) } : null;
  const saved = gain(base, sim), more = gain(sim, plus);
  return { paid, left: sim.interest, months: sim.months, saved, more: more ? { extra, ...more } : null };
}
// The owed balance month by month, at most `max` points, always ending on the last month
export function balancePoints(plan: number[], now: number[], horizon: number, label: (i: number) => string, max = 24) {
  const n = Math.max(1, Math.min(horizon, Math.max(plan.length, now.length) - 1)), step = Math.max(1, Math.ceil(n / (max - 1))), idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  idx.push(n);
  return idx.map(i => ({ label: label(i), a: plan[i] ?? 0, b: now[i] ?? 0 }));
}
export function debtPanel(d: DebtInsight, plan: number[], now: number[], label: (i: number) => string, date: string): Html {
  const stat = (lab: string, val: string, cls = '') => html`<div><dt>${lab}</dt><dd class="num ${cls}">${val}</dd></div>`;
  const pts = d.months === null ? [] : balancePoints(plan, now, d.months, label);
  const chart = pts.length > 2 ? html`<div class="bi-chart"><h3>Owed over time</h3>${twoLines(pts, ['Your plan', 'Payments as they are'], ['var(--good)', 'var(--spend)'], 'What is owed month by month, with your plan and paying as now')}<div class="legend"><span><i style="background:var(--good)"></i>Your plan</span><span><i style="background:var(--spend)"></i>Payments as they are</span></div></div>` : '';
  const sooner = (m: number) => m === 1 ? t('1 month sooner') : t('{count} months sooner', { count: m });
  return html`<section class="panel mh" aria-label="Interest and payoff"><header class="mh-head"><div><h2>Interest and payoff</h2><p class="lead">What the loans have cost, and what finishing sooner saves</p></div></header>
<dl class="bi-stats">${stat('Interest paid so far', money0(d.paid))}${stat('Interest still to pay', money0(d.left))}${stat('Debt-free', d.months === null ? 'Not yet' : date, d.months === null ? 'up' : '')}${d.saved ? stat('Your plan saves', money0(d.saved.interest) + (d.saved.months ? ' · ' + sooner(d.saved.months) : ''), 'down') : ''}${d.more ? stat(t('Another {amount} a month', { amount: money0(d.more.extra) }), t('saves {amount}{sooner}', { amount: money0(d.more.interest), sooner: d.more.months ? ' · ' + sooner(d.more.months) : '' }), 'down') : ''}</dl>${chart}</section>`;
}

/* ---------- Fees and interest paid ---------- */
// Fees and interest by wording: the description, the category or the payee. Whole words, so "coffee" is not a fee.
export const FEE_RE = /\b(fees?|interest|finance charges?|overdraft|late charges?|penalty|penalties|service charges?|surcharges?)\b/i;
export const INTEREST_RE = /\b(interest|finance charges?)\b/i;
export type FeeSplit = { type: string, date: string, amount: number, description: string, category: string, destination_id: string, destination_name: string };
export type Fees = {
  total: number, count: number, avg: number, interest: number, fees: number,
  months: { key: string, label: string, v: number }[],                               // the last twelve months, oldest first
  sources: Share[], biggest: { what: string, amount: number, date: string } | null,
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The last 12 calendar months up to and including today's: [{key: '2026-11', label: 'Nov'}, …] oldest first
export function lastTwelve(today: string) {
  let y = +today.slice(0, 4), m = +today.slice(5, 7) - 1; const out: { key: string, label: string }[] = [];
  for (let i = 0; i < 12; i++) { out.unshift({ key: y + '-' + String(m + 1).padStart(2, '0'), label: MONTHS[m] }); if (--m < 0) { m = 11; y--; } }
  return out;
}
export const isFee = (s: { description: string, category: string, destination_name: string }) => FEE_RE.test(s.description) || FEE_RE.test(s.category) || FEE_RE.test(s.destination_name);
export function feesIn(splits: FeeSplit[], today: string): Fees {
  const months = lastTwelve(today).map(m => ({ ...m, v: 0 })), idx = new Map(months.map((m, i) => [m.key, i]));
  const by = new Map<string, Share>(); let total = 0, count = 0, interest = 0, biggest: Fees['biggest'] = null;
  for (const s of splits) {
    const i = idx.get(String(s.date).slice(0, 7));
    if (s.type !== 'withdrawal' || i === undefined || !(s.amount > 0) || !isFee(s)) continue;
    months[i].v += s.amount; total += s.amount; count++;
    if (INTEREST_RE.test(s.description) || INTEREST_RE.test(s.category) || INTEREST_RE.test(s.destination_name)) interest += s.amount;
    const name = s.destination_name || s.description || 'Other', cur = by.get(name) || { name, v: 0, href: s.destination_id ? '#/account/' + s.destination_id : undefined };
    cur.v += s.amount; by.set(name, cur);
    if (!biggest || s.amount > biggest.amount) biggest = { what: s.description || name, amount: s.amount, date: String(s.date).slice(0, 10) };
  }
  const sources = [...by.values()].sort((a, b) => b.v - a.v);
  return { total, count, avg: total / 12, interest, fees: total - interest, months, sources, biggest };
}
export function feesPanel(f: Fees): Html | string {
  if (!f.count) return '';
  const stat = (lab: string, val: string) => html`<div><dt>${lab}</dt><dd class="num">${val}</dd></div>`;
  const rows = f.sources.map(s => ({ ...s, sub: money0(s.v) }));
  const chart = shareChart(rows, '', 'Fees and interest by payee', { limit: 5, ring: false, other: 'Others' });
  return html`<section class="panel mh" aria-label="Fees and interest"><header class="mh-head"><div><h2>Fees and interest</h2><p class="lead">${t(f.count === 1 ? 'Last 12 months · {count} charge' : 'Last 12 months · {count} charges', { count: f.count })}</p></div><strong class="num mh-total">${money0(f.total)}</strong></header>
<dl class="bi-stats">${stat('Per month', money0(f.avg))}${stat('Interest', money0(f.interest))}${stat('Fees', money0(f.fees))}${f.biggest ? stat('Biggest', money0(f.biggest.amount) + ' · ' + f.biggest.what) : ''}</dl>
<div class="bi-chart"><h3>Month by month</h3>${barChart(f.months.map(m => ({ label: t(m.label), v: m.v })), v => money0(v), 'Fees and interest paid in each of the last 12 months')}</div>
<div class="bi-chart"><h3>Biggest sources</h3>${chart}</div></section>`;
}

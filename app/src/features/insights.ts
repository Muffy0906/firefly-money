import { type Html, html, htmlList } from '../core/html';
import { type ApiData, App, type Period, absDiff, arr, el, fmtDay, isoDate, money, money0, monthRange, nowMonth, sumDiff, todayIso, spentSum } from '../core/base';
import { ICON_X, vt, vtName } from '../core/dom';
import { LS, addDays, budgetAlert, daysBetween } from '../core/helpers';
import { type Account } from '../core/lists';
import { insight, refundsIn } from './refunds';
import { t } from '../core/spanish';

// A card's next payment day on or after today: its day this month, or next month's, each clamped to the month's length
export function cardDue(now: Date, day: number) {
  const on = (k: number) => new Date(now.getFullYear(), now.getMonth() + k, Math.min(day, new Date(now.getFullYear(), now.getMonth() + k + 1, 0).getDate()), 12);
  const due = on(0);
  return due < new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? on(1) : due;
}

/* =====================================================================
   Insight cards: short, auto-generated observations on the Overview.
   Compares this month against the same point last month (3-month average as a note).
   ===================================================================== */
const INS_ICON: Record<string, Html> = {
  up: html`<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>`,
  down: html`<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>`,
  budget: html`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  card: html`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>`,
  spark: html`<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>`,
  check: html`<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>`,
};
type InsightArgs = { cur: Period, future: boolean, budgets: ApiData[], limits: Record<string, ApiData>, cards: Account[], trend: { label: string, income: number, spend: number }[], max?: number };
async function insightCards({ cur: period, future, budgets, limits, cards, trend, max }: InsightArgs) {
  if (future) return '';
  const cur = period as Period & { y: number, m: number };     // always one month here: not shown for all time or the future
  const now = new Date(), [ny, nm] = nowMonth(), isCur = cur.y === ny && cur.m === nm;
  // dim: days in this month (or pay cycle), N: days of it so far
  const dim = daysBetween(cur.start, cur.end) + 1, N = isCur ? daysBetween(cur.start, todayIso()) + 1 : dim;
  const win = (mr: Period & { y: number, m: number }) => { const e = addDays(mr.start, N - 1); return { start: mr.start, end: e < mr.end ? e : mr.end }; };
  const pull = async (w: { start: string, end: string }) => {
    const [c, u] = await Promise.all([insight('/insight/expense/category', w, rs), insight('/insight/expense/no-category', w, rs).catch(() => [])]);
    const m = new Map<string, { id: string, amt: number }>(); arr(c).forEach(x => m.set(x.name, { id: x.id, amt: (m.get(x.name) || { amt: 0 }).amt + absDiff(x) }));
    return { cats: m, total: sumDiff(c) + sumDiff(u) };
  };
  const nowW = win(cur), past = [1, 2, 3].map(i => win(monthRange(cur.y, cur.m - i)));
  const rs = refundsIn(past[2].start, nowW.end);     // one request for all four windows
  const [me, ...hist] = await Promise.all([pull(nowW), ...past.map(pull)]);
  const used = hist.filter(h => h.total > 0);
  if (!used.length) return '';
  // Compare against last month at the same point; fall back to the 3-month average when last month has no data.
  const prevM = monthRange(cur.y, cur.m - 1), last = hist[0], useLast = last.total > 0;
  const lastBy = isCur ? (cur.start.endsWith('-01') ? t('by the {day} of {month}', { day: Math.min(N, new Date(prevM.y, prevM.m + 1, 0).getDate()), month: prevM.short }) : t('by {date}', { date: fmtDay(past[0].end) })) : t('in {month}', { month: prevM.short });
  const byLabel = isCur ? (cur.start.endsWith('-01') ? t('by the {day}', { day: N }) : t('by day {day}', { day: N })) : t('in {month}', { month: cur.short });
  const vsWord = useLast ? (isCur ? t('last month') : prevM.short) : t('usual');
  const vsText = (amt: number) => useLast ? money0(amt) + ' ' + lastBy : t('about {amount} {period} in a typical month', { amount: money0(amt), period: byLabel });
  const out: { id: string, tone: string, ic: string, title: string, detail: string, href: string, score: number }[] = [];
  const add = (id: string, tone: string, ic: string, title: string, detail: string, href: string, score: number) => out.push({ id: cur.y + '-' + (cur.m + 1) + ':' + id, tone, ic, title, detail, href, score });
  const avgOf = (name: string | null) => used.reduce((s, h) => s + (name == null ? h.total : (h.cats.get(name) || { amt: 0 }).amt || 0), 0) / used.length;
  const usualNote = (amt: number, base: number) => useLast && used.length > 1 && Math.abs(amt - base) >= 1 ? t(' · usually about {amount}', { amount: money0(amt) }) : '';
  const meWhen = isCur ? t('so far') : t('in {month}', { month: cur.short });

  // 1. Overall pace
  const avg = avgOf(null), base = useLast ? last.total : avg, pct = base ? (me.total - base) / base : 0;
  if (Math.abs(pct) >= .1) add('pace', pct > 0 ? 'up' : 'down', pct > 0 ? 'up' : 'down',
    t('Spending is {percent}% {direction} than {comparison}', { percent: Math.round(Math.abs(pct) * 100), direction: t(pct > 0 ? 'higher' : 'lower'), comparison: vsWord }),
    t('{amount} {period} vs. {comparison}{usual}', { amount: money0(me.total), period: meWhen, comparison: vsText(base), usual: usualNote(avg, base) }), '#/transactions?type=withdrawal', 30 + Math.min(40, Math.abs(pct) * 60));
  else add('pace', 'down', 'check', t('Spending is in line with {comparison}', { comparison: vsWord }), t('{amount} {period} vs. {comparison}{usual}', { amount: money0(me.total), period: meWhen, comparison: vsText(base), usual: usualNote(avg, base) }), '#/reports', 8);

  // 2. Categories that moved the most
  const ref = useLast ? [last] : used;
  const names = new Set([...me.cats.keys(), ...ref.flatMap(h => [...h.cats.keys()])]);
  const moves: { name: string, id: string | undefined, amt: number, a: number, d: number, p: number, score: number }[] = [];
  names.forEach(name => {
    const c = me.cats.get(name), amt = c ? c.amt : 0, a = useLast ? ((last.cats.get(name) || {}).amt || 0) : avgOf(name);
    const id = (c || used.map(h => h.cats.get(name)).find(Boolean) || {}).id, d = amt - a;
    if (a < 1 && amt >= 100) moves.push({ name, id, amt, a, d, p: Infinity, score: 30 + Math.min(30, amt / 40) });
    else if (a >= 25 && d >= 40 && d / a >= .3) moves.push({ name, id, amt, a, d, p: d / a, score: 25 + Math.min(40, d / a * 30) + Math.min(15, d / 50) });
    else if (a >= 60 && -d >= 50 && -d / a >= .35) moves.push({ name, id, amt, a, d, p: d / a, score: 12 + Math.min(20, -d / 40) });
  });
  const ups = moves.filter(m => m.d > 0).sort((x, y) => y.score - x.score).slice(0, 2), downs = moves.filter(m => m.d < 0).sort((x, y) => y.score - x.score).slice(0, 1);
  [...ups, ...downs].forEach(m => {
    const href = m.id ? '#/transactions?category=' + m.id : '#/transactions';
    if (m.p === Infinity) add('cat:' + m.name, 'up', 'spark', t('{amount} on {category}', { amount: money0(m.amt), category: m.name }),
      useLast ? t('Nothing spent here {period}{usual}', { period: lastBy, usual: usualNote(avgOf(m.name), 0) }) : t('Nothing spent here {period} in the last 3 months', { period: byLabel }), href, m.score);
    else add('cat:' + m.name, m.d > 0 ? 'up' : 'down', m.d > 0 ? 'up' : 'down', t('{category} is {percent}% {position} {comparison}', { category: m.name, percent: Math.round(Math.abs(m.p) * 100), position: t(m.d > 0 ? 'above' : 'below'), comparison: vsWord }),
      t('{amount} vs. {comparison}{usual}', { amount: money0(m.amt), comparison: vsText(m.a), usual: usualNote(avgOf(m.name), m.a) }), href, m.score);
  });

  if (isCur) {
    // 3. Budgets on pace to run out before the month ends (ones already near/over the limit show in "Needs attention")
    budgets.filter(b => b.attributes.active !== false).forEach(b => {
      const lim = limits[String(b.id)], spent = spentSum(b);
      if (!lim || !lim.amount || spent >= lim.amount * budgetAlert() / 100 || N < 5) return;
      const perDay = spent / N, runDay = perDay > 0 ? Math.ceil(lim.amount / perDay) : Infinity;
      if (runDay >= dim) return;
      add('bud:' + b.id, 'warn', 'budget', t('{name} may run out around {date}', { name: b.attributes.name, date: fmtDay(addDays(cur.start, runDay - 1)) }),
        t('{spent} of {limit} used · about {amount}/day so far', { spent: money0(spent), limit: money0(lim.amount), amount: money0(perDay) }), '#/transactions?budget=' + b.id, 38 + (dim - runDay));
    });
    // 4. Credit card payments coming up
    cards.forEach(a => {
      const owed = Math.max(0, -a.balance), day = +String(a.paymentDate || '').slice(8, 10);
      if (!owed || !day) return;
      const due = cardDue(now, day);
      const days = Math.round((+due - +new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 864e5);
      if (days > 7) return;
      add('card:' + a.id, 'warn', 'card', t('{name} payment due {when}', { name: a.name, when: t(days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in {count} days', { count: days }) }),
        t('{amount} owed · due {date}', { amount: money(owed), date: fmtDay(isoDate(due)) }), '#/account/' + a.id, 55 - days);
    });
  } else if (trend && trend.length >= 2) {
    // 5. Savings rate for a finished month
    const a = trend[trend.length - 1], b = trend[trend.length - 2];
    if (a.income > 0) {
      const r = (a.income - a.spend) / a.income, rb = b.income > 0 ? (b.income - b.spend) / b.income : null;
      add('kept', r >= (rb ?? r) ? 'down' : 'up', 'check', t('You kept {percent}% of your income', { percent: Math.round(r * 100) }),
        rb === null ? t('{kept} of {income}', { kept: money0(a.income - a.spend), income: money0(a.income) }) : t('{direction} from {percent}% in {month}', { direction: t(r >= rb ? 'Up' : 'Down'), percent: Math.round(rb * 100), month: b.label }), '#/reports', 20);
    }
  }

  // December and early January: the year's story is ready (pages/year.ts)
  if (isCur && (nm === 11 || (nm === 0 && now.getDate() <= 20))) {
    const yr = nm === 11 ? ny : ny - 1;
    add('year:' + yr, 'down', 'spark', t('Your {year} in Money', { year: yr }), t('A few cards on your year: your places, your biggest month, days you spent nothing'), '#/year?y=' + yr, 90);
  }
  const hidden = LS.get('insightsHidden', {});
  const shown = out.filter(x => !hidden[x.id]).sort((a, b) => b.score - a.score).slice(0, max || 4);
  if (!shown.length) return '';
  return html`<div class="insights" id="insights" aria-label="Insights">${htmlList(shown.map(x =>
    html`<div class="insight t-${x.tone}" role="link" tabindex="0" data-ins="${x.id}" data-onclick="App.go('${x.href}')" data-onkeydown="App.enterClick(event,this)"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${INS_ICON[x.ic]}</svg></span><span><div class="t">${x.title}</div><div class="d">${x.detail}</div></span><button class="x" type="button" aria-label="Dismiss" title="Hide this" data-onclick="event.stopPropagation();App.hideInsight(this)">${ICON_X}</button></div>`))}</div>`;
}
function hideInsight(btn: HTMLElement) {
  const card = btn.closest<HTMLElement>('.insight')!, id = card.dataset.ins!, box = el('insights');
  const hidden = LS.get('insightsHidden', {}); hidden[id] = Date.now();
  Object.keys(hidden).forEach(k => { if (Date.now() - hidden[k] > 100 * 864e5) delete hidden[k]; });
  LS.set('insightsHidden', hidden);
  const rest = [...box.children].filter(c => c !== card);
  vt('ins', () => { card.remove(); if (!rest.length) (box.closest('#dash > .w') || box).remove(); }, () => rest.forEach((c, i) => vtName(c, 'ins' + i)));
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  insightCards,
  hideInsight,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

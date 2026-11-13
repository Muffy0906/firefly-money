import { payUrl } from '../core/paylink';
import { type Html, html, htmlList } from '../core/html';
import { api, getAll, sleep } from '../core/api';
import { paceForecast } from '../features/projections';
import { monthEnd } from '../features/predict';
import { ALL_START, App, S, absDiff, arr, el, fmtDate, fmtDay, isoDate, money, money0, monthRange, noneHref, nowMonth, num, pad, sumDiff, todayIso, txHref, type ApiData, type Period, viewPeriod, viewYM } from '../core/base';
import { head, monthNav } from '../core/dom';
import { normGroup, rankCats, txRows } from '../core/feed';
import { addDays, budgetAlert, daysBetween } from '../core/helpers';
import { type Account, isAsset, isCard, isLiab, lists } from '../core/lists';
import { VIEWS, quiet } from '../core/router';
import { type Unusual, loadUnusual } from '../features/unusual';
import { gettingStarted } from '../features/started';
import { DASH_NAMES, tileOn, tileOpt } from '../features/dashboard';
import { activityPanel, activityRange, barChart, paceChart, ring, shareChart, sparkBars, twoLines } from '../features/charts';
import { type NetWorthPoint, nwLine, nwSeg, nwWords } from '../features/networth';
import { bindSwipe } from '../features/phone';
import { drafts } from '../features/txform';
import { billAmount, billDueDates, billsFrom, subCharges } from './bills';
import { auditSubs } from '../features/subaudit';
import { subAuditTile } from '../features/subauditview';
import { fcHorizon } from './forecast';
import { type BudgetLimit, budgetLimits, budgetPace } from './budgets';
import { loanHistory } from './loans';
import { type Piggy, normPiggy, paceBits } from './piggy';
import { INVEST_RE } from '../features/moneyhealth';
import { budgetsLessRefunds, insight, lessRefundTx, refundsIn } from '../features/refunds';

/* ================= Overview ================= */
type CatRow = { name: string, id?: string, amt: number, prev: number };
type CashMonth = { label: string, income: number, spend: number, go?: string, start?: string, end?: string };
// Averages leave out a month that hasn't finished (it would pull them down); all of them if none has
export const fullMonths = (trend: CashMonth[]) => { const t = todayIso(), done = trend.filter(m => !m.end || m.end < t); return done.length ? done : trend; };
VIEWS[''] = async (r, paint) => {
  const L = await lists();
  const cur = viewPeriod(r), all = !!cur.all, [vy, vm] = viewYM(r), prev = monthRange(vy, vm - 1);
  // The cash-flow chart's months (six unless its settings say otherwise), up to today in All time
  const nMonths = tileOpt('cashflow', 'months');
  const [ny, nm] = nowMonth(), months = [...Array(nMonths)].map((_, i) => all ? monthRange(ny, nm - nMonths + 1 + i) : monthRange(vy, vm - nMonths + 1 + i));
  const p = (x: Period) => ({ start: x.start, end: x.end });
  // While this month is under way, Spent compares it with last month up to the same day (like the insights);
  // a month that's over is compared with the whole of the one before
  const t0 = todayIso(), soFar = !all && cur.start <= t0 && t0 <= cur.end ? samePoint(cur, prev, t0) : null;
  const future = !all && (vy > ny || (vy === ny && vm > nm));
  const monthOnly = future || all;   // cards that only make sense for one month (insights, the day heatmap)
  const uncatQ = 'has_no_category:true transaction_type:withdrawal date_after:' + cur.start + ' date_before:' + cur.end;
  const actRange = String(tileOpt('activity', 'range') || 'year'), own = L.accounts.filter(a => a.active);
  const cards = own.filter(isCard), loans = own.filter(isLiab);
  // What the balance tiles list, by their settings: closed (inactive) accounts, zero balances, paid-off debts
  const shown = (k: string, test: (a: Account) => boolean, settled: (a: Account) => boolean) => L.accounts.filter(a => test(a) && (a.active || tileOpt(k, 'closed')) && (tileOpt(k, k === 'cash' ? 'zero' : 'paidOff') || !settled(a)));
  const cashShown = shown('cash', a => isAsset(a) && !isCard(a), a => !a.balance);
  const cardsShown = shown('cards', isCard, a => a.balance >= 0), loansShown = shown('loans', isLiab, l => !l.debt);
  // Everything is requested at once (the main numbers first, so they reach Firefly first). The page is drawn
  // as soon as those are in; the slower cards show placeholders and fill in when their data arrives.
  // Refunds come off spending (see refunds.ts): fetched once for the chart's months, and the other ranges use those when they fit
  const span = { start: months[0].start, end: months[months.length - 1].end }, monthsRs = refundsIn(span.start, span.end);
  const rsFor = (x: { start: string, end: string }) => x.start >= span.start && x.end <= span.end ? monthsRs : undefined;
  const coreP = Promise.all([
    api('/summary/basic', { params: p(cur) }).catch(() => ({})),
    insight('/insight/expense/category', p(cur), rsFor(cur)), all ? [] : insight('/insight/expense/category', p(prev), rsFor(prev)),
    insight('/insight/expense/no-category', p(cur), rsFor(cur)).catch(() => []), all ? [] : insight('/insight/expense/no-category', p(prev), rsFor(prev)).catch(() => []),
    Promise.all(months.map(mo => Promise.all([insight('/insight/income/total', p(mo), monthsRs), insight('/insight/expense/total', p(mo), monthsRs)])
      .then(([i, e]) => ({ label: mo.short, income: sumDiff(i), spend: sumDiff(e), go: 'month:' + mo.y + ':' + mo.m, start: mo.start, end: mo.end })))),
    api('/transactions', { params: { limit: tileOpt('recent', 'count'), page: 1 } }),
    Promise.all([api('/budgets', { params: p(cur) }), rsFor(cur) || refundsIn(cur.start, cur.end)]).then(([b, rs]) => budgetsLessRefunds(arr(b), rs)), all ? {} : budgetLimits(cur, L),
    // From the 1st, so bills still unpaid from earlier this month show as overdue; as far ahead as the safe-to-spend card looks, so it's the same request
    getAll('/bills', { start: billsFrom(t0), end: addDays(t0, Math.max(45, fcHorizon())) }),
    future ? null : api('/search/transactions', { params: { query: uncatQ, search: uncatQ, limit: 1, page: 1 } }).catch(() => null),
    all ? Promise.all([insight('/insight/income/total', p(cur), rsFor(cur)), insight('/insight/expense/total', p(cur), rsFor(cur))])
      .then(([i, e]) => ({ income: sumDiff(i), spend: sumDiff(e) })) : null,
    soFar ? insight('/insight/expense/total', soFar, rsFor(soFar)).then(sumDiff).catch(() => null) : null,
  ]);
  // Only what the cards on the page need: a card that's off (Customize → Add cards) costs no requests
  const on = (...ks: string[]) => ks.some(tileOn), none = Promise.resolve([] as any);
  const slowP = Promise.all([on('loans') ? loanHistory(loansShown).catch(() => ({})) : {}, on('safe') ? App.safeCard() : '',
    coreP.then(c => App.insightCards({ cur, future: monthOnly, budgets: arr(c[7]), limits: c[8], cards, trend: c[5], max: 3 })).catch(() => ''),
    on('cash', 'cards') ? App.balanceSparks([...cashShown, ...cardsShown]).catch(() => ({})) : {},
    monthOnly || !on('heatmap', 'pace') ? none : Promise.all([getAll('/transactions', { start: cur.start, end: cur.end, type: 'withdrawal' }).catch(() => []), rsFor(cur) || refundsIn(cur.start, cur.end)]).then(([tx, rs]) => lessRefundTx(tx, rs)),
    on('flow', 'income') ? insight('/insight/income/revenue', p(cur), rsFor(cur)).catch(() => []) : none,
    on('payees') ? insight('/insight/expense/expense', p(cur), rsFor(cur)).catch(() => []) : none, all || !on('payees') ? none : insight('/insight/expense/expense', p(prev), rsFor(prev)).catch(() => []),
    on('goals') ? getAll('/piggy-banks').then(ps => ps.map(normPiggy)).catch(() => []) : none, on('networth') ? App.netWorthHistory().catch(() => null) : null,
    monthOnly || !on('pace') ? none : Promise.all([getAll('/transactions', { start: monthRange(vy, vm - 3).start, end: prev.end, type: 'withdrawal' }).catch(() => []), refundsIn(monthRange(vy, vm - 3).start, prev.end).catch(() => [])]).then(([tx, rs]) => lessRefundTx(tx, rs)),     // three months back: the pace learns from all of them
    on('trends') ? Promise.all(months.map(mo => insight('/insight/expense/category', p(mo), monthsRs).catch(() => []))) : none,
    // The activity grid ignores the month at the top: it covers its own range up to today (from Firefly only, nothing when it is down)
    on('activity') ? (() => { const a0 = actRange === 'all' ? ALL_START : activityRange(actRange, t0, '').start; return Promise.all([getAll('/transactions', { start: a0, end: t0, type: 'withdrawal' }), refundsIn(a0, t0).catch(() => [])]).then(([tx, rs]) => lessRefundTx(tx, rs)).catch(() => null); })() : none,
    // The subscription audit works from the past year's charges (from Firefly only, a note when it can't be reached)
    on('subs') ? subCharges().then(cs => auditSubs(cs, t0)).catch(() => null) : none]);
  slowP.catch(() => {});
  if (r.at) { await Promise.all([coreP, slowP]).catch(() => {}); return; }     // loading a month ahead: the data is all it needs
  const [summary, catNow, catPrev, noCatNow, noCatPrev, trend, recent, budgets, limits, bills, uncat, allTot, prevSoFar] = await coreP;
  const nwKey = Object.keys(summary || {}).find(k => k.startsWith('net-worth-in'));
  const computedNW = own.filter(isAsset).reduce((s, a) => s + a.balance, 0) - loans.reduce((s, l) => s + l.debt, 0);
  const netWorth = nwKey ? num(summary[nwKey].monetary_value) : computedNW;
  const last = all ? allTot! : trend[trend.length - 1], before = all || trend.length < 2 ? { spend: 0 } : soFar ? { spend: prevSoFar || 0 } : trend[trend.length - 2];

  // categories
  const cats = new Map<string, CatRow>();
  arr(catNow).forEach(x => cats.set(x.name, { name: x.name, id: x.id, amt: absDiff(x), prev: 0 }));
  arr(catPrev).forEach(x => { const c = cats.get(x.name) || { name: x.name, id: x.id, amt: 0, prev: 0 }; c.prev = absDiff(x); cats.set(x.name, c); });
  const un = sumDiff(noCatNow), unP = sumDiff(noCatPrev);
  if (un || unP) cats.set('Uncategorized', { name: 'Uncategorized', amt: un, prev: unP });
  rankCats([...cats.values()].map(c => ({ name: c.name, v: c.amt })));     // the feed's category colours follow the donut's

  let unusual: Unusual | null = null, lastSlow: ApiData[] | null = null;     // odd charges: found after the page is up (below)
  const build = (slow: ApiData[] | null) => {
    lastSlow = slow;
    const [prog, safe, insights, sparks, dayTx, incomeSrc, payNow, payPrev, piggies, nw, prevTx, monthCats, actTx, subAudit] = slow || [];
    const wait = (k: string) => slow ? null : skeletonPanel(k);
    // A card with nothing to show for this month says so rather than vanishing, so the cards around it stay put
    const idle = (k: string, why = future ? 'Fills in once this month starts.' : 'Shows for one month at a time: pick a month at the top.') => quietPanel(k, why);
    const W: [string, unknown][] = [
      ['networth', networthTile(netWorth, slow ? nw : undefined)],
      ['spent', spentTile(last.spend, future && !last.spend ? 0 : before.spend, soFar ? 'the same point in ' + prev.short : prev.short, trend, all, !!soFar)],
      ['earned', earnedTile(last.income, last.spend, !!soFar)],
      ['insights', monthOnly ? idle('insights') : wait('insights') ?? (insights || quietPanel('insights', 'Nothing unusual this month.'))],
      ['safe', future ? idle('safe') : wait('safe') ?? (safe || idle('safe'))],
      ['attention', attentionPanel({ uncat, uncatQ, bills: arr(bills), budgets: arr(budgets), limits, future, unusual })],
      ['spending', spendingPanel([...cats.values()], future, all, tileOpt('spending', 'count'), tileOpt('spending', 'compare'), noneHref('category', cur))],
      ['budgets', budgetsMini(arr(budgets), limits, all, tileOpt('budgets', 'unset'), all || future ? null : cur)],
      ['cash', balancesPanel('Cash & savings', 'Bank account balances', cashShown.filter(a => !INVEST_RE.test(a.name)), a => a.balance, false, tileOpt('cash', 'sparks') ? sparks : {}, cashShown.filter(a => INVEST_RE.test(a.name)))],
      ['cards', balancesPanel('Credit cards', 'Current balances owed', cardsShown, a => Math.max(0, -a.balance), true, tileOpt('cards', 'sparks') ? sparks : {})],
      ['loans', loansShown.length ? wait('loans') ?? loansPanel(loansShown, prog) : loansPanel(loansShown, {})], ['bills', billsMini(arr(bills), tileOpt('bills', 'days'), 4)],
      ['heatmap', monthOnly ? idle('heatmap') : wait('heatmap') ?? App.heatmapPanel(cur, dayTx.map(normGroup))],
      ['flow', future ? idle('flow') : wait('flow') ?? App.sankeyPanel(arr(incomeSrc), last.income, [...cats.values()].filter(c => c.amt > 0), cur)],
      ['payees', wait('payees') ?? payeesPanel(arr(payNow), arr(payPrev), future, all, tileOpt('payees', 'count'), tileOpt('payees', 'compare'))],
      ['income', future ? idle('income') : wait('income') ?? incomePanel(arr(incomeSrc), all)],
      ['goals', !tileOn('goals') ? 'off' : wait('goals') ?? goalsPanel(piggies, tileOpt('goals', 'done'))],     // (empty without its data, so offered as is)
      ['cashflow', html`<section class="panel chart">${cashFlowAs(trend, tileOpt('cashflow', 'style'))}</section>`],
      ['recent', html`<section class="panel flush"><div style="padding:24px 26px 6px" class="panel-head"><div><h2>Recent transactions</h2></div><a class="link" href="#/transactions">See all</a></div>${txRows(arr(recent).map(normGroup))}</section>`],
      ['activity', wait('activity') ?? activityTile(actTx, actRange, t0)],
      ['pace', monthOnly ? idle('pace') : wait('pace') ?? pacePanel(cur, prev, arr(dayTx).map(normGroup), arr(prevTx).map(normGroup))],
      ['savings', html`<section class="panel chart">${savingsRate(trend)}</section>`],
      ['subs', !tileOn('subs') ? 'off' : wait('subs') ?? subAuditTile(subAudit && !Array.isArray(subAudit) ? subAudit : null)],
      ['trends', wait('trends') ?? trendsPanel(months.map(mo => mo.short), monthCats || [], months)],
    ];
    W.forEach(w => { if (w[1] && !tileOn(w[0])) w[1] = 'off'; });     // off: not drawn, only offered under Add cards
    return html`${head('Overview', '', html`${monthNav()}${App.dashButton()}`)}${gettingStarted()}${App.dashboard(W)}`;
  };
  // Saved data (or a fast server): everything is here already, draw once. Another month waits longer, so its cards
  // glide from last month's in one go rather than dropping to placeholders and popping in (last month stays up, dimmed).
  const quick = await Promise.race([slowP, sleep(paint.month ? 2500 : 60).then(() => null)]);
  // Six months of spending for the odd-charges row: asked for only once the page is drawn and the network is quiet,
  // and only for the current month. Firefly not answering means no row (nothing is kept to show instead).
  const tok0 = S.tok, watch = () => {
    if (all || r.at || !paint.live || vy !== ny || vm !== nm || !tileOn('attention')) return;
    quiet(() => tok0 === S.tok).then(ok => ok ? loadUnusual() : null).then(u => {
      if (!u || tok0 !== S.tok || !u.flags.length) return;
      unusual = u; fillIn(build(lastSlow));
    }).catch(() => {});
  };
  if (quick || !paint.live) { paint(build(quick || await slowP)); watch(); return; }
  const first = build(null), tok = S.tok;
  paint(first);
  const full = build(await slowP);
  if (tok !== S.tok) return;
  if (S.pageHtml !== first || !fillIn(full)) paint(full);
  watch();
};
// Replace only the placeholders and the cards that changed, so the numbers already on screen don't redraw.
function fillIn(markup: Html) {
  const v = el('view'), t = document.createElement('template'); t.innerHTML = String(markup);
  if (v.querySelector('#dash.moving')) return true;      // a card is being dragged: keep what's on screen until the next refresh
  const olds = [...v.querySelectorAll('#dash .w')] as HTMLElement[], news = [...t.content.querySelectorAll<HTMLElement>('#dash .w')];
  if (olds.map(w => w.dataset.w).join() !== news.map(w => w.dataset.w).join()) return false;      // a card came or went: redraw it all
  olds.forEach((o, i) => { if (news[i].innerHTML !== o.innerHTML) { if (o.querySelector('.sk')) { const n = news[i]; n.classList.add('pop'); setTimeout(() => n.classList.remove('pop'), 2600); } o.replaceWith(news[i]); } });     // a card arriving plays its chart in
  S.pageHtml = markup;
  bindSwipe();
  if (App.fitSankey) App.fitSankey();
  return true;
}
function activityTile(tx: ApiData[] | null, range: string, today: string) {
  if (!tx) return quietPanel('activity', 'Firefly isn’t answering, so nothing is shown.');
  const buys = tx.map(normGroup).flatMap(g => g.splits.filter(x => x.type === 'withdrawal').map(x => ({ date: String(x.date), amount: x.amount })));
  const first = buys.reduce((m, b) => !m || b.date.slice(0, 10) < m ? b.date.slice(0, 10) : m, '');
  const r = activityRange(range, today, first);
  return activityPanel(buys, r.start, r.end, { range });
}
function quietPanel(k: string, why: string) {
  return html`<section class="panel quiet"><h2>${DASH_NAMES[k] || ''}</h2><p class="lead">${why}</p></section>`;
}
function skeletonPanel(k: string) {
  const h = ({ insights: 120, safe: 70, loans: 90, heatmap: 230, activity: 155, flow: 240, payees: 200, networth: 230, pace: 230, trends: 220 } as Record<string, number>)[k] || 120;
  return html`<section class="panel" aria-busy="true"><h2>${DASH_NAMES[k] || ''}</h2><p class="lead">&nbsp;</p><div class="sk" style="height:${h}px"></div></section>`;
}
function attentionPanel({ uncat, bills, budgets, limits, future, unusual }: { uncat: ApiData, uncatQ: string, bills: ApiData[], budgets: ApiData[], limits: Record<string, BudgetLimit>, future: boolean, unusual?: Unusual | null }) {
  const items: Html[] = [];
  const n = uncat && uncat.meta && uncat.meta.pagination ? uncat.meta.pagination.total : 0;
  const [ny, nm] = nowMonth(), lastMonth = monthRange(ny, nm - 1), cur = monthRange(ny, nm);
  if (!future && !S.all && S.y === ny && S.m === nm && todayIso() < addDays(cur.start, 7)) items.push(html`<a class="row" href="#/recap" data-onclick="event.preventDefault();App.recapLast()"><span class="name">📊 Your ${lastMonth.label} recap is ready</span><span class="neutral">See it →</span></a>`);
  const nd = drafts().length;
  if (nd) items.push(html`<a class="row" href="#/transactions"><span class="name">📝 ${nd} draft${nd === 1 ? '' : 's'} to finish</span><span class="neutral">Open →</span></a>`);
  if (n) items.push(html`<a class="row" href="#/inbox"><span class="name">🏷 ${n} expense${n === 1 ? '' : 's'} without a category</span><span class="neutral">Categorize →</span></a>`);
  if (unusual && unusual.flags.length) {
    const fl = unusual.flags, one = fl.length === 1 ? fl[0] : null;
    items.push(one ? html`<a class="row" href="#/unusual" data-onclick="event.preventDefault();App.editTx('${one.charge.id}')"><span class="name">🔍 ${one.charge.payee}: ${one.why}</span><span class="neutral">Look →</span></a>`
      : html`<a class="row" href="#/unusual"><span class="name">🔍 ${fl.length} unusual charges</span><span class="neutral">Review →</span></a>`);
  }
  const t = todayIso(), week = isoDate(new Date(Date.now() + 7 * 864e5));
  bills.filter(b => b.attributes.active !== false).forEach(b => {
    const d = billDueDates(b.attributes, { end: week })[0];
    if (d) items.push(html`<a class="row" href="#/bills"><span class="name">📅 ${b.attributes.name} ${d < t ? html`<span class="up">overdue since ${fmtDay(d)}</span>` : 'due ' + fmtDay(d)}</span><span class="num">${money(billAmount(b.attributes))}</span></a>`);
  });
  if (!future) budgets.forEach(b => {
    const lim = limits[String(b.id)], spent = Math.abs((b.attributes.spent || []).reduce((s: number, x: ApiData) => s + num(x.sum), 0));
    if (lim && lim.amount && spent > lim.amount) items.push(html`<a class="row" href="#/transactions?budget=${b.id}"><span class="name">⚠️ ${b.attributes.name} is over budget</span><span class="num up">${money0(spent - lim.amount)} over</span></a>`);
    else if (lim && lim.amount && spent >= lim.amount * budgetAlert() / 100) items.push(html`<a class="row" href="#/transactions?budget=${b.id}"><span class="name">◔ ${b.attributes.name} is at ${Math.round(spent / lim.amount * 100)}%</span><span class="num">${money0(lim.amount - spent)} left</span></a>`);
  });
  if (!items.length) return html`<section class="panel attention"><h2>Needs attention</h2><p class="lead">Quick things to tidy up</p><p class="all-clear"><span aria-hidden="true">✓</span> All caught up</p></section>`;
  // Two rows at most, so the card is the same height from month to month; the rest open from the heading
  const more = items.length - 2;
  return html`<section class="panel attention"><div class="panel-head"><h2>Needs attention</h2>${more > 0 ? html`<button type="button" class="link" data-onclick="App.attMore(this)">${more} more</button>` : ''}</div><p class="lead">Quick things to tidy up</p><div class="list">${htmlList(items.slice(0, 2))}${more > 0 ? html`<div class="att-more" hidden>${htmlList(items.slice(2))}</div>` : ''}</div></section>`;
}
// The bento's number tiles: net worth with its trend, what was spent against last month, what came in and was kept
function networthTile(netWorth: number, pts: NetWorthPoint[] | null | undefined) {
  const d = pts && pts.length > 1 ? netWorth - pts[0].net : null;
  const line = pts === undefined ? html`<div class="sk" style="height:56px"></div>` : pts && pts.length > 1 ? nwLine(pts, d! >= 0 ? 'var(--good)' : 'var(--spend)') : '';
  return html`<section class="panel stat nw"><div class="panel-head"><a class="eyebrow nw-tl" href="#/timeline" title="Open the timeline">Net worth<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>${nwSeg()}</div><div class="big num go-num${netWorth < 0 ? ' negative' : ''}" data-count="${netWorth}" data-go="#/accounts" title="See your accounts">${money0(netWorth)}</div><div class="sub-s">${d === null ? html`&nbsp;` : html`<span class="${d >= 0 ? 'down' : 'up'}">${d >= 0 ? '▲' : '▼'} ${money0(Math.abs(d))}</span> over ${nwWords()}`}</div>${line}</section>`;
}
// Last month from its start up to the same day of the month as today (the same number of days in, for a custom month start)
export function samePoint(cur: { start: string }, prev: { start: string, end: string }, today: string) {
  const e = addDays(prev.start, daysBetween(cur.start, today));
  return { start: prev.start, end: e < prev.end ? e : prev.end };
}
function spentTile(spend: number, before: number, prevShort: string, trend: CashMonth[], all: boolean, part = false) {
  const change = before ? (spend - before) / before * 100 : 0, bars = trend.map(t => t.spend);
  return html`<section class="panel stat"><div class="eyebrow">Spent${part ? ' so far' : ''}</div><div class="stat-v num go-num" data-count="${spend}" data-go="${txHref({ type: 'withdrawal' })}" title="See these expenses">${money0(spend)}</div><div class="sub-s">${all ? 'of all time' : before ? html`<span class="${change > 0 ? 'up' : 'down'}">${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}%</span> vs ${prevShort}` : html`&nbsp;`}</div>${all ? '' : sparkBars(bars, Math.max(1, ...bars), trend.map(t => t.label + ' · ' + money0(t.spend)), trend.map(t => t.start && t.end ? txHref({ type: 'withdrawal' }, { start: t.start, end: t.end }) : ''))}</section>`;
}
// What came in, what went out, and what was kept: two bars on the same scale, so a month that ran over shows it at a glance
function earnedTile(income: number, spend: number, part = false) {
  const kept = income - spend, pct = income > 0 ? Math.round(kept / income * 100) : 0, top = Math.max(income, spend, 1);
  const bar = (label: string, v: number, c: string) => html`<div class="io-r" data-go="${txHref({ type: c === 'in' ? 'deposit' : 'withdrawal' })}"><span class="io-l">${label}</span><span class="io-t"><i class="${c}" style="width:${(v / top * 100).toFixed(1)}%"></i></span><span class="io-v num">${money0(v)}</span></div>`;
  const sub = !income && !spend ? 'Nothing came in yet' : kept >= 0 ? html`Kept <span class="down num">${money0(kept)}</span>${income ? html` · <span class="${part ? 'neutral' : ''}"${part ? html` title="Not final: the month isn't over"` : ''}>${pct}%</span>` : ''}` : html`<span class="up num">${money0(-kept)}</span> more out than in`;
  return html`<section class="panel stat earned"><div class="eyebrow">Earned${part ? ' so far' : ''}</div><div class="stat-v num go-num" data-count="${income}" data-go="${txHref({ type: 'deposit' })}" title="See this income">${money0(income)}</div><div class="sub-s">${sub}</div><div class="io">${bar('In', income, 'in')}${bar('Out', spend, kept < 0 ? 'over' : 'out')}</div></section>`;
}
function spendingPanel(cats: CatRow[], future: boolean, all: boolean, count = 6, compare = true, uncat = '') {
  const cmp = compare && !all, total = cats.reduce((t, c) => t + c.amt, 0);
  const items = cats.map(c => {
    const d = c.amt - c.prev;
    const vs = !cmp ? '' : !c.prev ? ' · new' : Math.abs(d) < 1 ? ' · same' : html` · <span class="${d > 0 ? 'up' : 'down'}">${money0(Math.abs(d))} ${d > 0 ? 'more' : 'less'}</span>`;
    return { name: c.name, v: c.amt, href: c.id ? '#/transactions?category=' + c.id : c.name === 'Uncategorized' ? uncat || undefined : undefined, sub: html`${money0(c.amt)}${vs}` };
  });
  const chart = shareChart(items, html`<span class="eyebrow">Spent</span><strong class="num">${money0(total)}</strong>`, 'Spending by category', { limit: count, ring: tileOpt('spending', 'style') !== 'bars', go: txHref({ type: 'withdrawal' }), rest: '#/categories' });
  return html`<section class="panel"><h2>Where it went</h2><p class="lead">Spending by category ${all ? 'of all time' : 'this month'}${cmp ? ', against last month' : ''}</p>${chart || html`<p class="empty">${future ? 'This month hasn’t started yet.' : 'No spending recorded ' + (all ? 'yet.' : 'this month.')}</p>`}</section>`;
}
// A card row: the whole row opens the account, and a Pay now button (owed > 0 and a known/own pay link) opens the issuer in a new tab
export function payRow(a: Account, v: number, paidOff: boolean, sparks: any = {}) {
  const main = html`<span class="name">${a.name}</span>${sparks[a.id] ? App.sparkline(sparks[a.id], paidOff) : ''}<span class="num">${paidOff && !v ? html`<span class="down">Paid off</span>` : money(v)}</span>`;
  const url = paidOff && v > 0 ? payUrl(a.id, a.name) : '';
  if (!url) return html`<a class="row" href="#/account/${a.id}">${main}</a>`;
  return html`<div class="row payrow"><a class="rowmain" href="#/account/${a.id}">${main}</a><a class="paynow" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Pay ${a.name} now">Pay now</a></div>`;
}
function balancesPanel(title: string, lead: string, items: Account[], val: (a: Account) => number, paidOff: boolean, sparks: any = {}, invest: Account[] = []) {
  const rows = htmlList([...items].sort((a, b) => val(b) - val(a)).map(a => payRow(a, val(a), paidOff, sparks)));
  return html`<section class="panel"><h2>${title}</h2><p class="lead">${lead}</p>${items.length ? html`<div class="total num">${money0(items.reduce((s, a) => s + val(a), 0))}</div><div class="list">${rows}</div>` : html`<p class="empty">None yet.</p>`}${invest.length ? html`<a class="row" href="#/accounts" style="margin-top:6px;padding-top:10px;border-top:1px solid var(--line);text-decoration:none;color:inherit"><span class="name">Investments</span><span class="num neutral" style="text-decoration:none">${money0(invest.reduce((s, a) => s + val(a), 0))}</span></a>` : ''}</section>`;
}
function loansPanel(loans: Account[], prog: any = {}) {
  // The biggest four; the rest are a tap away on Loans, so one long list doesn't set the height of its whole row
  const sorted = [...loans].sort((a, b) => b.debt - a.debt), more = sorted.length > 4 ? sorted.length - 3 : 0;
  const rows = htmlList(sorted.slice(0, more ? 3 : undefined).map(l => {
    const pr = prog[l.id] || {}, paid = l.debt ? pr.pct ?? null : null;
    const months = pr.monthly > 0 && l.debt > 0 ? Math.ceil(l.debt / pr.monthly) : 0;
    const bits: string[] = [];
    if (paid !== null) bits.push(paid.toFixed(0) + '% paid' + (pr.repaid ? ' (' + money0(pr.repaid) + ' of ' + money0(pr.borrowed) + ')' : ' of ' + money0(pr.borrowed)));
    if (months) bits.push('about ' + months + ' month' + (months === 1 ? '' : 's') + ' to go at ' + money0(pr.monthly) + '/mo');
    else if (l.debt) bits.push('no payments in the last 3 months');
    if (!l.debt) bits.push('Paid off');
    return html`<div style="padding:11px 0;border-top:1px solid var(--line)"><a class="row" href="#/account/${l.id}" style="text-decoration:none"><span class="name">${l.name}</span><span class="num">${money0(l.debt)}</span></a>${paid ? html`<div class="track"><div class="fill good" style="width:${paid.toFixed(1)}%"></div></div>` : ''}<div class="sub-s">${bits.join(' · ')}</div></div>`;
  }));
  return html`<section class="panel"><div class="panel-head"><h2>Loans</h2><a class="link" href="#/loans">Plan payoff</a></div><p class="lead">Remaining balance and payoff progress</p>${loans.length ? html`<div class="total num" style="margin-bottom:4px">${money0(loans.reduce((s, l) => s + l.debt, 0))}</div><div class="loan-rows">${rows}${more ? html`<a class="row more" href="#/loans" style="padding:11px 0;border-top:1px solid var(--line)"><span class="name">${more} more</span><span class="neutral">→</span></a>` : ''}</div>` : html`<p class="empty">No loans.</p>`}</section>`;
}
export function cashFlow(trend: CashMonth[]) {
  const W = window.innerWidth < 600 ? 420 : window.innerWidth >= 1700 ? 1500 : 960, H = 210, top = 10, bottom = 28, n = trend.length;
  const max = Math.max(1, ...trend.flatMap(t => [t.income, t.spend])), slot = W / n, bw = Math.min(34, slot / 4);
  const yy = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const bars = htmlList(trend.map((t, i) => {
    const cx = slot * i + slot / 2;
    return html`<g class="col"><rect class="hit" x="${slot * i}" y="0" width="${slot}" height="${H}" fill="transparent" data-i="${i}"${t.go ? html` data-go="${t.go}" style="cursor:pointer"` : ''}></rect><rect class="band" x="${slot * i + 4}" y="${top - 6}" width="${slot - 8}" height="${H - bottom - top + 6}" rx="10"></rect><rect data-i="${i}" x="${cx - bw - 3}" y="${yy(t.income)}" width="${bw}" height="${H - bottom - yy(t.income)}" rx="6" fill="var(--income)" class="bar" style="--j:${i};color:var(--income)${t.go ? ';cursor:pointer' : ''}"><title>Earned ${money0(t.income)}</title></rect><rect data-i="${i}" x="${cx + 3}" y="${yy(t.spend)}" width="${bw}" height="${H - bottom - yy(t.spend)}" rx="6" fill="var(--spend)" class="bar" style="--j:${i};color:var(--spend)${t.go ? ';cursor:pointer' : ''}" opacity=".85"><title>Spent ${money0(t.spend)}</title></rect><text x="${cx}" y="${H - 7}" text-anchor="middle">${t.label}</text></g>`;
  }));
  const full = fullMonths(trend), avgS = full.reduce((s, t) => s + t.spend, 0) / full.length, avgK = full.reduce((s, t) => s + t.income - t.spend, 0) / full.length;
  S.chartData = trend;
  return html`<h2>Cash flow</h2><p class="lead">Earned vs. spent over the last ${n === 6 ? 'six' : n} months · click a month to open it</p><svg class="flowchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and spending by month"><line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" stroke="var(--line)"/>${bars}</svg><div style="display:flex;gap:40px;margin-top:18px"><div><div class="eyebrow">Avg. spent / month</div><div class="num" style="font-size:21px">${money0(avgS)}</div></div><div><div class="eyebrow">Avg. kept / month</div><div class="num" style="font-size:21px">${money0(avgK)}</div></div></div><div class="legend"><span><i style="background:var(--income)"></i>Earned</span><span><i style="background:var(--spend)"></i>Spent</span></div>`;
}
// The Cash flow tile drawn as its ⚙ says: bars (cashFlow above), smooth lines, or what was kept each month
function cashFlowAs(trend: CashMonth[], style: string) {
  if (style === 'bars') return cashFlow(trend);
  const n = trend.length, months = n === 6 ? 'six' : String(n);
  if (style === 'lines') return html`<h2>Cash flow</h2><p class="lead">Earned vs. spent over the last ${months} months</p>${twoLines(trend.map(t => ({ label: t.label, a: t.income, b: t.spend, go: t.go })), ['Earned', 'Spent'], ['var(--income)', 'var(--spend)'], 'Income and spending by month', { w: window.innerWidth < 600 ? 420 : window.innerWidth >= 1700 ? 1500 : 960, h: 240 })}`;
  const full = fullMonths(trend), kept = full.reduce((s, t) => s + t.income - t.spend, 0);
  return html`<h2>Cash flow</h2><p class="lead">What you kept each month · ${money0(kept / full.length)} a month on average</p>${barChart(trend.map(t => ({ label: t.label, v: t.income - t.spend, go: t.go })), v => (v < 0 ? '−' : '') + money0(Math.abs(v)), 'Earned minus spent by month', { w: window.innerWidth < 600 ? 420 : window.innerWidth >= 1700 ? 1500 : 960, h: 220 })}`;
}
// Spending pace: where this month's running total is against the same day last month, and where it's heading
function pacePanel(cur: Period, prev: Period, now: { date: string, total: number }[], before: { date: string, total: number }[]) {
  const daysIn = (x: Period) => new Date(x.y!, x.m! + 1, 0).getDate();
  const byDay = (gs: { date: string, total: number }[], n: number) => { const v = Array(n).fill(0); gs.forEach(g => { const d = +String(g.date).slice(8, 10); if (d >= 1 && d <= n) v[d - 1] += g.total; }); return v; };
  const dim = daysIn(cur), t = todayIso(), sofar = cur.start.slice(0, 7) === t.slice(0, 7) ? +t.slice(8, 10) : t < cur.start ? 0 : dim;
  const inMonth = (m: Period) => before.filter(g => String(g.date).slice(0, 7) === m.start.slice(0, 7)), older = [2, 3].map(k => monthRange(cur.y!, cur.m! - k));
  const a = byDay(now, dim).slice(0, sofar), b = byDay(inMonth(prev), daysIn(prev)), past = [b, ...older.map(m => byDay(inMonth(m), daysIn(m)))];
  const spent = a.reduce((s, v) => s + v, 0), then = b.slice(0, sofar).reduce((s, v) => s + v, 0), d = spent - then;
  const range = monthEnd(spent, sofar, dim, past), ahead = range ? range.mid : paceForecast(spent, sofar, dim, b);
  // A likely range once there are 3 months to judge by; before that it is an early guess
  const spread = range && !range.low && range.hi - range.lo >= 1 ? html` <span class="sub-s" title="Based on how this method did on your last ${range.months} months">(likely ${money0(range.lo)}–${money0(range.hi)})</span>` : range && range.low ? html` <span class="sub-s" title="Only ${range.months} past month${range.months === 1 ? '' : 's'} to go on">(early guess)</span>` : '';
  const line = !sofar ? 'This month hasn’t started yet.' : !then ? html`<strong class="num">${money0(spent)}</strong> spent so far${ahead ? html` · heading for about <strong class="num">${money0(ahead)}</strong>` : ''}` :
    html`<strong class="num">${money0(spent)}</strong> by day ${sofar}: <span class="${d > 0 ? 'up' : 'down'}">${money0(Math.abs(d))} ${d > 0 ? 'more' : 'less'}</span> than by this day last month${ahead ? html` · heading for about <strong class="num">${money0(ahead)}</strong>${spread}` : ''}`;
  return html`<section class="panel chart"><h2>Spending pace</h2><p class="lead">${line}</p>${sofar ? paceChart(a, b, dim, [cur.short, prev.short], d => { const iso = cur.start.slice(0, 8) + pad(d); return txHref({ type: 'withdrawal' }, { start: iso, end: iso }); }) : ''}</section>`;
}
// Savings rate: the share of each month's income you kept
function savingsRate(trend: CashMonth[]) {
  const pts = trend.map(t => ({ label: t.label, v: t.income > 0 ? Math.round((t.income - t.spend) / t.income * 100) : null, go: t.go, part: !!t.end && !!t.start && t.start <= todayIso() && t.end >= todayIso() }));
  const fm = fullMonths(trend), all = pts.filter(p => p.v != null) as { v: number }[], part = pts.filter((p, i) => p.v != null && fm.includes(trend[i])) as { v: number }[], got = part.length ? part : all, avg = got.length ? Math.round(got.reduce((s, p) => s + p.v, 0) / got.length) : 0;
  return html`<h2>Savings rate</h2><p class="lead">${got.length ? html`How much of each month’s income you kept · <strong>${avg}%</strong> on average` : 'Shows up once income is recorded'}</p>${got.length ? barChart(pts, v => v + '%', 'Share of income kept each month') : ''}`;
}
// Category trends: the biggest categories over the chart's months, this month against their usual
function trendsPanel(labels: string[], months: ApiData[][], ranges: Period[]) {
  const by = new Map<string, { id?: string, v: number[] }>();
  months.forEach((cs, i) => arr(cs).forEach(c => { const r = by.get(c.name) || { id: c.id, v: Array(months.length).fill(0) }; r.v[i] += absDiff(c); by.set(c.name, r); }));
  const top = [...by.entries()].map(([name, r]) => ({ name, ...r, sum: r.v.reduce((s, x) => s + x, 0) })).filter(r => r.sum > 0).sort((a, b) => b.sum - a.sum).slice(0, 6);
  const max = Math.max(1, ...top.flatMap(r => r.v));
  const rows = htmlList(top.map(r => {
    const now = r.v[r.v.length - 1], past = r.v.slice(0, -1), usual = past.length ? past.reduce((s, x) => s + x, 0) / past.length : 0, d = usual ? (now - usual) / usual * 100 : 0;
    const name = r.id ? html`<a href="#/transactions?category=${r.id}" style="text-decoration:none">${r.name}</a>` : r.name;
    return html`<div class="trend-row"><span class="name">${name}<span class="sub-s">${usual ? html`<span class="${d > 0 ? 'up' : 'down'}">${Math.abs(d) < 5 ? 'about usual' : Math.round(Math.abs(d)) + '% ' + (d > 0 ? 'above' : 'below') + ' usual'}</span>` : 'new'}</span></span>${sparkBars(r.v, max, r.v.map((v, i) => labels[i] + ' · ' + money0(v)), r.id ? ranges.map(mo => txHref({ category: r.id }, mo)) : undefined)}<span class="num">${money0(now)}</span></div>`;
  }));
  return html`<section class="panel"><h2>Category trends</h2><p class="lead">Your biggest categories, ${labels[0]} to ${labels[labels.length - 1]}</p>${rows ? html`<div class="trends">${rows}</div>` : html`<p class="empty">No spending recorded yet.</p>`}</section>`;
}
// Each budget as a ring of how much of it is used, and what's left
function budgetsMini(budgets: ApiData[], limits: Record<string, BudgetLimit>, all: boolean, unset = true, cur: Period | null = null) {
  const rows = htmlList(budgets.filter(b => b.attributes.active !== false && (unset || all || limits[String(b.id)])).map(b => {
    const spent = Math.abs((b.attributes.spent || []).reduce((s: number, x: ApiData) => s + num(x.sum), 0)), lim = limits[String(b.id)];
    const pct = lim && lim.amount ? spent / lim.amount * 100 : 0, cls = !lim ? '' : pct > 100 ? 'over' : pct >= budgetAlert() ? 'warn' : 'good';
    const sub = lim ? pct > 100 ? html`<span class="up">${money0(spent - lim.amount)} over</span>` : html`${money0(lim.amount - spent)} left` : html`${money0(spent)} spent`;
    return html`<a class="bring" href="#/transactions?budget=${b.id}">${ring(pct, cls, '', lim ? '' : '–')}<span class="name">${b.attributes.name}</span><span class="sub-s num">${sub}</span></a>`;
  }));
  // How many are running ahead of their month (the Budgets page has each one's history and pace)
  const t = todayIso(), ahead = !cur ? 0 : budgets.filter(b => {
    const lim = limits[String(b.id)], spent = Math.abs((b.attributes.spent || []).reduce((s: number, x: ApiData) => s + num(x.sum), 0)), p = b.attributes.active !== false && lim ? budgetPace(spent, lim.amount, cur.start, cur.end, t, budgetAlert()) : null;
    return p && (p.tone === 'warn' || p.tone === 'over');
  }).length;
  return html`<section class="panel"><div class="panel-head"><h2>Budgets</h2><a class="link" href="#/budgets">Insights</a></div><p class="lead">${all ? 'Spent of all time' : 'This month'}${ahead ? html` · <span class="up">${ahead} over or near limit</span>` : ''}</p>${rows ? html`<div class="brings">${rows}</div>` : html`<p class="empty">No budgets yet.</p>`}</section>`;
}
// Where the money went by who was paid (Firefly's expense accounts), against last month
function payeesPanel(now: ApiData[], prev: ApiData[], future: boolean, all: boolean, count = 8, compare = true) {
  const before = Object.fromEntries(prev.map(x => [String(x.id), absDiff(x)]));
  const rows = now.map(x => ({ id: String(x.id), name: x.name, amt: absDiff(x), prev: before[String(x.id)] || 0 })).filter(x => x.amt > 0);
  const total = rows.reduce((t, x) => t + x.amt, 0);
  const items = rows.map(x => {
    const d = x.amt - x.prev;
    const vs = all || !compare ? '' : !x.prev ? ' · new' : Math.abs(d) < 1 ? ' · same' : html` · <span class="${d > 0 ? 'up' : 'down'}">${money0(Math.abs(d))} ${d > 0 ? 'more' : 'less'}</span>`;
    return { name: x.name, v: x.amt, href: '#/account/' + x.id, sub: html`${money0(x.amt)}${vs}` };
  });
  const chart = shareChart(items, html`<span class="eyebrow">Paid</span><strong class="num">${money0(total)}</strong>`, 'Spending by payee', { limit: count, other: 'Everyone else', ring: tileOpt('payees', 'style') !== 'bars', go: txHref({ type: 'withdrawal' }) });
  return html`<section class="panel"><h2>Top payees</h2><p class="lead">Who you paid the most ${all ? 'of all time' : 'this month'}</p>${chart || html`<p class="empty">${future ? 'This month hasn’t started yet.' : 'No spending recorded ' + (all ? 'yet.' : 'this month.')}</p>`}</section>`;
}
function incomePanel(sources: ApiData[], all: boolean) {
  const rows = sources.map(x => ({ id: String(x.id), name: x.name, v: absDiff(x) })).filter(x => x.v > 0);
  const total = rows.reduce((t, x) => t + x.v, 0);
  const chart = shareChart(rows.map(x => ({ name: x.name, v: x.v, href: '#/account/' + x.id, sub: money(x.v) })), html`<span class="eyebrow">Earned</span><strong class="num">${money0(total)}</strong>`, 'Income by source', { go: txHref({ type: 'deposit' }) });
  return html`<section class="panel"><h2>Income sources</h2><p class="lead">Where your money came from ${all ? 'of all time' : 'this month'}</p>${chart || html`<p class="empty">No income recorded ${all ? 'yet.' : 'this month.'}</p>`}</section>`;
}
function goalsPanel(piggies: Piggy[], done = true) {
  const live = (piggies || []).filter(p => p.active && p.target > 0 && (done || p.current < p.target));
  if (!live.length) return '';
  S.piggyCache = { ...S.piggyCache, ...Object.fromEntries(live.map(p => [p.id, p])) };      // for Add money
  const rows = htmlList(live.sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999')).map(p => {
    const pct = Math.min(100, p.current / p.target * 100), pace = paceBits(p);
    return html`<div class="cat"><div class="row"><span class="name">${p.name} ${pace.chip}</span><span class="num">${money0(p.current)} <span class="neutral">of ${money0(p.target)}</span></span></div><div class="track"><div class="fill good" style="width:${pct.toFixed(1)}%"></div></div><div class="sub" style="display:flex;gap:8px;align-items:baseline"><span>${pct.toFixed(0)}% saved · ${pace.line}</span>${p.left > 0 ? html`<button class="link" style="margin-left:auto;flex:none" data-onclick="App.piggyMoney('${p.id}',1)">+ Add</button>` : ''}</div></div>`;
  }));
  return html`<section class="panel"><div class="panel-head"><h2>Savings goals</h2><a class="link" href="#/piggy">All goals</a></div><p class="lead">Piggy bank progress</p><div class="goal-rows">${rows}</div></section>`;
}
function billsMini(bills: ApiData[], days = 45, max = 0) {
  // A bill with no due date in the window falls back to Firefly's "next expected" date, which can be months
  // away, so only keep dates that really fall within the days this card is about (45 at most: what's fetched).
  const t = todayIso(), end = addDays(t, Math.min(45, days));
  const up = bills.filter(b => b.attributes.active !== false).map(b => ({ b, next: billDueDates(b.attributes)[0] || String(b.attributes.next_expected_match || '').slice(0, 10) }))
    .filter(x => x.next && x.next <= end).sort((a, b) => a.next.localeCompare(b.next));
  S.billCache = { ...S.billCache, ...Object.fromEntries(up.map(x => [String(x.b.id), x.b.attributes])) };      // for Pay now
  const more = max && up.length > max ? up.length - max : 0;      // (the tile shows the first few, All bills the rest)
  const rows = htmlList(up.slice(0, more ? max - 1 : undefined).map(({ b, next }) => html`<div class="row"><span class="name">${b.attributes.name}<br><span class="sub-s">${next < t ? html`<span class="up">Overdue since ${fmtDate(next)}</span>` : 'Due ' + fmtDate(next)}</span></span><span class="bill-end"><span class="num">${money(billAmount(b.attributes))}</span>${!(b.attributes.paid_dates || []).length ? html`<button class="btn small primary" data-onclick="App.billPay('${b.id}')">Pay now</button>` : ''}</span></div>`));
  return html`<section class="panel"><div class="panel-head"><h2>Coming up</h2><a class="link" href="#/bills">All bills</a></div><p class="lead">Bills due in the next ${Math.min(45, days)} days</p>${rows ? html`<div class="list">${rows}${more ? html`<a class="row more" href="#/bills"><span class="name">${more + 1} more</span><span class="neutral">→</span></a>` : ''}</div>` : html`<p class="empty">Nothing due soon.</p>`}</section>`;
}

function attMore(b: HTMLElement) {
  const m = b.closest('.attention')!.querySelector<HTMLElement>('.att-more'); if (!m) return;
  m.hidden = !m.hidden; b.textContent = m.hidden ? m.children.length + ' more' : 'Fewer';
}
// The Activity range chips: redraw only that card from its own data (the page, scroll and other cards stay as they are)
let actTok = 0;
async function activityRedraw(): Promise<boolean> {
  const sec = document.querySelector<HTMLElement>('#dash .w[data-w="activity"] > section.panel'); if (!sec) return false;
  const tok = ++actTok, range = String(tileOpt('activity', 'range') || 'year'), t0 = todayIso();
  const a0 = range === 'all' ? ALL_START : activityRange(range, t0, '').start;
  const tx = await Promise.all([getAll('/transactions', { start: a0, end: t0, type: 'withdrawal' }), refundsIn(a0, t0).catch(() => [])]).then(([x, rs]) => lessRefundTx(x, rs)).catch(() => null);
  if (tok !== actTok) return true;      // a newer chip press owns the card now
  if (!sec.isConnected) return false;
  const tpl = document.createElement('template'); tpl.innerHTML = String(activityTile(tx, range, t0));
  const next = tpl.content.firstElementChild; if (!next) return false;
  sec.replaceWith(next);
  return true;
}
// The Net worth range chips: same idea. The tile keeps its size (the line becomes a same-height placeholder while the
// history loads) and shows nothing for the line if Firefly doesn't answer; the rest of the page and the scroll stay put.
let nwTok = 0;
async function nwRedraw(): Promise<boolean> {
  const sec = document.querySelector<HTMLElement>('#dash .w[data-w="networth"] > section.panel'); if (!sec) return false;
  const big = sec.querySelector<HTMLElement>('.big'); if (!big) return false;
  const value = +(big.dataset.count || 0), tok = ++nwTok;
  const swap = (pts: NetWorthPoint[] | null | undefined) => {
    const tpl = document.createElement('template'); tpl.innerHTML = String(networthTile(value, pts));
    const next = tpl.content.firstElementChild; if (!next || !sec.isConnected) return false;
    sec.replaceWith(next); return true;
  };
  if (!swap(undefined)) return false;
  const pts = await App.netWorthHistory().catch(() => null);
  if (tok !== nwTok) return true;
  const now = document.querySelector<HTMLElement>('#dash .w[data-w="networth"] > section.panel'); if (!now) return false;
  const tpl = document.createElement('template'); tpl.innerHTML = String(networthTile(value, pts));
  const next = tpl.content.firstElementChild; if (!next) return false;
  now.replaceWith(next);
  return true;
}
const methods = { attMore, activityRedraw, nwRedraw };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

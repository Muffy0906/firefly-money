import { Html, html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, S, absDiff, arr, fmtDay, money, money0, monthRange, nowMonth, sumDiff, todayIso } from '../core/base';
import { head, monthNav } from '../core/dom';
import { nameAvatar, normGroup } from '../core/feed';
import { addDays } from '../core/helpers';
import { isAsset, isLiab, lists, normAccount } from '../core/lists';
import { VIEWS } from '../core/router';
import { billDays } from './bills';
import { insight, refundsIn } from '../features/refunds';
import { shareChart } from '../features/charts';

/* ================= Monthly recap =================
   One month in review: what came in and went out against last month and the three before it, where the money
   went, the biggest purchases, payees that are new, bills, and how much your net worth moved. */
const delta = (now: number, then: number, up = 'up') => {
  if (!then) return '';
  const d = now - then, pct = Math.round(d / then * 100);
  if (Math.abs(pct) < 3) return html`<span class="neutral">about the same as usual</span>`;
  return html`<span class="${(d > 0) === (up === 'up') ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${money0(Math.abs(d))} (${pct > 0 ? '+' : ''}${pct}%)</span> vs usual`;
};
// The month's own accounts on a day, summed: assets minus debts (Firefly keeps liabilities as negative balances)
async function netOn(date: string) {
  const [as, ls] = await Promise.all([getAll('/accounts', { type: 'asset', date }), getAll('/accounts', { type: 'liabilities', date })]);
  const byId = new Map([...as, ...ls].map(a => [String(a.id), normAccount(a)]));
  return [...byId.values()].filter(a => a.active && a.netWorth && (isAsset(a) || isLiab(a))).reduce((s, a) => s + a.balance, 0);
}
// Open the recap of the month before the one picked (from the Overview in the first days of a month)
function recapLast() { S.all = false; const [y, m] = nowMonth(), d = new Date(y, m - 1, 1); S.y = d.getFullYear(); S.m = d.getMonth(); location.hash = '#/recap'; }
// The methods markup handlers call (see events.ts), added to App and to its type
const methods = { recapLast };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

VIEWS.recap = async (r, paint) => {
  await lists();
  // All time has no single month to recap, so it shows this month
  const cur = S.all ? monthRange(...nowMonth()) : monthRange(S.y, S.m), t = todayIso();
  if (cur.start > t) return paint(html`${head('Recap', cur.label, monthNav())}<section class="panel"><div class="center-empty">${cur.label} hasn’t started yet. Come back at the end of the month.</div></section>`);
  const soFar = cur.end >= t, end = soFar ? t : cur.end;
  const p = { start: cur.start, end }, before = { start: monthRange(cur.y, cur.m - 3).start, end: monthRange(cur.y, cur.m - 1).end };
  const year = { start: monthRange(cur.y, cur.m - 12).start, end: addDays(cur.start, -1) };
  const rs = refundsIn(year.start < before.start ? year.start : before.start, p.end);     // refunds for all three ranges, in one request
  const g = (path: string, params: { start: string, end: string }) => insight(path, params, rs).catch(() => []);
  const [inc, exp, inc3, exp3, cats, cats3, noCat, noCat3, payees, payees12, spends, bills, nwStart, nwEnd] = await Promise.all([
    g('/insight/income/total', p), g('/insight/expense/total', p), g('/insight/income/total', before), g('/insight/expense/total', before),
    g('/insight/expense/category', p), g('/insight/expense/category', before), g('/insight/expense/no-category', p), g('/insight/expense/no-category', before),
    g('/insight/expense/expense', p), g('/insight/expense/expense', year),
    getAll('/transactions', { start: p.start, end: p.end, type: 'withdrawal' }).catch(() => []),
    getAll('/bills', { start: cur.start, end: cur.end }).catch(() => []),
    netOn(addDays(cur.start, -1)).catch(() => null), netOn(end).catch(() => null),
  ]);
  // "Usual" is the average of the three months before, scaled to the same number of days when the month isn't over.
  // Income isn't compared until the month is over: paydays come in lumps, so half a month says little.
  const days = +end.slice(8, 10), dim = +cur.end.slice(8, 10), scale = days / dim / 3;
  const earned = sumDiff(inc), spent = sumDiff(exp), kept = earned - spent, rate = earned ? kept / earned : 0;
  const usualIn = sumDiff(inc3) * scale, usualOut = sumDiff(exp3) * scale;
  const nw = nwStart != null && nwEnd != null ? nwEnd - nwStart : null;

  // Categories: this month against usual, biggest first, with the change that stands out most
  const usualCat = new Map<string, number>();
  arr(cats3).forEach(x => usualCat.set(x.name, (usualCat.get(x.name) || 0) + absDiff(x) * scale));
  const catRows = arr(cats).map(x => ({ id: x.id, name: x.name, v: absDiff(x) })).concat(sumDiff(noCat) ? [{ id: '', name: 'Uncategorized', v: sumDiff(noCat) }] : [])
    .filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (sumDiff(noCat3)) usualCat.set('Uncategorized', sumDiff(noCat3) * scale);
  const catHtml = shareChart(catRows.map(x => {
    const u = usualCat.get(x.name) || 0, d = x.v - u, big = Math.abs(d) >= 20 && (!u || Math.abs(d) / u >= 0.15);
    const vs = !u ? ' · new' : big ? html` · <span class="${d > 0 ? 'up' : 'down'}">${money0(Math.abs(d))} ${d > 0 ? 'over' : 'under'}</span>` : ' · usual';
    return { name: x.name, v: x.v, href: x.id ? '#/transactions?category=' + x.id : undefined, sub: html`${money0(x.v)}${vs}` };
  }), html`<span class="eyebrow">Spent</span><strong class="num">${money0(spent)}</strong>`, 'Spending by category', { limit: 8 });

  // Biggest single purchases, and the day you spent the most
  const splits = spends.map(normGroup).flatMap(gr => gr.splits.filter(s => s.type === 'withdrawal').map(s => ({ ...s, gid: gr.id })));
  const top = [...splits].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const byDay = new Map<string, number>(); splits.forEach(s => { const d = String(s.date).slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + s.amount); });
  const bigDay = [...byDay].sort((a, b) => b[1] - a[1])[0];
  const topHtml = htmlList(top.map(s => html`<button type="button" class="row recap-row" data-onclick="App.editTx('${s.gid}')"><span class="name" style="display:flex;gap:10px;align-items:center">${nameAvatar(s.destination_name || s.description, 'sm')}<span>${s.description}<br><span class="sub-s">${fmtDay(s.date)}${s.category ? ' · ' + s.category : ''}</span></span></span><span class="num">${money(s.amount)}</span></button>`));

  // Payees you paid this month and not once in the twelve months before
  const seen = new Set(arr(payees12).map(x => String(x.id)));
  const fresh = arr(payees).filter(x => !seen.has(String(x.id)) && absDiff(x) > 0).sort((a, b) => absDiff(b) - absDiff(a));
  const freshHtml = htmlList(fresh.slice(0, 6).map(x => html`<a class="row" href="#/account/${x.id}"><span class="name" style="display:flex;gap:10px;align-items:center">${nameAvatar(x.name, 'sm')}${x.name}</span><span class="num">${money(absDiff(x))}</span></a>`));

  const { days: billOn, sum: billSum } = billDays(bills, t);
  const billList = Object.values<any>(billOn).flat(), late = billList.filter(x => x.state === 'late');

  // A few plain sentences up top
  const notes: Html[] = [];
  if (earned) notes.push(kept >= 0 ? html`You kept <strong>${Math.round(rate * 100)}%</strong> of what came in (${money0(kept)}).` : html`You spent <strong>${money0(-kept)} more</strong> than came in.`);
  const mover = catRows.map(x => ({ ...x, d: x.v - (usualCat.get(x.name) || 0) })).filter(x => usualCat.get(x.name)).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  if (mover && Math.abs(mover.d) >= 25) notes.push(html`${mover.name} was <strong>${money0(Math.abs(mover.d))} ${mover.d > 0 ? 'above' : 'below'}</strong> usual.`);
  if (bigDay) notes.push(html`Your biggest day was ${fmtDay(bigDay[0])}: ${money0(bigDay[1])}.`);
  if (fresh.length) notes.push(html`${fresh.length} new payee${fresh.length === 1 ? '' : 's'}, starting with ${fresh[0].name}.`);
  if (late.length) notes.push(html`<span class="up">${late.length} bill${late.length === 1 ? ' is' : 's are'} overdue.</span>`);

  const kpi = (label: string, v: unknown, sub: unknown, cls = '') => html`<div class="kpi"><div class="eyebrow">${label}</div><div class="val num ${cls}">${v}</div><div class="sub-s">${sub}</div></div>`;
  paint(html`${head(cur.label + ' recap', soFar ? 'So far, up to ' + fmtDay(end) : 'The month in review', monthNav())}${notes.length ? html`<section class="panel recap-notes"><ul>${htmlList(notes.map(n => html`<li>${n}</li>`))}</ul></section>` : ''}<div class="kpis">${kpi('Earned', money0(earned), soFar ? (sumDiff(inc3) ? 'usually ' + money0(sumDiff(inc3) / 3) + ' a month' : '') : delta(earned, usualIn, 'down'), 'pos')}${kpi('Spent', money0(spent), delta(spent, usualOut), 'neg')}${kpi('Kept', money0(kept), earned ? Math.round(rate * 100) + '% of income' : '', kept < 0 ? 'neg' : '')}${nw != null ? kpi('Net worth', (nw > 0 ? '+' : '') + money0(nw), 'change over the month', nw < 0 ? 'neg' : 'pos') : ''}</div><div class="cards"><section class="panel"><div class="panel-head"><h2>Where it went</h2><a class="link" href="#/categories">Categories</a></div><p class="lead">Each category against a usual month${soFar ? ' up to the same day' : ''}</p>${catHtml || html`<p class="empty">Nothing spent yet.</p>`}</section><section class="panel"><h2>Biggest purchases</h2><p class="lead">${splits.length} purchase${splits.length === 1 ? '' : 's'} in all</p>${topHtml ? html`<div class="list">${topHtml}</div>` : html`<p class="empty">No purchases.</p>`}</section><section class="panel"><h2>New payees</h2><p class="lead">Paid this month and not in the year before</p>${freshHtml ? html`<div class="list">${freshHtml}</div>` : html`<p class="empty">No new payees. Same places as always.</p>`}</section><section class="panel"><div class="panel-head"><h2>Bills</h2><a class="link" href="#/bills?view=calendar">Calendar</a></div>${billList.length ? html`<p class="lead">${billList.filter(x => x.state === 'paid').length} of ${billList.length} paid</p><div class="list"><div class="row"><span class="name">Paid</span><span class="num pos">${money0(billSum.paid)}</span></div><div class="row"><span class="name">Still due</span><span class="num">${money0(billSum.due)}</span></div>${late.length ? html`<div class="row"><span class="name">Overdue: ${late.map(x => x.name).join(', ')}</span><span class="num neg">${money0(billSum.late)}</span></div>` : ''}</div>` : html`<p class="empty">No bills due this month.</p>`}</section></div>`);
};

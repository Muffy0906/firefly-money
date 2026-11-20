import { Html, html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, S, absDiff, arr, fmtDay, money, money0, monthRange, nowMonth, sumDiff, todayIso, txHref, noneHref } from '../core/base';
import { closeDrawer, head, monthNav, openDrawer } from '../core/dom';
import { t as tr } from '../core/spanish';
import { nameAvatar, normGroup } from '../core/feed';
import { LS, addDays, daysBetween } from '../core/helpers';
import { isAsset, isLiab, lists, normAccount } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { billDays } from './bills';
import { insight, refundsIn } from '../features/refunds';
import { barChart, shareChart } from '../features/charts';
import { customizeButton, pageCard, pageOpt } from '../features/pageopts';

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
export async function netOn(date: string) {
  const [as, ls] = await Promise.all([getAll('/accounts', { type: 'asset', date }), getAll('/accounts', { type: 'liabilities', date })]);
  const byId = new Map([...as, ...ls].map(a => [String(a.id), normAccount(a)]));
  return [...byId.values()].filter(a => a.active && a.netWorth && (isAsset(a) || isLiab(a))).reduce((s, a) => s + a.balance, 0);
}
// Open the recap of the month before the one picked (from the Overview in the first days of a month)
function recapLast() { S.all = false; const [y, m] = nowMonth(), d = new Date(y, m - 1, 1); S.y = d.getFullYear(); S.m = d.getMonth(); location.hash = '#/recap'; }
// The methods markup handlers call (see events.ts), added to App and to its type
// Income sources picked for the first card ("Money in" counts every deposit; picking only your pay shows what it really is). Saved on this device; none picked = every deposit.
const pickedSources = (): string[] => (LS.get('recapSources', []) as unknown[]).map(String);
async function recapSources() {
  const L = await lists(), on = new Set(pickedSources());
  openDrawer('Income to count', html`<form id="srcForm" data-onsubmit="event.preventDefault();App.recapSourcesSave(this)"><p class="sub-s" style="margin:0 0 12px">Pick the sources that are your pay. The first card on Recap then counts only those; Kept and everything else still use all deposits. Pick none to count every deposit.</p>${htmlList(L.revenue.map(a => html`<label class="check"><input type="checkbox" name="src" value="${a.id}"${on.has(a.id) ? ' checked' : ''}> ${a.name}</label>`))}${L.revenue.length ? '' : html`<p class="empty">No income sources yet.</p>`}</form>`,
    html`<span class="grow"></span><button type="button" class="btn" data-onclick="App.closeDrawer()">Cancel</button><button type="button" class="btn primary" data-onclick="App.submit('srcForm')">Save</button>`);
}
function recapSourcesSave(f: HTMLFormElement) {
  LS.set('recapSources', [...f.querySelectorAll<HTMLInputElement>('input[name=src]:checked')].map(b => b.value));
  closeDrawer(); route();
}
const methods = { recapLast, recapSources, recapSourcesSave };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

VIEWS.recap = async (r, paint) => {
  await lists();
  // All time has no single month to recap, so it shows this month
  const cur = S.all ? monthRange(...nowMonth()) : monthRange(S.y, S.m), t = todayIso();
  if (cur.start > t) return paint(html`${head('Recap', tr('{period} has not started yet', { period: cur.label }), monthNav())}<section class="panel"><div class="center-empty">${tr('{period} has not started yet. Come back at the end of the month.', { period: cur.label })}</div></section>`);
  const soFar = cur.end >= t, end = soFar ? t : cur.end;
  const p = { start: cur.start, end }, k = pageOpt('recap', 'usual') as number, before = { start: monthRange(cur.y, cur.m - k).start, end: monthRange(cur.y, cur.m - 1).end };
  const year = { start: monthRange(cur.y, cur.m - 12).start, end: addDays(cur.start, -1) };
  const rs = refundsIn(year.start < before.start ? year.start : before.start, p.end);     // refunds for all three ranges, in one request
  const g = (path: string, params: { start: string, end: string }) => insight(path, params, rs).catch(() => []);
  // "Usual" for a month still under way is the same point in each earlier month (as the Overview does), not the whole months spread evenly:
  // rent paid on the 1st would look like overspending otherwise. A finished month is set against the whole earlier months.
  const days = daysBetween(cur.start, end) + 1, dim = daysBetween(cur.start, cur.end) + 1;
  const wins = soFar ? Array.from({ length: k }, (_, i) => { const m = monthRange(cur.y, cur.m - 1 - i), e = addDays(m.start, days - 1); return { start: m.start, end: e < m.end ? e : m.end }; }) : [before];
  const picked = new Set(pickedSources());
  const [inc, exp, inc3, cats, noCat, payees, payees12, spends, bills, nwStart, nwEnd, ...hist] = await Promise.all([
    g('/insight/income/total', p), g('/insight/expense/total', p), g('/insight/income/total', before),
    g('/insight/expense/category', p), g('/insight/expense/no-category', p),
    g('/insight/expense/expense', p), g('/insight/expense/expense', year),
    getAll('/transactions', { start: p.start, end: p.end, type: 'withdrawal' }).catch(() => []),
    getAll('/bills', { start: cur.start, end: cur.end }).catch(() => []),
    netOn(addDays(cur.start, -1)).catch(() => null), netOn(end).catch(() => null),
    ...wins.flatMap(w => [g('/insight/expense/category', w), g('/insight/expense/no-category', w)]),
  ]);
  const [pay, pay3] = picked.size ? await Promise.all([g('/insight/income/revenue', p), g('/insight/income/revenue', before)]) : [[], []];
  const fromPicked = (res: any) => arr(res).filter(x => picked.has(String(x.id))).reduce((a, x) => a + absDiff(x), 0);
  // "Usual" is the average of the months before (three unless Customize says otherwise); months with no spending don't pull it down.
  // Income isn't compared until the month is over: paydays come in lumps, so half a month says little.
  const past = wins.map((_, i) => ({ cats: arr(hist[2 * i]), none: sumDiff(hist[2 * i + 1]) })).map(h => ({ ...h, total: h.cats.reduce((a, x) => a + absDiff(x), 0) + h.none }));
  const div = soFar ? Math.max(1, past.filter(h => h.total > 0).length) : k;
  const earned = sumDiff(inc), spent = sumDiff(exp), kept = earned - spent, rate = earned ? kept / earned : 0;
  const usualIn = sumDiff(inc3) / k, usualOut = past.reduce((a, h) => a + h.total, 0) / div;
  const nw = nwStart != null && nwEnd != null ? nwEnd - nwStart : null;

  // Categories: this month against usual, biggest first, with the change that stands out most
  const usualCat = new Map<string, number>();
  past.forEach(h => h.cats.forEach(x => usualCat.set(x.name, (usualCat.get(x.name) || 0) + absDiff(x) / div)));
  const catRows = arr(cats).map(x => ({ id: x.id, name: x.name, v: absDiff(x) })).concat(sumDiff(noCat) ? [{ id: '', name: 'Uncategorized', v: sumDiff(noCat) }] : [])
    .filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const usualNone = past.reduce((a, h) => a + h.none, 0) / div;
  if (usualNone) usualCat.set('Uncategorized', usualNone);
  const catHtml = shareChart(catRows.map(x => {
    const u = usualCat.get(x.name) || 0, d = x.v - u, big = Math.abs(d) >= 20 && (!u || Math.abs(d) / u >= 0.15);
    const vs = !u ? ' · new' : big ? html` · <span class="${d > 0 ? 'up' : 'down'}">${money0(Math.abs(d))} ${d > 0 ? 'over' : 'under'}</span>` : ' · usual';
    return { name: x.name, v: x.v, href: x.id ? '#/transactions?category=' + x.id : x.name === 'Uncategorized' ? noneHref('category', cur) : undefined, sub: html`${money0(x.v)}${vs}` };
  }), html`<span class="eyebrow">Spent</span><strong class="num">${money0(spent)}</strong>`, 'Spending by category', { limit: 8, ring: pageOpt('recap', 'share') !== 'bars', go: txHref({ type: 'withdrawal' }) });

  // Biggest single purchases, and the day you spent the most
  const splits = spends.map(normGroup).flatMap(gr => gr.splits.filter(s => s.type === 'withdrawal').map(s => ({ ...s, gid: gr.id })));
  const top = [...splits].sort((a, b) => b.amount - a.amount).slice(0, pageOpt('recap', 'top'));
  const byDay = new Map<string, number>(); splits.forEach(s => { const d = String(s.date).slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + s.amount); });
  const bigDay = [...byDay].sort((a, b) => b[1] - a[1])[0];
  const topHtml = htmlList(top.map(s => html`<button type="button" class="row recap-row" data-onclick="App.editTx('${s.gid}')"><span class="name" style="display:flex;gap:10px;align-items:center">${nameAvatar(s.destination_name || s.description, 'sm')}<span>${s.description}<br><span class="sub-s">${fmtDay(s.date)}${s.category ? ' · ' + s.category : ''}</span></span></span><span class="num">${money(s.amount)}</span></button>`));

  // Payees you paid this month and not once in the twelve months before
  const seen = new Set(arr(payees12).map(x => String(x.id)));
  const fresh = arr(payees).filter(x => !seen.has(String(x.id)) && absDiff(x) > 0).sort((a, b) => absDiff(b) - absDiff(a));
  const freshHtml = htmlList(fresh.slice(0, 6).map(x => html`<a class="row" href="#/account/${x.id}"><span class="name" style="display:flex;gap:10px;align-items:center">${nameAvatar(x.name, 'sm')}${x.name}</span><span class="num">${money(absDiff(x))}</span></a>`));

  // What went out each week of the month, counted from the day it starts (the last one runs to the month's end)
  const wk = [0, 7, 14, 21, 28].filter(o => o < dim).map((o, i, l) => ({ from: o, to: (l[i + 1] ?? dim) - 1, v: 0 }));
  splits.forEach(s => { const o = daysBetween(cur.start, String(s.date).slice(0, 10)), w = wk.find(x => o >= x.from && o <= x.to); if (w) w.v += s.amount; });
  const dayN = (o: number) => +addDays(cur.start, o).slice(8, 10), mon = (o: number) => fmtDay(addDays(cur.start, o)).replace(/\s*\d+$/, '');
  const weeksHtml = splits.length ? barChart(wk.filter(w => w.from < days).map(w => ({ label: mon(w.from) + ' ' + dayN(w.from) + '–' + (mon(w.to) === mon(w.from) ? '' : mon(w.to) + ' ') + dayN(w.to), v: w.v, go: txHref({ type: 'withdrawal' }, { start: addDays(cur.start, w.from), end: addDays(cur.start, w.to) }) })), v => money0(v), 'Spending by week', { w: 380, h: 190 }) : '';
  const { days: billOn, sum: billSum } = billDays(bills, t, cur);
  const billList = Object.values<any>(billOn).flat(), late = billList.filter(x => x.state === 'late');

  // A few plain sentences up top
  const notes: Html[] = [];
  if (earned) notes.push(kept >= 0 ? html`${tr('You kept {percentage}% of what came in ({amount}).', { percentage: Math.round(rate * 100), amount: money0(kept) })}` : html`${tr('You spent {amount} more than came in.', { amount: money0(-kept) })}`);
  const mover = catRows.map(x => ({ ...x, d: x.v - (usualCat.get(x.name) || 0) })).filter(x => usualCat.get(x.name)).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  if (mover && Math.abs(mover.d) >= 25) notes.push(html`${tr('{name} was {amount} {direction} usual.', { name: mover.name, amount: money0(Math.abs(mover.d)), direction: tr(mover.d > 0 ? 'above' : 'below') })}`);
  if (bigDay) notes.push(html`Your biggest day was ${fmtDay(bigDay[0])}: ${money0(bigDay[1])}.`);
  if (fresh.length) notes.push(html`${tr(fresh.length === 1 ? '1 new payee, starting with {name}.' : '{count} new payees, starting with {name}.', { count: fresh.length, name: fresh[0].name })}`);
  if (late.length) notes.push(html`<span class="up">${tr(late.length === 1 ? '1 bill is overdue.' : '{count} bills are overdue.', { count: late.length })}</span>`);

  const kpi = (label: string, v: unknown, sub: unknown, cls = '') => html`<div class="kpi"><div class="eyebrow">${label}</div><div class="val num ${cls}">${v}</div><div class="sub-s">${sub}</div></div>`;
  paint(html`${head(tr('{period} recap', { period: S.all ? tr('This month’s') : cur.label }), soFar ? tr('So far, up to {date}', { date: fmtDay(end) }) : 'The month in review', html`${monthNav()}${customizeButton('recap')}`)}${notes.length && pageCard('recap', 'notes') ? html`<section class="panel recap-notes"><ul>${htmlList(notes.map(n => html`<li>${n}</li>`))}</ul></section>` : ''}${pageCard('recap', 'kpis') ? html`<div class="kpis">${(picked.size
    ? kpi('Your pay', money0(fromPicked(pay)), html`${soFar ? (fromPicked(pay3) ? tr('usually {amount} a month · ', { amount: money0(fromPicked(pay3) / k) }) : '') : html`${delta(fromPicked(pay), fromPicked(pay3) / k, 'down')} · `}<button type="button" class="link" data-onclick="App.recapSources()">${tr(picked.size === 1 ? '1 source' : '{count} sources', { count: picked.size })}</button>`, 'pos')
    : kpi('Money in', money0(earned), html`${soFar ? (sumDiff(inc3) ? tr('usually {amount} a month, all deposits · ', { amount: money0(sumDiff(inc3) / k) }) : '') : html`${delta(earned, usualIn, 'down')} · `}<button type="button" class="link" data-onclick="App.recapSources()">Count only my pay</button>`, 'pos'))}${kpi('Spent', money0(spent), delta(spent, usualOut), 'neg')}${kpi('Kept', money0(kept), earned ? Math.round(rate * 100) + '% of income' : '', kept < 0 ? 'neg' : '')}${nw != null ? kpi('Net worth', (nw > 0 ? '+' : '') + money0(nw), 'change over the month', nw < 0 ? 'neg' : 'pos') : ''}</div>` : ''}<div class="flow" data-min="380">${pageCard('recap', 'cats') ? html`<section class="panel"><div class="panel-head"><h2>Where it went</h2><a class="link" href="#/categories">Categories</a></div><p class="lead">Each category against ${k === 1 ? 'last month' : 'a usual month'}${soFar ? ' up to the same day' : ''}</p>${catHtml || html`<p class="empty">Nothing spent yet.</p>`}</section>` : ''}${pageCard('recap', 'weeks') ? html`<section class="panel chart"><h2>Week by week</h2><p class="lead">What you spent each week</p>${weeksHtml || html`<p class="empty">No purchases.</p>`}</section>` : ''}${pageCard('recap', 'buys') ? html`<section class="panel"><h2>Biggest purchases</h2><p class="lead">${tr(splits.length === 1 ? '1 purchase in all' : '{count} purchases in all', { count: splits.length })}</p>${topHtml ? html`<div class="list">${topHtml}</div>` : html`<p class="empty">No purchases.</p>`}</section>` : ''}${pageCard('recap', 'fresh') ? html`<section class="panel"><h2>New payees</h2><p class="lead">Paid this month and not in the year before</p>${freshHtml ? html`<div class="list">${freshHtml}</div>` : html`<p class="empty">No new payees. Same places as always.</p>`}</section>` : ''}${pageCard('recap', 'bills') ? html`<section class="panel"><div class="panel-head"><h2>Bills</h2><a class="link" href="#/bills?view=calendar">Calendar</a></div>${billList.length ? html`<p class="lead">${tr('{paid} of {total} paid', { paid: billList.filter(x => x.state === 'paid').length, total: billList.length })}</p><div class="list"><div class="row"><span class="name">Paid</span><span class="num pos">${money0(billSum.paid)}</span></div><div class="row"><span class="name">Still due</span><span class="num">${money0(billSum.due)}</span></div>${late.length ? html`<div class="row"><span class="name">${tr('Overdue: {names}', { names: late.map(x => x.name).join(', ') })}</span><span class="num neg">${money0(billSum.late)}</span></div>` : ''}</div>` : html`<p class="empty">No bills due this month.</p>`}</section>` : ''}</div>`);
};

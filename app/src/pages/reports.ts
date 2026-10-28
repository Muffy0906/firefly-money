import { html, htmlList, raw } from '../core/html';
import { getAll } from '../core/api';
import { App, absDiff, el, arr, fmtDate, fmtDay, money, money0, monthOf, monthRange, nowMonth, num, sumDiff, todayIso, type ApiData } from '../core/base';
import { head, opt, toast } from '../core/dom';
import { LS, addDays, daysBetween, saveBlob } from '../core/helpers';
import { type Account, isAsset, isLiab, lists } from '../core/lists';
import { VIEWS, hashWith, route } from '../core/router';
import { cashFlow } from './overview';
import { insight, refundsIn } from '../features/refunds';
import { SERIES, donut, twoLines, type LinePoint } from '../features/charts';
import { normGroup } from '../core/feed';

// Each account's balance on one day, from two list requests (assets, liabilities) rather than one per account.
// The net worth chart asks for the same lists, so they're often already saved.
async function balancesOn(own: Account[], date: string): Promise<(number | null)[]> {
  try {
    const [as, ls] = await Promise.all([getAll('/accounts', { type: 'asset', date }), getAll('/accounts', { type: 'liabilities', date })]);
    const by = new Map([...as, ...ls].map(x => [String(x.id), num(x.attributes.current_balance)]));
    return own.map(a => by.get(String(a.id)) ?? null);
  } catch (e) { return own.map(() => null); }
}

/* ================= Reports ================= */
function reportRange(q: Record<string, string>) {
  const [y, m] = nowMonth();
  const P: Record<string, string[]> = {
    'this-month': [monthRange(y, m).start, monthRange(y, m).end], 'last-month': [monthRange(y, m - 1).start, monthRange(y, m - 1).end],
    'last-3': [monthRange(y, m - 2).start, monthRange(y, m).end], 'this-year': [y + '-01-01', y + '-12-31'],
    'last-year': [(y - 1) + '-01-01', (y - 1) + '-12-31'], 'last-12': [monthRange(y, m - 11).start, monthRange(y, m).end],
  };
  if (q.start && q.end) return { start: q.start, end: q.end, preset: '' };
  const p = q.preset || 'this-month';
  return { start: P[p][0], end: P[p][1], preset: p };
}
// The period to compare with: the months (or the same number of days) just before, or the same dates a year earlier
export function compareRange(start: string, end: string, kind: string) {
  if (kind === 'prev') {
    const k = monthSpan(start, end);
    if (k) { const [y, m] = monthOf(new Date(start + 'T12:00:00')); return { start: monthRange(y, m - k).start, end: monthRange(y, m - 1).end }; }
    const n = daysBetween(start, end) + 1; return { start: addDays(start, -n), end: addDays(start, -1) };
  }
  if (kind === 'year') {
    const back = (d: string) => { const y = +d.slice(0, 4) - 1, md = d.slice(5) === '02-29' ? '02-28' : d.slice(5); return y + '-' + md; };
    return { start: back(start), end: back(end) };
  }
  return null;
}
// How many whole months (as Settings sets them) start..end covers, or 0 if it doesn't line up with months
export function monthSpan(start: string, end: string) {
  const [y, m] = monthOf(new Date(start + 'T12:00:00'));
  if (monthRange(y, m).start !== start) return 0;
  for (let k = 1; k <= 36; k++) { const e = monthRange(y, m + k - 1).end; if (e === end) return k; if (e > end) return 0; }
  return 0;
}
const pctChange = (now: number, was: number) => was ? Math.round((now - was) / was * 100) : null;
// "vs $1,200 · +12%": tone says whether going up is good (income) or not (spending)
function vsLine(now: number, was: number | undefined, upGood: boolean) {
  if (was == null) return '';
  const p = pctChange(now, was), up = now > was, cls = Math.abs(now - was) < 1 ? 'neutral' : up === upGood ? 'pos' : 'neg';
  return html`<div class="sub-s">vs ${money0(was)}${p != null && Math.abs(now - was) >= 1 ? html` · <span class="${cls}">${p > 0 ? '+' : ''}${p}%</span>` : ''}</div>`;
}
type ShareRow = { name: string, v: number, href?: string };
// Earned and spent through a one-month period, day by day and adding up. Taken from the transactions, then scaled so
// each line ends on the period's total (which nets refunds off spending, see refunds.ts).
async function dailyRunning(start: string, end: string): Promise<LinePoint[]> {
  const gs = (await getAll('/transactions', { start, end, type: 'all' })).map(normGroup), inc: Record<string, number> = {}, out: Record<string, number> = {};
  gs.forEach(g => { const d = String(g.date).slice(0, 10); if (g.type === 'deposit') inc[d] = (inc[d] || 0) + g.total; if (g.type === 'withdrawal') out[d] = (out[d] || 0) + g.total; });
  const last = end > todayIso() ? todayIso() : end, pts: LinePoint[] = [];
  let a = 0, b = 0;
  for (let d = start; d <= last; d = addDays(d, 1)) { a += inc[d] || 0; b += out[d] || 0; pts.push({ label: fmtDay(d), a, b }); }
  return pts;
}
function scaleTo(pts: LinePoint[], earned: number, spent: number) {
  const n = pts[pts.length - 1], ka = n && n.a ? earned / n.a : 1, kb = n && n.b ? spent / n.b : 1;
  return pts.map(p => ({ label: p.label, a: p.a * ka, b: p.b * kb }));
}
// Earned vs. spent as lines (day by day for a month, else month by month) and where the spending went as a donut
function overviewRow(pts: LinePoint[], daily: boolean, cats: ShareRow[], spent: number) {
  const top = cats.filter(c => c.v > 0).sort((a, b) => b.v - a.v), parts = top.slice(0, 5).map((c, i) => ({ name: c.name, v: c.v, color: SERIES[i] }));
  if (top.length > 5) parts.push({ name: 'Everything else', v: top.slice(5).reduce((s, c) => s + c.v, 0), color: 'var(--muted)' });
  const total = parts.reduce((s, p) => s + p.v, 0) || 1, most = Math.max(1, ...parts.map(p => p.v));
  const lines = pts.length > 1 ? html`<section class="panel chart"><h2>Earned vs. spent</h2><p class="lead">${daily ? 'Adding up day by day' : 'Month by month'} · hover the chart to compare</p>${twoLines(pts, ['Earned', 'Spent'], ['var(--income)', 'var(--spend)'], 'Earned and spent over the period')}</section>` : '';
  const ring = parts.length ? html`<section class="panel"><h2>Where it went</h2><p class="lead">Spending by category</p>${donut(parts, html`<span class="eyebrow">Spent</span><strong class="num" data-count="${spent}">${money0(spent)}</strong>`, 'Spending by category')}<div class="parts">${htmlList(parts.map(p => html`<div class="part"><i style="background:${p.color}"></i><span class="name">${p.name}</span><span class="track"><span class="fill" style="width:${(p.v / most * 100).toFixed(1)}%;background:${p.color}"></span></span><span class="num">${(p.v / total * 100).toFixed(0)}%</span></div>`))}</div></section>` : '';
  return lines || ring ? html`<div class="report-top${lines && ring ? '' : ' one'}">${lines}${ring}</div>` : '';
}
const CMP_LABEL: Record<string, string> = { prev: 'the period before', year: 'the same dates last year' };
// The report as CSV, rebuilt each time the page is drawn
let csvRows: (string | number)[][] = [];
const csvCell = (v: string | number) => typeof v === 'number' ? v.toFixed(2) : /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
export const toCsv = (rows: (string | number)[][]) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
function reportCsv() { saveBlob(new Blob([toCsv(csvRows)], { type: 'text/csv' }), 'money-report-' + todayIso() + '.csv'); }
// Saved reports: a name and the page's query (range, preset and comparison), synced like other settings
type SavedReport = { id: string, name: string, q: string };
function saveReport(f: HTMLFormElement & { n: HTMLInputElement }) {
  const name = f.n.value.trim(), q = location.hash.split('?')[1] || 'preset=this-month';
  if (!name) return;
  LS.set('savedReports', [...(LS.get('savedReports', []) as SavedReport[]).filter(s => s.name !== name), { id: Date.now().toString(36), name, q }]);
  toast('Saved “' + name + '”'); route();
}
function deleteReport(id: string) { LS.set('savedReports', (LS.get('savedReports', []) as SavedReport[]).filter(s => s.id !== id)); route(); }
const delta = (d: number, upGood: boolean) => Math.abs(d) < 1 ? html`<span class="neutral">same</span>` : html`<span class="${d > 0 === upGood ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${money0(Math.abs(d))}</span>`;
// Sections with nothing in the period, listed on one line under the others instead of each taking a card
let emptyTables: string[] = [];
const listJoin = (xs: string[]) => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs.join('');
function shareTable(title: string, rows: ShareRow[], opts: any = {}) {
  rows = rows.filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  if (!rows.length) { emptyTables.push(title); return ''; }
  const total = rows.reduce((s, r) => s + r.v, 0), top = rows.slice(0, opts.limit || 12), rest = rows.slice(opts.limit || 12);
  const prev: Map<string, number> | undefined = opts.prev;
  csvRows.push(...rows.map(r => [title, r.name, r.v, ...(prev ? [prev.get(r.name) || 0] : [])]));
  if (rest.length) top.push({ name: rest.length + ' others', v: rest.reduce((s, r) => s + r.v, 0) });
  const max = Math.max(1, ...top.map(r => r.v));
  return html`<section class="panel"><div class="panel-head"><h2>${title}</h2><span class="num">${money0(total)}</span></div><p class="lead">${opts.lead || ''}</p>${top.length ? htmlList(top.map(r => html`<div class="cat"><div class="row"><span class="name">${r.href ? html`<a href="${r.href}" style="text-decoration:none">${r.name}</a>` : r.name}</span><span class="num">${money0(r.v)} ${prev && !r.name.endsWith(' others') ? delta(r.v - (prev.get(r.name) || 0), !!opts.good) : html`<span class="neutral">${total ? (r.v / total * 100).toFixed(0) : 0}%</span>`}</span></div><div class="track"><div class="fill${opts.good ? ' good' : ''}" style="width:${(r.v / max * 100).toFixed(1)}%"></div></div></div>`))
      : ''}</section>`;
}
VIEWS.reports = async (r, paint) => {
  const L = await lists();
  const R = reportRange(r.q), p = { start: R.start, end: R.end }, cmp = r.q.cmp || '', C = compareRange(R.start, R.end, cmp);
  const saved = LS.get('savedReports', []) as SavedReport[], here = location.hash.split('?')[1] || '';
  const months: { start: string, end: string, label: string }[] = [];
  for (let [yy, mm] = monthOf(new Date(R.start + 'T12:00:00')), mr = monthRange(yy, mm); mr.start <= R.end && months.length < 36; mr = monthRange(mr.y, mr.m + 1)) {
    months.push({ start: mr.start < R.start ? R.start : mr.start, end: mr.end > R.end ? R.end : mr.end, label: mr.short + (months.length === 0 || mr.m === 0 ? ' ’' + String(mr.y).slice(2) : '') });
  }
  const own = L.accounts.filter(a => (isAsset(a) || isLiab(a)) && a.active);
  const rs = refundsIn(R.start, R.end), crs = C ? refundsIn(C.start, C.end) : undefined;     // taken off spending (see refunds.ts)
  const g = (path: string) => insight(path, p, rs).catch(() => []);
  const daily = months.length === 1;
  const [inc, exp, xfer, byCat, noCat, byBud, noBud, byTag, byPayee, bySrc, byIncCat, trend, balStart, balEnd, days] = await Promise.all([
    g('/insight/income/total'), g('/insight/expense/total'), g('/insight/transfer/total'), g('/insight/expense/category'), g('/insight/expense/no-category'),
    g('/insight/expense/budget'), g('/insight/expense/no-budget'), g('/insight/expense/tag'), g('/insight/expense/expense'), g('/insight/income/revenue'), g('/insight/income/category'),
    Promise.all(months.map(mo => Promise.all([insight('/insight/income/total', mo, rs).catch(() => []), insight('/insight/expense/total', mo, rs).catch(() => [])])
      .then(([i, e]) => ({ label: mo.label, income: sumDiff(i), spend: sumDiff(e), go: 'report:' + mo.start + ':' + mo.end })))),
    balancesOn(own, addDays(R.start, -1)), balancesOn(own, R.end > todayIso() ? todayIso() : R.end),
    daily && R.start <= todayIso() ? dailyRunning(R.start, R.end).catch(() => []) : Promise.resolve([]),
  ]);
  // The comparison period's totals and breakdowns, by name
  const gc = (path: string) => C ? insight(path, C, crs).catch(() => []) : Promise.resolve(null);
  const [cInc, cExp, cCat, cNoCat, cBud, cNoBud, cPayee, cSrc, cIncCat, cTag] = await Promise.all(['/insight/income/total', '/insight/expense/total', '/insight/expense/category', '/insight/expense/no-category',
    '/insight/expense/budget', '/insight/expense/no-budget', '/insight/expense/expense', '/insight/income/revenue', '/insight/income/category', '/insight/expense/tag'].map(gc));
  const byName = (res: ApiData, extra?: [string, number]) => res == null ? undefined : new Map([...arr(res).map(x => [x.name, absDiff(x)] as [string, number]), ...(extra ? [extra] : [])]);
  const cEarned = cInc == null ? undefined : sumDiff(cInc), cSpent = cExp == null ? undefined : sumDiff(cExp);
  const earned = sumDiff(inc), spent = sumDiff(exp), net = earned - spent;
  const linePts = daily ? scaleTo(days, earned, spent) : trend.map(t => ({ label: t.label, a: t.income, b: t.spend }));
  csvRows = [['Section', 'Name', 'Amount', ...(C ? ['Compared with ' + C.start + ' to ' + C.end] : [])], ['Totals', 'Period', R.start + ' to ' + R.end],
    ['Totals', 'Earned', earned, ...(cEarned != null ? [cEarned] : [])], ['Totals', 'Spent', spent, ...(cSpent != null ? [cSpent] : [])], ['Totals', 'Net', net, ...(cEarned != null && cSpent != null ? [cEarned - cSpent] : [])]];
  const rowsOf = (res: ApiData, link: string) => arr(res).map(x => ({ name: x.name, v: absDiff(x), href: link && x.id ? link + x.id : '' }));
  const nwS = own.reduce((s, a, i) => s + (balStart[i] ?? 0), 0), nwE = own.reduce((s, a, i) => s + (balEnd[i] ?? 0), 0);
  const presetBtn = (k: string, l: string) => html`<a class="btn small${R.preset === k ? ' primary' : ''}" href="${hashWith({ preset: k, start: '', end: '' })}">${l}</a>`;
  own.forEach((a, i) => { if (balStart[i] != null && balEnd[i] != null && (balStart[i] || balEnd[i])) csvRows.push(['Account balances', a.name, balEnd[i]!]); });
  const accRows = htmlList(own.map((a, i) => ({ a, s: balStart[i], e: balEnd[i] })).filter((x): x is typeof x & { s: number, e: number } => x.s !== null && x.e !== null && !!(x.s || x.e))
    .map(({ a, s, e }) => html`<tr><td class="desc">${a.name}</td><td class="amt hide-s">${money(s)}</td><td class="amt">${money(e)}</td><td class="amt ${e - s > 0 ? 'pos' : e - s < 0 ? 'neg' : 'neutral'}">${e - s > 0 ? '+' : ''}${money(e - s)}</td></tr>`));
  emptyTables = [];
  paint(html`${head('Reports', fmtDate(R.start) + ' – ' + fmtDate(R.end), html`<select data-onchange="App.reportCompare(this.value)" style="width:auto" aria-label="Compare with">${opt('', 'No comparison', cmp)}${opt('prev', 'vs. period before', cmp)}${opt('year', 'vs. last year', cmp)}</select><button class="btn" data-onclick="App.reportSaveOpen()">Save</button><button class="btn" data-onclick="App.reportCsv()">CSV</button><button class="btn" data-onclick="App.print()">Print</button>`)}${C ? html`<p class="sub-s" style="margin:-10px 0 14px">Compared with ${CMP_LABEL[cmp]}: ${fmtDate(C.start)} – ${fmtDate(C.end)}</p>` : ''}<div class="saved-reports" id="savedReports"${saved.length ? '' : ' hidden'}>${htmlList(saved.map(s => html`<span class="chip${s.q === here ? ' on' : ''}"><a href="#/reports?${s.q}">${s.name}</a><button type="button" aria-label="Remove ${s.name}" data-onclick="App.deleteReport('${s.id}')">×</button></span>`))}<form class="save-report" id="saveReport" hidden data-onsubmit="event.preventDefault();App.saveReport(this)"><input type="text" name="n" placeholder="Save this report as…" maxlength="40" required><button class="btn small">Save</button></form></div><div class="toolbar"><div style="display:flex;gap:6px;flex-wrap:wrap">${presetBtn('this-month', 'This month')}${presetBtn('last-month', 'Last month')}${presetBtn('last-3', 'Last 3 months')}${presetBtn('this-year', 'This year')}${presetBtn('last-year', 'Last year')}${presetBtn('last-12', 'Last 12 months')}<button type="button" class="btn small${R.preset ? '' : ' primary'}" data-onclick="App.reportCustom()">Custom…</button></div><form class="range" id="reportRange"${R.preset ? ' hidden' : ''} data-onsubmit="event.preventDefault();App.reportsRange(this)"><input type="date" name="s" value="${R.start}" aria-label="From"><span class="neutral">to</span><input type="date" name="e" value="${R.end}" aria-label="To"><button class="btn small">Apply</button></form></div><div class="kpis"><div class="kpi"><div class="eyebrow">Earned</div><div class="val num pos">${money0(earned)}</div>${vsLine(earned, cEarned, true)}</div><div class="kpi"><div class="eyebrow">Spent</div><div class="val num neg">${money0(spent)}</div>${vsLine(spent, cSpent, false)}</div><div class="kpi"><div class="eyebrow">Net</div><div class="val num ${net < 0 ? 'neg' : ''}">${money0(net)}</div><div class="sub-s">${earned ? (net / earned * 100).toFixed(0) + '% of income kept' : ''}</div>${cEarned != null && cSpent != null ? vsLine(net, cEarned - cSpent, true) : ''}</div><div class="kpi"><div class="eyebrow">Moved between accounts</div><div class="val num">${money0(sumDiff(xfer))}</div></div><div class="kpi"><div class="eyebrow">Balance change</div><div class="val num ${nwE - nwS < 0 ? 'neg' : 'pos'}">${nwE - nwS > 0 ? '+' : ''}${money0(nwE - nwS)}</div><div class="sub-s">across your accounts</div></div></div>${overviewRow(linePts, daily, [...rowsOf(byCat, ''), { name: 'Uncategorized', v: sumDiff(noCat) }], spent)}${months.length > 1 ? html`<section class="panel chart" style="margin-bottom:20px">${raw(String(cashFlow(trend)).replace('over the last six months · click a month to open it', 'by month · click a month to report on it'))}</section>` : ''}<div class="report-cols"><div>${shareTable('Spending by category', [...rowsOf(byCat, '#/transactions?category='), { name: 'Uncategorized', v: sumDiff(noCat) }], { prev: byName(cCat, ['Uncategorized', sumDiff(cNoCat)]) })}${shareTable('Spending by budget', [...rowsOf(byBud, '#/transactions?budget='), { name: 'No budget', v: sumDiff(noBud) }], { prev: byName(cBud, ['No budget', sumDiff(cNoBud)]) })}${shareTable('Spending by tag', rowsOf(byTag, '#/transactions?tag='), { lead: 'Tagged spending only', prev: byName(cTag) })}${shareTable('Income by category', rowsOf(byIncCat, '#/transactions?category='), { good: true, prev: byName(cIncCat) })}</div><div>${shareTable('Top payees', rowsOf(byPayee, '#/account/'), { limit: 15, prev: byName(cPayee) })}${shareTable('Income by source', rowsOf(bySrc, '#/account/'), { good: true, prev: byName(cSrc) })}</div></div>${emptyTables.length ? html`<p class="sub-s report-empty">Nothing in this period for ${listJoin(emptyTables.map(t => t.toLowerCase()))}.</p>` : ''}<section class="panel flush"><div style="padding:22px 26px 6px"><h2 style="font-size:15px;margin:0">Account balances</h2></div>${accRows ? html`<table class="tbl"><thead><tr><th>Account</th><th class="r hide-s">${fmtDay(addDays(R.start, -1))}</th><th class="r">${fmtDay(R.end > todayIso() ? todayIso() : R.end)}</th><th class="r">Change</th></tr></thead><tbody>${accRows}</tbody></table>` : html`<div class="center-empty">No balances.</div>`}</section>`);
};
function reportCompare(v: string) { location.hash = hashWith({ cmp: v }); }
// Custom dates and Save… open their forms only when asked
function reportCustom() { const f = el<HTMLFormElement>('reportRange'); f.hidden = !f.hidden; if (!f.hidden) (f.elements.namedItem('s') as HTMLInputElement).focus(); }
function reportSaveOpen() { el('savedReports').hidden = false; const f = el<HTMLFormElement>('saveReport'); f.hidden = false; (f.elements.namedItem('n') as HTMLInputElement).focus(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  reportCompare,
  reportCustom,
  reportSaveOpen,
  reportCsv,
  saveReport,
  deleteReport,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

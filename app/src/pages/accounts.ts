import { Html, html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { busy } from '../core/auth';
import { App, S, absDiff, arr, el, fmtDate, fmtDay, money, money0, monthRange, num, period, today, todayIso, type Field, viewYM } from '../core/base';
import { closeDrawer, confirmBox, formError, head, monthNav, openDrawer, opt, toast } from '../core/dom';
import { type Group, nameAvatar, normGroup, signed, txRows } from '../core/feed';
import { logoDomain, setLogoSite } from '../core/logo';
import { addDays, daysBetween } from '../core/helpers';
import { type Account, invalidate, isAsset, isCard, isLiab, lists, normAccount, planText, stripPlan, withPlan } from '../core/lists';
import { VIEWS, hashWith, route } from '../core/router';
import { loanHistory } from './loans';

/* ================= Accounts ================= */
const ROLE_LABEL: Record<string, string> = { defaultAsset: 'Checking / default', savingAsset: 'Savings', sharedAsset: 'Shared', cashWalletAsset: 'Cash wallet', ccAsset: 'Credit card' };
VIEWS.accounts = async (r, paint) => {
  const L = await lists(true);
  const tab = r.q.tab || 'assets';
  const prog = tab === 'liabilities' ? await loanHistory(L.accounts.filter(isLiab)) : {};
  // Payees and income sources show how much went through each one in the period picked at the top
  const flow = tab === 'expense' || tab === 'revenue', cur = period(), sums: Record<string, number> = {};
  if (flow) for (const x of arr(await api(tab === 'expense' ? '/insight/expense/expense' : '/insight/income/revenue', { params: { start: cur.start, end: cur.end } }).catch(() => []))) sums[x.id] = (sums[x.id] || 0) + absDiff(x);
  const show = r.q.inactive === '1';
  const sets: Record<string, Account[]> = {
    assets: L.accounts.filter(a => isAsset(a) && !isCard(a)), cards: L.accounts.filter(isCard), liabilities: L.accounts.filter(isLiab),
    expense: L.accounts.filter(a => a.type === 'expense'), revenue: L.accounts.filter(a => a.type === 'revenue'),
  };
  let items = sets[tab] || []; const inactiveCount = items.filter(a => !a.active).length;
  if (!show) items = items.filter(a => a.active);
  const tabLink = (k: string, label: string) => html`<a href="#/accounts?tab=${k}" class="${tab === k ? 'on' : ''}">${label} <span class="neutral">${sets[k].filter(a => a.active).length}</span></a>`;
  let cols: Html, row: (a: Account) => Html, total = '';
  if (tab === 'assets') {
    cols = html`<th>Name</th><th class="hide-s">Type</th><th class="r">Balance</th>`;
    row = a => html`<td class="desc"><span class="acct">${nameAvatar(a.name, 'sm')}<span class="nm">${a.name}</span></span></td><td class="hide-s neutral">${ROLE_LABEL[a.role] || a.role}</td><td class="amt">${money(a.balance)}</td>`;
    total = money(items.reduce((s, a) => s + a.balance, 0)) + ' total';
  } else if (tab === 'cards') {
    cols = html`<th>Name</th><th class="hide-s">Payment due</th><th class="r">Owed</th>`;
    row = a => html`<td class="desc"><span class="acct">${nameAvatar(a.name, 'sm')}<span class="nm">${a.name}</span></span></td><td class="hide-s neutral">${a.paymentDate ? 'Day ' + new Date(String(a.paymentDate).slice(0, 10) + 'T12:00:00').getDate() + ' of the month' : '—'}</td><td class="amt">${a.balance < 0 ? money(-a.balance) : html`<span class="pos">Paid off</span>`}</td>`;
    total = money(items.reduce((s, a) => s + Math.max(0, -a.balance), 0)) + ' owed in total';
  } else if (tab === 'liabilities') {
    cols = html`<th>Name</th><th class="hide-s">Paid off</th><th class="hide-s">Interest</th><th class="r">Remaining</th>`;
    row = a => { const pr = prog[a.id] || {}; return html`<td class="desc"><span class="acct">${nameAvatar(a.name, 'sm')}<span class="nm">${a.name}</span></span><div class="sub-s" style="text-transform:capitalize">${a.liabType}</div></td><td class="hide-s" style="min-width:200px">${pr.pct != null ? html`<div class="track" style="max-width:220px"><div class="fill good" style="width:${(a.debt ? pr.pct : 100).toFixed(1)}%"></div></div><div class="sub-s">${a.debt ? pr.pct.toFixed(0) + '% · ' + money0(pr.repaid) + ' of ' + money0(pr.borrowed) : 'Paid off'}</div>` : html`<span class="neutral">—</span>`}</td><td class="hide-s neutral">${num(a.interest) ? num(a.interest) + '% ' + a.interestPeriod : '—'}</td><td class="amt">${money(a.debt)}</td>`; };
    total = money(items.reduce((s, a) => s + a.debt, 0)) + ' owed in total';
  } else {
    const used = items.filter(a => sums[a.id]).length, when = cur.all ? 'all time' : 'in ' + cur.label;
    cols = html`<th>Name</th><th class="r">${tab === 'expense' ? 'Spent' : 'Received'} ${cur.all ? 'all time' : 'in ' + cur.short}</th>`;
    row = a => html`<td class="desc"><span class="acct">${nameAvatar(a.name, 'sm')}<span class="nm">${a.name}</span></span></td><td class="amt">${sums[a.id] ? money(sums[a.id]) : html`<span class="neutral">—</span>`}</td>`;
    total = money(items.reduce((s, a) => s + (sums[a.id] || 0), 0)) + (tab === 'expense' ? ' spent at ' + used + ' of ' + items.length + ' payees ' : ' received from ' + used + ' of ' + items.length + ' income sources ') + when;
  }
  const body = items.length ? html`<table class="tbl"><thead><tr>${cols}</tr></thead><tbody>${htmlList(items.sort((a, b) => (sums[b.id] || 0) - (sums[a.id] || 0) || a.name.localeCompare(b.name)).map(a => html`<tr class="click" data-onclick="App.go('#/account/${a.id}')"${a.active ? '' : html` style="opacity:.5"`}>${row(a)}</tr>`))}</tbody></table>` : html`<div class="center-empty">Nothing here yet.</div>`;
  paint(html`${head('Accounts', total, html`${flow ? monthNav() : ''}<button class="btn primary" data-onclick="App.accountForm(null,'${tab === 'assets' ? 'asset' : tab === 'cards' ? 'card' : tab === 'liabilities' ? 'liability' : tab}')">+ New account</button>`)}<div class="tabs">${tabLink('assets', 'Bank accounts')}${tabLink('cards', 'Credit cards')}${tabLink('liabilities', 'Loans & debts')}${tabLink('expense', 'Payees')}${tabLink('revenue', 'Income sources')}</div><section class="panel flush">${body}</section>${inactiveCount ? html`<p style="margin-top:14px"><a class="link" href="${hashWith({ inactive: show ? '' : '1' })}">${show ? 'Hide' : 'Show'} ${inactiveCount} inactive</a></p>` : ''}`);
};
VIEWS.account = async (r, paint) => {
  await lists();
  const accRes = await api('/accounts/' + r.id);
  const a = normAccount(accRes.data);
  let range = ['month', 'year', 'all'].includes(r.q.range) ? r.q.range : (isLiab(a) ? 'all' : 'month');
  if (range === 'month' && S.all && !r.at) range = 'all';   // "All time" picked in the month selector
  const cur = monthRange(...viewYM(r));
  const period = range === 'month' ? { start: cur.start, end: cur.end, label: cur.label, short: cur.short }
    : range === 'year' ? { start: addDays(todayIso(), -365), end: todayIso(), label: 'the last 12 months', short: '12 mo' }
    : { label: 'all time', short: 'all time' };
  // A payee or income source also gets its last twelve months summed up (see payeePanel)
  const yearAgo = monthRange(today.getFullYear(), today.getMonth() - 11).start;
  const [txs, year] = await Promise.all([getAll('/accounts/' + r.id + '/transactions', period.start ? { start: period.start, end: period.end } : {}),
    isAsset(a) || isLiab(a) ? null : getAll('/accounts/' + r.id + '/transactions', { start: yearAgo, end: todayIso() }).catch(() => null)]);
  if (r.at) return;     // loading a month ahead
  const groups = txs.map(normGroup).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const kind = isCard(a) ? 'card' : isLiab(a) ? 'liability' : a.type;
  const own = isAsset(a) || isLiab(a);
  const headline = isCard(a) ? (a.balance < 0 ? money(-a.balance) + ' owed' : 'Paid off') : isLiab(a) ? money(a.debt) + ' remaining' : own ? money(a.balance) : '';
  const inflow = groups.reduce((s, g) => s + Math.max(0, signed(g, a.id)), 0), outflow = groups.reduce((s, g) => s + Math.max(0, -signed(g, a.id)), 0);
  const subtitle = html`<span style="text-transform:capitalize">${isCard(a) ? 'Credit card' : isLiab(a) ? (a.liabType || 'Liability') : a.type === 'expense' ? 'Payee' : a.type === 'revenue' ? 'Income source' : (ROLE_LABEL[a.role] || 'Account')}</span>${a.active ? '' : ' · inactive'}${a.number ? ' · ' + a.number : ''}${isLiab(a) ? (a.plan && a.plan.amount ? ' · pays ' + planText(a.plan) : html` · <button class="link" data-onclick="App.accountForm('${a.id}','liability')">set a monthly payment</button>`) : ''}`;
  const PER = 50, pages = Math.max(1, Math.ceil(groups.length / PER));
  const shown = groups.slice(0, PER);
  if (paint.live) S.feed = { next: 2, pages, opts: { accountId: own ? a.id : '' }, more: async n => groups.slice((n - 1) * PER, n * PER) };
  const rangeBtn = (k: string, l: string) => html`<button type="button" class="${range === k ? 'on' : ''}" data-onclick="App.pickRange('${hashWith({ range: k, page: '' })}')">${l}</button>`;
  const owedStyle = isLiab(a) || isCard(a);
  paint(
    html`<p style="margin:0 0 6px"><a class="link" href="#/accounts">← Accounts</a></p>${head(a.name, subtitle, html`${range === 'month' ? monthNav() : ''}${own ? html`<button class="btn" data-onclick="App.newTxFor('${a.id}')">+ Transaction</button>` : ''}${isAsset(a) || isLiab(a) ? html`<a class="btn" href="#/reconcile/${a.id}">Reconcile</a>` : ''}<button class="btn" data-onclick="App.accountForm('${a.id}','${kind}')">Edit</button>`)}<div class="seg" style="margin:-8px 0 20px">${rangeBtn('month', 'Month')}${rangeBtn('year', 'Last 12 months')}${rangeBtn('all', 'All time')}</div><div class="kpis">${own ? html`<div class="kpi"><div class="eyebrow">${owedStyle ? 'Balance' : 'Current balance'}</div><div class="val num">${headline}</div></div><div class="kpi"><div class="eyebrow">${isLiab(a) ? 'Paid' : 'In'} · ${period.short}</div><div class="val num pos">${money(inflow)}</div></div><div class="kpi"><div class="eyebrow">${isLiab(a) ? 'Borrowed' : 'Out'} · ${period.short}</div><div class="val num neg">${money(outflow)}</div></div>`
      : html`<div class="kpi"><div class="eyebrow">${a.type === 'revenue' ? 'Received' : 'Spent'} · ${period.short}</div><div class="val num ${a.type === 'revenue' ? 'pos' : 'neg'}">${money(a.type === 'revenue' ? outflow : inflow)}</div></div>`}<div class="kpi"><div class="eyebrow">Transactions</div><div class="val num">${groups.length}</div></div></div>${year ? payeePanel(a, year.map(normGroup)) : ''}${own ? html`<section class="panel chart" style="margin-bottom:20px"><h2>${owedStyle && isLiab(a) ? 'Amount owed' : 'Balance'} · ${period.label}</h2><p class="lead">After each transaction</p>${balanceChart(groups, a, range)}</section>` : ''}${stripPlan(a.notes) ? html`<section class="panel" style="margin-bottom:20px"><h2>Notes</h2><p style="margin:6px 0 0;white-space:pre-wrap">${stripPlan(a.notes)}</p></section>` : ''}<section class="panel flush">${txRows(shown, { accountId: own ? a.id : '', empty: 'No transactions in ' + period.label + '.' })}${pages > 1 ? html`<div class="more" id="feedMore"><span class="spin"></span>Loading older transactions…</div>` : ''}</section>`);
};
/* ---------- A payee's (or income source's) year: monthly totals, how often, typical amount, categories ---------- */
export function payeeStats(groups: Group[], id: string, t: string) {
  const charges = groups.flatMap(g => g.splits.filter(s => s.destination_id === id || s.source_id === id).map(s => ({ d: String(s.date).slice(0, 10), amt: s.amount, cat: s.category, bill: s.bill_name, gid: g.id })))
    .sort((x, y) => x.d.localeCompare(y.d));
  const y = +t.slice(0, 4), m = +t.slice(5, 7) - 1;
  const months = [...Array(12)].map((_, i) => { const mr = monthRange(y, m - 11 + i); return { key: mr.start.slice(0, 7), label: mr.short, v: 0 }; });
  const byKey = new Map(months.map(x => [x.key, x]));
  charges.forEach(c => { const mo = byKey.get(c.d.slice(0, 7)); if (mo) mo.v += c.amt; });
  const total = charges.reduce((s, c) => s + c.amt, 0), amts = charges.map(c => c.amt).sort((a, b) => a - b);
  const gaps = charges.slice(1).map((c, i) => daysBetween(charges[i].d, c.d)).sort((a, b) => a - b);
  const cats = new Map<string, number>(); charges.forEach(c => cats.set(c.cat || 'Uncategorized', (cats.get(c.cat || 'Uncategorized') || 0) + c.amt));
  return { charges, months, total, perMonth: total / Math.max(1, 12 - months.findIndex(x => x.v > 0)), typical: amts.length ? amts[Math.floor(amts.length / 2)] : 0,
    every: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0, first: charges[0], last: charges[charges.length - 1],
    cats: [...cats].sort((a, b) => b[1] - a[1]), bill: charges.find(c => c.bill)?.bill || '' };
}
const howOften = (d: number) => d <= 1 ? 'about daily' : d <= 9 ? 'about every ' + d + ' days' : d <= 17 ? 'about every two weeks' : d <= 40 ? 'about monthly' : d <= 100 ? 'every few months' : 'now and then';
function payeePanel(a: Account, groups: Group[]) {
  const p = payeeStats(groups, a.id, todayIso()), inc = a.type === 'revenue';
  if (!p.charges.length) return html`<section class="panel" style="margin-bottom:20px"><h2>The last 12 months</h2><p class="empty">Nothing ${inc ? 'received from' : 'spent at'} ${a.name} in the last year.</p></section>`;
  const W = innerWidth < 600 ? 420 : 960, H = 130, pb = 22, max = Math.max(1, ...p.months.map(x => x.v)), bw = W / 12;
  const bars = htmlList(p.months.map((x, i) => { const h = (H - pb - 8) * x.v / max; return html`<g class="pt" data-tip="${x.label + ' · ' + money(x.v)}"><rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H - pb}" fill="transparent"/><rect x="${(i * bw + bw * .18).toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${Math.max(h, x.v ? 2 : 0).toFixed(1)}" rx="3" fill="${inc ? 'var(--good)' : 'var(--spend)'}" opacity="${i === 11 ? 1 : .7}"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${W < 960 ? x.label.slice(0, 1) : x.label}</text></g>`; }));
  const stat = (label: string, v: unknown) => html`<div><div class="eyebrow">${label}</div><div class="num" style="font-size:18px">${v}</div></div>`;
  const cats = htmlList(p.cats.slice(0, 4).map(([c, v]) => html`<span class="chip">${c} · ${Math.round(v / p.total * 100)}%</span>`));
  return html`<section class="panel chart" style="margin-bottom:20px"><h2>The last 12 months</h2><p class="lead">${p.charges.length} ${inc ? 'payment' : 'charge'}${p.charges.length === 1 ? '' : 's'}${p.charges.length > 2 ? ', ' + howOften(p.every) : ''} · last ${fmtDate(p.last.d)}${p.bill ? ' · bill: ' + p.bill : ''}</p><div class="payee-stats">${stat(inc ? 'Received' : 'Spent', money0(p.total))}${stat('Per month', money0(p.perMonth))}${stat('Typical ' + (inc ? 'payment' : 'charge'), money(p.typical))}${stat('Since', fmtDate(p.first.d))}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="By month" style="margin-top:14px">${bars}</svg>${cats ? html`<div style="margin-top:12px">${cats}</div>` : ''}</section>`;
}
function balanceChart(groups: Group[], a: Account, range: string) {
  const owed = isLiab(a);                       // loans read better as "amount owed" going down
  const pts: { d: string, v: number, desc: string, amt: number }[] = [];
  groups.flatMap(g => g.splits.map(s => ({ s, d: String(s.date) }))).sort((x, y) => x.d.localeCompare(y.d)).forEach(({ s, d }) => {
    let after: number | null = null;
    if (s.source_id === a.id && s.sba != null) after = num(s.sba);
    else if (s.destination_id === a.id && s.dba != null) after = num(s.dba);
    if (after !== null) pts.push({ d, v: owed ? -after : after, desc: s.description, amt: s.source_id === a.id ? -s.amount : s.amount });
  });
  if (!pts.length) return html`<p class="empty">No activity in this period.</p>`;
  const W = innerWidth < 600 ? 420 : 960, H = 190, pl = 6, pr = 6, pt = 26, pb = 26;
  const vals = pts.map(p => p.v), lo = Math.min(...vals, owed ? 0 : Infinity), hi = Math.max(...vals);
  const span = (hi - lo) || 1, n = pts.length, long = range && range !== 'month';
  const t0 = new Date(pts[0].d.slice(0, 10) + 'T12:00:00').getTime(), t1 = new Date(pts[n - 1].d.slice(0, 10) + 'T12:00:00').getTime();
  const x = (i: number) => n === 1 ? W / 2 : long && t1 > t0 ? pl + (W - pl - pr) * (new Date(pts[i].d.slice(0, 10) + 'T12:00:00').getTime() - t0) / (t1 - t0) : pl + (W - pl - pr) * i / (n - 1);
  const y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / span);
  let path = '';
  pts.forEach((p, i) => { path += (i ? ' H' + x(i).toFixed(1) + ' V' : 'M' + x(i).toFixed(1) + ' ') + y(p.v).toFixed(1); });
  const tip = (p: { d: string, v: number, desc: string, amt: number }) => { const ch = owed ? -p.amt : p.amt; return fmtDate(p.d) + '\n' + p.desc + '\n' + (ch > 0 ? '+' : '') + money(ch) + '  →  ' + money(p.v) + (owed ? ' owed' : ''); };
  const dots = htmlList(pts.map((p, i) => html`<g class="pt" data-tip="${tip(p)}"><circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${n > 150 ? 6 : 11}" fill="transparent"/>${n <= 150 ? html`<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" fill="var(--good)"/>` : ''}</g>`));
  const zero = lo < 0 && hi > 0 ? html`<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-dasharray="4 4"/>` : '';
  const fd = long ? fmtDate : fmtDay;
  return html`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance over time">${zero}<path d="${path}" fill="none" stroke="var(--good)" stroke-width="2"/>${dots}<text x="${pl}" y="${H - 6}">${fd(pts[0].d)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${fd(pts[n - 1].d)}</text><text x="${pl}" y="14">${owed ? 'Highest owed ' : 'High '}${money0(hi)}</text></svg>`;
}
async function accountForm(id: string | null, kind: string) {
  const L = await lists();
  const a = id ? (L.byId[id] || normAccount((await api('/accounts/' + id)).data)) : null;
  S.form = { kind: kind || 'asset', id, name: a ? a.name : '' };
  const k = S.form.kind;
  const kinds = [['asset', 'Bank account'], ['card', 'Credit card'], ['liability', 'Loan or debt'], ['expense', 'Payee'], ['revenue', 'Income source']];
  let f = html`<form id="accForm" data-onsubmit="event.preventDefault();App.saveAccount()">`;
  if (!id) f = html`${f}<label>Kind of account<select id="a-kind" data-onchange="App.accountForm(null,this.value)">${htmlList(kinds.map(([v, l]) => opt(v, l, k)))}</select></label>`;
  f = html`${f}<label>Name<input type="text" id="a-name" value="${a ? a.name : ''}" required></label>`;
  if (k === 'asset') {
    f = html`${f}<label>Type<select id="a-role">${htmlList(['defaultAsset', 'savingAsset', 'sharedAsset', 'cashWalletAsset'].map(v => opt(v, ROLE_LABEL[v], a ? a.role : 'defaultAsset')))}</select></label>`;
    f = html`${f}<label>Account number (optional)<input type="text" id="a-number" value="${a ? a.number : ''}"></label>`;
    if (!id) f = html`${f}<div class="grid2"><label>Starting balance<input type="number" step="0.01" id="a-open" placeholder="0.00"></label><label>As of<input type="date" id="a-opendate" value="${todayIso()}"></label></div>`;
  } else if (k === 'card') {
    f = html`${f}<label>Payment due date<input type="date" id="a-paydate" value="${a && a.paymentDate ? String(a.paymentDate).slice(0, 10) : todayIso()}" required></label><p class="hint">Only the day of the month matters.</p>`;
    if (!id) f = html`${f}<div class="grid2"><label>Amount owed now<input type="number" step="0.01" min="0" id="a-open" placeholder="0.00"></label><label>As of<input type="date" id="a-opendate" value="${todayIso()}"></label></div>`;
  } else if (k === 'liability') {
    f = html`${f}<label>Type<select id="a-ltype">${htmlList([['loan', 'Loan'], ['debt', 'Debt'], ['mortgage', 'Mortgage']].map(([v, l]) => opt(v, l, a ? a.liabType : 'loan')))}</select></label>`;
    if (!id) f = html`${f}<div class="grid2"><label>Amount you owe<input type="number" step="0.01" min="0.01" id="a-open" required></label><label>As of<input type="date" id="a-opendate" value="${todayIso()}" required></label></div>`;
    f = html`${f}<div class="grid2"><label>Interest %<input type="number" step="0.001" min="0" id="a-interest" value="${a ? num(a.interest) || '' : ''}" placeholder="0"></label><label>Per<select id="a-iperiod">${htmlList(['monthly', 'yearly', 'weekly', 'daily', 'quarterly', 'half-year'].map(v => opt(v, v, a ? a.interestPeriod || 'monthly' : 'monthly')))}</select></label></div>`;
    const pl: { amount?: number, day?: number | null, from?: string } = (a && a.plan) || {};
    f = html`${f}<div class="grid2"><label>Monthly payment<input type="number" step="0.01" min="0" id="a-pamt" value="${pl.amount || ''}" placeholder="e.g. 500"></label><label>Due day of the month<input type="number" min="1" max="31" step="1" id="a-pday" value="${pl.day || ''}" placeholder="e.g. 30"></label></div><label>Paid from<select id="a-pfrom">${opt('', 'Not set', pl.from || '')}${htmlList(L.own.filter(x => !isLiab(x)).map(x => opt(x.name, x.name, pl.from || '')))}</select></label><p class="hint">Used by the Overview, Forecast and Loan planner. Saved in the loan’s notes in Firefly.</p>`;
  }
  if (id && (k === 'asset' || k === 'card' || k === 'liability')) {
    const ob = k === 'asset' ? a!.opening : Math.abs(a!.opening);
    f = html`${f}<div class="grid2"><label>${k === 'asset' ? 'Opening balance' : 'Opening amount owed'}<input type="number" step="0.01" id="a-open" value="${a!.opening ? ob : ''}" placeholder="None"></label><label>Opening date<input type="date" id="a-opendate" value="${a!.openingDate ? String(a!.openingDate).slice(0, 10) : ''}"></label></div>`;
  }
  f = html`${f}<label>Website (for its logo)<input type="text" id="a-site" value="${a ? logoDomain(a.name) : ''}" placeholder="e.g. walmart.com" autocapitalize="off" spellcheck="false"></label><p class="hint">Guessed from the name. Clear it to show initials instead.</p>`;
  f = html`${f}<label>Notes<textarea id="a-notes" rows="3">${a ? (k === 'liability' ? stripPlan(a.notes) : a.notes) : ''}</textarea></label>`;
  if (id) f = html`${f}<label class="check"><input type="checkbox" id="a-active"${a!.active ? ' checked' : ''}> Active</label>`;
  if (id && (k === 'asset' || k === 'card' || k === 'liability')) f = html`${f}<label class="check"><input type="checkbox" id="a-networth"${a!.netWorth ? ' checked' : ''}> Include in net worth</label>`;
  f = html`${f}<button type="submit" hidden></button></form>`;
  openDrawer(id ? 'Edit account' : 'New account', f,
    html`${id ? html`<button class="btn danger" type="button" data-onclick="App.deleteAccount('${id}')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="accSave" data-onclick="App.submit('accForm')">${id ? 'Save' : 'Create account'}</button>`);
}
async function saveAccount() {
  const { kind, id, name } = S.form, v = (x: string) => el<Field>(x) ? el<Field>(x).value.trim() : '';
  const b: any = { name: v('a-name'), notes: v('a-notes') };
  if (!b.name) return formError('Give the account a name.');
  const site = v('a-site').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  if (site && !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,12}$/.test(site)) return formError('The website should look like walmart.com.');
  if (kind === 'asset') { b.type = 'asset'; b.account_role = v('a-role'); b.account_number = v('a-number'); }
  if (kind === 'card') { b.type = 'asset'; b.account_role = 'ccAsset'; b.credit_card_type = 'monthlyFull'; b.monthly_payment_date = v('a-paydate'); }
  if (kind === 'liability') {
    b.type = 'liability'; b.liability_type = v('a-ltype'); b.liability_direction = 'credit'; b.interest = v('a-interest') || '0'; b.interest_period = v('a-iperiod');
    const day = parseInt(v('a-pday'), 10);
    if (v('a-pday') && !(day >= 1 && day <= 31)) return formError('The due day must be between 1 and 31.');
    b.notes = withPlan(b.notes, { amount: num(v('a-pamt')), day: day || null, from: v('a-pfrom') });
  }
  if (kind === 'expense' || kind === 'revenue') b.type = kind;
  if (id && el('a-open') && v('a-open') !== '') {
    const amt = Math.abs(num(v('a-open')));
    b.opening_balance = String(kind === 'card' || kind === 'liability' ? -amt : num(v('a-open')));
    b.opening_balance_date = v('a-opendate') || todayIso();
  }
  if (!id && el('a-open') && v('a-open') !== '') {
    const amt = Math.abs(num(v('a-open')));
    // Credit-card and loan balances are stored in Firefly as negative numbers (money owed).
    b.opening_balance = String(kind === 'card' || kind === 'liability' ? -amt : num(v('a-open')));
    b.opening_balance_date = v('a-opendate') || todayIso();
  }
  if (!id) b.currency_code = S.currency;
  if (id) { b.active = el<HTMLInputElement>('a-active').checked; if (el<HTMLInputElement>('a-networth')) b.include_net_worth = el<HTMLInputElement>('a-networth').checked; delete b.type; }
  await busy(el('accSave'), async () => {
    const res = id ? await api('/accounts/' + id, { method: 'PUT', body: b }) : await api('/accounts', { method: 'POST', body: b });
    setLogoSite(b.name, site, name);
    invalidate(); closeDrawer(); toast(id ? 'Account saved' : 'Account created');
    if (!id && res && res.data) location.hash = '#/account/' + res.data.id; else route();
  });
}
async function deleteAccount(id: string) {
  if (!await confirmBox('Delete this account?', 'Firefly III will also delete every transaction that uses this account. This cannot be undone. To keep the history, uncheck "Active" instead.')) return;
  try { await api('/accounts/' + id, { method: 'DELETE' }); invalidate(); closeDrawer(); toast('Account deleted'); location.hash = '#/accounts'; }
  catch (e) { formError((e as Error).message); }
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  accountForm,
  saveAccount,
  deleteAccount,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

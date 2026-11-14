import { Html, html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { busy } from '../core/auth';
import { type ApiData, App, el, type Field, fmtDate, fmtDay, isoDate, leadDays, money, money0, monthOf, monthRange, nowMonth, num, type Period, S, todayIso, viewYM, weekOrder } from '../core/base';
import { closeDrawer, formError, head, monthNav, openDrawer, opt, toast, emptyState } from '../core/dom';
import { normGroup } from '../core/feed';
import { LS, addDays, daysBetween } from '../core/helpers';
import { invalidate, lists } from '../core/lists';
import { newTx } from '../features/txform';
import { VIEWS, hashWith, parseHash, route } from '../core/router';
import { billRises, type Charge, findRecurring } from '../features/subs';
import { auditSubs } from '../features/subaudit';
import { subAuditPanel } from '../features/subauditview';

/* ================= Bills ================= */
const FREQ: Record<string, [string, number]> = { daily: ['day', 30.44], weekly: ['week', 4.35], monthly: ['month', 1], quarterly: ['quarter', 1 / 3], 'half-year': ['6 months', 1 / 6], yearly: ['year', 1 / 12] };
export const billAmount = (at: ApiData) => at.amount_avg != null ? num(at.amount_avg) : (num(at.amount_min) + num(at.amount_max)) / 2;
/* A bill's due dates still to pay. Firefly lists them for the range asked for (pay_dates): only the unpaid ones, as it
   leaves out every date on or before the latest payment in that range. It can also list dates past the end of the
   range (a yearly bill's next date), so a page about one period keeps only the dates in it. */
export function billDueDates(at: ApiData, range?: { start?: string, end?: string }) {
  const due = [...new Set<string>((at.pay_dates || []).map((d: unknown) => String(d).slice(0, 10)))].sort();
  const paid = (at.paid_dates || []).map((p: ApiData) => String(p.date).slice(0, 10)), t = todayIso();
  // Firefly keeps a due date that was paid early (the charge is before it), so it'd read as overdue: a date already past with a payment in its own cycle is settled
  const settled = (d: string) => d < t && paid.some((x: string) => x <= d && x > cycleBefore(at, d));
  return due.filter(d => (!range || !range.start || d >= range.start) && (!range || !range.end || d <= range.end) && !settled(d));
}
function cycleBefore(at: ApiData, d: string): string {
  const st = STEP[at.repeat_freq], k = (at.skip || 0) + 1;
  if (!st) return d;
  const [mo, dd] = st;
  if (!mo) return addDays(d, -dd * k);
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 - mo * k, day = +d.slice(8, 10);
  return isoDate(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12));
}
/* The next date a bill is due on or after `from`. Firefly doesn't always send next_expected_match, and pay_dates only covers the range asked
   for, so the date is worked out from the bill's own schedule (first date, how often, how many to skip) when neither has one. null when the bill has ended. */
const STEP: Record<string, [number, number]> = { daily: [0, 1], weekly: [0, 7], monthly: [1, 0], quarterly: [3, 0], 'half-year': [6, 0], yearly: [12, 0] };
export function nextBillDate(at: ApiData, from: string): string | null {
  const end = at.end_date ? String(at.end_date).slice(0, 10) : '', listed = [...billDueDates(at), at.next_expected_match ? String(at.next_expected_match).slice(0, 10) : ''].filter(d => d >= from).sort()[0];
  const first = at.date ? String(at.date).slice(0, 10) : '', st = STEP[at.repeat_freq];
  let next = listed || '';
  if (!next && first && st) {
    const k = (at.skip || 0) + 1, [mo, dd] = st, y0 = +first.slice(0, 4), m0 = +first.slice(5, 7) - 1, d0 = +first.slice(8, 10);
    for (let i = 0; i < 2000 && !next; i++) {
      let d: string;
      if (mo) { const mm = m0 + mo * k * i, last = new Date(y0, mm + 1, 0).getDate(), t = new Date(y0, mm, Math.min(d0, last), 12); d = isoDate(t); }
      else d = addDays(first, dd * k * i);
      if (d >= from) next = d;
      if (end && d > end) break;
    }
  }
  return next && (!end || next <= end) ? next : null;
}
// Bills are asked for from the start of this month, so one due earlier in the month and not paid yet is still listed
export const billsFrom = (today: string) => today.slice(0, 8) + '01';
VIEWS.bills = async (r, paint) => {
  await lists();
  // Bills are a schedule, so All time shows this month's due and paid status
  const cur = S.all && !r.at ? monthRange(...nowMonth()) : monthRange(...viewYM(r));
  const bills = await getAll('/bills', { start: cur.start, end: cur.end });
  if (r.at) return;     // loading a month ahead
  const active = bills.filter(b => b.attributes.active !== false);
  const monthly = active.reduce((s, b) => s + billAmount(b.attributes) * (FREQ[b.attributes.repeat_freq] || ['', 1])[1] / ((b.attributes.skip || 0) + 1), 0);
  const grp = (b: ApiData) => b.attributes.object_group_title || '';
  const rows = htmlList(bills.sort((a, b) => grp(a).localeCompare(grp(b)) || String((a.attributes.pay_dates || [])[0] || '9').localeCompare(String((b.attributes.pay_dates || [])[0] || '9'))).map((b, i, all) => {
    const heading = grp(b) && (i === 0 || grp(all[i - 1]) !== grp(b)) ? html`<tr><td colspan="4" class="eyebrow" style="padding-top:18px">${grp(b)}</td></tr>` : '';
    const at = b.attributes, paid = (at.paid_dates || []).length, due = billDueDates(at, cur)[0];
    const f = FREQ[at.repeat_freq] || [at.repeat_freq, 1], every = (at.skip ? 'Every ' + (at.skip + 1) + ' ' + f[0] + 's' : 'Every ' + f[0]);
    const status = at.active === false ? html`<span class="chip">Inactive</span>` : paid ? html`<span class="chip good">Paid this month</span>` :
      due ? due < todayIso() ? html`<span class="chip bad">Overdue since ${fmtDay(due)}</span>` : html`<span class="chip warn">Due ${fmtDay(due)}</span>` : (next => html`<span class="chip">${next ? 'Next ' + fmtDate(next) : at.end_date && String(at.end_date).slice(0, 10) < todayIso() ? 'Ended' : 'Next —'}</span>`)(nextBillDate(at, cur.start > todayIso() ? cur.start : todayIso()));
    const amt = num(at.amount_min) === num(at.amount_max) ? money(num(at.amount_min)) : money0(num(at.amount_min)) + '–' + money0(num(at.amount_max));
    return html`${heading}<tr${at.active === false ? html` style="opacity:.5"` : ''}><td><a class="desc" href="#/transactions?bill=${b.id}" style="text-decoration:none">${at.name}</a><div class="sub-s">${every}${billEnds(at)}</div><div class="show-s">${status}</div></td><td class="hide-s">${status}</td><td class="amt">${amt}</td><td class="act">${at.active !== false && !paid ? html`<button class="btn small primary" data-onclick="App.billPay('${b.id}')">Pay now</button> ` : ''}<button class="btn small" data-onclick="App.billForm('${b.id}')">Edit</button></td></tr>`;
  }));
  S.billCache = Object.fromEntries(bills.map(b => [String(b.id), b.attributes]));
  const cal = (r.q.view || LS.get('billsView', 'list')) === 'calendar' && bills.length;
  const viewBtn = (k: string, l: string) => html`<button type="button" class="${(cal ? 'calendar' : 'list') === k ? 'on' : ''}" data-onclick="App.billsView('${k}')">${l}</button>`;
  paint(html`${head('Bills', 'About ' + money0(monthly) + ' a month across ' + active.length + ' active bill' + (active.length === 1 ? '' : 's'), html`${monthNav()}<button class="btn primary" data-onclick="App.billForm()">+ New bill</button>`)}${bills.length ? html`<div class="seg" style="margin:-8px 0 20px">${viewBtn('list', 'List')}${viewBtn('calendar', 'Calendar')}</div>` : ''}${cal ? billCalendar(bills, cur) : html`<section class="panel flush">${rows ? html`<table class="tbl bills-tbl"><thead><tr><th>Bill</th><th class="hide-s">${cur.label}</th><th class="r">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : emptyState('bills', 'No bills yet', 'Add rent, subscriptions or insurance and Money shows what is due next and keeps your safe-to-spend honest.', html`<button class="btn primary" data-onclick="App.billForm()">+ New bill</button>`)}</section>`}<div id="subsBox"></div><p class="sub-s" style="margin-top:14px">Firefly marks a bill paid when a transaction is linked to it — pick the bill in the transaction form, or let your rules do it.</p>`);
  const tok = S.tok;
  // The page may still be animating in when the answer arrives, so wait a moment for the box to exist
  const put = (markup: Html | string, n = 0) => {
    if (tok !== S.tok || parseHash().name !== 'bills') return;
    const box = el('subsBox');
    if (box) box.innerHTML = String(markup); else if (n < 40) setTimeout(() => put(markup, n + 1), 50);
  };
  subsPanel(bills).then(m => put(m)).catch(() => {});
};

/* ---------- Calendar: the month's bills on the days they're due or were paid ---------- */
// Firefly gives each bill the charges that paid it in the month (paid_dates) and its due dates still unpaid (pay_dates,
// which never include the paid ones). Those are still due, or overdue once the day has passed. Only the month's own dates count.
type BillState = 'paid' | 'due' | 'late';
export type BillDay = { id: string, name: string, amt: number, state: BillState, gid?: string };
export function billDays(bills: ApiData[], t: string, range: { start: string, end: string }) {
  const days: Record<string, BillDay[]> = {}, sum = { paid: 0, due: 0, late: 0 };
  bills.filter(b => b.attributes.active !== false).forEach(b => {
    const at = b.attributes, amt = billAmount(at), paid = at.paid_dates || [];
    const put = (d: string, x: { state: BillState, gid?: string }) => { (days[d] = days[d] || []).push({ id: String(b.id), name: at.name, amt, ...x }); sum[x.state] += amt; };
    paid.map((p: ApiData) => ({ d: String(p.date).slice(0, 10), gid: String(p.transaction_group_id || '') })).filter((p: { d: string }) => p.d >= range.start && p.d <= range.end)
      .forEach((p: { d: string, gid: string }) => put(p.d, { state: 'paid', gid: p.gid }));
    billDueDates(at, range).forEach(d => put(d, { state: d < t ? 'late' : 'due' }));
  });
  Object.values(days).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
  return { days, sum };
}
const CAL_STATE: Record<string, string[]> = { paid: ['good', 'Paid'], due: ['warn', 'Due'], late: ['bad', 'Overdue'] };
function billCalendar(bills: ApiData[], cur: Period) {
  const t = todayIso(), { days, sum } = billDays(bills, t, cur);
  // A paid bill opens the charge that paid it; one still due opens the bill
  const pill = (x: BillDay) => {
    const cls = 'bpill ' + CAL_STATE[x.state][0], tip = x.name + ' · ' + CAL_STATE[x.state][1] + ' · ' + money(x.amt), inner = html`<span class="nm">${x.name}</span><span class="num">${money0(x.amt)}</span>`;
    return x.gid ? html`<button type="button" class="${cls}" title="${tip}" data-onclick="App.editTx('${x.gid}')">${inner}</button>` : html`<button type="button" class="${cls}" title="${tip}" data-onclick="App.billForm('${x.id}')">${inner}</button>`;
  };
  const row = (x: BillDay) => {
    const inner = html`<span class="name">${x.name} <span class="chip ${CAL_STATE[x.state][0]}">${CAL_STATE[x.state][1]}</span></span><span class="num">${money(x.amt)}</span>`;
    return x.gid ? html`<button type="button" class="row" data-onclick="App.editTx('${x.gid}')">${inner}</button>` : html`<button type="button" class="row" data-onclick="App.billForm('${x.id}')">${inner}</button>`;
  };
  // The month's own days, from where it starts (a month can start on any day, see cycleDay) to where it ends
  const lead = leadDays(new Date(cur.start + 'T12:00:00')), n = daysBetween(cur.start, cur.end) + 1;
  const cells: Html[] = [];
  for (let i = 0; i < lead; i++) cells.push(html`<div class="bcal-day pad"></div>`);
  for (let i = 0; i < n; i++) {
    const iso = addDays(cur.start, i), list = days[iso] || [], d = +iso.slice(8, 10);
    cells.push(html`<div class="bcal-day${iso === t ? ' today' : ''}${iso < t ? ' past' : ''}"><span class="d">${d}</span>${htmlList(list.map(pill))}</div>`);
  }
  // On a phone the grid is too narrow for names, so the same month shows as a list of days
  const agenda = htmlList(Object.keys(days).sort().map(d => html`<div class="bcal-agenda-day"><div class="eyebrow">${fmtDay(d)}${d === t ? ' · today' : ''}</div>${htmlList(days[d].map(row))}</div>`));
  const kpi = (label: string, v: number, cls = '') => html`<div class="kpi"><div class="eyebrow">${label}</div><div class="val num ${cls}">${money0(v)}</div></div>`;
  return html`<div class="kpis">${kpi('Paid', sum.paid, 'pos')}${kpi('Still due', sum.due)}${sum.late ? kpi('Overdue', sum.late, 'neg') : ''}</div><section class="panel bcal"><div class="bcal-dow">${htmlList(weekOrder(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(d => html`<span>${d}</span>`))}</div><div class="bcal-grid">${htmlList(cells)}</div></section><section class="panel bcal-agenda">${agenda ? html`<div class="list">${agenda}</div>` : html`<p class="empty">Nothing due in ${cur.label}.</p>`}</section><p class="sub-s" style="margin-top:10px">Amounts are each bill’s expected amount. Tap a paid bill to open the charge that paid it.</p>`;
}
function billsView(v: string) { LS.set('billsView', v); location.hash = hashWith({ view: v }); }

/* ---------- Subscriptions that aren't bills yet, and bills whose price went up ---------- */
// Looks through the last 13 months of spending. The months that have ended are one request that stays saved
// (see settled() in api.ts), so only this month is fetched again each time.
// The last 13 months of spending, as two requests: the months that have ended (saved for a day) and this month.
// The forecast asks for the same two, to see which account pays each bill.
export async function recentSpending() {
  const t = todayIso(), m0 = t.slice(0, 8) + '01', [y, m] = monthOf(new Date(m0 + 'T12:00:00')), from = monthRange(y, m - 13).start;
  return (await Promise.all([getAll('/transactions', { start: from, end: addDays(m0, -1), type: 'withdrawal' }), getAll('/transactions', { start: m0, end: t, type: 'withdrawal' })])).flat().map(normGroup);
}
// The past year's withdrawals as plain charges (the subscription audit on Overview asks for the same)
export async function subCharges(): Promise<Charge[]> {
  const gs = await recentSpending();
  return gs.flatMap(g => g.splits.filter(x => x.type === 'withdrawal').map(x => ({ date: x.date, amount: x.amount, payeeId: x.destination_id, payee: x.destination_name, billId: x.bill_id })));
}
async function subsPanel(bills: ApiData[]) {
  const charges = await subCharges();
  const hidden = new Set(LS.get('subsHidden', [])), names = new Set(bills.map(b => String(b.attributes.name).trim().toLowerCase()));
  const found = findRecurring(charges, todayIso()).filter(r => !hidden.has(r.payeeId) && !names.has(r.payee.trim().toLowerCase()));
  const rises = billRises(charges, bills.filter(b => b.attributes.active !== false).map(b => ({ id: String(b.id), max: num(b.attributes.amount_max) })));
  S.subs = found; S.billRises = rises;
  const riseRows = htmlList(Object.entries(rises).map(([id, r]) => {
    const at = (S.billCache || {})[id] || {};
    return html`<div class="row"><span class="name">${at.name}<br><span class="sub-s">Last charge ${money(r.last)} on ${fmtDay(r.date)}, above the bill’s ${money(num(at.amount_max))}</span></span><button class="btn small" data-onclick="App.billRaise('${id}')">Update to ${money(r.last)}</button></div>`;
  }));
  const subRows = htmlList(found.map((r, i) => html`<div class="row"><span class="name">${r.payee}${r.rose ? html` <span class="chip warn">Up from ${money(r.rose.from)}</span>` : ''}<br><span class="sub-s">${r.min === r.max ? money(r.amount) : 'About ' + money(r.amount)} every ${r.every} · ${r.count} charges · last ${fmtDay(r.last)}, next around ${fmtDay(r.next)}</span></span><span style="display:flex;gap:6px;flex:none"><button class="btn small" data-onclick="App.subIgnore(${i})">Not a bill</button><button class="btn small primary" data-onclick="App.subAdd(${i})">Add as bill</button></span></div>`));
  return html`${subAuditPanel(auditSubs(charges, todayIso()))}${riseRows ? html`<section class="panel" style="margin-top:20px"><h2>Prices that went up</h2><p class="lead">These bills were charged more than their highest amount</p><div class="list">${riseRows}</div></section>` : ''}${subRows ? html`<section class="panel" style="margin-top:20px"><h2>Looks like a bill</h2><p class="lead">Charges that repeat on a schedule but aren’t bills yet. As bills they show up in Coming up and in the safe-to-spend forecast.</p><div class="list">${subRows}</div></section>` : ''}`;
}
function subAdd(i: number) {
  const r = S.subs && S.subs[i]; if (!r) return;
  billForm('', { name: r.payee, amount_min: r.min, amount_max: r.max, date: r.next, repeat_freq: r.freq, skip: r.skip, object_group_title: 'Subscriptions', payee: r.payee, since: r.last });
}
function subIgnore(i: number) {
  const r = S.subs && S.subs[i]; if (!r) return;
  LS.set('subsHidden', [...new Set([...LS.get('subsHidden', []), r.payeeId])]);
  toast(r.payee + ' won’t be suggested again'); route();
}
async function billRaise(id: string) {
  const at = (S.billCache || {})[id], r = (S.billRises || {})[id]; if (!at || !r) return;
  const fixed = num(at.amount_min) === num(at.amount_max);
  try {
    await api('/bills/' + id, { method: 'PUT', body: { amount_max: String(r.last), ...(fixed ? { amount_min: String(r.last) } : {}) } });
    invalidate(); toast(at.name + ' updated to ' + money(r.last)); route();
  } catch (e) { toast((e as Error).message); }
}
// A rule that links the payee's future charges (and, run once now, the past year's) to the new bill
async function billRule(name: string, payee: string) {
  const groups = await getAll('/rule-groups');
  let g = groups.find(x => x.attributes.title === 'Bill rules');
  if (!g) g = (await api('/rule-groups', { method: 'POST', body: { title: 'Bill rules', description: 'Created by Money when a bill is added from a repeating charge.', active: true } })).data;
  const one = (o: { type: string, value: string }) => ({ ...o, active: true, stop_processing: false });
  const res = await api('/rules', { method: 'POST', body: { title: payee + ' → bill ' + name, rule_group_id: String(g.id), trigger: 'store-journal', strict: true, stop_processing: false, active: true,
    triggers: [one({ type: 'destination_account_is', value: payee }), one({ type: 'transaction_type', value: 'withdrawal' })], actions: [one({ type: 'link_to_bill', value: name })] } });
  if (res && res.data) await api('/rules/' + res.data.id + '/trigger', { method: 'POST', params: { start: addDays(todayIso(), -400), end: todayIso() } }).catch(() => {});
}
// pre: values for a new bill (from a repeating charge), with the payee to link it to
// "Ends Mar 1" / "Ended Mar 1", and the date to renew or cancel by, for a bill with a contract
export function billEnds(at: ApiData) {
  const e = at.end_date ? String(at.end_date).slice(0, 10) : '', x = at.extension_date ? String(at.extension_date).slice(0, 10) : '', t = todayIso();
  return (e ? ' · ' + (e < t ? 'Ended ' : 'Ends ') + fmtDate(e) : '') + (x && (!e || e >= t) && x >= t ? ' · Renew or cancel by ' + fmtDate(x) : '');
}
function billForm(id?: string, pre?: ApiData) {
  const at = id ? (S.billCache || {})[id] : pre || null;
  S.form = { id, payee: !id && pre ? pre.payee : '' };
  openDrawer(id ? 'Edit bill' : 'New bill',
    html`<form id="billForm" data-onsubmit="event.preventDefault();App.saveBill()"><label>Name<input type="text" id="bl-name" value="${at ? at.name : ''}" required></label><div class="grid2"><label>Lowest amount<input type="number" step="0.01" min="0" id="bl-min" value="${at ? num(at.amount_min) : ''}" required></label><label>Highest amount<input type="number" step="0.01" min="0" id="bl-max" value="${at ? num(at.amount_max) : ''}" required></label></div><p class="hint">Use the same number twice for a fixed amount.</p><label>${id ? 'First due date' : 'Next due date'}<input type="date" id="bl-date" value="${at ? String(at.date).slice(0, 10) : todayIso()}" required></label><div class="grid2"><label>Repeats<select id="bl-freq">${htmlList(Object.keys(FREQ).map(k => opt(k, k === 'half-year' ? 'every 6 months' : k, at ? at.repeat_freq : 'monthly')))}</select></label><label>Skip<input type="number" min="0" step="1" id="bl-skip" value="${at ? at.skip || 0 : 0}"></label></div><p class="hint">Skip 1 with “monthly” means every other month.</p><div class="grid2"><label>Ends on (optional)<input type="date" id="bl-end" value="${at && at.end_date ? String(at.end_date).slice(0, 10) : ''}"></label><label>Renew or cancel by (optional)<input type="date" id="bl-ext" value="${at && at.extension_date ? String(at.extension_date).slice(0, 10) : ''}"></label></div><p class="hint">For a contract or trial: after the end date Firefly stops expecting the bill. The second date is a reminder to renew or cancel.</p><label>Group (optional)<input type="text" id="bl-group" list="dl-groups" value="${at ? at.object_group_title || '' : ''}" placeholder="e.g. Housing, Subscriptions"></label><datalist id="dl-groups">${htmlList([...new Set(Object.values<any>(S.billCache || {}).map(x => x.object_group_title).filter(Boolean))].map(g => html`<option value="${g}">`))}</datalist><label>Notes<textarea id="bl-notes" rows="3">${at ? at.notes || '' : ''}</textarea></label><label class="check"><input type="checkbox" id="bl-active"${!at || at.active !== false ? ' checked' : ''}> Active</label>${S.form.payee ? html`<label class="check"><input type="checkbox" id="bl-rule" checked> Link charges from ${S.form.payee} to this bill, past and future (creates a rule)</label>` : ''}<button type="submit" hidden></button></form>`,
    html`${id ? html`<button class="btn danger" data-onclick="App.deleteThing('bills','${id}','bill')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="billSave" data-onclick="App.submit('billForm')">${id ? 'Save' : 'Create bill'}</button>`);
}
async function saveBill() {
  const id = S.form.id, v = (x: string) => el<Field>(x).value.trim();
  const mn = num(v('bl-min')), mx = num(v('bl-max'));
  if (!v('bl-name')) return formError('Give the bill a name.');
  if (mx < mn) return formError('The highest amount can’t be below the lowest.');
  const body: any = { name: v('bl-name'), amount_min: String(mn), amount_max: String(mx), date: v('bl-date'), repeat_freq: v('bl-freq'), skip: parseInt(v('bl-skip') || '0', 10), active: el<HTMLInputElement>('bl-active').checked, notes: el<HTMLTextAreaElement>('bl-notes').value, object_group_title: v('bl-group') };
  // Firefly's bill fields end_date and extension_date; on an edit, an empty box clears the date
  const endD = v('bl-end'), extD = v('bl-ext');
  if (endD && extD && extD > endD) return formError('Renew or cancel by a date before the bill ends.');
  if (id || endD) body.end_date = endD || null;
  if (id || extD) body.extension_date = extD || null;
  if (!id) body.currency_code = S.currency;
  await busy(el('billSave'), async () => {
    await api(id ? '/bills/' + id : '/bills', { method: id ? 'PUT' : 'POST', body });
    const linked = !id && S.form.payee && el<HTMLInputElement>('bl-rule') && el<HTMLInputElement>('bl-rule').checked;
    if (linked) await billRule(body.name, S.form.payee);
    invalidate(); closeDrawer(); toast(id ? 'Bill saved' : linked ? 'Bill created · past charges linked' : 'Bill created'); route();
  });
}

/* Pay now: opens the new-transaction form filled in from the bill (name, amount, today, the bill link) and, from the bill's latest charge, the
   account, category and budget it was paid with. Nothing is saved until the form is confirmed. */
async function billPay(id: string) {
  const at = S.billCache && S.billCache[id]; if (!at) return;
  await lists();
  let last: ApiData | null = null;
  try { const gs = await api('/bills/' + id + '/transactions?limit=1'); const t = gs.data && gs.data[0] && (gs.data[0].attributes.transactions || [])[0]; if (t && t.type === 'withdrawal') last = t; } catch { /* the form still opens without them */ }
  const fixed = num(at.amount_min) === num(at.amount_max), L = S.lists!;
  const amount = fixed || !last ? billAmount(at) : num(last.amount);
  const own = last && L.own.some(a => String(a.id) === String(last!.source_id)) ? String(last.source_id) : '';
  newTx({ type: 'withdrawal', description: at.name, amount: String(Math.round(amount * 100) / 100), counter: last && last.destination_name || at.name, bill: id,
    category: last && last.category_name || '', budget: last && last.budget_id ? String(last.budget_id) : '', ...(own ? { account: own } : {}) });
}

// Pay now on a credit card (Overview): a transfer into the card for what is owed; nothing is saved until the form is confirmed
async function cardPay(id: string) {
  await lists();
  const a = S.lists!.accounts.find(x => String(x.id) === String(id)); if (!a) return;
  newTx({ type: 'transfer', description: 'Payment to ' + a.name, amount: String(Math.round(Math.max(0, -a.balance) * 100) / 100), dest: String(a.id) });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  billForm,
  billPay,
  cardPay,
  saveBill,
  subAdd,
  subIgnore,
  billRaise,
  billsView,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

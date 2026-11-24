import { html, htmlList } from '../core/html';
import { AuthError, api, getAll } from '../core/api';
import { busy, showLogin } from '../core/auth';
import { App, S, arr, el, fmtDay, money, money0, monthRange, num, sumDiff, todayIso, type ApiData, type Period, viewPeriod, spentSum } from '../core/base';
import { inPrimary, isForeign } from '../core/fx';
import { addDays, budgetAlert, daysBetween } from '../core/helpers';
import { closeDrawer, confirmBox, formError, head, monthNav, openDrawer, opt, toast, emptyState } from '../core/dom';
import { invalidate, lists, type Lists } from '../core/lists';
import { VIEWS, hashWith, route } from '../core/router';
import { budgetsLessRefunds, insight, refundsIn } from '../features/refunds';
import { pairBars, ring } from '../features/charts';
import { type BMonth, budgetCard, budgetInsight } from '../features/budgetinsight';
import { normGroup } from '../core/feed';
import { customizeButton, pageCard, pageOpt } from '../features/pageopts';
import { emptyNote, kpi } from '../core/ui';

/* ================= Budgets ================= */
const AUTO_PERIODS = [['weekly', 'Week', '/wk'], ['monthly', 'Month', '/mo'], ['quarterly', 'Quarter', '/qtr'], ['half_year', 'Half year', '/6 mo'], ['yearly', 'Year', '/yr']];
const AUTO_LABEL: Record<string, string> = { reset: 'Same amount', rollover: 'Rolls over', adjusted: 'Adjusts for overspending' };
// What a rollover or adjusted auto-budget moved into this month: the month's amount minus the usual amount
function carried(b: { lim?: BudgetLimit, auto: string, autoPeriod: string, autoAmt: number }) {
  if (!b.lim || !['rollover', 'adjusted'].includes(b.auto) || b.autoPeriod !== 'monthly') return '';
  const d = b.lim.amount - b.autoAmt;
  if (Math.abs(d) < 1) return '';
  return html`<div class="sub-s">${d > 0 ? 'Includes ' + money(d) + ' carried over from last month' : html`<span class="up">${money(-d)} less</span> after overspending last month`}</div>`;
}
// How a budget is doing against the time gone by in its month: where spending "should" be today (at: 0–1 of the month),
// and the day it runs out at the pace so far. Only for the month that includes today.
export function budgetPace(spent: number, amount: number, start: string, end: string, today: string, alertPct: number) {
  if (!amount || today < start || today > end) return null;
  const len = daysBetween(start, end) + 1, gone = daysBetween(start, today) + 1, at = gone / len, used = spent / amount;
  if (used > 1) return { at, tone: 'over', text: '' };
  const left = len - gone + 1;      // days left including today, same count as the budget detail card's "days left"
  if (used * 100 >= alertPct) return { at, tone: 'warn', text: Math.round(used * 100) + '% used with ' + left + ' day' + (left === 1 ? '' : 's') + ' to go' };
  const runDay = spent > 0 ? Math.ceil(amount / (spent / gone)) : Infinity;
  if (gone >= 3 && runDay <= len) return { at, tone: 'warn', text: 'Ahead of pace · may run out around ' + fmtDay(addDays(start, runDay - 1)) };
  return { at, tone: 'ok', text: used <= at ? 'On pace' : 'A little ahead of pace' };
}
// This period's amount for each budget, by budget id
// A budget can have several amounts that overlap the period (an auto-budget that resets every week has one per week),
// so a budget's amount is the sum of them, each counted for the part of it that falls inside the period. `parts` are
// the amounts as Firefly has them; `id` is the one amount to edit, when the budget has exactly one.
// amount is in the main currency (core/fx.ts); cur is set when Firefly keeps this one in another currency
export type LimitPart = { id: string, amount: number, start: string, end: string, cur?: string };
export type BudgetLimit = { id: string, amount: number, parts: LimitPart[] };
export function limitTotal(parts: LimitPart[], per: { start: string, end: string }) {
  let sum = 0;
  parts.forEach(p => {
    const from = p.start && p.start > per.start ? p.start : per.start, to = p.end && p.end < per.end ? p.end : per.end;
    if (to < from) return;
    const whole = p.start && p.end && p.end >= p.start ? daysBetween(p.start, p.end) + 1 : 0;
    sum += whole ? p.amount * (daysBetween(from, to) + 1) / whole : p.amount;
  });
  return Math.round(sum * 100) / 100;
}
export async function budgetLimits(cur: Period, L: Lists) {
  const parts: Record<string, LimitPart[]> = {}, out: Record<string, BudgetLimit> = {};
  const take = (bid: string, x: ApiData) => {
    const at = x.attributes || {};
    (parts[String(bid)] = parts[String(bid)] || []).push({ id: String(x.id), amount: inPrimary(at.amount, at.currency_code), start: String(at.start || '').slice(0, 10), end: String(at.end || '').slice(0, 10), ...(isForeign(at.currency_code) ? { cur: String(at.currency_code) } : {}) });
  };
  const done = () => { Object.entries(parts).forEach(([bid, ps]) => { out[bid] = { id: ps.length === 1 ? ps[0].id : '', amount: limitTotal(ps, cur), parts: ps }; }); return out; };
  try {
    const all = await getAll('/budget-limits', { start: cur.start, end: cur.end });
    all.forEach(x => take(x.attributes.budget_id, x));
  } catch (e) {
    Object.keys(parts).forEach(k => delete parts[k]);
    await Promise.all(L.budgets.map(b => getAll('/budgets/' + b.id + '/limits', { start: cur.start, end: cur.end }).then(ls => ls.forEach(x => take(b.id, x))).catch(() => {})));
  }
  return done();
}
// Each budget's last `n` months up to y/m: what it spent on each day (less refunds of its purchases) and its amount
// Budget insights (budgetinsight.ts) are worked out from these. Throws when Firefly can't be reached: nothing is kept.
export async function budgetHistory(y: number, m: number, n: number, L: Lists) {
  const per = Array.from({ length: n }, (_, i) => monthRange(y, m - (n - 1 - i))), start = per[0].start, end = per[n - 1].end;
  const parts: Record<string, LimitPart[]> = {};
  const take = (bid: string, x: ApiData) => {
    const at = x.attributes || {};
    (parts[String(bid)] = parts[String(bid)] || []).push({ id: String(x.id), amount: inPrimary(at.amount, at.currency_code), start: String(at.start || '').slice(0, 10), end: String(at.end || '').slice(0, 10), ...(isForeign(at.currency_code) ? { cur: String(at.currency_code) } : {}) });
  };
  const limitsP = getAll('/budget-limits', { start, end }).then(all => all.forEach(x => take(x.attributes.budget_id, x))).catch(async () => {
    Object.keys(parts).forEach(k => delete parts[k]);
    await Promise.all(L.budgets.map(b => getAll('/budgets/' + b.id + '/limits', { start, end }).then(ls => ls.forEach(x => take(b.id, x)))));
  });
  const [txs, , rs] = await Promise.all([getAll('/transactions', { start, end, type: 'withdrawal' }), limitsP, refundsIn(start, end)]);
  const days = per.map(p => daysBetween(p.start, p.end) + 1), daily: Record<string, number[][]> = {};
  const slot = (bid: string) => daily[bid] || (daily[bid] = days.map(d => Array(d).fill(0)));
  const add = (bid: string, date: string, v: number) => {
    const d = date.slice(0, 10), k = per.findIndex(p => d >= p.start && d <= p.end);
    if (k >= 0 && bid) slot(bid)[k][daysBetween(per[k].start, d)] += v;
  };
  txs.map(normGroup).forEach(g => g.splits.forEach(s => { if (s.type === 'withdrawal' && s.budget_id) add(s.budget_id, String(s.date), s.amount); }));
  rs.forEach(r => add(r.budgetId, r.date, -r.amount));
  const out: Record<string, BMonth[]> = {};
  new Set([...Object.keys(daily), ...Object.keys(parts)]).forEach(bid => {
    out[bid] = per.map((p, k) => {
      const dd = slot(bid)[k], total = dd.reduce((a, v) => a + v, 0);
      return { start: p.start, end: p.end, label: p.label, short: p.short, daily: dd.map(v => Math.max(0, v)), spent: Math.max(0, Math.round(total * 100) / 100), limit: parts[bid] ? limitTotal(parts[bid], p) : 0 };
    });
  });
  return out;
}
VIEWS.budgets = async (r, paint) => {
  const L = await lists();
  const cur = viewPeriod(r), all = !!cur.all;   // All time shows what was spent; amounts are set per month
  const rs = refundsIn(cur.start, cur.end);   // refunds of purchases on a budget come off what it spent (see refunds.ts)
  const t0 = todayIso(), showHist = !all && !r.at && cur.start <= t0 && pageCard('budgets', 'insights');
  const hist = showHist ? budgetHistory(cur.y!, cur.m!, pageOpt('budgets', 'months'), L).catch(e => { if (e instanceof AuthError) throw e; return null; }) : Promise.resolve(null);
  const [res, limits, noBudget, avail, history] = await Promise.all([
    Promise.all([api('/budgets', { params: { start: cur.start, end: cur.end } }), rs]).then(([b, x]) => budgetsLessRefunds(arr(b), x)), all ? {} as Record<string, BudgetLimit> : budgetLimits(cur, L),
    insight('/insight/expense/no-budget', { start: cur.start, end: cur.end }, rs).catch(() => []),
    all ? { data: [] } : api('/available-budgets', { params: { start: cur.start, end: cur.end } }).catch(() => ({ data: [] })),
    hist,
  ]);
  if (r.at) return;     // loading a month ahead
  const available = arr(avail).reduce((s, x) => s + inPrimary(x.attributes.amount, x.attributes.currency_code), 0);
  const showInactive = r.q.inactive === '1';
  const bs = arr(res).map(b => ({ id: String(b.id), name: b.attributes.name, active: b.attributes.active !== false, notes: b.attributes.notes || '',
    auto: b.attributes.auto_budget_type && b.attributes.auto_budget_type !== 'none' ? b.attributes.auto_budget_type : '', autoAmt: num(b.attributes.auto_budget_amount), autoPeriod: b.attributes.auto_budget_period || 'monthly',
    spent: spentSum(b), lim: limits[String(b.id)] }));
  const visible = bs.filter(b => b.active || showInactive), t = todayIso(), alertPct = budgetAlert();
  // Customize: the order, the today marker, and a chart of the month above the list
  const sort = pageOpt('budgets', 'sort'), usedOf = (b: typeof bs[0]) => b.lim && b.lim.amount ? b.spent / b.lim.amount : -1, leftOf = (b: typeof bs[0]) => b.lim ? b.lim.amount - b.spent : -Infinity;
  if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'used') visible.sort((a, b) => usedOf(b) - usedOf(a));
  if (sort === 'left') visible.sort((a, b) => leftOf(b) - leftOf(a));
  if (sort === 'spent') visible.sort((a, b) => b.spent - a.spent);
  const showPace = pageOpt('budgets', 'pace'), kind = all ? 'none' : pageOpt('budgets', 'chart'), set = visible.filter(b => b.lim && b.lim.amount);
  const chart = kind === 'none' ? '' : html`<section class="panel chart" style="margin-bottom:20px"><h2>${kind === 'rings' ? 'How each budget is doing' : 'Spent vs. budgeted'}</h2><p class="lead">${cur.label}</p>${!set.length ? html`${emptyNote(html`No amounts set for ${cur.short} yet.`)}`
    : kind === 'rings' ? html`<div class="brings page-rings">${htmlList(set.map(b => { const pct = b.spent / b.lim!.amount * 100; return html`<a class="bring" href="#/transactions?budget=${b.id}">${ring(pct, pct > 100 ? 'over' : pct >= alertPct ? 'warn' : 'good')}<span class="name">${b.name}</span><span class="sub-s num">${pct > 100 ? html`<span class="up">${money0(b.spent - b.lim!.amount)} over</span>` : money0(b.lim!.amount - b.spent) + ' left'}</span></a>`; }))}</div>`
    : pairBars(set.map(b => ({ label: b.name, tip: b.name, a: b.lim!.amount, b: b.spent, go: '#/transactions?budget=' + b.id })), ['Budgeted', 'Spent'], ['color-mix(in srgb, var(--muted) 40%, transparent)', 'var(--spend)'], 'Each budget’s amount and what was spent')}</section>`;
  const totLim = visible.reduce((s, b) => s + (b.lim ? b.lim.amount : 0), 0), totSpent = visible.reduce((s, b) => s + b.spent, 0), unb = sumDiff(noBudget), left = totLim - visible.reduce((s, b) => s + (b.lim && b.lim.amount ? b.spent : 0), 0);      // left of what's planned: spending in a budget with no amount isn't taken off it
  const rows = htmlList(visible.map(b => {
    const pct = b.lim && b.lim.amount ? b.spent / b.lim.amount * 100 : 0, pace = b.lim && !all ? budgetPace(b.spent, b.lim.amount, cur.start, cur.end, t, alertPct) : null;
    return html`<tr${b.active ? '' : html` style="opacity:.5"`}><td class="namecol"><a class="desc" href="#/transactions?budget=${b.id}" style="text-decoration:none">${b.name}</a>${b.lim ? html`<div class="track pace" style="max-width:360px"><div class="fill ${pct > 100 ? 'over' : pace && pace.tone === 'warn' ? 'warn' : 'good'}" style="width:${Math.min(100, pct).toFixed(1)}%"></div>${pace && showPace ? html`<i class="today" style="left:${(pace.at * 100).toFixed(1)}%" title="Today"></i>` : ''}</div><div class="sub-s"><span class="show-s">${money(b.spent)} spent · </span>${pct > 100 ? html`<span class="up">${money(b.spent - b.lim.amount)} over</span>` : money(b.lim.amount - b.spent) + ' left · ' + pct.toFixed(0) + '% used'}${pace && pace.text ? html` · <span class="${pace.tone === 'warn' ? 'up' : 'neutral'}">${pace.text}</span>` : ''}</div>` : all ? '' : html`<div class="sub-s">No amount set for ${cur.short}</div>`}${b.lim ? '' : html`<div class="sub-s show-s">${money(b.spent)} spent</div>`}${all ? '' : carried(b)}${b.auto ? html`<span class="chip" title="Auto-budget: Firefly sets the amount each period">${AUTO_LABEL[b.auto] || b.auto} · ${money0(b.autoAmt)}${(AUTO_PERIODS.find(x => x[0] === b.autoPeriod) || ['', '', ''])[2]}</span>` : ''}</td><td class="amt hide-s">${money(b.spent)}</td>${all ? '' : html`<td class="r"><input class="inline num" type="number" min="0" step="1" placeholder="Set…" value="${b.lim ? b.lim.amount : ''}" data-onchange="App.setLimit('${b.id}',this)" aria-label="Budget for ${b.name}"></td>`}<td class="act"><button class="btn small" data-onclick="App.budgetForm('${b.id}')">Edit</button></td></tr>`;
  }));
  const inactiveCount = bs.filter(b => !b.active).length;
  const nHist = pageOpt('budgets', 'months') as number;
  const cards = showHist && history ? visible.map(b => { const ms = history[b.id]; return ms && ms.some(m => m.limit > 0 || m.spent > 0) ? budgetCard(b, budgetInsight(ms, t, alertPct), alertPct) : ''; }).filter(Boolean) : [];
  const insights = !showHist ? '' : html`<section class="bi-wrap"><div class="panel-head"><h2>Budget insights</h2></div><p class="lead">${history ? 'Each budget over the last ' + nHist + ' months, to ' + cur.label + ' · average, pace and where this month is heading' : 'Budget history'}</p>${!history ? html`${emptyNote('Couldn’t load the budget history. Try again in a moment.')}` : cards.length ? html`<div class="binsights">${htmlList(cards)}</div>` : html`${emptyNote(html`Nothing spent in a budget over the last ${nHist} months yet.`)}`}</section>`;
  paint(html`${head('Budgets', '', html`${monthNav()}${customizeButton('budgets')}<button class="btn primary" data-onclick="App.budgetForm()">+ New budget</button>`)}${pageCard('budgets', 'kpis') ? html`<div class="kpis">${available ? html`<div class="kpi"><div class="eyebrow">Available to budget</div><div class="val num">${money0(available)}</div><div class="sub-s">${available - totLim >= 0 ? money0(available - totLim) + ' not yet assigned' : html`<span class="up">${money0(totLim - available)} more assigned than available</span>`}</div></div>` : ''}${all ? '' : html`${kpi('Budgeted', money0(totLim), null)}`}${kpi('Spent in budgets', money0(totSpent), null)}${all ? '' : html`${kpi('Left', money0(left), null, left < 0 ? 'neg' : '')}`}${kpi('Spent outside budgets', money0(unb), null)}</div>` : ''}${chart}<section class="panel flush">${rows ? html`<table class="tbl"><thead><tr><th>Budget</th><th class="r hide-s">Spent</th>${all ? '' : html`<th class="r"><span class="hide-s">Budget for ${cur.short}</span><span class="show-s">Amount</span></th>`}<th></th></tr></thead><tbody>${rows}</tbody></table>`
      : emptyState('budgets', 'No budgets yet', 'Give a category a monthly limit and see how fast you are using it, with a warning before you go over.', html`<button class="btn primary" data-onclick="App.budgetForm()">+ New budget</button>`)}</section>${insights}${inactiveCount ? html`<p style="margin-top:14px"><a class="link" href="${hashWith({ inactive: showInactive ? '' : '1' })}">${showInactive ? 'Hide' : 'Show'} ${inactiveCount} inactive</a></p>` : ''}<p class="sub-s" style="margin-top:14px">${all ? 'Budget amounts are set per month. Pick a month to set them.' : 'Type an amount in the right column and press Enter to set that month’s budget. Clear it to remove it.'}</p>`);
  S.budgetLimits = limits; S.budgetCache = Object.fromEntries(bs.map(b => [b.id, b]));
};
async function setLimit(bid: string, input: HTMLInputElement) {
  const cur = monthRange(S.y, S.m), lim = (S.budgetLimits || {})[bid], val = input.value.trim(), clear = val === '' || num(val) <= 0, parts: LimitPart[] = lim ? lim.parts : [];
  // The amount typed is in the main currency (that's what the column shows), so a limit Firefly kept in another currency is saved as a main-currency one
  const body = { amount: String(num(val)), start: cur.start, end: cur.end, ...(parts.some(p => p.cur) ? { currency_code: S.currency } : {}) };
  // Several amounts (weekly auto-budget, say) can't be edited as one number: the new amount replaces them all, once the person agrees
  if (parts.length > 1 && !await confirmBox(clear ? 'Remove all ' + parts.length + ' amounts?' : 'Replace ' + parts.length + ' amounts with one?',
    clear ? 'This budget has ' + parts.length + ' amounts this month. They will all be removed.' : 'This budget has ' + parts.length + ' amounts this month (' + money0(lim.amount) + ' in all). They will be replaced by one amount of ' + money0(num(val)) + '.', clear ? 'Remove' : 'Replace')) { input.value = String(lim.amount); return; }
  input.disabled = true;
  try {
    if (clear) await Promise.all(parts.map(p => api('/budgets/' + bid + '/limits/' + p.id, { method: 'DELETE' })));
    else if (parts.length === 1) await api('/budgets/' + bid + '/limits/' + parts[0].id, { method: 'PUT', body });
    else {
      if (parts.length) await Promise.all(parts.map(p => api('/budgets/' + bid + '/limits/' + p.id, { method: 'DELETE' })));
      await api('/budgets/' + bid + '/limits', { method: 'POST', body: { ...body, currency_code: S.currency } });
    }
    toast('Budget updated'); route();
  } catch (e) { input.disabled = false; if (e instanceof AuthError) return showLogin(e.message); toast((e as Error).message); }
}
async function budgetForm(id?: string) {
  const L = await lists(true), b = id ? L.budgets.find(x => x.id === id) : null;
  S.form = { id };
  openDrawer(id ? 'Edit budget' : 'New budget',
    html`<form id="budForm" data-onsubmit="event.preventDefault();App.saveBudget()"><label>Name<input type="text" id="b-name" value="${b ? b.name : ''}" required></label>${!id ? html`<label>Amount for ${monthRange(S.y, S.m).label} (optional)<input type="number" min="0" step="1" id="b-amount"></label>` : ''}${(() => { const bc = (S.budgetCache || {})[String(id)] || {}; return html`<div class="grid2"><label>Auto-budget<select id="b-auto">${htmlList([['none', 'Off'], ['reset', 'Same amount every month'], ['rollover', 'Roll over what’s left'], ['adjusted', 'Adjust for overspending']].map(([v, l]) => opt(v, l, bc.auto || 'none')))}</select></label><label>Amount<input type="number" min="0" step="1" id="b-autoamt" value="${bc.autoAmt || ''}"></label></div><label>Every<select id="b-autoper">${htmlList(AUTO_PERIODS.map(([v, l]) => opt(v, l, bc.autoPeriod || 'monthly')))}</select></label><p class="hint">Firefly sets the budget’s amount at the start of each period. “Roll over” carries what’s left (or overspent) into the next period; “Adjust” only takes off what you overspent.</p>`; })()}<label>Notes<textarea id="b-notes" rows="3">${b ? b.notes : ''}</textarea></label>${id ? html`<label class="check"><input type="checkbox" id="b-active"${b!.active ? ' checked' : ''}> Active</label>` : ''}<button type="submit" hidden></button></form>`,
    html`${id ? html`<button class="btn danger" data-onclick="App.deleteThing('budgets','${id}','budget')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="budSave" data-onclick="App.submit('budForm')">${id ? 'Save' : 'Create budget'}</button>`);
}
async function saveBudget() {
  const id = S.form.id, name = el<HTMLInputElement>('b-name').value.trim();
  if (!name) return formError('Give the budget a name.');
  await busy(el('budSave'), async () => {
    const body: any = { name, notes: el<HTMLTextAreaElement>('b-notes').value };
    const auto = el<HTMLSelectElement>('b-auto').value, autoAmt = num(el<HTMLInputElement>('b-autoamt').value);
    if (auto !== 'none' && !(autoAmt > 0)) throw new Error('Set the monthly amount for the auto-budget.');
    body.auto_budget_type = auto;
    if (auto !== 'none') { body.auto_budget_amount = String(autoAmt); body.auto_budget_period = el<HTMLSelectElement>('b-autoper').value; body.auto_budget_currency_code = S.currency; }
    if (id) { body.active = el<HTMLInputElement>('b-active').checked; await api('/budgets/' + id, { method: 'PUT', body }); }
    else {
      const res = await api('/budgets', { method: 'POST', body: { ...body, active: true } });
      const amt = num(el<HTMLInputElement>('b-amount').value), cur = monthRange(S.y, S.m);
      if (amt > 0 && res && res.data) await api('/budgets/' + res.data.id + '/limits', { method: 'POST', body: { amount: String(amt), start: cur.start, end: cur.end, currency_code: S.currency } });
    }
    invalidate(); closeDrawer(); toast(id ? 'Budget saved' : 'Budget created'); route();
  });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  setLimit,
  budgetForm,
  saveBudget,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { busy, withAuth } from '../core/auth';
import { App, S, el, fmtDate, fmtDay, money, num, sameName, todayIso, type ApiData, type Field } from '../core/base';
import { closeDrawer, confirmBox, formError, head, openDrawer, opt, toast } from '../core/dom';
import { invalidate, isLiab, lists } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { accountOptions } from '../features/txform';

/* ================= Recurring ================= */
const REPEAT_LABEL: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
VIEWS.recurring = async (r, paint) => {
  await lists();
  const recs = await getAll('/recurrences');
  S.recCache = Object.fromEntries(recs.map(x => [String(x.id), x.attributes]));
  const rows = htmlList(recs.map(x => {
    const at = x.attributes, t = (at.transactions || [])[0] || {}, rep = (at.repetitions || [])[0] || {};
    const next = (at.repetitions || []).flatMap((p: ApiData) => p.occurrences || []).sort().filter((d: string) => String(d).slice(0, 10) >= todayIso()).slice(0, 3);
    const sign = at.type === 'withdrawal' ? 'neg' : at.type === 'deposit' ? 'pos' : 'neutral';
    const ends = at.repeat_until ? 'until ' + fmtDate(at.repeat_until) : at.nr_of_repetitions ? at.nr_of_repetitions + ' times' : '';
    return html`<tr class="click" data-onclick="App.recurForm('${x.id}')"${at.active === false ? html` style="opacity:.5"` : ''}><td><div class="desc">${at.title}${at.active === false ? html` <span class="chip">Inactive</span>` : ''}</div><div class="sub-s">${rep.description || ''}${ends ? ' · ' + ends : ''}</div></td><td class="fromto hide-s">${t.source_name || ''} → ${t.destination_name || ''}</td><td class="hide-s">${next.length ? htmlList(next.map((d: string) => html`<span class="chip">${fmtDay(d)}</span>`)) : html`<span class="neutral">—</span>`}</td><td class="amt ${sign}">${money(num(t.amount))}</td></tr>`;
  }));
  paint(html`${head('Recurring', 'Transactions Firefly creates for you automatically on a schedule', html`<button class="btn primary" data-onclick="App.recurForm()">+ New recurring</button>`)}<section class="panel flush">${rows ? html`<table class="tbl"><thead><tr><th>Name</th><th class="hide-s">From → To</th><th class="hide-s">Next</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>`
      : html`<div class="center-empty">Nothing recurring yet. Add rent, a salary or a subscription and Firefly will create it for you each time.</div>`}</section><p class="sub-s" style="margin-top:14px">Firefly creates these transactions on its daily cron job, so make sure the cron is set up in your Firefly install.</p>`);
};
function recurForm(id?: string, forceType?: string) {
  const L = S.lists!, at = id ? S.recCache![id] : null, rep = at ? (at.repetitions || [])[0] || {} : {};
  const type = forceType || (at ? at.type : 'withdrawal');
  const t = at && at.type === type ? (at.transactions || [])[0] || {} : at ? { amount: ((at.transactions || [])[0] || {}).amount, description: ((at.transactions || [])[0] || {}).description } : {};
  S.form = { id, type, origType: type };
  const main = type === 'deposit' ? t.destination_id : t.source_id;
  const counter = type === 'deposit' ? t.source_name : t.destination_name;
  const firstDate = at ? String(at.first_date).slice(0, 10) : todayIso();
  const endMode = at && at.repeat_until ? 'date' : at && at.nr_of_repetitions ? 'count' : 'never';
  const typeBtn = (v: string, l: string) => html`<button type="button" class="${type === v ? 'on' : ''}" data-onclick="App.recurType('${v}')">${l}</button>`;
  const counterList = type === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  openDrawer(id ? 'Edit recurring transaction' : 'New recurring transaction',
    html`<form id="recForm" data-onsubmit="event.preventDefault();App.saveRecur()"><div class="seg">${typeBtn('withdrawal', 'Expense')}${typeBtn('deposit', 'Income')}${typeBtn('transfer', 'Transfer')}</div><label>Name<input type="text" id="rc-title" value="${at ? at.title : ''}" required placeholder="e.g. Rent"></label><div class="grid2"><label>Amount<input type="number" step="0.01" min="0.01" id="rc-amount" value="${t.amount ? num(t.amount) : ''}" required></label><label>Description on each transaction<input type="text" id="rc-desc" value="${t.description || ''}" placeholder="Same as name"></label></div>${type === 'transfer' ? html`<div class="grid2"><label>From<select id="rc-src">${accountOptions(t.source_id, true)}</select></label><label>To<select id="rc-dst">${accountOptions(t.destination_id, true)}</select></label></div>`
      : html`<div class="grid2"><label>${type === 'withdrawal' ? 'Paid from' : 'Deposited into'}<select id="rc-main">${accountOptions(main || (L.own[0] || {}).id, true)}</select></label><label>${type === 'withdrawal' ? 'Paid to' : 'Received from'}<input type="text" id="rc-counter" list="rc-dl" value="${counter && counter !== 'Cash account' ? counter : ''}" required></label></div><datalist id="rc-dl">${htmlList(counterList.map(a => html`<option value="${a.name}">`))}</datalist>`}<div class="grid2"><label>Category<input type="text" id="rc-cat" list="rc-dlcat" value="${t.category_name || ''}"></label>${type === 'withdrawal' ? html`<label>Budget<select id="rc-bud">${opt('', 'None', t.budget_id || '')}${htmlList(L.budgets.filter(b => b.active).map(b => opt(b.id, b.name, String(t.budget_id || ''))))}</select></label>` : html`<span></span>`}</div><datalist id="rc-dlcat">${htmlList(L.categories.map(c => html`<option value="${c.name}">`))}</datalist><div class="grid2"><label>First date<input type="date" id="rc-first" value="${firstDate}" required></label><label>Repeats every<div style="display:flex;gap:8px;margin-top:5px"><input type="number" min="1" step="1" id="rc-every" value="${(rep.skip || 0) + 1}" style="width:70px"><select id="rc-freq" style="flex:1">${htmlList(['monthly', 'weekly', 'yearly', 'daily'].map(v => opt(v, REPEAT_LABEL[v] + '(s)', rep.type || 'monthly')))}</select></div></label></div><p class="hint">It repeats on the same day as the first date (e.g. the 1st of each month).</p><div class="grid2"><label>If it falls on a weekend<select id="rc-weekend">${htmlList([[1, 'Create it anyway'], [2, 'Skip it'], [3, 'Move to the Friday before'], [4, 'Move to the Monday after']].map(([v, l]) => opt(v, l, rep.weekend || 1)))}</select></label><label>Ends<select id="rc-endmode" data-onchange="App.recurEnds()">${opt('never', 'Never', endMode)}${opt('date', 'On a date', endMode)}${opt('count', 'After a number of times', endMode)}</select></label></div><div class="grid2"><label id="rc-until-l"${endMode === 'date' ? '' : ' hidden'}>End date<input type="date" id="rc-until" value="${at && at.repeat_until ? String(at.repeat_until).slice(0, 10) : ''}"></label><label id="rc-count-l"${endMode === 'count' ? '' : ' hidden'}>Number of times<input type="number" min="1" id="rc-count" value="${at && at.nr_of_repetitions || ''}"></label></div><label>Notes<textarea id="rc-notes" rows="2">${at ? at.notes || '' : ''}</textarea></label><label class="check"><input type="checkbox" id="rc-rules"${!at || at.apply_rules ? ' checked' : ''}> Run my rules on each transaction it creates</label><label class="check"><input type="checkbox" id="rc-active"${!at || at.active !== false ? ' checked' : ''}> Active</label><button type="submit" hidden></button></form>`,
    html`${id ? html`<button class="btn danger" data-onclick="App.deleteRecur('${id}')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="recSave" data-onclick="App.submit('recForm')">${id ? 'Save' : 'Create'}</button>`);
}
function recurType(t: string) {
  const keep = ['rc-title', 'rc-amount', 'rc-desc', 'rc-cat', 'rc-first', 'rc-every', 'rc-notes'].map(k => [k, el<Field>(k) ? el<Field>(k).value : '']);
  recurForm(S.form.id, t);
  keep.forEach(([k, v]) => { if (el(k)) el<Field>(k).value = v; });
}
function recurEnds() { const m = el<HTMLSelectElement>('rc-endmode').value; el('rc-until-l').hidden = m !== 'date'; el('rc-count-l').hidden = m !== 'count'; }
async function accountIdFor(name: string, kind: string) {
  const L = S.lists!, pool = kind === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  const hit = pool.find(a => sameName(a.name, name));
  if (hit) return hit.id;
  const res = await api('/accounts', { method: 'POST', body: { name: name.trim(), type: kind === 'withdrawal' ? 'expense' : 'revenue' } });
  return String(res.data.id);
}
async function categoryIdFor(name: string) {
  if (!name) return '';
  const hit = S.lists!.categories.find(c => sameName(c.name, name));
  if (hit) return hit.id;
  const res = await api('/categories', { method: 'POST', body: { name: name.trim() } });
  return String(res.data.id);
}
async function saveRecur() {
  const f = S.form, v = (x: string) => el<Field>(x) ? el<Field>(x).value.trim() : '';
  const type = f.type;
  if (!v('rc-title')) return formError('Give it a name.');
  if (!(num(v('rc-amount')) > 0)) return formError('Enter an amount above zero.');
  await busy(el('recSave'), async () => {
    const tx: any = { description: v('rc-desc') || v('rc-title'), amount: String(num(v('rc-amount'))), currency_code: S.currency };
    if (type === 'transfer') {
      if (!v('rc-src') || !v('rc-dst') || v('rc-src') === v('rc-dst')) throw new Error('Choose two different accounts.');
      tx.source_id = v('rc-src'); tx.destination_id = v('rc-dst');
    } else {
      if (!v('rc-main')) throw new Error('Choose the account.');
      if (!v('rc-counter')) throw new Error('Say who it is ' + (type === 'withdrawal' ? 'paid to.' : 'received from.'));
      const other = await accountIdFor(v('rc-counter'), type);
      if (type === 'withdrawal') { tx.source_id = v('rc-main'); tx.destination_id = other; } else { tx.source_id = other; tx.destination_id = v('rc-main'); }
    }
    const cat = await categoryIdFor(v('rc-cat')); if (cat) tx.category_id = cat;
    if (type === 'withdrawal' && v('rc-bud')) tx.budget_id = v('rc-bud');
    const first = v('rc-first'), freq = v('rc-freq'), d = new Date(first + 'T12:00:00');
    const moment = freq === 'monthly' ? String(d.getDate()) : freq === 'weekly' ? String(d.getDay() || 7) : freq === 'yearly' ? first : '';
    const body: any = { type, title: v('rc-title'), first_date: first, apply_rules: el<HTMLInputElement>('rc-rules').checked, active: el<HTMLInputElement>('rc-active').checked, notes: el<HTMLTextAreaElement>('rc-notes').value,
      repetitions: [{ type: freq, moment, skip: Math.max(0, parseInt(v('rc-every') || '1', 10) - 1), weekend: parseInt(v('rc-weekend'), 10) }], transactions: [tx] };
    const mode = v('rc-endmode');
    if (mode === 'date') { if (!v('rc-until')) throw new Error('Pick the end date.'); body.repeat_until = v('rc-until'); }
    if (mode === 'count') { if (!(parseInt(v('rc-count'), 10) > 0)) throw new Error('Enter how many times.'); body.nr_of_repetitions = parseInt(v('rc-count'), 10); }
    await api(f.id ? '/recurrences/' + f.id : '/recurrences', { method: f.id ? 'PUT' : 'POST', body });
    invalidate(); closeDrawer(); toast(f.id ? 'Recurring transaction saved' : 'Recurring transaction created'); route();
  });
}
async function deleteRecur(id: string) {
  if (!await confirmBox('Delete this recurring transaction?', 'Transactions it already created stay. It won’t create new ones.')) return;
  await withAuth(async () => { await api('/recurrences/' + id, { method: 'DELETE' }); closeDrawer(); toast('Recurring transaction deleted'); route(); });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  recurForm,
  recurType,
  recurEnds,
  saveRecur,
  deleteRecur,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

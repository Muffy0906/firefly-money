import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { busy } from '../core/auth';
import { App, S, el, fmtDate, money, money0, num, todayIso, type ApiData, type Field } from '../core/base';
import { closeDrawer, formError, head, openDrawer, opt, toast } from '../core/dom';
import { isAsset, isCard, lists } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { goalPace } from '../features/pace';
import { ring } from '../features/charts';

/* ================= Piggy banks ================= */
// What a goal needs from here on, and a chip saying whether it keeps up (shared with the Overview's Savings goals card)
export function paceBits(p: Piggy) {
  const g = goalPace(p, todayIso());
  if (g.status === 'done') return { line: 'Goal reached', chip: html`<span class="chip good">Reached</span>` };
  if (g.status === 'open') return { line: money0(g.left) + ' to go', chip: '' };
  if (g.status === 'late') return { line: money0(g.left) + ' still to go, target date passed', chip: html`<span class="chip bad">Past due</span>` };
  return { line: 'Save ' + money0(g.perMonth) + '/month to reach it by ' + fmtDate(p.targetDate),
    chip: g.status === 'behind' ? html`<span class="chip warn" title="Where an even pace from the start date would be by now">${money0(g.gap)} behind</span>` : html`<span class="chip good">On track</span>` };
}
export type PiggyAccount = { id: string, name: string, amount: number };
export type Piggy = ReturnType<typeof normPiggy>;
export function normPiggy(p: ApiData) {
  const at = p.attributes || {};
  const accounts: PiggyAccount[] = (at.accounts || []).map((x: ApiData) => ({ id: String(x.account_id ?? x.id), name: x.name || x.account_name || '', amount: num(x.current_amount) }));
  if (!accounts.length && at.account_id) accounts.push({ id: String(at.account_id), name: at.account_name || '', amount: num(at.current_amount) });
  return { id: String(p.id), name: at.name, target: num(at.target_amount), current: num(at.current_amount), left: num(at.left_to_save), perMonth: num(at.save_per_month),
    targetDate: at.target_date || '', startDate: at.start_date || '', notes: at.notes || '', active: at.active !== false, accounts, group: at.object_group_title || '' };
}
VIEWS.piggy = async (r, paint) => {
  const L = await lists();
  const piggies = (await getAll('/piggy-banks')).map(normPiggy);
  S.piggyCache = Object.fromEntries(piggies.map(p => [p.id, p]));
  const saved = piggies.reduce((s, p) => s + p.current, 0), goal = piggies.reduce((s, p) => s + p.target, 0);
  piggies.sort((a, b) => a.group.localeCompare(b.group));
  const cards = htmlList(piggies.map((p, i) => {
    const heading = p.group && (i === 0 || piggies[i - 1].group !== p.group) ? html`<div class="eyebrow full" style="margin:6px 0 -6px">${p.group}</div>` : '';
    const pct = p.target ? Math.min(100, p.current / p.target * 100) : 0;
    return html`${heading}<section class="panel"><div class="panel-head"><h2>${p.name}</h2><button class="btn small" data-onclick="App.piggyForm('${p.id}')">Edit</button></div><p class="lead">${p.accounts.map(a => a.name || (L.byId[a.id] || {}).name).filter(Boolean).join(', ') || 'No account'}${p.targetDate ? ' · by ' + fmtDate(p.targetDate) : ''}</p><div class="goal">${ring(pct, 'good', 'saved')}<div><div class="total num" style="margin-bottom:2px">${money0(p.current)}</div><div class="neutral">of ${money0(p.target)}</div><div class="sub-s" style="margin-top:8px">${paceBits(p).line} ${paceBits(p).chip}</div></div></div><div style="display:flex;gap:8px"><button class="btn small" data-onclick="App.piggyMoney('${p.id}',1)">+ Add money</button><button class="btn small" data-onclick="App.piggyMoney('${p.id}',-1)">− Take out</button></div></section>`;
  }));
  paint(html`${head('Piggy banks', piggies.length ? money0(saved) + ' saved toward ' + money0(goal) + ' in goals' : 'Set money aside for goals', html`<button class="btn primary" data-onclick="App.piggyForm()">+ New piggy bank</button>`)}${cards ?
    html`<div class="flow" data-min="320">${cards}</div>` :
    html`<section class="panel"><div class="center-empty">No piggy banks yet.<br>Use one to set money aside in an account for a goal — a trip, tuition, an emergency fund.</div></section>`}`);
};
function piggyForm(id?: string) {
  const L = S.lists!, p: Piggy | null = id ? S.piggyCache![id] : null;
  S.form = { id };
  const accId = p && p.accounts[0] ? p.accounts[0].id : ((L.own.find(a => a.role === 'savingAsset') || L.own.find(a => isAsset(a) && !isCard(a)) || {}).id || '');
  openDrawer(id ? 'Edit piggy bank' : 'New piggy bank',
    html`<form id="pgForm" data-onsubmit="event.preventDefault();App.savePiggy()"><label>Name<input type="text" id="p-name" value="${p ? p.name : ''}" required></label><label>Account the money sits in<select id="p-acc"${id ? ' disabled' : ''}>${htmlList(L.own.filter(a => isAsset(a) && !isCard(a)).map(a => opt(a.id, a.name, accId)))}</select></label><div class="grid2"><label>Goal amount<input type="number" min="0.01" step="0.01" id="p-target" value="${p ? p.target : ''}" required></label><label>Target date (optional)<input type="date" id="p-date" value="${p && p.targetDate ? String(p.targetDate).slice(0, 10) : ''}"></label></div>${!id ? html`<label>Already saved (optional)<input type="number" min="0" step="0.01" id="p-current" placeholder="0.00"></label>` : ''}<label>Group (optional)<input type="text" id="p-group" list="dl-pgroups" value="${p ? p.group : ''}"></label><datalist id="dl-pgroups">${htmlList([...new Set(Object.values<any>(S.piggyCache || {}).map(x => x.group).filter(Boolean))].map(g => html`<option value="${g}">`))}</datalist><label>Notes<textarea id="p-notes" rows="3">${p ? p.notes : ''}</textarea></label><button type="submit" hidden></button></form>${id ? html`<div id="pgHistory"><p class="sub-s">Loading history…</p></div>` : ''}`,
    html`${id ? html`<button class="btn danger" data-onclick="App.deleteThing('piggy-banks','${id}','piggy bank')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="pgSave" data-onclick="App.submit('pgForm')">${id ? 'Save' : 'Create piggy bank'}</button>`);
  if (id) getAll('/piggy-banks/' + id + '/events').then(ev => {
    const box = el('pgHistory'); if (!box) return;
    box.innerHTML = String(html`<h3 style="font-size:14px;margin:8px 0 10px">History</h3>${ev.length ? html`<div class="list">${htmlList(ev.map(e => {
      const a = num(e.attributes.amount);
      return html`<div class="row"><span class="name">${fmtDate(e.attributes.created_at || e.attributes.date)}${e.attributes.transaction_journal_id ? html` <span class="sub-s">· from a transaction</span>` : ''}</span><span class="num ${a < 0 ? 'neg' : 'pos'}">${a > 0 ? '+' : ''}${money(a)}</span></div>`;
    }))}</div>` : html`<p class="empty">No changes yet.</p>`}`);
  }).catch(() => { const box = el('pgHistory'); if (box) box.innerHTML = ''; });
}
async function savePiggy() {
  const id = S.form.id, v = (x: string) => el<Field>(x) ? el<Field>(x).value.trim() : '';
  if (!v('p-name')) return formError('Give it a name.');
  if (!(num(v('p-target')) > 0)) return formError('Set a goal amount above zero.');
  const body: any = { name: v('p-name'), target_amount: String(num(v('p-target'))), notes: el<HTMLTextAreaElement>('p-notes').value, object_group_title: v('p-group') };
  if (v('p-date')) body.target_date = v('p-date');
  if (!id) {
    body.start_date = todayIso(); body.transaction_currency_code = S.currency;
    body.accounts = [{ account_id: v('p-acc'), current_amount: String(num(v('p-current'))) }];
  }
  await busy(el('pgSave'), async () => {
    await api(id ? '/piggy-banks/' + id : '/piggy-banks', { method: id ? 'PUT' : 'POST', body });
    closeDrawer(); toast(id ? 'Piggy bank saved' : 'Piggy bank created'); route();
  });
}
function piggyMoney(id: string, dir: number) {
  const p: Piggy = S.piggyCache![id];
  S.form = { id, dir };
  openDrawer((dir > 0 ? 'Add money to ' : 'Take money out of ') + p.name,
    html`<form id="pmForm" data-onsubmit="event.preventDefault();App.savePiggyMoney()"><p class="sub-s" style="margin-top:0">Currently ${money(p.current)} of ${money(p.target)}. This only moves money in Firefly’s bookkeeping — no transaction is created.</p>${p.accounts.length > 1 ? html`<label>Account<select id="pm-acc">${htmlList(p.accounts.map(a => opt(a.id, (a.name || (S.lists!.byId[a.id] || {}).name) + ' (' + money(a.amount) + ')', '')))}</select></label>` : ''}<label>Amount<input type="number" min="0.01" step="0.01" id="pm-amt" required></label><button type="submit" hidden></button></form>`,
    html`<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="pmSave" data-onclick="App.submit('pmForm')">${dir > 0 ? 'Add' : 'Take out'}</button>`);
}
async function savePiggyMoney() {
  const { id, dir } = S.form, p: Piggy = S.piggyCache![id], amt = num(el<HTMLInputElement>('pm-amt').value);
  if (!(amt > 0)) return formError('Enter an amount above zero.');
  const accId = el<HTMLSelectElement>('pm-acc') ? el<HTMLSelectElement>('pm-acc').value : (p.accounts[0] || {}).id;
  if (!accId) return formError('This piggy bank has no account linked. Edit it in Firefly III.');
  const accounts = p.accounts.map(a => ({ account_id: a.id, current_amount: String(a.id === accId ? Math.max(0, a.amount + dir * amt) : a.amount) }));
  if (dir < 0 && ((p.accounts.find(a => a.id === accId) || {}) as ApiData).amount < amt) return formError('There isn’t that much saved in it.');
  await busy(el('pmSave'), async () => {
    await api('/piggy-banks/' + id, { method: 'PUT', body: { accounts } });
    closeDrawer(); toast(dir > 0 ? 'Money added' : 'Money taken out'); route();
  });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  piggyForm,
  savePiggy,
  piggyMoney,
  savePiggyMoney,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

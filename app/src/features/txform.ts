import { type Html, html, htmlList } from '../core/html';
import { AuthError, api } from '../core/api';
import { showLogin } from '../core/auth';
import { type ApiData, App, S, el, fmtDate, fmtDay, money, num, sameName, todayIso, type AppApi, type Field } from '../core/base';
import { LS } from '../core/helpers';
import { BUZZ_SAVE, buzz } from '../core/haptics';
import { closeDrawer, formError, heroParts, icon, openDrawer, opt, toast, vt, vtName } from '../core/dom';
import { type Group, amtInner, avatarHtml, normGroup, payeeOf, signed } from '../core/feed';
import { hoursText, lensOn } from '../core/worklens';
import { type Account, invalidate, isAsset, isCard, isLiab, lists } from '../core/lists';
import { REFUND_TAG, isRefundTag, refundLinkType } from './refunds';
import { route } from '../core/router';

/* ================= Transaction form ================= */
// The transaction form's state (S.form while it's open). Fields hold what the inputs hold, as text.
export type SplitForm = { jid: string, description: string, amount: string, counter: string, category: string, budget: string, bill: string,
  tags: string, notes: string, fa: string, fc: string, orig: Partial<Record<string, string>> };
export type TxForm = { id: string, type: string, date: string, title: string, main: string, src: string, dst: string, rules: boolean, splits: SplitForm[],
  nlBase?: ApiData, nl?: string, nlChips?: Html | '',   // quick add: what was typed and the chips it was read as
  refundOf?: { jid: string, label: string },              // a refund made from this purchase: linked to it when saved
  draft?: string };                                    // the draft this form was opened from (see drafts below)
export function blankSplit(): SplitForm { return { jid: '', description: '', amount: '', counter: '', category: '', budget: '', bill: '', tags: '', notes: '', fa: '', fc: '', orig: {} }; }
export function newTx(preset: { type?: string, date?: string, account?: string, description?: string, amount?: string } = {}) {
  const L = S.lists!; S.drawerHero = null;
  const firstAsset = (L.own.find(a => isAsset(a) && !isCard(a)) || L.own[0] || {}).id || '';
  S.form = { id: '', type: preset.type || 'withdrawal', date: preset.date || todayIso(), title: '', main: preset.account || firstAsset, src: preset.account || firstAsset, dst: '', rules: true, splits: [blankSplit()] };
  if (preset.description) S.form.splits[0].description = preset.description;
  if (preset.amount) S.form.splits[0].amount = preset.amount;
  renderTxForm();
}
const EDITABLE = ['withdrawal', 'deposit', 'transfer'];
// The edit form for a saved transaction
function formOf(g: Group): TxForm {
  const f = g.splits[0];
  return {
    id: g.id, type: g.type, date: String(g.date).slice(0, 10), title: g.title, rules: false,
    main: g.type === 'deposit' ? f.destination_id : f.source_id, src: f.source_id, dst: f.destination_id,
    splits: g.splits.map(s => {
      const x: SplitForm = { jid: s.jid, description: s.description, amount: String(s.amount), counter: g.type === 'deposit' ? s.source_name : s.destination_name,
        category: s.category, budget: s.budget_id, bill: s.bill_id, tags: s.tags.join(', '), notes: s.notes, fa: s.fa, fc: s.fc, orig: {} };
      const { orig, ...fields } = x; x.orig = fields;
      return x;
    }),
  };
}
export async function editTx(id: string) {
  const meta = S.txMeta && S.txMeta[id], row = document.querySelector<HTMLElement>('#view tr[data-gid="' + id + '"]');
  if (meta) {
    const g = meta.g, v = signed(g, meta.accountId);
    S.drawerHero = { id, av: avatarHtml(g, 'lg'), name: payeeOf(g).name, date: g.date, kicker: 'Transaction',
      amount: !meta.accountId && g.type === 'transfer' ? money(g.total) : (v > 0 ? '+' : '') + money(v) + (v < 0 && lensOn() && hoursText(v) ? ' · ' + hoursText(v) + ' of work' : '') };
  } else S.drawerHero = null;
  // The list already has the whole transaction, so the form opens filled in straight away; the copy fetched
  // from Firefly III replaces it only if it differs and you haven't started editing.
  const known = meta && S.lists && EDITABLE.includes(meta.g.type) ? meta.g : null;
  const loading = html`<div style="padding:8px 0">${htmlList(['60%', '100%', '100%', '80%'].map(w => html`<div class="sk" style="width:${w};height:38px;margin-bottom:16px"></div>`))}</div>`;
  const rowAv = row && row.querySelector('.av') as HTMLElement, parts = heroParts(row, S.drawerHero);
  let shown = null as TxForm | null, shownJson = '', typed = '';
  const opening = vt('drawer-open', () => {
    if (rowAv) rowAv.style.viewTransitionName = '';
    parts.forEach(p => { p.el.style.viewTransitionName = ''; vtName(el('drawer').querySelector(p.sel), p.vtn); });
    if (known) { shown = S.form = formOf(known); shownJson = JSON.stringify(shown); renderTxForm(); collectTx(); typed = JSON.stringify(S.form); }
    else openDrawer('Loading…', loading);
    vtName(el('drawer').querySelector('.dhero .av'), 'txav');
  }, () => { vtName(rowAv, 'txav'); parts.forEach(p => vtName(p.el, p.vtn)); });
  try {
    const [res] = await Promise.all([api('/transactions/' + id), lists()]);
    if (opening) await opening.updateCallbackDone.catch(() => {});   // the drawer shell must be in place before the form goes in
    const g = normGroup(res.data);
    if (shown) {
      if (S.form !== shown || !el('drawer').classList.contains('open')) return;      // closed, or moved on to another form
      const fresh = formOf(g);
      if (JSON.stringify(fresh) === shownJson || !EDITABLE.includes(g.type)) return;
      collectTx();
      if (JSON.stringify(S.form) !== typed || el('txForm')!.contains(document.activeElement)) return;   // you're already editing
    }
    if (!EDITABLE.includes(g.type)) {
      openDrawer('Transaction', html`<p>This is a <strong>${g.type}</strong> transaction (${money(g.total)} on ${fmtDate(g.date)}). Edit it in Firefly III.</p>`,
        html`<button class="btn danger" data-onclick="App.deleteTx()">Delete</button><span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Close</button>`);
      return;
    }
    S.form = formOf(g);
    renderTxForm();
  } catch (e) {
    if (e instanceof AuthError) return showLogin(e.message);
    openDrawer('Transaction', html`<div class="form-err">${(e as Error).message}</div>`);
  }
}
export function accountOptions(sel: string, allowEmpty?: boolean) {
  const L = S.lists!;
  const group = (label: string, list: Account[]) => list.length ? html`<optgroup label="${label}">${htmlList(list.map(a => opt(a.id, a.name, sel)))}</optgroup>` : '';
  return html`${allowEmpty ? opt('', 'Choose…', sel) : ''}${group('Bank accounts', L.own.filter(a => isAsset(a) && !isCard(a)))}${group('Credit cards', L.own.filter(isCard))}${group('Loans & debts', L.own.filter(isLiab))}`;
}
export function renderTxForm() {
  const f: TxForm = S.form, L = S.lists!, multi = f.splits.length > 1;
  const typeBtn = (t: string, label: string) => html`<button type="button" class="${f.type === t ? 'on' : ''}" data-onclick="App.txType('${t}')">${label}</button>`;
  const counterList = f.type === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  let accountsHtml;
  if (f.type === 'transfer') {
    accountsHtml = html`<div class="grid2"><label>From<select id="f-src" required>${accountOptions(f.src, true)}</select></label><label>To<select id="f-dst" required>${accountOptions(f.dst, true)}</select></label></div>`;
  } else {
    accountsHtml = html`<label>${f.type === 'withdrawal' ? 'Paid from' : 'Deposited into'}<select id="f-main" required>${accountOptions(f.main, true)}</select></label>`;
  }
  const splitHtml = htmlList(f.splits.map((s, i) =>
    html`<div class="split" data-i="${i}">${multi ? html`<div class="split-head"><span>Split ${i + 1}</span><button type="button" class="link" data-onclick="App.removeSplit(${i})">Remove</button></div>` : ''}<label>Description<input type="text" data-k="description" value="${s.description}" required></label><div class="grid2"><label>Amount<input type="number" data-k="amount" value="${s.amount}" step="0.01" min="0.01" inputmode="decimal" required></label>${f.type !== 'transfer' ? html`<label>${f.type === 'withdrawal' ? 'Paid to' : 'Received from'}<input type="text" data-k="counter" list="dl-counter" value="${s.counter}" placeholder="Name" data-onchange="App.payeeFill(${i}, this.value)"></label>` : html`<span></span>`}</div><div class="grid2"><label>Category<input type="text" data-k="category" list="dl-cat" value="${s.category}" placeholder="None"></label>${f.type === 'withdrawal' ? html`<label>Budget<select data-k="budget">${opt('', 'None', s.budget)}${htmlList(L.budgets.filter(b => b.active || b.id === s.budget).map(b => opt(b.id, b.name, s.budget)))}</select></label>` : html`<span></span>`}</div><div class="grid2">${f.type === 'withdrawal' ? html`<label>Bill<select data-k="bill">${opt('', 'None', s.bill)}${htmlList(L.bills.map(b => opt(b.id, b.name, s.bill)))}</select></label>` : html`<span></span>`}<label>Tags<input type="text" data-k="tags" list="dl-tags" value="${s.tags}" placeholder="Comma separated"></label></div>${L.foreign.length ? html`<div class="grid2"><label>Foreign amount (optional)<input type="number" data-k="fa" step="0.01" min="0" value="${s.fa}"></label><label>Foreign currency<select data-k="fc">${opt('', 'None', s.fc)}${htmlList(L.foreign.map(c => opt(c.code, c.code + ' · ' + c.name, s.fc)))}</select></label></div>` : ''}<label>Notes<textarea data-k="notes" rows="2">${s.notes}</textarea></label></div>`));
  const body =
    html`<form id="txForm" data-haptic="saved" data-onsubmit="event.preventDefault();App.saveTx(this)">${f.refundOf ? html`<p class="sub-s refund-of">Refund of ${f.refundOf.label}. It goes back into the account you paid from, and Reports and Budgets take it off that spending.</p>` : ''}${f.id ? '' : html`<div class="nlq">${icon('spark')}<input type="text" id="nlq" value="${f.nl || ''}" placeholder="Describe it — e.g. starbucks 5.40 amex yesterday" autocomplete="off" enterkeyhint="done" data-oninput="App.nlParse(this.value)" data-onkeydown="App.nlKey(event,this)"><div id="nlChips" class="nlchips">${f.nlChips || ''}</div></div>`}<div class="seg">${typeBtn('withdrawal', 'Expense')}${typeBtn('deposit', 'Income')}${typeBtn('transfer', 'Transfer')}</div><label>Date<input type="date" id="f-date" value="${f.date}" required></label>${accountsHtml}${multi ? html`<label>Title for the whole transaction<input type="text" id="f-title" value="${f.title}" required></label>` : ''}${splitHtml}<button type="button" class="btn small" data-onclick="App.addSplit()" style="margin-bottom:18px">+ Split into another part</button><label class="check"><input type="checkbox" id="f-rules"${f.rules ? ' checked' : ''}> Run my Firefly rules on this transaction</label><datalist id="dl-counter">${htmlList(counterList.map(a => html`<option value="${a.name}">`))}</datalist><datalist id="dl-cat">${htmlList(L.categories.map(c => html`<option value="${c.name}">`))}</datalist><datalist id="dl-tags">${htmlList(L.tags.map(t => html`<option value="${t.name}">`))}</datalist><button type="submit" hidden></button></form>${f.id ? html`<div id="txExtras"><p class="sub-s">Loading attachments and links…</p></div>` : ''}`;
  const foot = html`${f.id ? html`<button class="btn danger" type="button" data-onclick="App.deleteTx()">Delete</button><button class="btn" type="button" data-onclick="App.duplicateTx()" title="A new transaction with the same details, dated today">Duplicate</button>${f.type === 'withdrawal' ? html`<button class="btn" type="button" data-onclick="App.refundTx()" title="Money back for this purchase, into the account it was paid from">Refund</button>` : ''}` : html`<button class="btn" type="button" data-onclick="App.saveDraft()" title="Keep it on this list to finish later; nothing goes to Firefly yet">${f.draft ? 'Update draft' : 'Save as draft'}</button>`}<span class="grow"></span><button class="btn" type="button" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" type="button" id="txSave" data-onclick="App.submit('txForm')">${f.id ? 'Save changes' : 'Add transaction'}</button>`;
  const wasOpen = el('drawer').classList.contains('open') && el('txForm');
  const scroll = wasOpen ? el('drawerBody').scrollTop : 0;
  // Typing in "Describe it" redraws the form on every key. Keep that box itself, so the iPhone keyboard stays as it is:
  // a new box, even focused straight away, puts the keyboard back on letters after each number.
  const typing = wasOpen ? el<HTMLInputElement>('nlq') : null;
  if (typing && document.activeElement === typing) {
    const t = document.createElement('template'); t.innerHTML = String(body);
    const form = el('txForm'), box = typing.closest('.nlq')!, fresh = t.content.querySelector('form')!;
    [...form.children].forEach(c => { if (c !== box) c.remove(); });
    let before = true;
    [...fresh.children].forEach(c => {
      if (c.classList.contains('nlq')) { before = false; el('nlChips').innerHTML = c.querySelector('#nlChips')!.innerHTML; return; }
      if (before) box.before(c); else form.append(c);
    });
    const ft = el('drawer').querySelector(':scope > footer'); if (ft) ft.innerHTML = String(foot);
    el('drawerBody').scrollTop = scroll;
    return;
  }
  openDrawer(f.id ? 'Edit transaction' : f.draft ? 'Draft' : f.refundOf ? 'Refund' : 'New transaction', body, foot);
  if (wasOpen) el('drawerBody').scrollTop = scroll;
  if (f.id && (window.App as Partial<AppApi>).loadTxExtras) App.loadTxExtras(f.id, f.splits.map(s => s.jid).filter(Boolean));
}
export function collectTx() {
  const f: TxForm | null = S.form; if (!f || !el('txForm')) return;
  const v = (id: string) => el<Field>(id) ? el<Field>(id).value : undefined;
  f.date = v('f-date') ?? f.date; f.title = v('f-title') ?? f.title; f.rules = el<HTMLInputElement>('f-rules') ? el<HTMLInputElement>('f-rules').checked : f.rules;
  if (el('f-main')) f.main = v('f-main')!;
  if (el('f-src')) f.src = v('f-src')!;
  if (el('f-dst')) f.dst = v('f-dst')!;
  document.querySelectorAll<HTMLElement>('#txForm .split').forEach(card => {
    const s = f.splits[Number(card.dataset.i)];
    card.querySelectorAll<HTMLInputElement>('[data-k]').forEach(inp => { (s as unknown as Record<string, string>)[inp.dataset.k!] = inp.value; });
  });
}
function resolveCounter(name: string, kind: string): { id?: string, name?: string } {
  const L = S.lists!, pool = kind === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  const hit = pool.find(a => sameName(a.name, name));
  return hit ? { id: hit.id } : { name: name.trim() };
}
function buildTxPayload() {
  const f: TxForm = S.form, edit = !!f.id;
  const txs = f.splits.map(s => {
    const o: Record<string, unknown> = { type: f.type, date: f.date, amount: String(Math.abs(num(s.amount))), description: s.description.trim() };
    if (edit && s.jid) o.transaction_journal_id = s.jid;
    const changed = (k: string) => !edit || !s.jid || String((s as unknown as Record<string, string>)[k] || '') !== String((s.orig || {})[k] || '');
    if (f.type === 'withdrawal') {
      o.source_id = f.main;
      if (s.counter.trim()) { const c = resolveCounter(s.counter, 'withdrawal'); c.id ? (o.destination_id = c.id) : (o.destination_name = c.name); }
      if (changed('budget')) o.budget_id = s.budget || '0';
      if (changed('bill')) o.bill_id = s.bill || '0';
    } else if (f.type === 'deposit') {
      o.destination_id = f.main;
      if (s.counter.trim()) { const c = resolveCounter(s.counter, 'deposit'); c.id ? (o.source_id = c.id) : (o.source_name = c.name); }
    } else {
      o.source_id = f.src; o.destination_id = f.dst;
    }
    if (changed('category')) o.category_name = s.category.trim();
    if (changed('tags')) o.tags = s.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (changed('notes')) o.notes = s.notes;
    if (changed('fa') || changed('fc')) {
      if (s.fa && num(s.fa) > 0 && s.fc) { o.foreign_amount = String(num(s.fa)); o.foreign_currency_code = s.fc; }
      else if (edit && s.jid) { o.foreign_amount = '0'; }
    }
    // On edit, fields left out stay as they are in Firefly, so only changed ones are sent.
    return o;
  });
  const body: Record<string, unknown> = { apply_rules: f.rules, fire_webhooks: true, transactions: txs };
  if (txs.length > 1) body.group_title = f.title.trim();
  if (!edit) body.error_if_duplicate_hash = false;
  return body;
}
async function saveTx(formEl: HTMLFormElement) {
  collectTx();
  const f: TxForm = S.form;
  if (f.type === 'transfer') {
    if (!f.src || !f.dst) return formError('Choose both accounts for the transfer.');
    if (f.src === f.dst) return formError('A transfer needs two different accounts.');
  } else if (!f.main) return formError('Choose the account.');
  for (const s of f.splits) {
    if (s.fa && num(s.fa) > 0 && !s.fc) return formError('Pick the currency for the foreign amount.');
    if (!s.description.trim()) return formError('Every part needs a description.');
    if (!(num(s.amount) > 0)) return formError('Every part needs an amount above zero.');
  }
  // Optimistic: close right away and show the change; if Firefly refuses, reopen the form with the error.
  const body = buildTxPayload(), row = f.id && document.querySelector<HTMLElement>('#view tr[data-gid="' + f.id + '"]');
  closeDrawer();
  if (row) {
    row.classList.add('saving');
    const d = row.querySelector('.desc'); if (d && f.splits.length === 1) d.textContent = f.splits[0].description;
    const a = row.querySelector('.amt'); if (a && f.splits.length === 1 && f.type !== 'transfer') a.innerHTML = String(amtInner((f.type === 'deposit' ? 1 : -1) * Math.abs(num(f.splits[0].amount))));
    const c = row.querySelector('.catcol span'); if (c && f.splits.length === 1) { c.textContent = f.splits[0].category || '—'; }
  } else toast('Saving…');
  try {
    if (f.id) await api('/transactions/' + f.id, { method: 'PUT', body });
    else {
      const res = await api('/transactions', { method: 'POST', body });
      if (f.refundOf && f.type === 'deposit') await linkRefund(res, f.refundOf.jid);
    }
    if (f.draft) dropDraft(f.draft);
    buzz(BUZZ_SAVE); invalidate(); toast(f.id ? 'Transaction updated' : 'Transaction added'); route();
  } catch (e) {
    if (e instanceof AuthError) return showLogin(e.message);
    if (row) row.classList.remove('saving');
    S.drawerHero = null; S.form = f; renderTxForm(); formError((e as Error).message);
  }
}
async function deleteTx() {
  const f = S.form; if (!f || !f.id) return;
  closeDrawer();
  App.softDeleteTx([f.id]);
}

/* ---------- Duplicate ---------- */
// The open transaction, splits and all, as a new one dated today
export function copyForm(f: TxForm, date: string): TxForm {
  return { ...f, id: '', date, rules: true, draft: undefined, refundOf: undefined, nl: '', nlChips: '', splits: f.splits.map(s => ({ ...s, jid: '', orig: {} })) };
}
function duplicateTx() {
  collectTx(); if (!S.form) return;
  S.drawerHero = null; S.form = copyForm(S.form, todayIso()); renderTxForm();
  toast('Copy ready · change anything, then add it');
}

/* ---------- Refund: money back for the open purchase ---------- */
// An income form filled in from the purchase: the same account, payee and category, the whole amount, tagged Refund
export function refundForm(f: TxForm, date: string): TxForm {
  const s0 = f.splits[0], total = f.splits.reduce((s, x) => s + Math.abs(num(x.amount)), 0), what = f.title || s0.description;
  const tags = [...s0.tags.split(',').map(t => t.trim()).filter(t => t && !isRefundTag(t)), REFUND_TAG].join(', ');
  return { id: '', type: 'deposit', date, title: '', main: f.main, src: f.main, dst: '', rules: true, nl: '', nlChips: '',
    refundOf: { jid: s0.jid, label: what + ' (' + fmtDay(f.date) + ', ' + money(total) + ')' },
    splits: [{ ...blankSplit(), description: 'Refund: ' + what, amount: total.toFixed(2), counter: s0.counter, category: s0.category, tags }] };
}
function refundTx() {
  collectTx(); if (!S.form || S.form.type !== 'withdrawal') return;
  S.drawerHero = null; S.form = refundForm(S.form, todayIso()); renderTxForm();
  toast('Refund ready · change the amount if only part came back');
}
// Links a new refund to its purchase with Firefly's Refund link type ("… (partially) refunds …"), if it still has one
async function linkRefund(res: ApiData, origJid: string) {
  try {
    const jid = String((((res && res.data && res.data.attributes.transactions) || [])[0] || {}).transaction_journal_id || ''), type = await refundLinkType();
    if (jid && origJid && type) await api('/transaction-links', { method: 'POST', body: { link_type_id: type.id, outward_id: jid, inward_id: origJid } });
  } catch (e) { if (e instanceof AuthError) throw e; toast('Refund added, but it could not be linked to the purchase'); }
}

/* ---------- Drafts: a new transaction kept on this list (synced like other settings) until it's added ---------- */
export type Draft = { id: string, t: number, form: TxForm };
export const drafts = (): Draft[] => (LS.get('drafts', []) as Draft[]).filter(d => d && d.form && d.form.splits);
const draftTotal = (f: TxForm) => f.splits.reduce((s, x) => s + Math.abs(num(x.amount)), 0);
export const draftLabel = (d: Draft) => d.form.title || d.form.splits.map(s => s.description).filter(Boolean).join(', ') || 'Untitled';
function saveDraft() {
  collectTx(); const f: TxForm | null = S.form; if (!f) return;
  const id = f.draft || 'd' + Date.now().toString(36), form: TxForm = { ...f, draft: id, nlBase: undefined, nlChips: '' };
  LS.set('drafts', [...drafts().filter(d => d.id !== id), { id, t: Date.now(), form }]);
  closeDrawer(); toast(f.draft ? 'Draft updated' : 'Saved as a draft · find it at the top of Transactions'); route();
}
function dropDraft(id: string) { LS.set('drafts', drafts().filter(d => d.id !== id)); }
function openDraft(id: string) {
  const d = drafts().find(x => x.id === id); if (!d) return;
  S.drawerHero = null; S.form = { ...d.form, draft: id }; renderTxForm();
}
function deleteDraft(id: string) { dropDraft(id); toast('Draft deleted'); route(); }
export function draftsPanel() {
  const list = drafts().sort((a, b) => b.t - a.t);
  if (!list.length) return '';
  return html`<section class="panel drafts"><div class="panel-head"><h2>Drafts</h2><span class="neutral">${list.length} to finish</span></div><div class="list">${htmlList(list.map(d => html`<div class="row"><button type="button" class="link name" data-onclick="App.openDraft('${d.id}')" style="text-align:left">${draftLabel(d)}<span class="sub-s" style="display:block">${d.form.date ? fmtDay(d.form.date) + ' · ' : ''}saved ${fmtDay(new Date(d.t).toISOString())}</span></button><span style="display:flex;gap:10px;align-items:center"><span class="num">${draftTotal(d.form) ? money(draftTotal(d.form)) : ''}</span><button type="button" class="link" data-onclick="App.deleteDraft('${d.id}')" aria-label="Delete draft">Delete</button></span></div>`))}</div></section>`;
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  duplicateTx,
  refundTx,
  saveDraft,
  openDraft,
  deleteDraft,
  editTx,
  saveTx,
  deleteTx,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

import { html, htmlList } from '../core/html';
import { AuthError, api, eachLimited, getAll } from '../core/api';
import { showLogin } from '../core/auth';
import { App, S, el, fmtDate, money, todayIso } from '../core/base';
import { head, opt, toast, todoTabs } from '../core/dom';
import { type Group, type Split, groupUpdate, normGroup } from '../core/feed';
import { addDays } from '../core/helpers';
import { lists } from '../core/lists';
import { VIEWS, parseHash } from '../core/router';

/* ================= Categorize inbox ================= */
const NOISE = new Set(['SQ', 'TST', 'DD', 'POS', 'ACH', 'WEB', 'PMT', 'PAYMENT', 'PURCHASE', 'IC', 'THE', 'APLPAY', 'PP', 'PAYPAL', 'ZSK', 'IT', 'RAZ', 'DEBIT', 'CARD', 'ONLINE', 'INST', 'XFER']);
function descKey(d: string | null | undefined) { return String(d || '').toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !NOISE.has(w)).slice(0, 2).join(' '); }
// How often each payee, description key or category went with each category or budget: counts[from][to]
type Counts = Record<string, Record<string, number>>;
type History = { payee: Counts, key: Counts, tok: Counts, bud: Counts, payeeBud: Counts };
const bump = (o: Counts, k: string, v: string) => { if (!k) return; const m = o[k] = o[k] || {}; m[v] = (m[v] || 0) + 1; };
async function inboxHistory(): Promise<History> {
  if (S.inboxHist && Date.now() - S.inboxHist.t < 600000) return S.inboxHist.v;
  const all = await getAll('/transactions', { type: 'all', start: addDays(todayIso(), -365), end: todayIso() });
  const h: History = { payee: {}, key: {}, tok: {}, bud: {}, payeeBud: {} };
  all.map(normGroup).forEach(g => g.splits.forEach(s => {
    if (s.type === 'transfer') return;
    const payee = s.type === 'deposit' ? s.source_id : s.destination_id, k = descKey(s.description);
    if (s.category) { bump(h.payee, payee, s.category); bump(h.key, k, s.category); bump(h.tok, k.split(' ')[0], s.category); }
    if (s.budget_id) { bump(h.bud, s.category, s.budget_id); bump(h.payeeBud, payee, s.budget_id); }
  }));
  S.inboxHist = { t: Date.now(), v: h };
  return h;
}
function suggest(s: Split, h: History) {
  const score: any = {}, payee = s.type === 'deposit' ? s.source_id : s.destination_id, k = descKey(s.description);
  const addAll = (m: Record<string, number> | null, w: number) => { if (!m) return; const t = Object.values<any>(m).reduce((a, b) => a + b, 0); Object.entries<any>(m).forEach(([c, n]) => { score[c] = (score[c] || 0) + w * n / t; }); };
  const generic = /^(cash|cash account|venmo|zelle|paypal)$/i.test(s.type === 'deposit' ? s.source_name : s.destination_name);
  addAll(generic ? null : h.payee[payee], 3); addAll(h.key[k], 2); addAll(h.tok[k.split(' ')[0]], .7);
  const tot = Object.values<any>(score).reduce((a, b) => a + b, 0) || 1;
  const cats = Object.entries<any>(score).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => ({ c, pct: Math.round(v / tot * 100) }));
  const pickBud = (cat: string) => { const m = (!generic && h.payeeBud[payee]) || h.bud[cat]; if (!m) return ''; return Object.entries<any>(m).sort((a, b) => b[1] - a[1])[0][0]; };
  return { cats, pickBud, generic };
}
VIEWS.inbox = async (r, paint) => {
  await lists();
  const q = 'has_no_category:true';
  const [found, h] = await Promise.all([getAll('/search/transactions', { query: q, search: q }), inboxHistory()]);
  const items: Group[] = [];
  found.map(normGroup).forEach(g => { if (g.type !== 'transfer' && g.splits.some(s => !s.category)) items.push(g); });
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!paint.live) return;
  S.inbox = { items, i: 0, h, done: 0, paint };
  renderInbox();
};
function renderInbox() {
  const I = S.inbox, L = S.lists!, g = I.items[I.i];
  if (!g) {
    I.paint(html`${head('To do', '', '')}${todoTabs('inbox')}<section class="panel"><div class="center-empty" style="padding:70px 20px"><div style="font-size:40px">✓</div><h2 style="font-size:18px;margin:10px 0 4px">All caught up</h2>${I.done ? 'You categorized ' + I.done + ' transaction' + (I.done === 1 ? '' : 's') + '.' : 'Every transaction has a category.'}</div></section>`);
    return;
  }
  const s = g.splits.find((x: Split) => !x.category) || g.splits[0], sug = suggest(s, I.h), top = sug.cats[0];
  const payeeName = s.type === 'deposit' ? s.source_name : s.destination_name;
  const payeeId = s.type === 'deposit' ? s.source_id : s.destination_id;
  const similar = sug.generic ? [] : I.items.filter((x: Group, j: number) => j !== I.i && x.splits.some(y => !y.category && (y.type === 'deposit' ? y.source_id : y.destination_id) === payeeId));
  I.cur = { g, s, payeeName, similar, generic: sug.generic, pickBud: sug.pickBud };
  const bud = top ? sug.pickBud(top.c) : '';
  I.paint(html`${head('To do', (I.items.length - I.i) + ' to categorize' + (I.done ? ' · ' + I.done + ' done this session' : ''), html`<button class="btn" data-onclick="App.inboxSkip()">Skip <span class="neutral">S</span></button>`)}${todoTabs('inbox')}<div class="track" style="margin:-10px 0 24px"><div class="fill good" style="width:${(I.done / (I.done + I.items.length) * 100).toFixed(1)}%"></div></div><section class="panel" style="max-width:760px"><div class="row" style="align-items:flex-start"><div><div class="eyebrow">${fmtDate(g.date)} · ${s.type === 'deposit' ? 'Income' : 'Expense'}</div><div style="font-size:22px;font-weight:600;letter-spacing:-.01em;margin:4px 0">${s.description}</div><div class="sub-s">${s.source_name} → ${s.destination_name}${g.splits.length > 1 ? ' · part of “' + g.title + '”' : ''}</div></div><div class="big num ${s.type === 'deposit' ? 'pos' : ''}" style="font-size:34px">${money(s.amount)}</div></div><div style="margin:24px 0 6px" class="eyebrow">${sug.cats.length ? 'Suggestions' : 'No suggestion yet — pick a category'}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">${htmlList(sug.cats.map((c, i) => html`<button class="btn${i === 0 ? ' primary' : ''}" data-onclick="App.inboxPick(${i})" data-cat="${c.c}"><span class="neutral" style="color:inherit;opacity:.6">${i + 1}</span> ${c.c} <span style="opacity:.6">${c.pct}%</span></button>`))}</div><form id="inboxForm" data-onsubmit="event.preventDefault();App.inboxSave()"><div class="grid2"><label>Category<input type="text" id="ib-cat" list="ib-dl" value="${top ? top.c : ''}" required></label>${s.type === 'withdrawal' ? html`<label>Budget<select id="ib-bud">${opt('', 'None', bud)}${htmlList(L.budgets.filter(b => b.active).map(b => opt(b.id, b.name, bud)))}</select></label>` : html`<span></span>`}</div><datalist id="ib-dl">${htmlList(L.categories.map(c => html`<option value="${c.name}">`))}</datalist>${similar.length ? html`<label class="check"><input type="checkbox" id="ib-similar" checked> Also do the ${similar.length} other uncategorized from ${payeeName}</label>` : ''}<label class="check"><input type="checkbox" id="ib-rule"${similar.length >= 1 && !sug.generic ? ' checked' : ''}> Always do this for ${sug.generic ? '“' + descKey(s.description) + '”' : payeeName} from now on (creates a rule)</label><div style="display:flex;gap:10px;margin-top:6px"><button class="btn primary" id="ib-save">Save <span style="opacity:.6">↵</span></button><button type="button" class="btn" data-onclick="App.editTx('${g.id}')">Open full transaction</button>${I.i > 0 ? html`<button type="button" class="link" data-onclick="App.inboxBack()">← Back</button>` : ''}</div></form></section><p class="sub-s" style="margin-top:14px">Keys: <strong>1–3</strong> pick a suggestion · <strong>Enter</strong> save · <strong>S</strong> skip. Suggestions come from how you categorized similar transactions over the past year.</p>`);
}
function inboxPick(i: number) { const b = document.querySelectorAll<HTMLElement>('[data-cat]')[i]; if (!b) return; el<HTMLInputElement>('ib-cat').value = b.dataset.cat!; const bud = S.inbox.cur.pickBud(b.dataset.cat); if (el<HTMLSelectElement>('ib-bud') && bud) el<HTMLSelectElement>('ib-bud').value = bud; }
function inboxSkip() { S.inbox.i++; renderInbox(); }
function inboxBack() { S.inbox.i = Math.max(0, S.inbox.i - 1); renderInbox(); }
async function ensureInboxGroup() {
  const groups = await getAll('/rule-groups');
  const g = groups.find(x => x.attributes.title === '5. Inbox rules');
  if (g) return String(g.id);
  const res = await api('/rule-groups', { method: 'POST', body: { title: '5. Inbox rules', description: 'Created from the Categorize inbox. Runs after your other groups.', active: true } });
  return String(res.data.id);
}
async function inboxSave() {
  const I = S.inbox, { g, s, similar, payeeName, generic } = I.cur, L = S.lists!;
  const cat = el<HTMLInputElement>('ib-cat').value.trim(); if (!cat) return toast('Pick a category first.');
  const bud = el<HTMLSelectElement>('ib-bud') ? el<HTMLSelectElement>('ib-bud').value : '';
  const alsoSimilar = el<HTMLInputElement>('ib-similar') && el<HTMLInputElement>('ib-similar').checked, makeRule = el<HTMLInputElement>('ib-rule') && el<HTMLInputElement>('ib-rule').checked;
  const btn = el<HTMLButtonElement>('ib-save'); btn.disabled = true; btn.textContent = 'Saving…';
  const put = (grp: Group) => api('/transactions/' + grp.id, { method: 'PUT', body: groupUpdate(grp, x => {
    if (x.category) return null;
    const o: any = { category_name: cat }; if (bud && x.type === 'withdrawal' && !x.budget_id) o.budget_id = bud; return o; }) });
  try {
    await put(g);
    let n = 1;
    if (alsoSimilar) await eachLimited(similar, 4, async (o: Group) => { await put(o); n++; });
    if (makeRule) {
      const gid = await ensureInboxGroup();
      const triggers = generic ? [{ type: 'description_contains', value: descKey(s.description) }] : [{ type: s.type === 'deposit' ? 'source_account_is' : 'destination_account_is', value: payeeName }];
      triggers.push({ type: 'transaction_type', value: s.type });
      const actions = [{ type: 'set_category', value: cat }];
      const budName = bud && (L.budgets.find(b => b.id === bud) || {}).name; if (budName) actions.push({ type: 'set_budget', value: budName });
      await api('/rules', { method: 'POST', body: { title: (generic ? descKey(s.description) : payeeName) + ' → ' + cat, rule_group_id: gid, trigger: 'store-journal', strict: true, stop_processing: false, active: true,
        triggers: triggers.map(t => ({ ...t, active: true, stop_processing: false })), actions: actions.map(a => ({ ...a, active: true, stop_processing: false })) } });
    }
    const doneIds = new Set([g.id, ...(alsoSimilar ? similar.map((x: Group) => x.id) : [])]);
    I.items = I.items.filter((x: Group) => !doneIds.has(x.id)); I.done += n;
    if (I.i >= I.items.length) I.i = Math.max(0, I.items.length - 1);
    if (I.items.length && I.i > 0 && I.i >= I.items.length) I.i = I.items.length - 1;
    // remember this choice for the next suggestions
    bump(I.h.payee, s.type === 'deposit' ? s.source_id : s.destination_id, cat); bump(I.h.key, descKey(s.description), cat);
    toast('Saved' + (n > 1 ? ' · ' + n + ' transactions' : '') + (makeRule ? ' · rule created' : ''));
    renderInbox();
  } catch (e) { if (e instanceof AuthError) return showLogin(e.message); btn.disabled = false; btn.textContent = 'Save'; toast((e as Error).message); }
}
document.addEventListener('keydown', e => {
  if (parseHash().name !== 'inbox' || !S.inbox || !el('inboxForm')) return;
  if (el('drawer').classList.contains('open') || !el('palette').hidden || el<HTMLDialogElement>('confirm').open || e.metaKey || e.ctrlKey || e.altKey) return;
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName) && (e.target as HTMLInputElement).type !== 'checkbox';
  if (!inField && /^[123]$/.test(e.key)) { e.preventDefault(); inboxPick(+e.key - 1); }
  else if (!inField && (e.key === 's' || e.key === 'S')) { e.preventDefault(); inboxSkip(); }
  else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'TEXTAREA') { e.preventDefault(); inboxSave(); }
});

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  inboxPick,
  inboxSkip,
  inboxBack,
  inboxSave,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

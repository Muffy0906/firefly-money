import { html, htmlList } from '../core/html';
import { AuthError, api, getAll } from '../core/api';
import { withAuth } from '../core/auth';
import { App, arr, type ApiData } from '../core/base';
import { confirmBox, head, toast } from '../core/dom';
import { invalidate, lists } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { doneState } from '../core/ui';

/* ================= Clean up: payees, income sources, categories, tags and budgets that nothing uses =================
   One pass over every transaction and recurring transaction narrows it down; then each candidate is asked for its
   own transactions (one each, six at a time), so something used only by a transaction beyond what the pass read
   is never offered for deletion. */
type Kind = 'payees' | 'sources' | 'categories' | 'tags' | 'budgets';
type Item = { id: string, name: string };
const KINDS: [Kind, string, string][] = [
  ['payees', 'Payees', 'Shops and people you’ve paid, with no transactions'],
  ['sources', 'Income sources', 'Who paid you, with no transactions'],
  ['categories', 'Categories', 'With no transactions or recurring transactions'],
  ['tags', 'Tags', 'On no transactions'],
  ['budgets', 'Budgets', 'With no transactions. A new budget you haven’t spent from yet shows up here too.'],
];
const ownPath = (k: Kind, x: Item) => k === 'payees' || k === 'sources' ? '/accounts/' + x.id : '/' + k + '/' + encodeURIComponent(x.id);
export type Used = { accounts: Set<string>, categories: Set<string>, budgets: Set<string>, tags: Set<string> };
// What the transactions and recurring transactions use: account, category and budget ids, and tag names
export function usedBy(groups: ApiData[]): Used {
  const u: Used = { accounts: new Set(), categories: new Set(), budgets: new Set(), tags: new Set() };
  groups.forEach(g => ((g.attributes || {}).transactions || []).forEach((s: ApiData) => {
    [s.source_id, s.destination_id].forEach(id => id != null && u.accounts.add(String(id)));
    if (s.category_id != null) u.categories.add(String(s.category_id));
    if (s.budget_id != null) u.budgets.add(String(s.budget_id));
    (s.tags || []).forEach((t: unknown) => u.tags.add(String(t).toLowerCase()));
  }));
  return u;
}
let found: Record<Kind, Item[]> = { payees: [], sources: [], categories: [], tags: [], budgets: [] };
// The page while it looks: reading every transaction takes a while with years of history, so say what it's doing
const looking = (what: string, pct: number) => html`<div class="head"><div><h1>Clean up</h1><p class="sub">Looking for unused items…</p></div></div><section class="panel" id="cleanLoading" aria-live="polite"><div class="center-empty"><p id="cleanWhat" style="margin:0 0 16px">${what}</p><div class="track" style="max-width:320px;margin:0 auto"><div class="fill good" id="cleanBar" style="width:${pct}%"></div></div><p class="sub-s" style="margin:16px 0 0">Nothing is deleted until you choose it.</p></div></section>`;
function progress(what: string, pct: number) {
  const t = document.getElementById('cleanWhat'), b = document.getElementById('cleanBar');
  if (t && b) { t.textContent = what; b.style.width = pct + '%'; }
}
VIEWS.cleanup = async (r, paint) => {
  paint(looking('Reading your payees, categories, tags and budgets…', 5));
  const L = await lists(true);
  progress('Reading every transaction…', 15);
  const [txs, recs] = await Promise.all([getAll('/transactions', { type: 'all' }), getAll('/recurrences').catch(() => [])]);
  progress('Working out what nothing uses…', 35);
  const u = usedBy([...txs, ...recs]);
  const cand: Record<Kind, Item[]> = {
    payees: L.expense.filter(a => !u.accounts.has(a.id)).map(a => ({ id: a.id, name: a.name })),
    sources: L.revenue.filter(a => !u.accounts.has(a.id)).map(a => ({ id: a.id, name: a.name })),
    categories: L.categories.filter(c => !u.categories.has(c.id)),
    tags: L.tags.filter(t => !u.tags.has(t.name.toLowerCase())),
    budgets: L.budgets.filter(b => !u.budgets.has(b.id)).map(b => ({ id: b.id, name: b.name })),
  };
  // Make sure: anything with even one transaction of its own stays off the list
  const all = (Object.keys(cand) as Kind[]).flatMap(k => cand[k].map(x => ({ k, x })));
  const keep = new Set<string>();
  for (let i = 0; i < all.length; i += 6) {
    progress('Double-checking ' + Math.min(i + 6, all.length) + ' of ' + all.length + ' unused items…', 35 + Math.round(60 * i / all.length));
    await Promise.all(all.slice(i, i + 6).map(({ k, x }) => api(ownPath(k, x) + '/transactions', { params: { limit: 1, page: 1 }, fresh: true })
      .then(res => { if (arr(res).length) keep.add(k + ':' + x.id); }).catch(e => { if (e instanceof AuthError) throw e; keep.add(k + ':' + x.id); })));
  }
  found = Object.fromEntries((Object.keys(cand) as Kind[]).map(k => [k, cand[k].filter(x => !keep.has(k + ':' + x.id)).sort((a, b) => a.name.localeCompare(b.name))])) as Record<Kind, Item[]>;
  const total = Object.values(found).reduce((n, xs) => n + xs.length, 0);
  const section = ([k, title, lead]: [Kind, string, string]) => found[k].length ? html`<section class="panel cleanup"><form data-onsubmit="event.preventDefault();App.cleanupDelete(this)" data-kind="${k}"><div class="panel-head"><h2>${title}</h2><button type="button" class="link" data-onclick="App.cleanupAll(this)">Select all</button></div><p class="lead">${found[k].length} unused · ${lead}</p><div class="list">${htmlList(found[k].map(x => html`<label class="row check"><input type="checkbox" name="id" value="${x.id}" data-onchange="App.cleanupCount(this)"><span class="name">${x.name}</span></label>`))}</div><button class="btn small" disabled>Delete selected</button></form></section>` : '';
  paint(html`<p style="margin:0 0 8px"><a class="link" href="#/settings?s=data">← Data</a></p>${head('Clean up', total ? total + ' unused item' + (total === 1 ? '' : 's') + ' found' : 'Nothing to clean up', '')}${total ? html`<p class="sub-s" style="margin:-10px 0 20px;max-width:640px">Nothing is selected until you pick it, and deleting asks first. Rules that mention a deleted item may need a look afterwards.</p><div class="cleanup-list">${htmlList(KINDS.map(section))}</div>` : html`<section class="panel">${doneState('All tidy', 'Every payee, income source, category, tag and budget is in use.', 60)}</section>`}`);
};
function cleanupCount(box: HTMLInputElement) {
  const f = box.form!, n = f.querySelectorAll('input[name=id]:checked').length, b = f.querySelector<HTMLButtonElement>(':scope > .btn')!;
  b.disabled = !n; b.textContent = n ? 'Delete ' + n + ' selected' : 'Delete selected';
}
function cleanupAll(btn: HTMLElement) {
  const boxes = [...btn.closest('form')!.querySelectorAll<HTMLInputElement>('input[name=id]')], on = boxes.some(b => !b.checked);
  boxes.forEach(b => { b.checked = on; }); btn.textContent = on ? 'Select none' : 'Select all';
  if (boxes[0]) cleanupCount(boxes[0]);
}
async function cleanupDelete(f: HTMLFormElement) {
  const k = f.dataset.kind as Kind, ids = new Set([...f.querySelectorAll<HTMLInputElement>('input[name=id]:checked')].map(b => b.value));
  const items = found[k].filter(x => ids.has(x.id)), label = (KINDS.find(x => x[0] === k) || [k, k])[1].toLowerCase();
  if (!items.length) return;
  if (!await confirmBox('Delete ' + items.length + ' ' + (items.length === 1 ? label.replace(/ies$/, 'y').replace(/s$/, '') : label) + '?',
    items.slice(0, 8).map(x => x.name).join(', ') + (items.length > 8 ? ' and ' + (items.length - 8) + ' more' : '') + '. This can’t be undone.')) return;
  await withAuth(async () => {
    let done = 0;
    for (let i = 0; i < items.length; i += 6) {
      await Promise.all(items.slice(i, i + 6).map(x => api(ownPath(k, x), { method: 'DELETE' }).then(() => { done++; }).catch(e => { if (e instanceof AuthError) throw e; })));
    }
    invalidate(); toast('Deleted ' + done + (done < items.length ? ' of ' + items.length : '')); route();
  });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  cleanupCount,
  cleanupAll,
  cleanupDelete,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

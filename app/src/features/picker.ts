import { html, htmlList } from '../core/html';
import { AuthError, api } from '../core/api';
import { showLogin } from '../core/auth';
import { App, S, el } from '../core/base';
import { toast } from '../core/dom';
import { type Group, type TxMeta, type TxRowsOpts, groupUpdate, txRows } from '../core/feed';
import { buzz } from '../core/helpers';
import { invalidate } from '../core/lists';
import { bindSwipe } from './phone';

/* ---------- Inline category / budget picker ---------- */
type PickItem = { v: string, l: string, create?: boolean };
let pickCtx: { tr: HTMLElement, meta: TxMeta, k: string, items: PickItem[], cur: string, idx: number, q: string } | null = null;
export function pick(node: HTMLElement) {
  const tr = node.closest<HTMLElement>('tr[data-gid]'), meta = tr && S.txMeta[tr.dataset.gid!], L = S.lists!;
  if (!meta || !L) return;
  const k = node.dataset.k!, sp = meta.g.splits[0];
  const items = k === 'category'
    ? [{ v: '', l: 'No category' }, ...L.categories.map(c => ({ v: c.name, l: c.name }))]
    : [{ v: '', l: 'No budget' }, ...L.budgets.filter(b => b.active || b.id === sp.budget_id).map(b => ({ v: b.id, l: b.name }))];
  pickCtx = { tr, meta, k, items, cur: k === 'category' ? sp.category : sp.budget_id, idx: 0, q: '' };
  const box = el('pickpop');
  box.innerHTML = String(html`<input type="text" id="pkq" autocomplete="off" placeholder="${k === 'category' ? 'Find or create a category' : 'Find a budget'}" data-oninput="App.pickFilter(this.value)" data-onkeydown="App.pickKey(event)"><div class="pk-list" id="pkList"></div>`);
  box.hidden = false;
  const r = node.getBoundingClientRect(), w = Math.min(280, innerWidth - 24);
  box.style.width = w + 'px';
  box.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
  pickFilter('');
  const h = box.offsetHeight;
  box.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(12, r.top - h - 6) : r.bottom + 6) + 'px';
  el('pkq').focus();
}
function pickList(): PickItem[] {
  const c = pickCtx!, q = c.q.trim().toLowerCase();
  let list = c.items.filter(x => !q || x.l.toLowerCase().includes(q));
  list.sort((a, b) => (b.l.toLowerCase().startsWith(q) ? 1 : 0) - (a.l.toLowerCase().startsWith(q) ? 1 : 0));
  if (c.k === 'category' && q && !c.items.some(x => x.l.toLowerCase() === q)) list = [...list, { v: c.q.trim(), l: 'Create “' + c.q.trim() + '”', create: true }];
  return list;
}
function pickFilter(q: string) { const c = pickCtx!; c.q = q; c.idx = q ? 0 : Math.max(0, pickList().findIndex(x => String(x.v) === String(c.cur || ''))); drawPick(); }
function drawPick() {
  const c = pickCtx!, list = pickList();
  el('pkList').innerHTML = String(htmlList(list.map((x, i) => html`<div class="pal-item${i === c.idx ? ' on' : ''}" data-onmouseenter="App.pickHover(${i})" data-onmousedown="event.preventDefault();App.pickChoose(${i})"><span>${x.l}</span>${String(x.v) === String(c.cur) && !x.create ? html`<span class="k">✓</span>` : ''}</div>`)) || html`<div class="empty" style="padding:10px 14px">Nothing matches.</div>`);
  const on = el('pkList').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function pickHover(i: number) { if (pickCtx && i !== pickCtx.idx) { pickCtx.idx = i; drawPick(); } }
function pickKey(e: KeyboardEvent) {
  const n = pickList().length, c = pickCtx!;
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) e.stopPropagation();
  if (e.key === 'ArrowDown') { e.preventDefault(); c.idx = (c.idx + 1) % n; drawPick(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); c.idx = (c.idx - 1 + n) % n; drawPick(); }
  else if (e.key === 'Enter') { e.preventDefault(); pickChoose(c.idx); }
  else if (e.key === 'Escape') { e.preventDefault(); closePick(); }
}

function closePick() { const a = document.activeElement as HTMLElement; if (a && a.id === 'pkq') a.blur(); el('pickpop').hidden = true; const c = pickCtx; pickCtx = null; return c; }
document.addEventListener('mousedown', e => { if (!el('pickpop').hidden && !(e.target as HTMLElement).closest('#pickpop')) closePick(); });
document.addEventListener('scroll', e => { if (!el('pickpop').hidden && !((e.target as HTMLElement).closest && (e.target as HTMLElement).closest('#pickpop'))) closePick(); }, true);
function rowFor(g: Group, opts: TxRowsOpts) {
  const t = document.createElement('template'); t.innerHTML = String(txRows([g], opts));
  return t.content.querySelector<HTMLElement>('tr[data-gid]')!;
}
function swapRow(tr: HTMLElement, g: Group, opts: TxRowsOpts) {
  const nr = rowFor(g, opts), cb = tr.querySelector<HTMLInputElement>('input[data-sel]');
  if (cb && cb.checked) nr.querySelector<HTMLInputElement>('input[data-sel]')!.checked = true;
  if (tr.classList.contains('kfocus')) nr.classList.add('kfocus');
  tr.replaceWith(nr); bindSwipe(); return nr;
}
async function pickChoose(i: number) {
  const item = pickList()[i], c = closePick(); if (!item || !c) return;
  const { meta, k } = c, g = meta.g, sp = g.splits[0];
  if (String(item.v) === String(c.cur) && !item.create) return;
  const before = { category: sp.category, budget_id: sp.budget_id, budget_name: sp.budget_name };
  if (k === 'category') sp.category = item.v; else { sp.budget_id = item.v; sp.budget_name = item.v ? item.l : ''; }
  let row = c.tr.isConnected ? swapRow(c.tr, g, meta.opts) : null;          // optimistic: show it now
  if (row) row.classList.add('saving');
  buzz(8);
  try {
    const t: any = {};
    if (k === 'category') t.category_name = item.v; else t.budget_id = item.v || '0';
    await api('/transactions/' + g.id, { method: 'PUT', body: groupUpdate(g, x => x === sp ? t : null, { fire_webhooks: true }) });
    invalidate(); if (item.create) S.listsAt = 0;
    if (row && row.isConnected) { row.classList.remove('saving'); row.classList.add('saved'); setTimeout(() => row!.classList.remove('saved'), 900); }
    toast((k === 'category' ? 'Category' : 'Budget') + (item.v ? ' set to ' + (item.create ? item.v : item.l) : ' removed'));
  } catch (e) {
    Object.assign(sp, before);
    row = document.querySelector<HTMLElement>('#view tr[data-gid="' + g.id + '"]'); if (row) swapRow(row, g, meta.opts);
    if (e instanceof AuthError) return showLogin(e.message);
    toast('Couldn’t save: ' + (e as Error).message);
  }
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  pick,
  pickFilter,
  pickKey,
  pickHover,
  pickChoose,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

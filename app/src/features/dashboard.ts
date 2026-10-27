import { Html, html, htmlList } from '../core/html';
import { PAGES } from '../core/api';
import { App, S, el } from '../core/base';
import { vt, vtName } from '../core/dom';
import { buzz } from '../core/haptics';
import { LS } from '../core/helpers';
import { route } from '../core/router';
import { GRID, ROW, type Tile, gridDrop, gridSettle, snapStep } from './grid';

/* ---------- Customizable dashboard ----------
   Cards sit in columns you arrange yourself: each card stays in the column and at the height you put it. A wide card
   spans every column and splits the page into bands of columns above and below it. The arrangement is kept for each
   column count (money.dash place[n]), so a phone (1 column) and a desktop (3) each keep their own. */
const DASH_WIDE = ['flow', 'cashflow', 'recent'];
export const DASH_NAMES: Record<string, string> = { safe: 'Safe to spend', attention: 'Needs attention', spending: 'Where it went', budgets: 'Budgets', cash: 'Cash & savings', cards: 'Credit cards',
  loans: 'Loans', bills: 'Coming up', heatmap: 'Daily spending', flow: 'Money flow', cashflow: 'Cash flow', recent: 'Recent transactions',
  payees: 'Top payees', income: 'Income sources', goals: 'Savings goals', networth: 'Net worth' };
// Rough card heights, only used to deal cards into columns evenly the first time
const DASH_EST: Record<string, number> = { safe: 200, attention: 200, spending: 640, budgets: 300, cash: 300, cards: 290, loans: 250, bills: 220, heatmap: 420, payees: 640, income: 260, goals: 260, networth: 330 };
// Each tile's own settings (the ⚙ button while customizing), saved in money.dash opts {tile: {setting: value}}
const yes = [true, false];
type TileOpt = { id: string, label: string, options: (number | boolean)[], def: number | boolean, unit?: string };
export const TILE_OPTS: Record<string, TileOpt[]> = {
  recent: [{ id: 'count', label: 'Transactions to show', options: [5, 8, 10, 15, 20, 25], def: 8 }],
  spending: [{ id: 'count', label: 'Categories to show', options: [5, 8, 12, 20], def: 8 }, { id: 'compare', label: 'Compare with last month', options: yes, def: true }],
  payees: [{ id: 'count', label: 'Payees to show', options: [5, 8, 10, 15], def: 8 }, { id: 'compare', label: 'Compare with last month', options: yes, def: true }],
  budgets: [{ id: 'unset', label: 'Show budgets without an amount', options: yes, def: true }],
  cash: [{ id: 'zero', label: 'Show accounts with a zero balance', options: yes, def: true }, { id: 'closed', label: 'Show closed accounts', options: yes, def: false },
    { id: 'sparks', label: 'Show 30-day trend lines', options: yes, def: true }],
  cards: [{ id: 'paidOff', label: 'Show paid-off cards', options: yes, def: true }, { id: 'closed', label: 'Show closed cards', options: yes, def: false },
    { id: 'sparks', label: 'Show 30-day trend lines', options: yes, def: true }],
  loans: [{ id: 'paidOff', label: 'Show paid-off loans', options: yes, def: true }, { id: 'closed', label: 'Show closed loans', options: yes, def: false }],
  bills: [{ id: 'days', label: 'Look ahead', options: [7, 14, 30, 45], def: 45, unit: 'days' }],
  goals: [{ id: 'done', label: 'Show goals already reached', options: yes, def: true }],
  cashflow: [{ id: 'months', label: 'Months to show', options: [3, 6, 12], def: 6 }],
};
// A tile's setting, or its default when unset or no longer one of the choices
export function tileOpt(k: string, id: string) {
  const o = (TILE_OPTS[k] || []).find(x => x.id === id); if (!o) return undefined;
  const v = ((LS.get('dash', {}).opts || {})[k] || {})[id];
  return o.options.includes(v) ? v : o.def;
}
function tileOptsPanel(k: string) {
  const os = TILE_OPTS[k]; if (!os) return '';
  return html`<div class="wopts"${S.dashOptsOpen === k ? '' : ' hidden'}>${htmlList(os.map(o => {
    const v = tileOpt(k, o.id);
    return typeof o.def === 'boolean'
      ? html`<label class="check"><input type="checkbox"${v ? ' checked' : ''} data-onchange="App.dashOpt('${k}','${o.id}',this.checked)"> ${o.label}</label>`
      : html`<label class="wopt">${o.label}<select data-onchange="App.dashOpt('${k}','${o.id}',this.value)">${htmlList(o.options.map(x => html`<option value="${x}"${x === v ? ' selected' : ''}>${x}${o.unit ? ' ' + o.unit : ''}</option>`))}</select></label>`;
  }))}</div>`;
}
const optsButton = (k: string) => TILE_OPTS[k] ? html`<button type="button" class="obtn" data-onclick="App.dashOpts('${k}')" aria-label="Settings for this tile" title="Settings">⚙</button>` : '';
const DASH_COLS: (number | '')[] = ['', 1, 2, 3, 4, 6];      // '' = as many ~340px columns as fit (max 6)
// hidden also holds the parts above the cards ('hero', 'insights'); cols is the chosen column count; place[n] the arrangement;
// free the freeform spots {tile: [x, y, w]}; opts each tile's settings
type Block = string | string[][];
type DashLayout = { order: string[], hidden: string[], wide: string[] | null, cols: number | '', place: Record<string, unknown>,
  free?: Record<string, unknown>, opts?: Record<string, Record<string, unknown>> };
const dashLayout = (): DashLayout => ({ order: [], hidden: [], wide: null, cols: '', place: {}, ...LS.get('dash', {}) });
const dashShows = (part: string) => !dashLayout().hidden.includes(part);
// How many columns fit right now: the chosen count is a maximum, narrow windows get fewer
function dashCount(L: DashLayout) {
  const v = el('view'), w = (v && v.clientWidth) || innerWidth, min = L.cols ? 260 : 340;
  const n = Math.max(1, Math.min(L.cols || 6, Math.floor((w + 20) / (min + 20))));
  return gridMode() ? [6, 4, 3, 2, 1].find(c => c <= n)! : n;     // the freeform grid is 24 wide, so 5 columns become 4
}
// How many columns the Overview has right now (the insight strip shows one card per column, at least 4)
export const dashColumns = () => dashCount(dashLayout());
// The arrangement for n columns: a list of blocks, each a wide card's key or a band of n columns of keys.
// Cards that are gone are dropped; new ones (and ones that changed between wide and narrow) are dealt in at the end.
function dashPlace(L: DashLayout, keys: string[], n: number, wide: string[], est: (k: string) => number) {
  const seen = new Set(), ok = (k: string, isWide: boolean) => keys.includes(k) && !seen.has(k) && wide.includes(k) === isWide && seen.add(k);
  const blocks: Block[] = [];
  (((L.place || {})[n] || []) as unknown[]).forEach(b => {
    if (typeof b === 'string') { if (ok(b, true)) blocks.push(b); return; }
    if (!Array.isArray(b)) return;
    const band = [...Array(n)].map((_, i) => ((Array.isArray(b[i]) ? b[i] : []) as unknown[]).filter(k => typeof k === 'string' && ok(k, false)) as string[]);
    const last = blocks[blocks.length - 1];
    if (Array.isArray(last)) band.forEach((c, i) => last[i].push(...c)); else blocks.push(band);     // two bands in a row: merge them
  });
  const order = [...L.order.filter(k => keys.includes(k)), ...keys.filter(k => !L.order.includes(k))];
  order.filter(k => !seen.has(k)).forEach(k => {
    if (wide.includes(k)) { blocks.push(k); return; }
    let band = blocks[blocks.length - 1];
    if (!Array.isArray(band)) blocks.push(band = [...Array(n)].map(() => [] as string[]));
    const h = band.map(c => c.reduce((s, x) => s + est(x), 0)), i = h.indexOf(Math.min(...h));     // the shortest column
    band[i].push(k);
  });
  return blocks.filter(b => !Array.isArray(b) || b.some(c => c.length));
}
const gridMode = () => { const v = el('view'); return ((v && v.clientWidth) || innerWidth) >= 700; };
// Lay the tiles on the page out from their saved spots (data-gx/gy/gw), their measured heights and `over` (the tile
// being dragged or resized, at its new spot). Always starts from the saved spots, so nothing drifts.
// Outside Customize every tile rises as far as it can, so empty space (from a tile moved down, hidden, or shorter
// than before) always closes up; while customizing, gaps stay where you leave them until you're done.
type TileEl = HTMLElement & { _g?: Tile };
function gridLayout(d: HTMLElement, over?: Tile | null) {
  const gap = parseFloat(getComputedStyle(d).columnGap) || 20, pack = !d.classList.contains('editing');
  const ts = [...d.querySelectorAll<TileEl>(':scope > .w')].map(el => {
    const t: any = { el, k: el.dataset.w, x: Number(el.dataset.gx), y: Number(el.dataset.gy), w: Number(el.dataset.gw), float: pack || el.dataset.float === '1' };
    if (over && over.k === t.k) Object.assign(t, over, { float: false });
    el.style.gridColumn = (t.x + 1) + ' / span ' + t.w;
    return t;
  });
  ts.forEach(t => { t.h = Math.max(1, Math.ceil((t.el.offsetHeight + gap) / ROW)); });
  if (over) gridDrop(ts, over.k); else gridSettle(ts);
  ts.forEach(t => { t.el.style.gridRow = (t.y + 1) + ' / span ' + t.h; t.el._g = t; });
  return ts;
}
// Keep where the tiles are now as their saved spots
function gridKeep(d: HTMLElement) {
  const L = dashLayout(), free = { ...L.free };
  d.querySelectorAll<TileEl>(':scope > .w').forEach(el => {
    const t = el._g; if (!t) return;
    el.dataset.gx = String(t.x); el.dataset.gy = String(t.y); el.dataset.gw = String(t.w); delete el.dataset.float;
    free[t.k] = [t.x, t.y, t.w];
  });
  L.free = free; LS.set('dash', L);
}
// A phone shows the first few cards (in your order: Customize to change which) and folds the rest under Show more
const PHONE_CARDS = 6;
function phoneCards(cards: unknown[]) {
  if (cards.length <= PHONE_CARDS + 1) return htmlList(cards);
  const more = cards.length - PHONE_CARDS;
  return html`${htmlList(cards.slice(0, PHONE_CARDS))}<div class="dash-rest" id="dashRest"${S.dashMore ? '' : ' hidden'}>${htmlList(cards.slice(PHONE_CARDS))}</div><button type="button" class="btn dash-more" data-more="${more}" data-onclick="App.dashMore(this)">${S.dashMore ? 'Show fewer' : 'Show ' + more + ' more'}</button>`;
}
function dashMore(b: HTMLElement) {
  S.dashMore = !S.dashMore; el('dashRest').hidden = !S.dashMore;
  b.textContent = S.dashMore ? 'Show fewer' : 'Show ' + b.dataset.more + ' more';
  if (!S.dashMore) el('dash').scrollIntoView({ block: 'start' });
}
function dashButton() { return S.dashEdit ? '' : html`<button class="btn small" data-onclick="App.dashEdit(true)" title="Move, resize or hide cards">Customize</button>`; }
// top: the insight strip, which shares the cards' column grid so its cards line up with the columns below
function dashboard(W: [string, unknown][], top: Html | string = '') {
  const L = dashLayout(), keys = W.map(w => w[0]), map = Object.fromEntries(W), wide = L.wide || DASH_WIDE, edit = !!S.dashEdit, n = dashCount(L);
  const grid = gridMode(), blocks = dashPlace(L, keys, n, wide, k => map[k] ? (DASH_EST[k] || 250) + 20 : 0);
  // Freeform: each tile's spot, either saved or (for tiles you haven't placed) dealt from the column arrangement
  const spot: any = {};
  if (grid) {
    let i = 0;
    const deal = (k: string, c: number, cols: number) => { const x = Math.round(c * GRID / cols); spot[k] = { k, x, w: Math.round((c + 1) * GRID / cols) - x, y: 1e6 + i++, float: true }; };
    blocks.forEach(b => {
      if (typeof b === 'string') return deal(b, 0, 1);
      for (let r = 0; r < Math.max(...b.map(c => c.length)); r++) b.forEach((c, ci) => { if (c[r]) deal(c[r], ci, b.length); });
    });
    Object.entries<any>(L.free || {}).forEach(([k, v]) => {
      if (!spot[k] || !Array.isArray(v)) return;
      const w = Math.max(4, Math.min(GRID, Math.round(+v[2]) || 8)), x = Math.max(0, Math.min(GRID - w, Math.round(+v[0]) || 0));
      Object.assign(spot[k], { x, y: Math.max(0, Math.round(+v[1]) || 0), w, float: false });
    });
    // A first guess at the heights so the first paint is close; the real ones are measured right after
    gridSettle(Object.values<any>(spot).filter(t => map[t.k] && (edit || !L.hidden.includes(t.k))).map(t => Object.assign(t, { h: Math.ceil(((DASH_EST[t.k] || 250) + 20) / ROW) })));
  }
  const card = (k: string) => {
    const body = map[k]; if (!body) return '';
    const off = L.hidden.includes(k); if (off && !edit) return '';
    const isWide = wide.includes(k), g = spot[k];
    if (grid) return html`<div class="w${off ? ' off' : ''}" data-w="${k}" data-gx="${g.x}" data-gy="${g.y}" data-gw="${g.w}"${g.float ? html` data-float="1"` : ''} style="grid-column:${g.x + 1} / span ${g.w};grid-row:${g.y + 1} / span ${g.h}">${edit ? html`<div class="wctl"><span class="grip" title="Drag to move" aria-hidden="true">⠿</span><strong>${DASH_NAMES[k] || k}</strong><span class="grow"></span><button type="button" data-onclick="App.dashNudge('${k}',-1,0)" aria-label="Move left">←</button><button type="button" data-onclick="App.dashNudge('${k}',1,0)" aria-label="Move right">→</button><button type="button" data-onclick="App.dashNudge('${k}',0,-1)" aria-label="Move up">↑</button><button type="button" data-onclick="App.dashNudge('${k}',0,1)" aria-label="Move down">↓</button>${optsButton(k)}<button type="button" class="wbtn" data-onclick="App.dashWide('${k}')">${g.w === GRID ? 'Narrow' : 'Wide'}</button><button type="button" class="hbtn" data-onclick="App.dashHide('${k}')">${off ? 'Show' : 'Hide'}</button></div>${tileOptsPanel(k)}<span class="rsz" title="Drag to resize" aria-hidden="true"></span>` : ''}${body}</div>`;
    return html`<div class="w${isWide ? ' wide' : ''}${off ? ' off' : ''}" data-w="${k}">${edit ? html`<div class="wctl"><span class="grip" title="Drag to move" aria-hidden="true">⠿</span><strong>${DASH_NAMES[k] || k}</strong><span class="grow"></span>${n > 1 && !isWide ? html`<button type="button" data-onclick="App.dashShift('${k}',-1)" aria-label="Move left">←</button><button type="button" data-onclick="App.dashShift('${k}',1)" aria-label="Move right">→</button>` : ''}<button type="button" data-onclick="App.dashMove('${k}',-1)" aria-label="Move up">↑</button><button type="button" data-onclick="App.dashMove('${k}',1)" aria-label="Move down">↓</button>${optsButton(k)}<button type="button" class="wbtn" data-onclick="App.dashWide('${k}')">${isWide ? 'Narrow' : 'Wide'}</button><button type="button" class="hbtn" data-onclick="App.dashHide('${k}')">${off ? 'Show' : 'Hide'}</button></div>${tileOptsPanel(k)}` : ''}${body}</div>`;
  };
  const body = grid ? htmlList(keys.map(card)) : !edit && n === 1 ? phoneCards(blocks.flatMap(b => typeof b === 'string' ? [b] : b.flat()).map(card).filter(Boolean)) : htmlList(blocks.map(blk => {
    if (typeof blk === 'string') return card(blk);
    const cols = blk.map(c => htmlList(c.map(card)));
    return !edit && cols.every(c => !c) ? '' : html`<div class="band">${htmlList(cols.map(c => html`<div class="dcol">${c}</div>`))}</div>`;
  }));
  const part = (p: string, label: string) => html`<label class="check"><input type="checkbox"${L.hidden.includes(p) ? '' : ' checked'} data-onchange="App.dashPart('${p}', this.checked)"> ${label}</label>`;
  return html`<div class="dash-wrap" data-n="${n}" style="--n:${n}">${top}${edit ? html`<div class="dash-bar"><span>${grid ? 'Drag a tile anywhere and drag its corner to resize; tiles snap to the grid and push others down.' :
      'Drag a card to any column and height (on a touch screen, by its ⠿ handle), or use the arrows. Wide cards span every column.'}</span><span class="grow"></span>${grid ? html`<button class="link" data-onclick="App.dashTidy()" title="Close the gaps by moving tiles up">Tidy up</button>` : ''}<button class="link" data-onclick="App.dashReset()">Reset</button><button class="btn small primary" data-onclick="App.dashEdit(false)">Done</button><div class="dash-opts"><span>${grid ? 'Arrange in columns' : 'Columns'}</span><div class="seg mini" id="dashCols">${htmlList(DASH_COLS.map(c => html`<button type="button" class="${String(L.cols || '') === String(c) ? 'on' : ''}" data-onclick="App.dashCols('${c}')">${c || 'Auto'}</button>`))}</div><span class="grow"></span>${part('hero', 'Net worth summary')}${part('insights', 'Insights')}</div></div>` : ''}<div class="cards ${grid ? 'grid' : 'free'}${edit ? ' editing' : ''}" id="dash" data-n="${n}" data-mode="${grid ? 'grid' : 'cols'}"${L.cols ? html` data-cols="${String(L.cols)}"` : ''}>${body}</div></div>`;
}
// Read the arrangement back from the page (only while customizing, when hidden cards are on the page too)
function dashSave(mut?: (L: DashLayout) => void) {
  const L = dashLayout(), d = el('dash');
  if (d && d.classList.contains('editing') && !d.classList.contains('grid')) {
    const keysIn = (node: Element) => [...node.querySelectorAll<HTMLElement>(':scope > .w')].map(w => w.dataset.w);
    const blocks = ([...d.children] as HTMLElement[]).map(ch => ch.classList.contains('band') ? [...ch.children].map(keysIn) : ch.dataset.w).filter(Boolean);
    L.place = { ...L.place, [d.dataset.n!]: blocks };
    L.order = (blocks.flat(2) as string[]).concat(L.order.filter(k => !d.querySelector('[data-w="' + k + '"]')));
  }
  if (!L.wide) L.wide = DASH_WIDE.slice();
  if (mut) mut(L);
  LS.set('dash', L); return L;
}
function dashAnimate(fn: () => void) {
  const ws = [...document.querySelectorAll<HTMLElement>('#dash .w')];
  vt('dash', fn, () => ws.forEach(w => vtName(w, 'dw-' + w.dataset.w)));
}
const dashRedraw = () => { S.pageKey = ''; PAGES.clear(); route(); };
function dashEdit(on: boolean) {
  const d = el('dash');
  if (!on && d && d.classList.contains('grid')) {      // done: close the gaps and keep the tidy layout
    d.querySelectorAll(':scope > .w').forEach((w: any) => { w.dataset.float = '1'; });
    gridLayout(d); gridKeep(d);
  }
  S.dashEdit = on; dashRedraw();
}
const dashCard = (k: string): any => document.querySelector('#dash [data-w="' + k + '"]');
const newBand = (n: number) => { const b = document.createElement('div'); b.className = 'band'; b.innerHTML = '<div class="dcol"></div>'.repeat(n); return b; };
// Up and down: within the column, or past a wide card into the band beyond it (same column)
function dashMove(k: string, dir: number) {
  const w = dashCard(k); if (!w) return;
  const sib = dir < 0 ? w.previousElementSibling : w.nextElementSibling;
  if (sib) return dashAnimate(() => { dir < 0 ? sib.before(w) : sib.after(w); dashSave(); });
  const col = w.parentElement; if (!col.classList.contains('dcol')) return;
  const i = [...col.parentElement.children].indexOf(col), d = el('dash');
  let blk = dir < 0 ? col.parentElement.previousElementSibling : col.parentElement.nextElementSibling;
  if (!blk) return;
  dashAnimate(() => {
    if (!blk.classList.contains('band')) {       // a wide card: hop over it into the band on its far side
      const far = dir < 0 ? blk.previousElementSibling : blk.nextElementSibling;
      if (!far || !far.classList.contains('band')) { const b = newBand(Number(d.dataset.n)); dir < 0 ? blk.before(b) : blk.after(b); blk = b; } else blk = far;
    }
    const to = blk.children[i]; dir < 0 ? to.appendChild(w) : to.prepend(w);
    dashSave();
  });
}
// Left and right: the same height in the next column
function dashShift(k: string, dir: number) {
  const w = dashCard(k); if (!w || !w.parentElement.classList.contains('dcol')) return;
  const col = w.parentElement, to = dir < 0 ? col.previousElementSibling : col.nextElementSibling; if (!to) return;
  const at = to.children[[...col.children].indexOf(w)];
  dashAnimate(() => { at ? at.before(w) : to.appendChild(w); dashSave(); });
}
function dashWide(k: string) {
  const w = dashCard(k), d = el('dash'); if (!w) return;
  if (d.classList.contains('grid')) {
    const t = w._g, wide = t.w < GRID, nw = wide ? GRID : Math.round(GRID / Math.min(Number(d.dataset.n), 4)) || 8;
    dashSave(x => { x.wide = wide ? [...new Set([...x.wide!, k])] : x.wide!.filter(y => y !== k); });
    gridMove(d, { k, x: wide ? 0 : Math.min(t.x, GRID - nw), y: t.y, w: nw, h: t.h });
    w.querySelector('.wbtn').textContent = wide ? 'Narrow' : 'Wide';
    return;
  }
  const L = dashSave(x => { x.wide = x.wide!.includes(k) ? x.wide!.filter(y => y !== k) : [...x.wide!, k]; }), on = L.wide!.includes(k);
  dashAnimate(() => {
    if (on) w.closest('.band').after(w);       // full width, right below the band it was in
    else {                                     // back into a column: the shortest one of the band just above (or below)
      const near = [w.previousElementSibling, w.nextElementSibling].find(b => b && b.classList.contains('band'));
      const band = near || (() => { const b = newBand(Number(d.dataset.n)); w.after(b); return b; })();
      const cols = [...band.children] as HTMLElement[];
      cols.reduce((a, c) => c.offsetHeight < a.offsetHeight ? c : a, cols[0])[near === w.previousElementSibling ? 'appendChild' : 'prepend'](w);
    }
    w.classList.toggle('wide', on); w.querySelector('.wbtn').textContent = on ? 'Narrow' : 'Wide';
    dashSave();
  });
}
// ⚙: show or hide a tile's settings
function dashOpts(k: string) {
  S.dashOptsOpen = S.dashOptsOpen === k ? null : k;
  document.querySelectorAll('#dash .wopts').forEach((p: any) => { p.hidden = p.closest('.w').dataset.w !== S.dashOptsOpen; });
}
// Change one setting: save it and redraw (the tile may need different data); its settings stay open
function dashOpt(k: string, id: string, v: string | number | boolean) {
  const o = (TILE_OPTS[k] || []).find(x => x.id === id); if (!o) return;
  if (typeof o.def === 'number') v = +v;
  if (!o.options.includes(v as number | boolean)) return;
  dashSave(x => { x.opts = { ...x.opts, [k]: { ...(x.opts || {})[k], [id]: v } }; });
  dashRedraw();
}
function dashHide(k: string) {
  const L = dashSave(x => { x.hidden = x.hidden.includes(k) ? x.hidden.filter(y => y !== k) : [...x.hidden, k]; });
  const w = dashCard(k), off = L.hidden.includes(k);
  w.classList.toggle('off', off); w.querySelector('.hbtn').textContent = off ? 'Show' : 'Hide';
}
function dashCols(c: string) {
  const grid = el('dash') && el('dash').classList.contains('grid');      // freeform: start over from that many columns
  dashSave(x => { x.cols = DASH_COLS.map(String).includes(String(c)) ? (c ? +c : '') : ''; if (grid) x.free = {}; }); dashRedraw();
}
// Freeform: put a tile at a new spot (others make room, animated) and keep the result
function gridMove(d: HTMLElement, over?: Tile) {
  const ws = [...d.querySelectorAll<HTMLElement>(':scope > .w')], was = new Map(ws.map(w => [w, w.getBoundingClientRect()]));
  gridLayout(d, over); gridKeep(d);
  ws.forEach(w => {
    const a = was.get(w)!, b = w.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) return;
    w.style.transition = 'none'; w.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    void w.offsetWidth; w.style.transition = 'transform .2s ease'; w.style.transform = '';
  });
}
// The arrows nudge a tile one column sideways, or a card's worth of rows up or down
function dashNudge(k: string, dx: number, dy: number) {
  const w = dashCard(k), d = el('dash'); if (!w || !w._g) return;
  const t = w._g;
  gridMove(d, { k, x: Math.max(0, Math.min(GRID - t.w, t.x + dx)), y: Math.max(0, t.y + dy * 6), w: t.w, h: t.h });
}
// Close the gaps: every tile rises as far as it can, keeping its column and order
function dashTidy() {
  const d = el('dash'); if (!d || !d.classList.contains('grid')) return;
  d.querySelectorAll<HTMLElement>(':scope > .w').forEach(w => { w.dataset.float = '1'; });
  gridMove(d);
}
// The net-worth summary and the insight strip sit above the cards, so showing or hiding them redraws the page
function dashPart(p: string, on: boolean) { dashSave(x => { x.hidden = x.hidden.filter(y => y !== p).concat(on ? [] : [p]); }); dashRedraw(); }
function dashReset() { LS.set('dash', {}); dashRedraw(); }
// A window resize that changes how many columns fit redraws the overview with that count's arrangement
addEventListener('resize', (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(() => {
  const d = el('dash'); if (d && !d.classList.contains('moving') && (Number(d.dataset.n) !== dashCount(dashLayout()) || (d.dataset.mode === 'grid') !== gridMode())) { S.pageKey = ''; PAGES.clear(); route({ quiet: true }); }
}, 200); }; })());
// Moving cards in Customize: pointer events, so it works the same with a mouse, a pen or a finger. A mouse can pick a
// card up anywhere on it; touch uses the ⠿ handle so the page still scrolls. The card follows the pointer as a floating
// copy, its slot moves to wherever it would land (the others slide out of the way), and the page scrolls when you hold
// it near the top or bottom edge.
let gridRO: ResizeObserver | null = null, gridMO: MutationObserver | null = null;
export function bindDash() {
  if (gridRO) { gridRO.disconnect(); gridMO!.disconnect(); gridRO = gridMO = null; }
  const d = el('dash'); if (!d) return;
  if (d.classList.contains('grid')) return bindGrid(d);
  if (!d.classList.contains('editing')) return;
  let drag: { w: HTMLElement, id: number, x0: number, y0: number, x: number, y: number, ghost?: HTMLElement, raf: number } | null = null;
  const dragging = () => drag!;
  const near = (els: Element[], x: number, y: number) => {      // the element under the pointer, or else the nearest one (so gaps count too)
    let best: Element | null = null, bd = Infinity;
    for (const e of els) {
      const r = e.getBoundingClientRect(), dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom), dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = e; }
    }
    return best;
  };
  // The first of these whose middle is below the pointer: the slot goes right before it
  const before = (els: Element[], y: number) => els.find(e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2 > y; }) || null;
  const flip = (fn: () => void) => {
    const ws = [...d.querySelectorAll<HTMLElement>('.w')], was = new Map(ws.map(w => [w, w.getBoundingClientRect()]));
    fn();
    ws.forEach(w => {
      if (w === drag!.w) return;
      const a = was.get(w)!, b = w.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      w.style.transition = 'none'; w.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      void w.offsetWidth; w.style.transition = 'transform .2s ease'; w.style.transform = '';
    });
  };
  const put = (parent: Element, ref: Element | null) => {
    const drag = dragging();
    if (ref === drag.w || (ref ? ref.previousElementSibling === drag.w : parent.lastElementChild === drag.w) && drag.w.parentElement === parent) return;
    flip(() => parent.insertBefore(drag.w, ref));
  };
  const place = () => {
    if (!drag) return;
    const { x, y, w } = drag, top = [...d.children].filter(c => c !== w);
    if (w.classList.contains('wide')) return put(d, before(top, y));      // a wide card goes between bands
    // A narrow card: into the column under the pointer, at the pointer's height
    const t = near([...d.querySelectorAll('.dcol'), ...d.querySelectorAll(':scope > .w.wide')].filter(c => c !== w), x, y); if (!t) return;
    if (t.classList.contains('dcol')) return put(t, before([...t.children].filter(c => c !== w), y));
    // Over a wide card: into the band just above or below it (a new one if there's none), in the column under the pointer
    const r = t.getBoundingClientRect(), up = y < r.top + r.height / 2, n = Number(d.dataset.n);
    let band = up ? t.previousElementSibling : t.nextElementSibling;
    if (!band || !band.classList.contains('band')) { band = newBand(n); up ? t.before(band) : t.after(band); }
    const col = band.children[Math.max(0, Math.min(n - 1, Math.floor((x - r.left) / (r.width / n))))];
    put(col, up ? null : col.firstElementChild);
  };
  const tick = () => {
    if (!drag || !drag.ghost) return;
    const edge = 70, v = drag.y < edge ? -(edge - drag.y) / 4 : drag.y > innerHeight - edge ? (drag.y - innerHeight + edge) / 4 : 0;
    if (v) { scrollBy(0, v); place(); }
    drag.raf = requestAnimationFrame(tick);
  };
  const lift = () => {
    const drag = dragging(), r = drag.w.getBoundingClientRect(), g = drag.w.cloneNode(true) as HTMLElement;
    g.classList.add('dash-ghost'); g.removeAttribute('data-w');
    Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
    document.body.appendChild(g);
    drag.ghost = g;
    drag.w.classList.add('dragging'); d.classList.add('moving');
    buzz(8);
    drag.raf = requestAnimationFrame(tick);
  };
  const drop = () => {
    if (!drag) return;
    const { w, ghost, raf } = drag; drag = null;
    cancelAnimationFrame(raf);
    d.classList.remove('moving');
    if (!ghost) return;
    const r = w.getBoundingClientRect();
    ghost.style.transition = 'transform .18s ease, opacity .18s'; ghost.style.transform = 'translate(' + (r.left - parseFloat(ghost.style.left)) + 'px,' + (r.top - parseFloat(ghost.style.top)) + 'px)';
    setTimeout(() => { ghost.remove(); w.classList.remove('dragging'); }, 180);
    dashSave();
  };
  d.addEventListener('pointerdown', e => {
    const w = (e.target as HTMLElement).closest<HTMLElement>('.w'); if (!w || e.button > 0 || (e.target as HTMLElement).closest('button, a, input, select, label, .wopts')) return;
    if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('.grip')) return;     // touch: only the handle, so scrolling still works
    drag = { w, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, raf: 0 };
    if (e.pointerType !== 'mouse') lift();
    try { d.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  d.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.ghost) { if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 5) return; lift(); }
    drag.ghost!.style.transform = 'translate(' + (drag.x - drag.x0) + 'px,' + (drag.y - drag.y0) + 'px)';
    place();
  });
  d.addEventListener('pointerup', drop);
  d.addEventListener('pointercancel', drop);
  d.addEventListener('lostpointercapture', drop);
}
// Freeform tiles: re-measure whenever a tile changes size (data arriving, a narrower window) or is replaced, and let
// you move tiles by dragging them (a mouse anywhere on the tile, touch by the ⠿ handle) and resize them by the corner.
function bindGrid(d: HTMLElement) {
  let drag: { w: HTMLElement, t: Tile, resize: boolean, id: number, x0: number, y0: number, x: number, y: number, r0: DOMRect, left: number,
    over: Tile | null, lifted?: boolean, ghost?: HTMLElement, raf: number } | null = null, raf = 0;
  const dragging = () => drag!;
  const relayout = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (d.isConnected) gridLayout(d, drag && drag.over); }); };
  if (window.ResizeObserver) {
    const ro = gridRO = new ResizeObserver(relayout);
    const watch = () => { d.querySelectorAll(':scope > .w').forEach(w => ro.observe(w)); relayout(); };
    gridMO = new MutationObserver(watch); gridMO.observe(d, { childList: true });
    watch();
  }
  gridLayout(d);
  if (!d.classList.contains('editing')) return;
  const cell = () => { const r = d.getBoundingClientRect(), gap = parseFloat(getComputedStyle(d).columnGap) || 20; return { r, gap, cw: (r.width - gap * (GRID - 1)) / GRID }; };
  const shift = (over: Tile) => {
    const drag = dragging();
    if (drag.over && over.x === drag.over.x && over.y === drag.over.y && over.w === drag.over.w) return;
    drag.over = over;
    const ws = [...d.querySelectorAll<HTMLElement>(':scope > .w')].filter(w => w !== drag.w), was = new Map(ws.map(w => [w, w.getBoundingClientRect()]));
    gridLayout(d, over);
    ws.forEach(w => {
      const a = was.get(w)!, b = w.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      w.style.transition = 'none'; w.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      void w.offsetWidth; w.style.transition = 'transform .2s ease'; w.style.transform = '';
    });
  };
  const place = () => {
    if (!drag) return;
    const { r, gap, cw } = cell(), t = drag.t;
    if (drag.resize) {
      const w = Math.max(4, Math.min(GRID - t.x, Math.round((drag.x - drag.left + gap) / (cw + gap))));
      return shift({ k: t.k, x: t.x, y: t.y, w, h: t.h });
    }
    const left = drag.r0.left + drag.x - drag.x0 - r.left, top = drag.r0.top + drag.y - drag.y0 - r.top;
    // Snap with a dead zone: one column sideways, four rows (32px) up or down, each only once well past halfway
    const cur = drag.over || t;
    shift({ k: t.k, x: Math.max(0, Math.min(GRID - t.w, snapStep(left / (cw + gap), cur.x, 1))), y: Math.max(0, snapStep(top / ROW, cur.y, 4)), w: t.w, h: t.h });
  };
  const tick = () => {
    if (!drag) return;
    const edge = 70, v = drag.y < edge ? -(edge - drag.y) / 4 : drag.y > innerHeight - edge ? (drag.y - innerHeight + edge) / 4 : 0;
    if (v) { scrollBy(0, v); place(); }
    drag.raf = requestAnimationFrame(tick);
  };
  const lift = () => {
    const drag = dragging();
    drag.lifted = true; d.classList.add('moving'); buzz(8);
    if (!drag.resize) {
      const g = drag.w.cloneNode(true) as HTMLElement;
      g.classList.add('dash-ghost'); g.removeAttribute('data-w'); g.style.gridColumn = g.style.gridRow = '';
      Object.assign(g.style, { left: drag.r0.left + 'px', top: drag.r0.top + 'px', width: drag.r0.width + 'px' });
      document.body.appendChild(g); drag.ghost = g; drag.w.classList.add('dragging');
    }
    drag.raf = requestAnimationFrame(tick);
  };
  const drop = () => {
    if (!drag) return;
    const { w, ghost, lifted } = drag; cancelAnimationFrame(drag.raf);
    const over = drag.over; drag = null;
    d.classList.remove('moving');
    if (!lifted) return;
    gridLayout(d, over); gridKeep(d);
    if (ghost) {
      const r = w.getBoundingClientRect();
      ghost.style.transition = 'transform .18s ease, opacity .18s'; ghost.style.transform = 'translate(' + (r.left - parseFloat(ghost.style.left)) + 'px,' + (r.top - parseFloat(ghost.style.top)) + 'px)';
      setTimeout(() => { ghost.remove(); w.classList.remove('dragging'); }, 180);
    }
  };
  d.addEventListener('pointerdown', e => {
    const w = (e.target as HTMLElement).closest<HTMLElement & { _g?: Tile }>('.w'); if (!w || !w._g || e.button > 0 || (e.target as HTMLElement).closest('button, a, input, select, label, .wopts')) return;
    const resize = !!(e.target as HTMLElement).closest('.rsz');
    if (e.pointerType !== 'mouse' && !resize && !(e.target as HTMLElement).closest('.grip')) return;     // touch: the handle or the corner, so scrolling still works
    const r0 = w.getBoundingClientRect();
    drag = { w, t: { ...w._g }, resize, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, r0, left: r0.left, over: null, raf: 0 };
    if (e.pointerType !== 'mouse') lift();
    try { d.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  d.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.lifted) { if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 5) return; lift(); }
    if (drag.ghost) drag.ghost.style.transform = 'translate(' + (drag.x - drag.x0) + 'px,' + (drag.y - drag.y0) + 'px)';
    place();
  });
  d.addEventListener('pointerup', drop);
  d.addEventListener('pointercancel', drop);
  d.addEventListener('lostpointercapture', drop);
}


// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  dashboard,
  dashButton,
  dashMore,
  dashEdit,
  dashOpts,
  dashOpt,
  dashMove,
  dashWide,
  dashHide,
  dashReset,
  dashCols,
  dashPart,
  dashShows,
  dashShift,
  dashNudge,
  dashTidy,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

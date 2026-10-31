import { html } from '../core/html';
import { api, eachLimited } from '../core/api';
import { App, S, arr, el, money0, sameName } from '../core/base';
import { toast } from '../core/dom';
import { normGroup, tidyDays } from '../core/feed';
import { glideRows, rowTops } from '../core/morph';
import { lists } from '../core/lists';
import { type RouteInfo, VIEWS, parseHash, route } from '../core/router';
import { openPalette } from './palette';
import { bindSwipe } from './phone';
import { newTx } from './txform';

/* Polish: prefetch on hover, after-paint effects, chart tooltips, quick add and keyboard shortcuts,
   payee memory, undo for deletes, instant rules filter. */
export const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Prefetch a page's data when hovering its link ---------- */
const prefetched: any = {};
function prefetch(name: string) {
  if (!VIEWS[name] || name === (parseHash().name) || Date.now() - (prefetched[name] || 0) < 30000) return;
  prefetched[name] = Date.now();
  Promise.resolve().then(() => VIEWS[name]({ name, id: '', q: {} }, () => {})).catch(() => {});
}

/* ---------- After every page paint ---------- */
function afterPaint(r: RouteInfo, o: { quiet?: boolean } = {}) {
  if (!o.quiet) { countUp(); playIn(); }
  bindChart();
  bindSwipe();
  if (App.afterPaint2) App.afterPaint2(r);
}
// A tab you've seen before comes back from memory without a paint: play its entrance all the same
function replayIn() { countUp(); playIn(); }
// Every page you open eases in, first visit or not: cards rise one after another, lines draw, bars grow, donuts and
// rings sweep round (the animations are in money.css under .anim). Refreshes of the page you're on don't replay it.
let animT = 0;
function playIn() {
  if (reduceMotion) return;
  const v = el('view');
  v.querySelectorAll<HTMLElement>(':scope :is(.hero, .kpi, .panel, .insight)').forEach((n, i) => n.style.setProperty('--i', String(Math.min(i, 10))));
  // Inside a page slide the whole page is already moving: cards rising on top of that reads as a stutter, so then only
  // the charts draw in
  v.classList.toggle('calm', document.documentElement.classList.contains('vt-page'));
  v.classList.remove('anim'); void v.offsetWidth; v.classList.add('anim');
  // Take .enter off with it: without .anim the page's own fade-in rules apply again and would play a second time (a flicker)
  clearTimeout(animT); animT = window.setTimeout(() => v.classList.remove('anim', 'enter'), 2600);
}
function countUp() {
  if (reduceMotion) return;
  document.querySelectorAll<HTMLElement>('#view [data-count]').forEach(node => {
    const target = parseFloat(node.dataset.count!); if (!isFinite(target) || Math.abs(target) < 1) return;
    const t0 = performance.now(), dur = 520;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      node.textContent = money0(target * e);
      if (p < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
function bindChart() {
  document.querySelectorAll<HTMLElement>('#view svg.flowchart').forEach(svg => {
    svg.addEventListener('mousemove', e => {
      const hit = (e.target as HTMLElement).closest && (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); const tip = el('tip');
      if (!hit) { tip.hidden = true; return; }
      const d = (S.chartData || [])[Number(hit.dataset.i)]; if (!d) return;
      tip.innerHTML = String(html`<strong>${d.label}</strong><br>Earned ${money0(d.income)}<br>Spent ${money0(d.spend)}<br>Kept ${money0(d.income - d.spend)}`);
      tip.hidden = false;
      // Pin the tip centred above the hovered month rather than at the cursor, so it never covers a neighbour's bars
      const col = (hit.closest('.col')?.querySelector('.band') || hit).getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, col.left + col.width / 2 - w / 2)) + 'px';
      tip.style.top = (col.top - hgt - 8 >= 8 ? col.top - hgt - 8 : col.bottom + 8) + 'px';
    });
    svg.addEventListener('mouseleave', () => { el('tip').hidden = true; });
    svg.addEventListener('click', e => {
      const hit = (e.target as HTMLElement).closest && (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); const d = hit && (S.chartData || [])[Number(hit.dataset.i)];
      if (!d || !d.go) return;
      el('tip').hidden = true;
      const [kind, a, b] = d.go.split(':');
      if (kind === 'month') { S.all = false; S.y = +a; S.m = +b; route(); }
      if (kind === 'report') location.hash = '#/reports?start=' + a + '&end=' + b;
    });
  });
}

/* ---------- Hover tooltips for chart points ---------- */
let touchAt = 0;   // a tap also sends a mousemove; the tap already placed the tip above the finger
document.addEventListener('mousemove', e => {
  if (Date.now() - touchAt < 800) return;
  const t = e.target && (e.target as HTMLElement).closest ? (e.target as HTMLElement).closest('[data-tip]') : null, tip = el('tip');
  if (!t) { if (tip.dataset.src === 'pt') { tip.hidden = true; tip.dataset.src = ''; } return; }
  tip.textContent = t.getAttribute('data-tip'); tip.dataset.src = 'pt'; tip.hidden = false;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px';
  tip.style.top = (e.clientY + hgt + 20 > innerHeight ? e.clientY - hgt - 12 : e.clientY + 14) + 'px';
});
document.addEventListener('scroll', () => { const tip = el('tip'); if (tip.dataset.src === 'pt') tip.hidden = true; }, true);
// Ring charts: the slice under the pointer stands out, with its row in the list beside it; on a phone a tap on any chart point shows its tip above the finger
let ringT: ReturnType<typeof setTimeout> | undefined;
function ringHot(seg: Element | null) {
  document.querySelectorAll('.donut.hot').forEach(d => { if (!seg || !d.contains(seg)) { d.classList.remove('hot'); d.closest('.share')?.querySelectorAll('.part.hot').forEach(p => p.classList.remove('hot')); } });
  if (!seg) return;
  const d = seg.closest('.donut')!, i = Number((seg as HTMLElement).dataset.i);
  d.classList.add('hot'); d.querySelectorAll('.seg').forEach(x => x.classList.toggle('on', x === seg));
  d.closest('.share')?.querySelectorAll('.part').forEach((p, k) => p.classList.toggle('hot', k === i));
}
document.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') ringHot(e.target instanceof Element ? e.target.closest('.donut .seg[data-tip]') : null); });
document.addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') return;
  touchAt = Date.now();
  const seg = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null, tip = el('tip');
  ringHot(seg && seg.matches('.donut .seg') ? seg : null); clearTimeout(ringT);
  if (!seg) { if (tip.dataset.src === 'ring' || tip.dataset.src === 'pt') tip.hidden = true; return; }
  tip.textContent = seg.getAttribute('data-tip'); tip.dataset.src = 'ring'; tip.hidden = false;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX - w / 2)) + 'px';
  tip.style.top = (e.clientY - hgt - 18 >= 8 ? e.clientY - hgt - 18 : e.clientY + 18) + 'px';
  ringT = setTimeout(() => { tip.hidden = true; ringHot(null); }, 2500);
});

/* ---------- Quick add + keyboard shortcuts ---------- */
export async function quickAdd() { await lists(); const r = parseHash(); newTx(r.name === 'account' && r.id ? { account: r.id } : {}); }
export const typing = (e: Event) => { const t = e.target as HTMLElement | null; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!el('app').hidden) openPalette(); return; }
  if (el('app').hidden || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (el('drawer').classList.contains('open') || !el('palette').hidden || el<HTMLDialogElement>('confirm').open) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickAdd(); }
  if (e.key === '/') { e.preventDefault(); const s = document.querySelector<HTMLInputElement>('#view .search input'); if (s) s.focus(); else openPalette(); }
});

/* ---------- Payee memory: fill category/budget from the last time ---------- */
export async function payeeFill(i: number, name: string) {
  const f = S.form; if (!f || !name || !name.trim()) return;
  const L = S.lists!, pool = f.type === 'withdrawal' ? L.expense : L.revenue;
  const acc = pool.find(a => sameName(a.name, name)); if (!acc) return;
  try {
    const res = await api('/accounts/' + acc.id + '/transactions', { params: { limit: 25, page: 1 } });
    const mine = arr(res).map(normGroup).flatMap(g => g.splits).filter(x => x.source_id === acc.id || x.destination_id === acc.id);
    const s = mine.find(x => x.category) || mine[0];       // most recent one that was categorized
    if (!s || !S.form || S.form !== f) return;
    const card = document.querySelector<HTMLElement>('#txForm .split[data-i="' + i + '"]'); if (!card) return;
    const set = (k: string, v: string) => { const inp = card.querySelector<HTMLInputElement>('[data-k="' + k + '"]'); if (inp && !inp.value && v) { inp.value = v; inp.classList.add('filled'); f.splits[i][k] = v; } };
    set('category', s.category);
    if (f.type === 'withdrawal') set('budget', s.budget_id);
    if (!card.querySelector<HTMLInputElement>('[data-k="description"]')!.value) set('description', s.description);
  } catch (e) { /* suggestions are optional */ }
}

/* ---------- Undo for deleting transactions ---------- */
function softDeleteTx(ids: string[]) {
  ids.forEach(id => S.pendingDel.add(id));
  const before = rowTops(el('view'));               // the rows below close the gap, gliding up
  document.querySelectorAll<HTMLElement>('#view tr[data-gid]').forEach(tr => { if (ids.includes(tr.dataset.gid!)) tr.remove(); });
  tidyDays();
  glideRows(el('view'), before);
  S.sel = new Set(); if (el('bulkbar')) el('bulkbar').hidden = true;
  const box = el('undo'); clearTimeout(S.undoT);
  let undone = false;
  const commit = async () => {
    box.hidden = true;
    if (undone) return;
    let failed = 0;
    await eachLimited(ids, 4, async id => { try { await api('/transactions/' + id, { method: 'DELETE' }); } catch (e) { failed++; } S.pendingDel.delete(id); });
    if (failed) toast(failed + ' couldn’t be deleted');
    if (['', 'transactions', 'account'].includes(parseHash().name)) route();
  };
  if (S.undoCommit) S.undoCommit();              // finish any earlier pending delete first
  S.undoCommit = () => { clearTimeout(S.undoT); S.undoCommit = null; commit(); };
  box.innerHTML = String(html`<span>${ids.length === 1 ? 'Transaction deleted' : ids.length + ' transactions deleted'}</span><button type="button">Undo</button><span class="bar"></span>`);
  box.hidden = false;
  box.querySelector('button')!.onclick = () => {
    undone = true; clearTimeout(S.undoT); S.undoCommit = null; box.hidden = true;
    ids.forEach(id => S.pendingDel.delete(id)); toast('Restored'); route();
  };
  S.undoT = setTimeout(() => S.undoCommit && S.undoCommit(), 5000);
}
window.addEventListener('beforeunload', () => { if (S.undoCommit) S.undoCommit(); });

/* ---------- Rules: instant filter while typing ---------- */
function liveRuleFilter(q: string) {
  q = q.trim().toLowerCase();
  document.querySelectorAll<HTMLDetailsElement>('.rulegroup').forEach(g => {
    let shown = 0;
    g.querySelectorAll<HTMLElement>('td[data-text]').forEach(td => { const ok = !q || td.dataset.text!.includes(q); td.parentElement!.hidden = !ok; if (ok) shown++; });
    g.hidden = Boolean(q && !shown && !g.querySelector('summary')!.textContent.toLowerCase().includes(q));
    if (q && shown) g.open = true;
  });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  prefetch,
  afterPaint,
  replayIn,
  quickAdd,
  payeeFill,
  softDeleteTx,
  liveRuleFilter,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

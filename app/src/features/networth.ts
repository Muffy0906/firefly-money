import { html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, S, el, monthOf, monthRange, money0, todayIso } from '../core/base';
import { buzz } from '../core/haptics';
import { type Account, isAsset, isLiab, lists, normAccount } from '../core/lists';
import { LS, monthEnds } from '../core/helpers';
import { route } from '../core/router';
import { miniLine } from './charts';

/* ---------- Net worth over time ----------
   Firefly reports an account's balance on any past day (GET /accounts?date=…), so the history is one request per
   point and type: the last day of each month, plus today. */
const POINTS = 13;
export type NetWorthPoint = { date: string, assets: number, debts: number, net: number, by?: Record<string, number> };
export const nwYears = () => LS.get('nwYears', 1) === 3 ? 3 : 1;
async function netWorthHistory(): Promise<NetWorthPoint[]> {
  return netWorthOn(monthEnds(todayIso(), POINTS, nwYears() * 12 / (POINTS - 1)));
}
// Net worth on each of these days, in the same order (a day from today on uses today's balances)
export async function netWorthOn(days: string[]): Promise<NetWorthPoint[]> {
  const L = await lists(), t = todayIso();
  const own = L.accounts.filter(a => a.active && a.netWorth && (isAsset(a) || isLiab(a))), ids = new Set(own.map(a => a.id));
  // A liability's debt is Firefly's current_debt, which isn't reported for past days; the dated balance is, so past
  // debts are the dated balance shifted by however much the two differ today.
  const shift = Object.fromEntries(own.filter(isLiab).map(a => [a.id, a.debt - Math.abs(a.balance)]));
  const total = (accts: Account[]) => {
    let assets = 0, debts = 0; const by: Record<string, number> = {};
    accts.filter(a => ids.has(a.id)).forEach(a => {
      if (isLiab(a)) { const d = Math.abs(a.balance) + (shift[a.id] || 0); debts += d; by[a.id] = -d; } else { assets += a.balance; by[a.id] = a.balance; }
    });
    return { assets, debts, net: assets - debts, by };
  };
  return Promise.all(days.map(date => date >= t ? { date, ...total(own) }
    : Promise.all([getAll('/accounts', { type: 'asset', date }), getAll('/accounts', { type: 'liabilities', date })])
      .then(([as, ls]) => ({ date, ...total([...as, ...ls].map(normAccount)) }))));
}
// One year or three, for the Overview's net worth tile
export const nwSeg = () => { const years = nwYears(); return html`<div class="seg mini">${htmlList([1, 3].map(y => html`<button type="button" class="${years === y ? 'on' : ''}" data-onclick="App.nwRange(${y})">${y === 1 ? '1Y' : '3Y'}</button>`))}</div>`; };

/* ---------- Time scrubber: drag along the tile's line and it goes back to that month ----------
   The big number and the line under it show that point, and a tip names the accounts that moved most since.
   Let go on a past point and it offers that month's Overview. Each point you pass ticks (where the phone lets a
   drag tick: Android does, iPhone only on the first touch). */
let SCRUB: NetWorthPoint[] = [];
const label = (d: string) => new Date(d + 'T12:00:00').toLocaleString('en-US', { month: 'short', year: 'numeric' });
// The tile's line, with a guide and a knob on top that follow your finger
export function nwLine(pts: NetWorthPoint[], color: string) {
  SCRUB = pts;
  return html`<div class="nw-scrub" title="Drag to go back in time">${miniLine(pts.map(p => p.net), color, 'Net worth over time')}<i class="nw-guide"></i><i class="nw-knob" style="background:${color}"></i></div>`;
}
export const scrubIndex = (fx: number, xs: number[]) => xs.reduce((best, v, i) => Math.abs(v - fx) < Math.abs(xs[best] - fx) ? i : best, 0);
// The accounts whose balance changed most between a point and today: [name, change]
export function movers(then: Record<string, number>, now: Record<string, number>, names: Record<string, string>, n = 3) {
  return Object.keys({ ...then, ...now }).map(id => [names[id] || '?', (now[id] || 0) - (then[id] || 0)] as [string, number])
    .filter(([, d]) => Math.abs(d) >= 1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n);
}
let cur = -1, dragging = false, held = false, resetT: ReturnType<typeof setTimeout> | undefined;
const FIELDS = ['big', 'sub'], ORIG = new WeakMap<HTMLElement, Record<string, string>>();
const part = (card: HTMLElement, k: string) => card.querySelector<HTMLElement>(':scope > .' + (k === 'big' ? 'big' : 'sub-s'));
function show(box: HTMLElement, i: number) {
  const card = box.closest<HTMLElement>('.nw')!, pts = SCRUB, last = pts[pts.length - 1], p = pts[i]; if (!p || !last) return;
  if (i !== cur && cur !== -1) buzz(4);
  cur = i; clearTimeout(resetT);
  if (!ORIG.has(card)) ORIG.set(card, Object.fromEntries(FIELDS.map(f => [f, part(card, f)?.innerHTML || ''])));
  card.classList.add('scrubbing');
  const fx = pts.length > 1 ? i / (pts.length - 1) : 0, vals = pts.map(q => q.net);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; }
  // The line is drawn in a 300×60 box stretched over the svg's content box (see miniLine)
  const svg = box.querySelector('svg')!, sr = svg.getBoundingClientRect(), br = box.getBoundingClientRect(), pad = parseFloat(getComputedStyle(svg).paddingTop) || 0;
  const ky = sr.top - br.top + pad + (sr.height - pad) * (4 + 52 * (1 - (p.net - lo) / (hi - lo))) / 60;
  box.style.setProperty('--x', (fx * 100).toFixed(2) + '%'); box.style.setProperty('--ky', ky.toFixed(1) + 'px');
  const big = part(card, 'big'), sub = part(card, 'sub'), today = i === pts.length - 1, d = last.net - p.net;
  if (big) { big.textContent = money0(p.net); big.classList.toggle('negative', p.net < 0); }
  if (sub) sub.innerHTML = String(today ? html`<strong>Today</strong>` : html`<strong>${label(p.date)}</strong> · <span class="${d >= 0 ? 'down' : 'up'}">${money0(Math.abs(d))} ${d >= 0 ? 'less' : 'more'} than now</span>`);
  // Which accounts moved since then, in the tip above the line
  const names = Object.fromEntries((S.lists ? S.lists.accounts : []).map(a => [a.id, a.name]));
  const mv = today ? [] : movers(p.by || {}, last.by || {}, names), tip = el('tip');
  if (!mv.length) { tip.hidden = true; return; }
  tip.textContent = 'Since then\n' + mv.map(([nm, x]) => nm + ' ' + (x >= 0 ? '+' : '−') + money0(Math.abs(x))).join('\n');
  tip.dataset.src = 'nw'; tip.hidden = false;
  // Above the tile, so it never covers the number you're reading (below it when the tile is at the top of the screen)
  const r = box.getBoundingClientRect(), c = card.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, at = r.left + r.width * fx;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, at - w / 2)) + 'px';
  tip.style.top = (c.top - h - 8 >= 8 ? c.top - h - 8 : c.bottom + 8) + 'px';
}
function settle(box: HTMLElement) {
  const card = box.closest<HTMLElement>('.nw'), p = SCRUB[cur]; if (!card) return;
  if (!p || cur === SCRUB.length - 1) return reset(card);
  const [y, m] = monthOf(new Date(p.date + 'T12:00:00')), sub = part(card, 'sub');
  if (sub) sub.insertAdjacentHTML('beforeend', String(html` <button type="button" class="link nw-open" data-onclick="App.nwOpen(${y},${m})">See ${monthRange(y, m).short} →</button>`));
  // Hold that month while a mouse heads for the link, rather than scrubbing on the way there
  held = true;
  resetT = setTimeout(() => reset(card), 8000);
}
// Back to today: the tile as it was drawn
function reset(card: HTMLElement) {
  cur = -1; held = false; clearTimeout(resetT); card.classList.remove('scrubbing');
  const tip = el('tip'); if (tip && tip.dataset.src === 'nw') { tip.hidden = true; tip.dataset.src = ''; }
  const o = ORIG.get(card); if (!o) return;
  FIELDS.forEach(f => { const n = part(card, f); if (n) n.innerHTML = o[f]; });
  const big = part(card, 'big'), last = SCRUB[SCRUB.length - 1];
  if (big && last) { big.textContent = money0(+(big.dataset.count || last.net)); big.classList.toggle('negative', +(big.dataset.count || last.net) < 0); }
}
const boxAt = (t: EventTarget | null) => t instanceof Element ? t.closest<HTMLElement>('.nw-scrub') : null;
function at(box: HTMLElement, e: PointerEvent) {
  const r = box.getBoundingClientRect(), n = SCRUB.length;
  show(box, scrubIndex((e.clientX - r.left) / r.width, SCRUB.map((_, i) => n > 1 ? i / (n - 1) : 0)));
}
document.addEventListener('pointerdown', e => {
  const box = boxAt(e.target); if (!box || S.dashEdit || SCRUB.length < 2) return;
  dragging = true; held = false; cur = -1; buzz(6); try { box.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  at(box, e);
});
document.addEventListener('pointermove', e => {
  const box = boxAt(e.target); if (!box || S.dashEdit || SCRUB.length < 2) return;
  if (dragging || (e.pointerType === 'mouse' && !held)) at(box, e);
});
document.addEventListener('pointerup', e => { const box = boxAt(e.target); if (!dragging || !box) return; dragging = false; settle(box); });
document.addEventListener('pointercancel', e => { const box = boxAt(e.target); dragging = false; if (box) reset(box.closest<HTMLElement>('.nw')!); });
document.addEventListener('pointerout', e => {
  const box = boxAt(e.target); if (!box || e.pointerType !== 'mouse' || dragging || box.contains(e.relatedTarget as Node)) return;
  held = false;
  const card = box.closest<HTMLElement>('.nw')!; if (!card.querySelector('.nw-open')) reset(card);
});
addEventListener('scroll', () => { const c = document.querySelector<HTMLElement>('.nw.scrubbing'); if (c && !dragging) reset(c); }, { passive: true });
// Open the month of a point on the Overview: the whole page as it was then
function nwOpen(y: number, m: number) { S.all = false; S.y = y; S.m = m; if (location.hash.replace(/^#\/?/, '') === '') App.reload(); else location.hash = '#/'; }
function nwRange(y: number) { LS.set('nwYears', y === 3 ? 3 : 1); route(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  netWorthHistory,
  nwRange,
  nwOpen,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

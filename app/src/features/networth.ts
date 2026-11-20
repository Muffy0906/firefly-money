import { html, htmlList } from '../core/html';
import { getAll, PAGES } from '../core/api';
import { App, el, fmtD, money0, monthOf, monthRange, S, todayIso } from '../core/base';
import { toast } from '../core/dom';
import { buzz } from '../core/haptics';
import { type Account, isAsset, isLiab, lists, normAccount } from '../core/lists';
import { LS, monthEnds } from '../core/helpers';
import { route } from '../core/router';
import { miniLine } from './charts';
import { t } from '../core/spanish';

/* ---------- Net worth over time ----------
   Firefly reports an account's balance on any past day (GET /accounts?date=…), so the history is one request per
   point and type: the last day of each month, plus today. */
const POINTS = 13;
export type NetWorthPoint = { date: string, assets: number, debts: number, net: number, by?: Record<string, number> };
// The ranges the tile can show, in months. Only those the history reaches are offered (plus the first one past it, so
// the longest button always covers everything): 6M and 1Y for a new setup, up to 30Y for a long one.
const RANGES: [number, string, string][] = [[6, '6M', 'six months'], [12, '1Y', 'the year'], [36, '3Y', 'three years'], [60, '5Y', 'five years'], [120, '10Y', 'ten years'], [180, '15Y', 'fifteen years'], [240, '20Y', 'twenty years'], [360, '30Y', 'thirty years']];
export function nwOptions(first = ''): number[] {
  const span = first ? (new Date().getFullYear() - +first.slice(0, 4)) * 12 + new Date().getMonth() + 1 - +first.slice(5, 7) : 1e9;
  const i = RANGES.findIndex(r => r[0] >= span);
  return RANGES.slice(0, i < 0 ? RANGES.length : Math.max(i + 1, 2)).map(r => r[0]);
}
const firstOpened = () => (S.lists ? S.lists.accounts : []).filter(a => a.active && a.netWorth && a.openingDate).map(a => a.openingDate.slice(0, 10)).sort()[0] || '';
// The range in use: the saved one (an old 1 or 3 means years), or the longest one offered if history is shorter
export const nwMonths = () => {
  const saved = LS.get('nwMonths', 0) || LS.get('nwYears', 1) * 12, opts = nwOptions(firstOpened());
  if (isCustom(saved)) return saved;
  return opts.includes(saved) ? saved : opts.filter(m => m <= saved).pop() || opts[0];
};
// A range typed in by hand (any whole number of months from 3 to 600) rather than one of the buttons
const isCustom = (m: number) => Number.isInteger(m) && m >= 3 && m <= 600 && !RANGES.some(r => r[0] === m);
export const customLabel = (m: number) => m % 12 === 0 ? m / 12 + 'Y' : m < 24 ? m + 'M' : +(m / 12).toFixed(1) + 'Y';
export const nwWords = () => { const m = nwMonths(), r = RANGES.find(x => x[0] === m); return r ? t(r[2]) : m % 12 === 0 || m >= 24 ? t('{count} years', { count: +(m / 12).toFixed(1) }) : t('{count} months', { count: m }); };
let editing = false;
async function netWorthHistory(): Promise<NetWorthPoint[]> {
  return netWorthOn(monthEnds(todayIso(), POINTS, nwMonths() / (POINTS - 1)));
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
// The range switch for the Overview's net worth tile
export const nwSeg = () => {
  const cur = nwMonths(), custom = isCustom(cur);
  if (editing) return html`<form class="nwcust" data-onsubmit="event.preventDefault();App.nwSet(this.yrs.value)"><input name="yrs" type="number" inputmode="decimal" min="0.25" max="50" step="any" value="${+(cur / 12).toFixed(2)}" aria-label="Years of history"> <span class="sub-s">years</span> <button class="btn small primary">Set</button> <button type="button" class="link" data-onclick="App.nwCustom(false)">Cancel</button></form>`;
  return html`<div class="seg mini">${htmlList(nwOptions(firstOpened()).map(m => html`<button type="button" class="${cur === m ? 'on' : ''}" data-onclick="App.nwRange(${m})">${RANGES.find(r => r[0] === m)![1]}</button>`))}<button type="button" class="${custom ? 'on' : ''}" data-onclick="App.nwCustom(true)" aria-label="Custom range" title="Custom range">${custom ? customLabel(cur) : '…'}</button></div>`;
};

/* ---------- Time scrubber: drag along the tile's line and it goes back to that month ----------
   The big number and the line under it show that point, and a tip names the accounts that moved most since.
   Let go on a past point and it offers that month's Overview. Each point you pass ticks (where the phone lets a
   drag tick: Android does, iPhone only on the first touch). */
let SCRUB: NetWorthPoint[] = [];
const label = (d: string) => fmtD(d, { month: 'short', year: 'numeric' });
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
  if (sub) sub.innerHTML = String(today ? html`<strong>Today</strong>` : html`<strong>${label(p.date)}</strong> · <span class="${d >= 0 ? 'down' : 'up'}">${t('{amount} {direction} than now', { amount: money0(Math.abs(d)), direction: t(d >= 0 ? 'less' : 'more') })}</span>`);
  // Which accounts moved since then, in the tip above the line
  const names = Object.fromEntries((S.lists ? S.lists.accounts : []).map(a => [a.id, a.name]));
  const mv = today ? [] : movers(p.by || {}, last.by || {}, names), tip = el('tip');
  if (!mv.length) { tip.hidden = true; return; }
  tip.textContent = t('Since then') + '\n' + mv.map(([nm, x]) => nm + ' ' + (x >= 0 ? '+' : '−') + money0(Math.abs(x))).join('\n');
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
  if (sub) sub.insertAdjacentHTML('beforeend', String(html` <button type="button" class="link nw-open" data-onclick="App.nwOpen(${y},${m})">${t('See {month} →', { month: monthRange(y, m).short })}</button>`));
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
function nwRange(m: number) {
  LS.set('nwMonths', RANGES.some(r => r[0] === m) || isCustom(m) ? m : 12);
  editing = false;
  PAGES.clear(); S.pageHtml = '';
  // Redraw only the Net worth tile; the whole page only if the tile isn't there (e.g. another page)
  if (!S.dashEdit && App.nwRedraw) App.nwRedraw().then(ok => { if (!ok) route(); }); else route();
}
// Free-form range: years typed in (0.25 to 50), kept as whole months
function nwSet(years: string) {
  const y = parseFloat(years), m = Math.round(y * 12);
  if (!Number.isFinite(y) || m < 3 || m > 600) { toast('Enter 3 months to 50 years'); return; }
  nwRange(m);
}
function nwCustom(on: boolean) {
  editing = on;
  if (!S.dashEdit && App.nwRedraw) App.nwRedraw().then(ok => { if (!ok) route(); }); else route();
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  netWorthHistory,
  nwRange,
  nwSet,
  nwCustom,
  nwOpen,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

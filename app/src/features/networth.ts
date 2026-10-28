import { html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, S, monthOf, monthRange, money0, todayIso } from '../core/base';
import { buzz } from '../core/haptics';
import { type Account, isAsset, isLiab, lists, normAccount } from '../core/lists';
import { LS, monthEnds } from '../core/helpers';
import { route } from '../core/router';
import { smoothPath } from './charts';

/* ---------- Net worth over time ----------
   Firefly reports an account's balance on any past day (GET /accounts?date=…), so the history is one request per
   point and type: the last day of each month, plus today. */
const POINTS = 13;
export type NetWorthPoint = { date: string, assets: number, debts: number, net: number, by?: Record<string, number> };
export const nwYears = () => LS.get('nwYears', 1) === 3 ? 3 : 1;
async function netWorthHistory(): Promise<NetWorthPoint[]> {
  const L = await lists(), years = nwYears();
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
  const days = monthEnds(todayIso(), POINTS, years * 12 / (POINTS - 1));
  const past = await Promise.all(days.slice(0, -1).map(date => Promise.all([getAll('/accounts', { type: 'asset', date }), getAll('/accounts', { type: 'liabilities', date })])
    .then(([as, ls]) => ({ date, ...total([...as, ...ls].map(normAccount)) }))));
  return [...past, { date: days[days.length - 1], ...total(own) }];
}
const label = (d: string, withYear?: boolean) => new Date(d + 'T12:00:00').toLocaleString('en-US', withYear ? { month: 'short', year: '2-digit' } : { month: 'short' });
function netWorthPanel(pts: NetWorthPoint[]) {
  const years = nwYears(), seg = html`<div class="seg mini">${htmlList([1, 3].map(y => html`<button type="button" class="${years === y ? 'on' : ''}" data-onclick="App.nwRange(${y})">${y === 1 ? '1 year' : '3 years'}</button>`))}</div>`;
  if (!pts || pts.length < 2) return html`<section class="panel chart"><div class="panel-head"><h2>Net worth</h2>${seg}</div><p class="empty">Couldn’t load your balance history.</p></section>`;
  const W = 380, H = 150, pt = 12, pb = 22, n = pts.length, vals = pts.map(p => p.net);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; }
  const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
  const x = (i: number) => 6 + (W - 12) * i / (n - 1), y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const line = smoothPath(pts.map((p, i) => [x(i), y(p.net)]));
  const area = line + ' L' + x(n - 1).toFixed(1) + ' ' + (H - pb) + ' L' + x(0).toFixed(1) + ' ' + (H - pb) + ' Z';
  const first = pts[0], last = pts[n - 1], d = last.net - first.net, pct = first.net ? d / Math.abs(first.net) * 100 : 0, good = d >= 0;
  const color = good ? 'var(--good)' : 'var(--spend)';
  const dots = htmlList(pts.map((p, i) => html`<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.net).toFixed(1)}" r="${i === n - 1 ? 4.5 : 3}" fill="${i === n - 1 ? color : 'var(--panel)'}" stroke="${color}" stroke-width="1.6"/>`));
  // What the scrubber needs for each point (see scrub below): x, y, date and the numbers, and each account's then
  SCRUB = pts.map((p, i) => ({ x: x(i), y: y(p.net), ...p }));
  const scrubber = html`<line class="nw-guide" x1="0" x2="0" y1="${pt - 6}" y2="${H - pb}"/><circle class="nw-knob" r="6" cx="0" cy="0" fill="${color}"/>`;
  const ticks = htmlList([0, Math.floor((n - 1) / 2), n - 1].map(i => html`<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${i === n - 1 ? 'Today' : label(pts[i].date, true)}</text>`));
  const zero = lo < 0 && hi > 0 ? html`<line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--line)" stroke-dasharray="4 4"/>` : '';
  return html`<section class="panel chart nw"><div class="panel-head"><h2>Net worth</h2>${seg}</div><p class="lead">What you own minus what you owe, at the end of each ${years === 1 ? 'month' : 'quarter'}. Drag along the line to go back in time.</p><div class="total num${last.net < 0 ? ' negative' : ''}" data-nw="total" style="margin-bottom:2px">${money0(last.net)}</div><div class="sub-s" data-nw="sub" style="margin-bottom:12px"><span class="${good ? 'down' : 'up'}">${good ? '▲' : '▼'} ${money0(Math.abs(d))}${first.net ? ' (' + (pct > 0 ? '+' : '') + pct.toFixed(0) + '%)' : ''}</span> since ${label(first.date, true)}</div><svg class="nw-scrub" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth over time"><defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${zero}<path class="area" d="${area}" fill="url(#nwg)"/><path class="draw" pathLength="1" d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${dots}${ticks}${scrubber}</svg><div style="display:flex;gap:32px;margin-top:14px"><div><div class="eyebrow">Assets</div><div class="num" data-nw="assets" style="font-size:18px">${money0(last.assets)}</div></div><div><div class="eyebrow">Debts</div><div class="num" data-nw="debts" style="font-size:18px">${money0(last.debts)}</div></div></div><div class="nw-then" data-nw="then" aria-live="polite"></div></section>`;
}

/* ---------- Time scrubber: drag along the line and the card goes back to that day ----------
   The big number, the change and assets and debts all show that point; under them, the accounts that moved most
   since then. Let go on a past point and it offers that month's Overview. Each point you pass ticks (where the phone
   lets a drag tick: Android does, iPhone only on the first touch). */
let SCRUB: (NetWorthPoint & { x: number, y: number })[] = [];
export const scrubIndex = (fx: number, xs: number[]) => xs.reduce((best, v, i) => Math.abs(v - fx) < Math.abs(xs[best] - fx) ? i : best, 0);
// The accounts whose balance changed most between a point and today: [name, change]
export function movers(then: Record<string, number>, now: Record<string, number>, names: Record<string, string>, n = 3) {
  return Object.keys({ ...then, ...now }).map(id => [names[id] || '?', (now[id] || 0) - (then[id] || 0)] as [string, number])
    .filter(([, d]) => Math.abs(d) >= 1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n);
}
let cur = -1, dragging = false, resetT: ReturnType<typeof setTimeout> | undefined;
const FIELDS = ['total', 'sub', 'assets', 'debts', 'then'], ORIG = new WeakMap<HTMLElement, Record<string, string>>();
function show(svg: SVGSVGElement, i: number) {
  const card = svg.closest<HTMLElement>('.nw')!, pts = SCRUB, last = pts[pts.length - 1], p = pts[i]; if (!p || !last) return;
  if (i !== cur && cur !== -1) buzz(4);
  cur = i; clearTimeout(resetT);
  const q = (k: string) => card.querySelector<HTMLElement>('[data-nw="' + k + '"]')!;
  if (!ORIG.has(card)) ORIG.set(card, Object.fromEntries(FIELDS.map(f => [f, q(f).innerHTML])));
  card.classList.add('scrubbing');
  const g = svg.querySelector('.nw-guide')!, k = svg.querySelector('.nw-knob')!;
  g.setAttribute('x1', p.x.toFixed(1)); g.setAttribute('x2', p.x.toFixed(1)); k.setAttribute('cx', p.x.toFixed(1)); k.setAttribute('cy', p.y.toFixed(1));
  q('total').textContent = money0(p.net); q('total').classList.toggle('negative', p.net < 0);
  q('assets').textContent = money0(p.assets); q('debts').textContent = money0(p.debts);
  const today = i === pts.length - 1, d = last.net - p.net;
  q('sub').innerHTML = String(today ? html`<strong>Today</strong>` : html`<strong>${label(p.date, true)}</strong> · <span class="${d >= 0 ? 'down' : 'up'}">${money0(Math.abs(d))} ${d >= 0 ? 'less' : 'more'} than today</span>`);
  const names = Object.fromEntries((S.lists ? S.lists.accounts : []).map(a => [a.id, a.name]));
  const mv = today ? [] : movers(p.by || {}, last.by || {}, names);
  q('then').innerHTML = String(today ? '' : html`${mv.length ? html`<div class="eyebrow">Since then</div><div class="nw-moves">${htmlList(mv.map(([nm, x]) => html`<span><span class="nm">${nm}</span> <span class="num ${x >= 0 ? 'pos' : 'neg'}">${x >= 0 ? '+' : '−'}${money0(Math.abs(x))}</span></span>`))}</div>` : ''}`);
}
function settle(svg: SVGSVGElement) {
  const card = svg.closest<HTMLElement>('.nw'), p = SCRUB[cur]; if (!card) return;
  if (!p || cur === SCRUB.length - 1) return reset(card);
  const [y, m] = monthOf(new Date(p.date + 'T12:00:00'));
  const then = card.querySelector<HTMLElement>('[data-nw="then"]')!;
  then.insertAdjacentHTML('beforeend', String(html`<button type="button" class="btn small nw-open" data-onclick="App.nwOpen(${y},${m})">See ${monthRange(y, m).label} on the Overview</button>`));
  resetT = setTimeout(() => reset(card), 8000);
}
// Back to today: the card as it was drawn
function reset(card: HTMLElement) {
  cur = -1; clearTimeout(resetT); card.classList.remove('scrubbing');
  const o = ORIG.get(card); if (!o) return;
  FIELDS.forEach(f => { const n = card.querySelector<HTMLElement>('[data-nw="' + f + '"]'); if (n) n.innerHTML = o[f]; });
  const t = card.querySelector('[data-nw="total"]'), last = SCRUB[SCRUB.length - 1];
  if (t && last) t.classList.toggle('negative', last.net < 0);
}
const svgAt = (t: EventTarget | null) => t instanceof Element ? t.closest<SVGSVGElement>('svg.nw-scrub') : null;
function at(svg: SVGSVGElement, e: PointerEvent) {
  const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, fx = (e.clientX - r.left) / r.width * vb.width;
  show(svg, scrubIndex(fx, SCRUB.map(p => p.x)));
}
document.addEventListener('pointerdown', e => {
  const svg = svgAt(e.target); if (!svg || S.dashEdit || !SCRUB.length) return;
  dragging = true; cur = -1; buzz(6); try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  at(svg, e);
});
document.addEventListener('pointermove', e => {
  const svg = svgAt(e.target); if (!svg || !SCRUB.length) return;
  if (dragging || e.pointerType === 'mouse') at(svg, e);
});
const end = (e: PointerEvent) => { const svg = svgAt(e.target); if (!dragging || !svg) return; dragging = false; settle(svg); };
document.addEventListener('pointerup', end);
document.addEventListener('pointercancel', e => { const svg = svgAt(e.target); dragging = false; if (svg) reset(svg.closest<HTMLElement>('.nw')!); });
document.addEventListener('pointerout', e => {
  const svg = svgAt(e.target); if (!svg || e.pointerType !== 'mouse' || dragging || svg.contains(e.relatedTarget as Node)) return;
  const card = svg.closest<HTMLElement>('.nw')!; if (!card.querySelector('.nw-open')) reset(card);
});
// Open the month of a point on the Overview: the whole page as it was then
function nwOpen(y: number, m: number) { S.all = false; S.y = y; S.m = m; if (location.hash.replace(/^#\/?/, '') === '') App.reload(); else location.hash = '#/'; }
function nwRange(y: number) { LS.set('nwYears', y === 3 ? 3 : 1); route(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  netWorthHistory,
  netWorthPanel,
  nwRange,
  nwOpen,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

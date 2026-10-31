/* Morph: when a page is drawn again with new data in the same layout, what changed moves from the old value to the
   new one, instead of the page being swapped wholesale.
   - Amounts roll like an odometer, digit by digit (only in tabular figures, so nothing changes width as it rolls).
   - Charts morph: each path, bar, line, ring and label tweens its geometry from the old drawing to the new one (a
     chart whose shape changed, e.g. 30 days to 31, fades in instead).
   - Bars (.fill: budgets, goals, shares) grow or shrink from the width they had.
   - Rows (transactions, by id) glide from where they were to where they are now; new rows fade in.
   Used for redraws of the page you're on (after an edit, a refresh) and for a month change on pages whose layout
   doesn't depend on the month (Overview, Budgets, Reports…), which redraw in place instead of sliding.
   Text that moves (odometer strips, rows) is placed in whole device pixels by JS, never by a CSS transition or
   between pixels: Chrome on Windows draws text that is mid-transition blurred until it settles. */

const RM = !!window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const morphOk = () => !RM;
const NUM = '.num, [data-count]';
const GEO = 'path, rect, polyline, polygon, circle, line, text';
const ATTRS = ['d', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'stroke-dasharray', 'stroke-dashoffset'];
const ease = (p: number) => 1 - Math.pow(1 - p, 3);                     // ease-out cubic
const glide = (p: number) => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // in-out, for shapes
const px = (v: number) => { const d = devicePixelRatio || 1; return Math.round(v * d) / d; };

/* ---------- One frame loop for everything that's moving ---------- */
type Task = (t: number) => boolean;           // false once it's done
const tasks = new Set<Task>();
let frame = 0;
function run(t: number) {
  frame = 0;
  tasks.forEach(k => { if (!k(t)) tasks.delete(k); });
  if (tasks.size) frame = requestAnimationFrame(run);
}
function add(k: Task) { tasks.add(k); if (!frame) frame = requestAnimationFrame(run); }
// Each element runs at most one of each kind at a time: a newer one takes over from where the old one is
const owner = new WeakMap<Element, Map<string, Task>>();
function own(e: Element, kind: string, k: Task) {
  let m = owner.get(e); if (!m) owner.set(e, m = new Map());
  const old = m.get(kind); if (old) tasks.delete(old);
  m.set(kind, k); add(k);
}

/* ---------- Which element is which, across two drawings ---------- */
// The nearest ancestor with an identity (a tile, a transaction, a day, an id), then the child positions below it
// (root is the page, or the fragment holding its next drawing)
function keyOf(e: Element, root: Node) {
  const parts: string[] = [];
  for (let n: Element = e; n !== root;) {
    const d = (n as HTMLElement).dataset || {};
    if (d.w) { parts.push('w:' + d.w); break; }
    if (d.gid) { parts.push('g:' + d.gid); break; }
    if (n.id) { parts.push('#' + n.id); break; }
    const p = n.parentNode as (ParentNode & Node) | null;
    parts.push(n.tagName + ':' + (p ? Array.prototype.indexOf.call(p.children, n) : 0));
    if (!p || p === root || p.nodeType !== 1) break;
    n = p as Element;
  }
  return parts.reverse().join('/');
}
const near = (r: DOMRect, m = 120) => r.bottom > -m && r.top < innerHeight + m && r.width > 0;
const textOf = (e: HTMLElement) => e.dataset.odo ?? e.textContent ?? '';

type SvgSnap = { n: number, kids: [string, Record<string, string>][] };
export type Snap = {
  nums: Map<string, string>, fills: Map<string, number>, svgs: Map<string, SvgSnap>,
  rows: Map<string, number>, layout: Set<string>, feed: boolean
};
// The parts of a page that frame the layout: if most of them are the same in both drawings, it can redraw in place
const LAYOUT = '[data-w], .kpi, section.panel, .hero';
function layoutKeys(root: Element | DocumentFragment) {
  const s = new Set<string>();
  root.querySelectorAll(LAYOUT).forEach(n => { if (!n.parentElement?.closest(LAYOUT)) s.add(keyOf(n, root)); });
  return s;
}

export function snapshot(root: HTMLElement): Snap {
  const s: Snap = { nums: new Map(), fills: new Map(), svgs: new Map(), rows: new Map(), layout: layoutKeys(root), feed: !!root.querySelector('.tbl.feed tr[data-gid]') };
  if (RM) return s;
  let c = 0;
  root.querySelectorAll<HTMLElement>(NUM).forEach(e => { if (c < 80 && (!e.children.length || e.dataset.odo) && near(e.getBoundingClientRect())) { s.nums.set(keyOf(e, root), textOf(e)); c++; } });
  root.querySelectorAll<HTMLElement>('.fill').forEach(e => { const w = parseFloat(e.style.width); if (isFinite(w) && near(e.getBoundingClientRect())) s.fills.set(keyOf(e, root), w); });
  c = 0;
  root.querySelectorAll<SVGSVGElement>('svg').forEach(v => {
    if (c >= 24 || !near(v.getBoundingClientRect())) return;
    const kids = [...v.querySelectorAll(GEO)];
    if (!kids.length || kids.length > 600) return;
    c++;
    s.svgs.set(keyOf(v, root), { n: kids.length, kids: kids.map(k => [k.tagName, Object.fromEntries(ATTRS.filter(a => k.hasAttribute(a)).map(a => [a, k.getAttribute(a)!]))]) });
  });
  s.rows = rowTops(root);
  return s;
}
// Where each transaction row and day heading is on screen now
const ROWS = 'tr[data-gid], tr.dayhead[data-day]';
const rowKey = (r: HTMLElement) => r.dataset.gid ? 'g' + r.dataset.gid : 'd' + r.dataset.day;
export function rowTops(root: HTMLElement) {
  const m = new Map<string, number>();
  if (!RM) root.querySelectorAll<HTMLElement>(ROWS).forEach(r => { const b = r.getBoundingClientRect(); if (near(b, 300)) m.set(rowKey(r), b.top); });
  return m;
}

// Can a month change redraw this page in place? Same page, mostly the same tiles and cards, and not a list of
// transactions (a different month's list is a different list: that one slides)
export function sameLayout(old: Snap, next: DocumentFragment) {
  if (RM || old.feed || next.querySelector('.tbl.feed tr[data-gid]')) return false;
  const k = layoutKeys(next); if (!k.size || !old.layout.size) return false;
  let both = 0; k.forEach(x => { if (old.layout.has(x)) both++; });
  return both / Math.max(k.size, old.layout.size) >= .7;
}

/* ---------- Odometer ---------- */
const DIG = /\d/;
function roll(e: HTMLElement, from: string, to: string) {
  if (from === to || !DIG.test(to) || !DIG.test(from) || e.children.length) return;
  const cs = getComputedStyle(e);
  if (!/tabular/.test(cs.fontVariantNumeric) || cs.display === 'none') return;
  const val = (s: string) => parseFloat(s.replace(/[^\d.-]/g, '')) || 0;
  const up = val(to) * (/^[^\d]*-|−|\(/.test(to) ? -1 : 1) >= val(from) * (/^[^\d]*-|−|\(/.test(from) ? -1 : 1);
  // One line's height, as the text itself lays it out
  const w0 = e.getBoundingClientRect().width;
  const probe = document.createElement('span'); probe.style.display = 'inline-block'; probe.textContent = '0';
  e.textContent = ''; e.appendChild(probe);
  const H = probe.getBoundingClientRect().height; probe.remove();
  if (!H) { e.textContent = to; return; }
  e.dataset.odo = to;
  const cols: { strip: HTMLElement, n: number }[] = [];
  const f = [...from], t = [...to], off = f.length - t.length;
  t.forEach((ch, i) => {
    if (!DIG.test(ch)) { e.append(ch); return; }
    const o = f[i + off], a = o && DIG.test(o) ? +o : 0, b = +ch;
    if (a === b) { e.append(ch); return; }
    const seq: number[] = []; for (let d = a; ; d = (d + (up ? 1 : 9)) % 10) { seq.push(d); if (d === b) break; }
    if (!up) seq.reverse();
    const col = document.createElement('span'); col.className = 'odo'; col.style.height = H + 'px';
    const strip = document.createElement('span'); strip.className = 'odo-s'; strip.style.lineHeight = H + 'px';
    strip.textContent = seq.join('\n');
    col.appendChild(strip); e.appendChild(col);
    cols.push({ strip, n: seq.length - 1 });
  });
  // Split into columns, a digit loses its kerning with what's next to it (a % sign): if that moves anything, don't roll
  if (Math.abs(e.getBoundingClientRect().width - w0) > .3) { e.textContent = to; delete e.dataset.odo; return; }
  const set = (p: number) => cols.forEach(c => { const y = (up ? p : 1 - p) * c.n * H; c.strip.style.transform = 'translateY(' + -px(y) + 'px)'; });
  set(0);
  const t0 = performance.now(), dur = 700;
  own(e, 'roll', now => {
    const p = e.isConnected ? Math.min(1, Math.max(0, now - t0) / dur) : 1;      // (a page put away mid-roll comes back finished)
    if (p >= 1) { e.textContent = to; delete e.dataset.odo; return false; }
    set(ease(p)); return true;
  });
}

/* ---------- Chart geometry ---------- */
const NUMS = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
function tweenAttr(a: string, b: string): ((p: number) => string) | null {
  if (a === b) return null;
  const na = a.match(NUMS), nb = b.match(NUMS);
  if (!na || !nb || na.length !== nb.length) return null;
  const parts = b.split(NUMS);
  if (a.split(NUMS).join('|') !== parts.join('|')) return null;     // different commands (an L where an M was)
  const x = na.map(Number), y = nb.map(Number);
  return p => parts.reduce((s, part, i) => s + part + (i < y.length ? +(x[i] + (y[i] - x[i]) * p).toFixed(2) : ''), '');
}
function morphSvg(v: SVGSVGElement, old: SvgSnap) {
  const kids = [...v.querySelectorAll(GEO)];
  const same = kids.length === old.n && kids.every((k, i) => k.tagName === old.kids[i][0]);
  if (!same) { v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease' }); return; }
  const tw: [Element, string, (p: number) => string][] = [];
  kids.forEach((k, i) => {
    const was = old.kids[i][1];
    ATTRS.forEach(a => { const now = k.getAttribute(a); if (now == null || was[a] == null) return; const f = tweenAttr(was[a], now); if (f) tw.push([k, a, f]); });
  });
  if (!tw.length) return;
  tw.forEach(([k, a, f]) => k.setAttribute(a, f(0)));
  const t0 = performance.now(), dur = 560;
  own(v, 'svg', now => {
    const p = v.isConnected ? Math.min(1, Math.max(0, now - t0) / dur) : 1, e = glide(p);
    tw.forEach(([k, a, f]) => k.setAttribute(a, f(e)));
    return p < 1;
  });
}

/* ---------- Rows ---------- */
// Rows move from where they were (tops from snapshot) to where they are now, in whole pixels; new ones fade in
export function glideRows(root: HTMLElement, old: Map<string, number>) {
  if (RM || !old.size) return;
  const moves: [HTMLElement, number][] = [];
  root.querySelectorAll<HTMLElement>(ROWS).forEach(r => {
    const b = r.getBoundingClientRect(); if (!near(b, 300)) return;
    const was = old.get(rowKey(r));
    if (was == null) { if (r.dataset.gid) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 120, easing: 'ease', fill: 'backwards' }); return; }
    const dy = was - b.top; if (Math.abs(dy) >= 1 && Math.abs(dy) < innerHeight * 1.5) moves.push([r, dy]);
  });
  if (!moves.length) return;
  moves.forEach(([r, dy]) => { r.style.translate = '0 ' + px(dy) + 'px'; });
  const t0 = performance.now(), dur = 360;
  moves.forEach(([r, dy]) => own(r, 'row', now => {
    const p = Math.min(1, Math.max(0, now - t0) / dur);
    if (p >= 1 || !r.isConnected) { r.style.removeProperty('translate'); return false; }
    r.style.translate = '0 ' + px(dy * (1 - ease(p))) + 'px'; return true;
  }));
}

// After a redraw (root already holds the new drawing and is scrolled where it will be)
export function morph(root: HTMLElement, s: Snap) {
  if (RM) return;
  glideRows(root, s.rows);
  let c = 0;
  if (s.nums.size) root.querySelectorAll<HTMLElement>(NUM).forEach(e => {
    if (c >= 60 || e.children.length) return;
    const was = s.nums.get(keyOf(e, root)), now = e.textContent || '';
    if (was == null || was === now || !near(e.getBoundingClientRect())) return;
    c++; roll(e, was, now);
  });
  if (s.fills.size) root.querySelectorAll<HTMLElement>('.fill').forEach(e => {
    const was = s.fills.get(keyOf(e, root)), now = parseFloat(e.style.width);
    if (was == null || !isFinite(now) || now <= 0 || Math.abs(was - now) < .2) return;
    e.animate([{ transform: 'scaleX(' + (was / now).toFixed(4) + ')', transformOrigin: 'left' }, { transform: 'none', transformOrigin: 'left' }], { duration: 620, easing: 'cubic-bezier(.32,.72,0,1)' });
  });
  if (s.svgs.size) root.querySelectorAll<SVGSVGElement>('svg').forEach(v => { const was = s.svgs.get(keyOf(v, root)); if (was && near(v.getBoundingClientRect())) morphSvg(v, was); });
}

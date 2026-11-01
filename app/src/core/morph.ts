/* Morph: when a page is drawn again with new data in the same layout, what changed moves from the old value to the
   new one, instead of the page being swapped wholesale.
   - Amounts roll like an odometer, digit by digit (only in tabular figures, so nothing changes width as it rolls).
   - Charts morph: each path, bar, line, ring and label tweens its geometry from the old drawing to the new one (a
     chart whose shape changed, e.g. 30 days to 31, fades in instead).
   - Bars (.fill: budgets, goals, shares) grow or shrink from the width they had.
   - Rows (transactions, by id) glide from where they were to where they are now; new rows fade in.
   Used for redraws of the page you're on (after an edit, a refresh) and for a month change on pages whose layout
   doesn't depend on the month (Overview, Budgets, Reports…), which redraw in place instead of sliding.
   A month change spreads out from the arrow you pressed: cards nearest it change first (see The wave below).
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
    if (d.day && n.tagName === 'TR') { parts.push('d:' + d.day); break; }     // a day's heading in a list
    if (n.id) { parts.push('#' + n.id); break; }
    // a card is known by its heading, so a card added above it (a longer report has one more chart) doesn't make it
    // look like a different card
    if (n.tagName === 'SECTION') { const h = n.querySelector(':scope > h2, :scope > .panel-head h2'); if (h && h.textContent) { parts.push('h:' + h.textContent.trim()); break; } }
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
  nums: Map<string, string>, fills: Map<string, number>, svgs: Map<string, SvgSnap>, tints: Map<string, string>,
  texts: Map<string, string>, cards: Set<string>, shapes: Map<string, number>, rows: Map<string, number>, layout: Set<string>, feed: boolean
};
// A part that changes itself into place when its own data comes (the Transactions month strip: transactions.ts
// fillStrip) is left alone here, or it would change twice
const SELF = '[data-selfmorph]';
const ours = (e: Element, root: Node) => { const o = e.closest(SELF); return !o || o === root; };
// Words that can differ from month to month (a page's subtitle, a card's heading or lead line): when they do, the
// new words fade in as the wave reaches them; when they don't, they stay exactly as they were
const TEXT = '.head h1, .head .sub, h2, .lead, .center-empty, .empty';
// The words in a card (labels, legends, axis labels, captions): everything that isn't an amount (those roll) or a
// day's square in the heatmap (those change colour). A line of text with a few words styled inside it ("$593 ·
// <span>$144 more</span>") counts as one, by its markup.
const INLINE = /^(SPAN|B|STRONG|SMALL|I|EM|A|ABBR|SUB|SUP|BR|MARK)$/;
const isLine = (e: Element) => e.children.length > 0 && [...e.childNodes].some(n => n.nodeType === 3 && (n.textContent || '').trim()) &&
  [...e.querySelectorAll('*')].every(k => INLINE.test(k.tagName) && !k.matches(NUM));
// (an icon, which says something too: an arrow up or down, a tick, goes with its words)
const ICON = 'svg[viewBox="0 0 24 24"]';
const leaves = (card: Element, root: Node) => [...card.querySelectorAll('*')].filter(e => ours(e, root) && (e.matches(ICON) || ((e.textContent || '').trim() &&
  (!e.children.length ? !e.matches(NUM) : isLine(e)))) && !e.parentElement?.closest(ICON) && !e.parentElement?.closest('[data-odo], .hm-cell, .mghost') && !e.matches('.hm-cell, .mghost, [data-odo]') &&
  !(e.parentElement && isLine(e.parentElement)));
// A card's build (its elements, in order): another month's words can only stand in for this one's when they sit in
// the same places. A calendar (the month starts on another day, has 30 days, not 31) or a list with more rows is
// built differently, and its new words just fade in.
function shape(card: Element) {
  let h = 0;
  for (const e of card.querySelectorAll('*')) {
    // (words styled inside a line, and a chart's parts, don't count: those change in place)
    if (INLINE.test(e.tagName) || e.closest('svg')) continue;
    const t = e.tagName; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; h = (h * 31 + 59) | 0;
  }
  return h;
}
// What a piece of text says: its words, or its markup when words inside it are styled
const said = (e: Element) => e.children.length || e.matches(ICON) ? 'H:' + e.innerHTML : e.textContent || '';
const say = (e: Element, v: string) => { if (v.startsWith('H:')) e.innerHTML = v.slice(2); else e.textContent = v; };
const topCards = (root: Element | DocumentFragment) => [...root.querySelectorAll(CARD)].filter(c => !c.parentElement?.closest(CARD));
// The parts of a page that frame the layout: if most of them are the same in both drawings, it can redraw in place
const LAYOUT = '[data-w], .kpi, section.panel, .hero';
function layoutKeys(root: Element | DocumentFragment) {
  const s = new Set<string>();
  root.querySelectorAll(LAYOUT).forEach(n => { if (!n.parentElement?.closest(LAYOUT)) s.add(keyOf(n, root)); });
  return s;
}

export function snapshot(root: HTMLElement): Snap {
  const s: Snap = { nums: new Map(), fills: new Map(), svgs: new Map(), tints: new Map(), texts: new Map(), cards: new Set(), shapes: new Map(), rows: new Map(), layout: layoutKeys(root), feed: !!root.querySelector('.tbl.feed tr[data-gid]') };
  if (RM) return s;
  let c = 0;
  root.querySelectorAll<HTMLElement>(NUM).forEach(e => { if (c < 80 && (!e.children.length || e.dataset.odo) && ours(e, root) && near(e.getBoundingClientRect())) { s.nums.set(keyOf(e, root), textOf(e)); c++; } });
  root.querySelectorAll<HTMLElement>('.fill').forEach(e => { const w = parseFloat(e.style.width); if (isFinite(w) && ours(e, root) && near(e.getBoundingClientRect())) s.fills.set(keyOf(e, root), w); });
  root.querySelectorAll<HTMLElement>(TEXT).forEach(e => { if (ours(e, root)) s.texts.set(keyOf(e, root), e.textContent || ''); });
  topCards(root).forEach(e => s.cards.add(keyOf(e, root)));
  c = 0;
  topCards(root).forEach(card => {
    if (!near(card.getBoundingClientRect())) return;
    s.shapes.set(keyOf(card, root), shape(card));
    leaves(card, root).forEach(e => { if (c++ < 1500) s.texts.set(keyOf(e, root), said(e)); });
  });
  c = 0;
  root.querySelectorAll<SVGSVGElement>('svg').forEach(v => {
    if (c >= 24 || !ours(v, root) || v.matches(ICON) || !near(v.getBoundingClientRect())) return;
    const kids = [...v.querySelectorAll(GEO)];
    if (!kids.length || kids.length > 600) return;
    c++;
    s.svgs.set(keyOf(v, root), { n: kids.length, kids: kids.map(k => [k.tagName, Object.fromEntries(ATTRS.filter(a => k.hasAttribute(a)).map(a => [a, k.getAttribute(a)!]))]) });
  });
  c = 0;
  root.querySelectorAll<HTMLElement>(TINT).forEach(e => { if (c < 200 && near(e.getBoundingClientRect())) { s.tints.set(keyOf(e, root), getComputedStyle(e).backgroundColor); c++; } });
  s.rows = rowTops(root);
  return s;
}
// Cells whose colour is the number (the Daily spending heatmap): they fade from the old shade to the new one
const TINT = '.hm-cell:not(.pad)';
// Where each transaction row and day heading is on screen now
const ROWS = 'tr[data-gid], tr.dayhead[data-day]';
const rowKey = (r: HTMLElement) => r.dataset.gid ? 'g' + r.dataset.gid : 'd' + r.dataset.day;
export function rowTops(root: HTMLElement) {
  const m = new Map<string, number>();
  if (!RM) root.querySelectorAll<HTMLElement>(ROWS).forEach(r => { const b = r.getBoundingClientRect(); if (near(b, 300)) m.set(rowKey(r), b.top); });
  return m;
}

// Can this redraw happen in place? Another month always does (nothing slides on a month change but the month's
// name: what doesn't depend on the month stays put, and the rest changes into the new month as the wave passes).
// The same page with other options does when it has mostly the same tiles and cards, and isn't a list of
// transactions (a different list: that one comes in fresh)
export function sameLayout(old: Snap, next: DocumentFragment, dir = '') {
  if (RM) return false;
  if (dir === 'next' || dir === 'prev') return true;
  if (old.feed || next.querySelector('.tbl.feed tr[data-gid]')) return false;
  const k = layoutKeys(next); if (!k.size || !old.layout.size) return false;
  let both = 0; k.forEach(x => { if (old.layout.has(x)) both++; });
  return both / Math.max(k.size, old.layout.size) >= .7;
}

/* ---------- Odometer ---------- */
const DIG = /\d/;
function roll(e: HTMLElement, from: string, to: string, delay = 0, dur = 700): boolean {
  if (from === to || !DIG.test(to) || !DIG.test(from) || e.children.length) return false;
  // Only between figures of the same shape ($1,334 → $1,076): from $1,000 to $778 the first frame would read $000
  if (from.replace(/\d/g, '0') !== to.replace(/\d/g, '0')) return false;
  const cs = getComputedStyle(e);
  if (!/tabular/.test(cs.fontVariantNumeric) || cs.display === 'none') return false;
  const val = (s: string) => parseFloat(s.replace(/[^\d.-]/g, '')) || 0;
  const up = val(to) * (/^[^\d]*-|−|\(/.test(to) ? -1 : 1) >= val(from) * (/^[^\d]*-|−|\(/.test(from) ? -1 : 1);
  // One line's height, as the text itself lays it out
  const w0 = e.getBoundingClientRect().width;
  const probe = document.createElement('span'); probe.style.display = 'inline-block'; probe.textContent = '0';
  e.textContent = ''; e.appendChild(probe);
  const H = probe.getBoundingClientRect().height; probe.remove();
  if (!H) { e.textContent = to; return false; }
  e.dataset.odo = to;
  // The window is a line tall plus a thin margin above and below (see .odo), and digits are a window apart, so at
  // rest only the one digit shows. While it spins, the window's top and bottom fade out (deeper the faster it
  // goes, like a speedometer drum), so digits come and go through a soft edge instead of a hard cut.
  const P = Math.max(2, Math.round(H * .14)), S = H + 2 * P, F = H * .3;
  const cols: { col: HTMLElement, strip: HTMLElement, n: number }[] = [];
  const f = [...from], t = [...to], off = f.length - t.length;
  t.forEach((ch, i) => {
    if (!DIG.test(ch)) { e.append(ch); return; }
    const o = f[i + off], a = o && DIG.test(o) ? +o : 0, b = +ch;
    if (a === b) { e.append(ch); return; }
    const seq: number[] = []; for (let d = a; ; d = (d + (up ? 1 : 9)) % 10) { seq.push(d); if (d === b) break; }
    if (!up) seq.reverse();
    const col = document.createElement('span'); col.className = 'odo'; col.style.height = S + 'px'; col.style.setProperty('--odo-p', P + 'px');
    const strip = document.createElement('span'); strip.className = 'odo-s'; strip.style.lineHeight = S + 'px';
    strip.textContent = seq.join('\n');
    col.appendChild(strip); e.appendChild(col);
    cols.push({ col, strip, n: seq.length - 1 });
  });
  // Split into columns, a digit loses its kerning with what's next to it (a % sign): if that moves anything, don't roll
  if (Math.abs(e.getBoundingClientRect().width - w0) > .3) { e.textContent = to; delete e.dataset.odo; return false; }
  // Gradient-filled amounts (background-clip: text, as the big hero figures in most themes): the parent's clip
  // draws its columns' digits where they'd be unmoved, so while it rolls each piece (columns and the unchanged
  // characters between them) carries its own copy of the gradient, lined up with the whole, and the parent none
  const grad = /text/.test(cs.backgroundClip || cs.getPropertyValue('-webkit-background-clip')) && cs.backgroundImage !== 'none';
  if (grad) {
    const r = e.getBoundingClientRect(), bg = cs.backgroundImage;
    const paint = (n: HTMLElement, at: HTMLElement) => {
      const st = n.style, x = at.getBoundingClientRect().left - r.left;
      st.backgroundImage = bg; st.backgroundSize = r.width + 'px 100%'; st.backgroundPosition = -x + 'px 0';
      st.setProperty('-webkit-background-clip', 'text'); st.backgroundClip = 'text'; st.color = 'transparent';
    };
    [...e.childNodes].forEach(n => { if (n.nodeType === 3) { const sp = document.createElement('span'); n.replaceWith(sp); sp.appendChild(n); paint(sp, sp); } });
    cols.forEach(c => paint(c.strip, c.col));
    e.style.backgroundImage = 'none';
  }
  const done = () => { e.textContent = to; delete e.dataset.odo; if (grad) e.style.removeProperty('background-image'); };
  const set = (q: number) => {
    const p = ease(q), f = Math.min(1, q * 10) * (1 - q) * (1 - q);            // how fast it's turning, 0…1
    cols.forEach(c => {
      const y = (up ? p : 1 - p) * c.n * S; c.strip.style.transform = 'translateY(' + -px(y) + 'px)';
      c.col.style.setProperty('--odo-f', (P + f * F).toFixed(1) + 'px');
    });
  };
  set(0);
  const t0 = performance.now() + delay;
  own(e, 'roll', now => {
    const p = e.isConnected ? Math.min(1, Math.max(0, now - t0) / dur) : 1;      // (a page put away mid-roll comes back finished)
    if (p >= 1) { done(); return false; }
    set(p); return true;
  });
  return true;
}
// Text that can't roll (a word, a figure of another shape) keeps showing what it said until the wave reaches it,
// then the new words fade in, so a card never shows this month's labels on last month's chart
function later(e: Element, from: string, to: string, delay: number, kind = 'roll') {
  say(e, from); if (e instanceof HTMLElement && kind === 'roll') e.dataset.odo = to;
  const t0 = performance.now() + delay;
  own(e, kind, now => {
    if (now < t0 && e.isConnected) return true;
    say(e, to); if (e instanceof HTMLElement) delete e.dataset.odo;
    if (e.isConnected) e.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 220, easing: 'ease' });
    return false;
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
function morphSvg(v: SVGSVGElement, old: SvgSnap, delay = 0, dur = 560) {
  const kids = [...v.querySelectorAll(GEO)];
  const same = kids.length === old.n && kids.every((k, i) => k.tagName === old.kids[i][0]);
  // A few more or fewer parts (a 31st day's bar, one more slice): each part takes over from the old one of its kind
  // in the same place and the extra ones fade in. Very different drawings just fade in whole.
  if (!same && Math.abs(kids.length - old.n) > Math.max(2, old.n * .2)) { v.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 300, easing: 'ease', fill: 'backwards' }); return; }
  const was: Record<string, Record<string, string>[]> = {}, seen: Record<string, number> = {};
  old.kids.forEach(([t, a]) => (was[t] = was[t] || []).push(a));
  const tw: [Element, string, (p: number) => string][] = [], fresh: Element[] = [];
  kids.forEach(k => {
    const t = k.tagName, j = seen[t] = (seen[t] ?? -1) + 1, from = was[t] && was[t][j];
    if (!from) { fresh.push(k); return; }
    ATTRS.forEach(a => { const now = k.getAttribute(a); if (now == null || from[a] == null) return; const f = tweenAttr(from[a], now); if (f) tw.push([k, a, f]); });
  });
  fresh.forEach(k => k.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 200 + delay, easing: 'ease', fill: 'backwards' }));
  if (!tw.length) return;
  tw.forEach(([k, a, f]) => k.setAttribute(a, f(0)));
  const t0 = performance.now() + delay;
  own(v, 'svg', now => {
    const p = v.isConnected ? Math.min(1, Math.max(0, now - t0) / dur) : 1, e = glide(p);
    tw.forEach(([k, a, f]) => k.setAttribute(a, f(e)));
    return p < 1;
  });
}

/* ---------- Rows ---------- */
// Rows move from where they were (tops from snapshot) to where they are now, in whole pixels; new ones fade in
// (another month's rows, with at: each as the wave reaches it, day headings too)
export function glideRows(root: HTMLElement, old: Map<string, number>, at?: (e: Element) => number) {
  if (RM || (!old.size && !at)) return;
  const moves: [HTMLElement, number][] = [];
  root.querySelectorAll<HTMLElement>(ROWS).forEach(r => {
    const b = r.getBoundingClientRect(); if (!near(b, 300)) return;
    const was = old.get(rowKey(r));
    if (was == null) {
      if (at) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: at(r), easing: 'ease', fill: 'backwards' });
      else if (r.dataset.gid) r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 120, easing: 'ease', fill: 'backwards' });
      return;
    }
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

/* ---------- The wave (another month, redrawn in place) ---------- */
// A month change spreads out from the button you pressed: each card's numbers and chart change as the wave reaches
// it, nearest first, and the card gives a small nudge away from the button as the wave passes, so you can see it
// travel. Nothing is drawn over the page (a ring would cost Glass a lot of blur work).
const WAVE_STEP = 60, WAVE_MAX = 480;                    // ms between cards, on average; the farthest card starts by then
const CARD = '[data-w], .kpi, section.panel, .hero, .card';
let tap: { x: number, y: number, t: number } | null = null;
if (!RM) addEventListener('pointerdown', ev => {
  const b = (ev.target as Element | null)?.closest?.('.month button');
  if (b) { const r = b.getBoundingClientRect(); tap = { x: r.left + r.width / 2, y: r.top + r.height / 2, t: performance.now() }; }
}, { capture: true, passive: true });
// Where the wave starts: the button just pressed, or (keyboard, swipe) the arrow for that way on screen
function origin(dir: string) {
  if (tap && performance.now() - tap.t < 5000) return tap;
  const lab = dir === 'next' ? 'Next month' : 'Previous month';
  for (const b of document.querySelectorAll<HTMLElement>('.month button[aria-label="' + lab + '"]')) {
    const r = b.getBoundingClientRect();
    if (r.width && r.bottom > 0 && r.top < innerHeight) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: dir === 'next' ? innerWidth : 0, y: 0 };
}
// How long each element waits for the wave: by its card's distance from where it started
function waveDelays(root: HTMLElement, dir: string) {
  const o = origin(dir); tap = null;
  const dist = new Map<Element, number>();
  root.querySelectorAll(CARD).forEach(c => {
    if (c.parentElement?.closest(CARD)) return;
    const r = c.getBoundingClientRect(); if (!near(r)) return;
    // the nearest point of the card, so a wide card next to the button starts right away
    const dx = Math.max(r.left - o.x, 0, o.x - r.right), dy = Math.max(r.top - o.y, 0, o.y - r.bottom);
    dist.set(c, Math.hypot(dx, dy));
  });
  const far = Math.max(1, ...dist.values()), spread = Math.min(WAVE_MAX, Math.max(0, dist.size - 1) * WAVE_STEP);
  // The nudge: each card dips a little and moves a few pixels away from where the wave started, then settles
  dist.forEach((d, c) => {
    const r = c.getBoundingClientRect(), vx = r.left + r.width / 2 - o.x, vy = r.top + r.height / 2 - o.y, l = Math.hypot(vx, vy) || 1;
    const push = 'translate(' + (vx / l * 4).toFixed(1) + 'px,' + (vy / l * 4).toFixed(1) + 'px) scale(.985)';
    c.animate([{ transform: 'none' }, { transform: push, offset: .35 }, { transform: 'none' }],
      { duration: 460, delay: Math.round(d / far * spread), easing: 'cubic-bezier(.3,.7,.3,1)', composite: 'add' });
  });
  // Outside any card (a list of transactions): by the element's own distance, over the same time the cards take,
  // so a long list fills in from the arrow down without its far rows waiting long
  const span = Math.hypot(innerWidth, innerHeight), rowSpread = Math.max(spread, 260);
  return (e: Element) => {
    let c: Element | null = e.closest(CARD);
    while (c && c.parentElement?.closest(CARD)) c = c.parentElement.closest(CARD);
    const d = c ? dist.get(c) : undefined;
    if (d != null) return Math.round(d / far * spread);
    if (c) return 0;
    const r = e.getBoundingClientRect();
    const dx = Math.max(r.left - o.x, 0, o.x - r.right), dy = Math.max(r.top - o.y, 0, o.y - r.bottom);
    return Math.round(Math.min(1, Math.hypot(dx, dy) / span) * rowSpread);
  };
}

/* ---------- The month label ---------- */
// The month's name slides out one way and the new one in from the other, the way the month went. Both are copies
// laid over the real label (kept in place, hidden), so its width and the arrows beside it don't move mid-slide.
export const monthLabel = (root: Element) => { const s = root.querySelector('.month > span'); return s ? labelHtml(s) : null; };
export function labelHtml(s: Element) {
  if (!s.querySelector('.mghost')) return s.innerHTML;
  const c = s.cloneNode(true) as Element; c.querySelectorAll('.mghost').forEach(g => g.remove());     // (mid-slide)
  return c.innerHTML;
}
export function slideLabel(root: Element, was: string | null, dir?: string) {
  if (RM || was == null || (dir !== 'next' && dir !== 'prev')) return;
  const s = root.querySelector<HTMLElement>('.month > span');
  if (!s || monthLabel(root) === was) return;
  s.querySelectorAll('.mghost').forEach(g => g.remove());
  const k = dir === 'next' ? 1 : -1, d = 22, now = s.innerHTML;
  const ghost = (h: string) => { const g = document.createElement('span'); g.className = 'mghost'; g.setAttribute('aria-hidden', 'true'); g.innerHTML = h; s.appendChild(g); return g; };
  const out = ghost(was), inn = ghost(now);
  s.classList.add('msliding');
  const opt = { duration: 380, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'both' as FillMode };
  out.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(' + -k * d + 'px)', opacity: 0 }], { ...opt, duration: 260 });
  inn.animate([{ transform: 'translateX(' + k * d + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], opt).finished
    .catch(() => {}).then(() => { out.remove(); inn.remove(); s.classList.remove('msliding'); });
}

// After a redraw (root already holds the new drawing and is scrolled where it will be). With a direction (another
// month), the changes ripple out from the month arrows.
export function morph(root: HTMLElement, s: Snap, dir = '') {
  if (RM) return;
  const wave = dir === 'next' || dir === 'prev' ? waveDelays(root, dir) : null;
  const at = (e: Element) => wave ? wave(e) : 0;
  glideRows(root, s.rows, wave || undefined);
  if (wave) {
    // a card this month has that the last one didn't (a budget, a recap note) grows in when the wave reaches it
    topCards(root).forEach(c => {
      if (s.cards.has(keyOf(c, root)) || c.matches(SELF) || !near(c.getBoundingClientRect())) return;
      c.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: at(c), easing: 'cubic-bezier(.32,.72,0,1)', fill: 'backwards' });
    });
    // In each card the words wait for the wave with the chart: the old ones stay until it arrives, then the new
    // ones fade in (new ones with nothing before them just fade in then)
    let n = 0;
    topCards(root).forEach(card => {
      if (card.matches(SELF) || !near(card.getBoundingClientRect())) return;
      const d = at(card), hold = s.shapes.get(keyOf(card, root)) === shape(card);
      leaves(card, root).forEach(e => {
        if (n >= 1500) return;
        const now = said(e), was = s.texts.get(keyOf(e, root));
        if (was === now) return;
        n++;
        if (was == null) { e.animate([{ opacity: hold ? 0 : .25 }, { opacity: 1 }], { duration: 220, delay: hold ? d : 0, easing: 'ease', fill: 'backwards' }); return; }
        if (hold) later(e, was, now, d, 'text');
        else e.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 220, easing: 'ease' });
      });
    });
    root.querySelectorAll<HTMLElement>(TEXT).forEach(e => {
      const was = s.texts.get(keyOf(e, root));
      if (was == null || was === e.textContent || !ours(e, root) || !near(e.getBoundingClientRect())) return;
      if (e.closest(CARD) && !e.children.length) return;      // (a card's words: above)
      e.animate([{ opacity: .25 }, { opacity: 1 }], { duration: 260, delay: at(e), easing: 'ease', fill: 'backwards' });
    });
  }
  // in a wave each card's move is a little quicker, so the last one settles soon after the first
  const D = wave ? .8 : 1;
  let c = 0;
  if (s.nums.size) root.querySelectorAll<HTMLElement>(NUM).forEach(e => {
    if (c >= 60 || e.children.length) return;
    const was = s.nums.get(keyOf(e, root)), now = e.textContent || '';
    if (was == null || was === now || !near(e.getBoundingClientRect())) return;
    c++;
    const d = at(e);
    if (!roll(e, was, now, d, 700 * D) && (d > 0 || wave) && e.isConnected && !e.children.length && e.textContent === now) later(e, was, now, d);
  });
  if (s.fills.size) root.querySelectorAll<HTMLElement>('.fill').forEach(e => {
    const was = s.fills.get(keyOf(e, root)), now = parseFloat(e.style.width);
    if (was == null || !isFinite(now) || now <= 0 || Math.abs(was - now) < .2) return;
    e.animate([{ transform: 'scaleX(' + (was / now).toFixed(4) + ')', transformOrigin: 'left' }, { transform: 'none', transformOrigin: 'left' }], { duration: 620 * D, delay: at(e), fill: 'backwards', easing: 'cubic-bezier(.32,.72,0,1)' });
  });
  // Another month: the same square is another day (the month starts on another weekday), so taking over its old
  // shade would show last month's pattern on this month's days for a moment. Each day's square starts as a day with
  // nothing spent and darkens to its shade as the wave reaches it instead.
  const cells = s.tints.size ? [...root.querySelectorAll<HTMLElement>(TINT)] : [];
  const blank = wave ? cells.find(e => !e.style.getPropertyValue('--p') && !e.classList.contains('fut')) : null;
  const base = blank ? getComputedStyle(blank).backgroundColor : '';
  cells.forEach(e => {
    const now = getComputedStyle(e).backgroundColor;
    const was = wave ? (e.style.getPropertyValue('--p') ? base : '') : s.tints.get(keyOf(e, root));
    if (was && was !== now) e.animate([{ backgroundColor: was }, { backgroundColor: now }], { duration: 520 * D, delay: at(e), fill: 'backwards', easing: 'ease' });
  });
  if (s.svgs.size) root.querySelectorAll<SVGSVGElement>('svg').forEach(v => { const was = s.svgs.get(keyOf(v, root)); if (was && near(v.getBoundingClientRect())) morphSvg(v, was, at(v), 560 * D); });
}

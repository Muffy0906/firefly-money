import { App } from '../core/base';
import { toast } from '../core/dom';
import { LS } from '../core/helpers';

/* Magnetic hover: what's under the mouse leans a few pixels toward it. A button or link by up to 3px, the card under
   the pointer by 1.5px, and inside that card its charts and big numbers by 1.5px more, so they float a little over
   it. Buttons also rise 1px and Overview tiles 2px.
   Off unless Settings → Appearance → Magnetic hover turns it on (per device), and only with a mouse or trackpad and
   no Reduce motion.
   Smoothness:
   - Each element follows its goal on a critically damped spring stepped by real frame time, so it glides in and
     settles without overshoot and runs the same speed at 60Hz and 120Hz. (The old fixed share per frame crawled
     through its last pixel, which showed up as a late tick after the motion had seemed to stop.)
   - Boxes are measured once when the pointer reaches something and then reused (scroll, resize or 300ms later
     measures again), so a frame normally reads no layout.
   - It writes `translate` straight onto the element. A custom property inherits, which made Chrome restyle every
     node in a card (charts have hundreds) on every frame.
   - Text must never sit between device pixels (Chrome on Windows draws it blurred until it settles), so what's shown
     moves in whole device pixels, with a little hysteresis so it never flickers between two of them. */
export const magnetOn = () => LS.get('magnet', false) === true;
const fine = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)') : null;
export const canMagnet = () => !!fine?.matches;
const CONTROL = '.btn, .round, .seg button, .tabs a, .side-search, .side-tg, .fab, .add-card, .set-nav a, .link';
const CARD = '.panel:not(.set-panel), .kpi, .insight';
const INNER = 'svg:is(.lines, .spark, .sbars, .mini-line, .barchart, .flowchart, .donut, .ring), .big, .head h1';
const W = 30;               // spring stiffness (rad/s): settles in about 180ms
const FRESH = 300;          // ms a measured box is trusted
type V2 = [number, number];
type Box = { cx: number, cy: number, hw: number, hh: number, at: number, gen: number };
type Lean = { goal: V2, pos: V2, vel: V2, shown: V2, abs: V2 };   // shown: its own translate; abs: where that and its card's put it
const leaning = new Map<HTMLElement, Lean>();
const boxes = new WeakMap<HTMLElement, Box>();
let px = 0, py = 0, target: Element | null = null, frame = 0, last = 0, gen = 0, bound = false, aimed = false;

// el's resting box: measured without its own lean or the lean of anything around it that's leaning too
function box(el: HTMLElement, t: number): Box | null {
  const b = boxes.get(el);
  if (b && b.gen === gen && t - b.at < FRESH) return b;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  let sx = 0, sy = 0;
  leaning.forEach((l, o) => { if (o === el || o.contains(el)) { sx += l.shown[0]; sy += l.shown[1]; } });
  const nb = { cx: r.left - sx + r.width / 2, cy: r.top - sy + r.height / 2, hw: r.width / 2, hh: r.height / 2, at: t, gen };
  boxes.set(el, nb);
  return nb;
}
// Where el should lean: toward the pointer, max px at its edge and nothing at its centre, plus a lift
function aim(el: HTMLElement, max: number, lift: number, goals: Map<HTMLElement, V2>, t: number) {
  const b = box(el, t);
  if (!b) return;
  const c = (f: number) => Math.max(-1, Math.min(1, f));
  goals.set(el, [c((px - b.cx) / b.hw) * max, c((py - b.cy) / b.hh) * max - lift]);
}
function goalsNow(t: number) {
  const goals = new Map<HTMLElement, V2>(), el = target instanceof Element ? target : null;
  const ctl = el && el.closest<HTMLElement>(CONTROL);
  if (ctl && !ctl.closest('.side .nav') && !(ctl as HTMLButtonElement).disabled) aim(ctl, 3, ctl.classList.contains('btn') ? 1 : 0, goals, t);
  const card = el && el.closest<HTMLElement>(CARD);
  if (card && !card.closest('#dash.editing, .drawer, dialog')) {
    aim(card, 1.5, card.matches('#dash .w > .panel') ? 2 : 0, goals, t);
    card.querySelectorAll<HTMLElement>(INNER).forEach((n, i) => { if (i < 6) aim(n, 1.5, 0, goals, t); });
  }
  const h1 = el && el.closest<HTMLElement>('.head h1');
  if (h1) aim(h1, 2, 0, goals, t);
  return goals;
}
// Whole device pixels, and it only moves on once the spring is 0.6 of a pixel away, so it can't flicker
function snap(v: number, shown: number) {
  const d = devicePixelRatio || 1;
  return Math.abs(v - shown) * d < .6 ? shown : Math.round(v * d) / d;
}
function letGo(el: HTMLElement) { el.classList.remove('mag'); el.style.removeProperty('translate'); leaning.delete(el); }
// The nearest thing around el that's leaning too (a card around its chart or button)
function host(el: HTMLElement) {
  for (let o = el.parentElement; o; o = o.parentElement) if (leaning.has(o)) return o;
  return null;
}
function step(t: number) {
  frame = 0;
  const dt = last ? Math.min((t - last) / 1000, 1 / 30) : 1 / 60;
  last = t;
  if (aimed) {
    aimed = false;
    const goals = goalsNow(t);
    leaning.forEach(l => { l.goal = [0, 0]; });          // whatever isn't under the pointer any more eases home
    goals.forEach((g, el) => { const l = leaning.get(el); if (l) l.goal = g; else leaning.set(el, { goal: g, pos: [0, 0], vel: [0, 0], shown: [0, 0], abs: [0, 0] }); });
  }
  let moving = false;
  const home: HTMLElement[] = [];
  leaning.forEach((l, el) => {
    for (const i of [0, 1]) {
      const a = W * W * (l.goal[i] - l.pos[i]) - 2 * W * l.vel[i];
      l.vel[i] += a * dt; l.pos[i] += l.vel[i] * dt;
    }
    const done = Math.abs(l.goal[0] - l.pos[0]) < .02 && Math.abs(l.goal[1] - l.pos[1]) < .02 && Math.abs(l.vel[0]) < 1 && Math.abs(l.vel[1]) < 1;
    if (done) { l.pos = [...l.goal]; l.vel = [0, 0]; if (!l.goal[0] && !l.goal[1]) home.push(el); }
    else moving = true;
  });
  // What's inside a leaning card is snapped where it ends up on screen (the card's lean plus its own), then drawn
  // relative to the card. Snapped separately, the two moved a pixel at different moments and the chart wobbled.
  const placed = new Set<HTMLElement>();
  const place = (el: HTMLElement, l: Lean) => {
    if (placed.has(el)) return;
    placed.add(el);
    const h = host(el), hl = h && leaning.get(h);
    if (h && hl) place(h, hl);
    const base: V2 = hl ? [hl.pos[0], hl.pos[1]] : [0, 0], baseShown: V2 = hl ? hl.abs : [0, 0];
    l.abs = [snap(l.pos[0] + base[0], l.abs[0]), snap(l.pos[1] + base[1], l.abs[1])];
    const shown: V2 = [l.abs[0] - baseShown[0], l.abs[1] - baseShown[1]];
    if (shown[0] !== l.shown[0] || shown[1] !== l.shown[1] || !el.classList.contains('mag')) {
      el.classList.add('mag'); el.style.translate = `${shown[0]}px ${shown[1]}px`;
      l.shown = shown;
    }
  };
  leaning.forEach((l, el) => place(el, l));
  home.forEach(el => { if (!leaning.get(el)!.shown[0] && !leaning.get(el)!.shown[1]) letGo(el); else moving = true; });
  if (moving) frame = requestAnimationFrame(step);
  else last = 0;
}
function kick() { if (!frame) frame = requestAnimationFrame(step); }
function follow(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  px = e.clientX; py = e.clientY;
  if (e.target !== target) gen++;                         // reached something new: measure afresh
  target = e.target as Element | null; aimed = true;
  kick();
}
// Let go of everything at once: the effect was turned off
function release() {
  cancelAnimationFrame(frame); frame = 0; last = 0; target = null;
  [...leaning.keys()].forEach(letGo);
}
// The pointer left the window: ease everything home
function away(e: MouseEvent) { if (!e.relatedTarget) { target = null; aimed = true; kick(); } }
const moved = () => { gen++; };

function bindMagnet() {
  const on = magnetOn() && canMagnet();
  if (on === bound) return;
  bound = on;
  if (on) {
    addEventListener('pointermove', follow, { passive: true }); document.addEventListener('mouseout', away);
    addEventListener('scroll', moved, { capture: true, passive: true }); addEventListener('resize', moved);
  } else {
    removeEventListener('pointermove', follow); document.removeEventListener('mouseout', away);
    removeEventListener('scroll', moved, { capture: true }); removeEventListener('resize', moved);
    release();
  }
}
function toggleMagnet(on: boolean) { LS.set('magnet', !!on); bindMagnet(); toast(on ? 'Magnetic hover on' : 'Magnetic hover off'); }
bindMagnet();
// Reduce motion switched on (or a mouse unplugged) while the app is open
fine?.addEventListener?.('change', bindMagnet);

const methods = { toggleMagnet };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

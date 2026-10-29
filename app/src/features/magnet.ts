import { App } from '../core/base';
import { toast } from '../core/dom';
import { LS } from '../core/helpers';

/* Magnetic hover: what's under the mouse leans a few pixels toward it. A button or link by up to 3px, the card under
   the pointer by 1.5px, and inside that card its charts and big numbers by 1.5px more, so they float a little over
   it. Buttons also rise 1px and Overview tiles 2px. Each gets the class .mag and --mx/--my, which money.css turns
   into a `translate` (never `transform`, which presses, drags and the entrance animations use).
   The easing happens here, frame by frame, and every step lands on a whole device pixel: Chrome on Windows draws
   text that's mid-transition, or between pixels, blurred until it settles.
   Only with a mouse or trackpad and not with Reduce motion on; Settings → Appearance → Magnetic hover turns it off on
   this device. Frames run only while something is still moving. */
export const magnetOn = () => LS.get('magnet', true) !== false;
export const canMagnet = () => !!window.matchMedia && matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
const CONTROL = '.btn, .round, .seg button, .tabs a, .side-search, .side-tg, .fab, .add-card, .set-nav a, .link';
const CARD = '.panel:not(.set-panel), .kpi, .insight';
const INNER = 'svg:is(.lines, .spark, .sbars, .mini-line, .barchart, .flowchart, .donut, .ring), .big, .head h1';
const EASE = .22;           // how much of the way left it moves each frame
type Lean = { goal: [number, number], now: [number, number], shown: [number, number] };
const leaning = new Map<HTMLElement, Lean>();
let px = 0, py = 0, target: Element | null = null, frame = 0, bound = false, aimed = false;

// Where el should lean: toward the pointer, max px at its edge and nothing at its centre, plus a lift. Its box is
// measured without the lean it shows now.
function aim(el: HTMLElement, max: number, lift: number, goals: Map<HTMLElement, [number, number]>) {
  const r = el.getBoundingClientRect(), [sx, sy] = leaning.get(el)?.shown || [0, 0];
  if (!r.width || !r.height) return;
  const c = (f: number) => Math.max(-1, Math.min(1, f));
  goals.set(el, [c((px - (r.left - sx + r.width / 2)) / (r.width / 2)) * max, c((py - (r.top - sy + r.height / 2)) / (r.height / 2)) * max - lift]);
}
function goalsNow() {
  const goals = new Map<HTMLElement, [number, number]>(), t = target instanceof Element ? target : null;
  const ctl = t && t.closest<HTMLElement>(CONTROL);
  if (ctl && !ctl.closest('.side .nav') && !(ctl as HTMLButtonElement).disabled) aim(ctl, 3, ctl.classList.contains('btn') ? 1 : 0, goals);
  const card = t && t.closest<HTMLElement>(CARD);
  if (card && !card.closest('#dash.editing, .drawer, dialog')) {
    aim(card, 1.5, card.matches('#dash .w > .panel') ? 2 : 0, goals);
    card.querySelectorAll<HTMLElement>(INNER).forEach((n, i) => { if (i < 6) aim(n, 1.5, 0, goals); });
  }
  const h1 = t && t.closest<HTMLElement>('.head h1');
  if (h1) aim(h1, 2, 0, goals);
  return goals;
}
const snap = (v: number) => Math.round(v * devicePixelRatio) / devicePixelRatio;
function letGo(el: HTMLElement) { el.classList.remove('mag'); el.style.removeProperty('--mx'); el.style.removeProperty('--my'); leaning.delete(el); }
function step() {
  frame = 0;
  if (aimed) {
    aimed = false;
    const goals = goalsNow();
    leaning.forEach(l => { l.goal = [0, 0]; });          // whatever isn't under the pointer any more eases home
    goals.forEach((g, el) => { const l = leaning.get(el); if (l) l.goal = g; else leaning.set(el, { goal: g, now: [0, 0], shown: [0, 0] }); });
  }
  let moving = false;
  leaning.forEach((l, el) => {
    const now: [number, number] = [l.now[0] + (l.goal[0] - l.now[0]) * EASE, l.now[1] + (l.goal[1] - l.now[1]) * EASE];
    const done = Math.abs(l.goal[0] - now[0]) < .05 && Math.abs(l.goal[1] - now[1]) < .05;
    l.now = done ? l.goal : now;
    const shown: [number, number] = [snap(l.now[0]), snap(l.now[1])];
    if (done && !l.goal[0] && !l.goal[1]) { letGo(el); return; }
    if (!done) moving = true;
    if (shown[0] !== l.shown[0] || shown[1] !== l.shown[1] || !el.classList.contains('mag')) {
      el.classList.add('mag'); el.style.setProperty('--mx', shown[0] + 'px'); el.style.setProperty('--my', shown[1] + 'px');
      l.shown = shown;
    }
  });
  if (moving && !frame) frame = requestAnimationFrame(step);
}
function follow(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  px = e.clientX; py = e.clientY; target = e.target as Element | null; aimed = true;
  if (!frame) frame = requestAnimationFrame(step);
}
// Let go of everything at once: the effect was turned off
function release() {
  cancelAnimationFrame(frame); frame = 0; target = null;
  [...leaning.keys()].forEach(letGo);
}
// The pointer left the window: ease everything home
function away(e: MouseEvent) { if (!e.relatedTarget) { target = null; aimed = true; if (!frame) frame = requestAnimationFrame(step); } }

function bindMagnet() {
  const on = magnetOn() && canMagnet();
  if (on === bound) return;
  bound = on;
  if (on) { addEventListener('pointermove', follow, { passive: true }); document.addEventListener('mouseout', away); }
  else { removeEventListener('pointermove', follow); document.removeEventListener('mouseout', away); release(); }
}
function toggleMagnet(on: boolean) { LS.set('magnet', !!on); bindMagnet(); toast(on ? 'Magnetic hover on' : 'Magnetic hover off'); }
bindMagnet();

const methods = { toggleMagnet };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

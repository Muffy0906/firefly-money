import { App } from '../core/base';
import { toast } from '../core/dom';
import { LS } from '../core/helpers';

/* Magnetic hover: what's under the mouse leans a few pixels toward it. A button or link by up to 3px, the card under
   the pointer by 1.5px, and inside that card its charts and big numbers by 1.5px more, so they float a little over
   it. Each gets --mx/--my, and the class .mag, which money.css turns into a `translate` (never `transform`, which presses, drags and the
   entrance animations use). Only with a mouse or trackpad and not with Reduce motion on; Settings → Appearance →
   Magnetic hover turns it off on this device. Work happens once per frame, and only while the mouse moves. */
export const magnetOn = () => LS.get('magnet', true) !== false;
export const canMagnet = () => !!window.matchMedia && matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
const CONTROL = '.btn, .round, .seg button, .tabs a, .side-search, .side-tg, .fab, .add-card, .set-nav a, .link';
const CARD = '.panel:not(.set-panel), .kpi, .insight';
const INNER = 'svg:is(.lines, .spark, .sbars, .mini-line, .barchart, .flowchart, .donut, .ring), .big, .head h1';
const pulled = new Map<HTMLElement, [number, number]>();
let px = 0, py = 0, target: Element | null = null, frame = 0, bound = false;

// Lean el toward the pointer: max px at its edge, nothing at its centre. Its box is measured without the lean it has now.
function lean(el: HTMLElement, max: number, next: Map<HTMLElement, [number, number]>) {
  const r = el.getBoundingClientRect(), [ox, oy] = pulled.get(el) || [0, 0];
  if (!r.width || !r.height) return;
  const fx = (px - (r.left - ox + r.width / 2)) / (r.width / 2), fy = (py - (r.top - oy + r.height / 2)) / (r.height / 2);
  const c = (f: number) => Math.max(-1, Math.min(1, f));
  next.set(el, [+(c(fx) * max).toFixed(2), +(c(fy) * max).toFixed(2)]);
}
function letGo(el: HTMLElement) { el.classList.remove('mag'); el.style.removeProperty('--mx'); el.style.removeProperty('--my'); }
function pull() {
  frame = 0;
  const next = new Map<HTMLElement, [number, number]>(), t = target instanceof Element ? target : null;
  const ctl = t && t.closest<HTMLElement>(CONTROL);
  if (ctl && !ctl.closest('.side .nav') && !(ctl as HTMLButtonElement).disabled) lean(ctl, 3, next);
  const card = t && t.closest<HTMLElement>(CARD);
  if (card && !card.closest('#dash.editing, .drawer, dialog')) {
    lean(card, 1.5, next);
    card.querySelectorAll<HTMLElement>(INNER).forEach((n, i) => { if (i < 6) lean(n, 1.5, next); });
  }
  const h1 = t && t.closest<HTMLElement>('.head h1');
  if (h1) lean(h1, 2, next);
  pulled.forEach((_, el) => { if (!next.has(el)) letGo(el); });
  next.forEach(([x, y], el) => { el.classList.add('mag'); el.style.setProperty('--mx', x + 'px'); el.style.setProperty('--my', y + 'px'); });
  pulled.clear(); next.forEach((v, el) => pulled.set(el, v));
}
function follow(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  px = e.clientX; py = e.clientY; target = e.target as Element | null;
  if (!frame) frame = requestAnimationFrame(pull);
}
// Let go of everything: the pointer left the window, or the effect was turned off
function release() {
  cancelAnimationFrame(frame); frame = 0; target = null;
  pulled.forEach((_, el) => letGo(el));
  pulled.clear();
}
function away(e: MouseEvent) { if (!e.relatedTarget) release(); }

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

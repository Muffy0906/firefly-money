import { App } from '../core/base';
import { toast } from '../core/dom';
import { LS } from '../core/helpers';

/* Edge glow: in the glass themes (Liquid glass and Frosted glass) the rims of cards and buttons near the mouse light up,
   brightest at the point nearest the pointer and fading out over REACH px.
   On by default with a mouse or trackpad; never on touch. Settings → Appearance → Edge glow turns it off (per device).
   Cost: nothing runs until the pointer moves. A move measures the boxes it needs at most every FRESH ms (or after a
   scroll or resize) and then only writes --ex/--ey on the few elements in reach. Those are registered with
   inherits: false (money.css), so Chrome restyles just that element and its ::before ring, not the whole card. */
export const edgeOn = () => LS.get('edge', true) !== false;
const fine = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null;
export const canEdge = () => !!fine?.matches;
const SEL = '.panel:not(.set-panel), .kpi, .insight, .extra, .split, .dash-bar, .btn, .round, .seg, .tabs';
const REACH = 150;          // px from an element's edge at which its rim starts to light
const FRESH = 300;          // ms the measured boxes are trusted
type Item = { el: HTMLElement, l: number, t: number, r: number, b: number };
let items: Item[] = [], at = 0, gen = 0, seen = -1, px = 0, py = 0, frame = 0, bound = false, out = true;
const lit = new Set<HTMLElement>();
const glassy = () => { const t = document.documentElement.getAttribute('data-theme'); return t === 'glass' || t === 'frosted'; };

function measure(now: number) {
  if (seen === gen && now - at < FRESH) return;
  seen = gen; at = now; items = [];
  const vw = innerWidth, vh = innerHeight;
  document.querySelectorAll<HTMLElement>(SEL).forEach(el => {
    if (el.closest('dialog, .drawer, .palette, .story, #dash.editing')) return;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < -REACH || r.top > vh + REACH || r.right < -REACH || r.left > vw + REACH) return;
    items.push({ el, l: r.left, t: r.top, r: r.right, b: r.bottom });
  });
}
function dark(el: HTMLElement) {
  if (!lit.delete(el)) return;
  el.classList.remove('edge');
  el.style.removeProperty('--ex'); el.style.removeProperty('--ey');
}
function step(now: number) {
  frame = 0;
  if (out || !glassy()) { [...lit].forEach(dark); return; }
  measure(now);
  const keep = new Set<HTMLElement>();
  for (const it of items) {
    const dx = Math.max(it.l - px, 0, px - it.r), dy = Math.max(it.t - py, 0, py - it.b);
    if (dx * dx + dy * dy > REACH * REACH) continue;
    keep.add(it.el);
    if (!lit.has(it.el)) { lit.add(it.el); it.el.classList.add('edge'); }
    // where the element is now (it may lean with Magnetic hover): its own box, kept for this frame
    it.el.style.setProperty('--ex', Math.round(px - it.l) + 'px');
    it.el.style.setProperty('--ey', Math.round(py - it.t) + 'px');
  }
  lit.forEach(el => { if (!keep.has(el)) dark(el); });
}
const kick = () => { if (!frame) frame = requestAnimationFrame(step); };
function follow(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  px = e.clientX; py = e.clientY; out = false;
  kick();
}
function away(e: MouseEvent) { if (!e.relatedTarget) { out = true; kick(); } }
const moved = () => { gen++; if (!out && lit.size) kick(); };

function bindEdge() {
  const on = edgeOn() && canEdge();
  if (on === bound) return;
  bound = on;
  if (on) {
    addEventListener('pointermove', follow, { passive: true }); document.addEventListener('mouseout', away);
    addEventListener('scroll', moved, { capture: true, passive: true }); addEventListener('resize', moved);
    addEventListener('click', moved, { capture: true, passive: true });   // a click often redraws the page
  } else {
    removeEventListener('pointermove', follow); document.removeEventListener('mouseout', away);
    removeEventListener('scroll', moved, { capture: true }); removeEventListener('resize', moved);
    removeEventListener('click', moved, { capture: true });
    cancelAnimationFrame(frame); frame = 0; [...lit].forEach(dark);
  }
}
function toggleEdge(on: boolean) { LS.set('edge', !!on); bindEdge(); toast(on ? 'Edge glow on' : 'Edge glow off'); }
bindEdge();
fine?.addEventListener?.('change', bindEdge);

const methods = { toggleEdge };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

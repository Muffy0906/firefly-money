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
// Everything in the glass themes that has a visible rim. Form fields can't hold a ::before ring, so they brighten their
// border by how near the pointer is instead (--eg).
const RING = '.panel, .kpi, .insight, .extra, .split, .dash-bar, .daycards tbody.day, .ask, .side, .side-search, .ff-pill, '
  + '.btn, .round, .seg, .tabs, .calpop, .pickpop, .palette-box, .bulkbar, .ff-pop, dialog, .drawer';
const FIELD = 'input:not([type=checkbox], [type=radio], [type=range], [type=file], [type=color], [type=hidden]), select, textarea';
const SEL = RING + ', ' + FIELD;
// While one of these is open, only what's inside it lights up (not the page dimmed behind it)
const MODAL = 'dialog[open], .drawer.open, #palette:not([hidden])';
export const REACH = 140;   // px from an element's edge at which its rim starts to light (money.css --edge-r matches)
const FRESH = 300;          // ms the measured boxes are trusted
type Item = { el: HTMLElement, l: number, t: number, r: number, b: number, field: boolean, scroll: boolean, hid: boolean, inset: number };
// Can a clipping box let its painting out over its own border? (not in Safari)
const CLIPM = typeof CSS !== 'undefined' && CSS.supports?.('overflow-clip-margin', 'border-box');
let items: Item[] = [], at = 0, gen = 0, seen = -1, px = 0, py = 0, frame = 0, bound = false, out = true;
const lit = new Set<HTMLElement>();
const glassy = () => { const t = document.documentElement.getAttribute('data-theme'); return t === 'glass' || t === 'frosted'; };

function measure(now: number) {
  if (seen === gen && now - at < FRESH) return;
  seen = gen; at = now; items = [];
  const vw = innerWidth, vh = innerHeight;
  const modals = [...document.querySelectorAll<HTMLElement>(MODAL)];
  const scope: ParentNode = modals[modals.length - 1] || document;
  if (scope !== document && (scope as HTMLElement).matches(RING)) add(scope as HTMLElement);
  scope.querySelectorAll<HTMLElement>(SEL).forEach(add);
  function add(el: HTMLElement) {
    if (el instanceof SVGElement || el.closest('#dash.editing')) return;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < -REACH || r.top > vh + REACH || r.right < -REACH || r.left > vw + REACH) return;
    const field = el.matches(FIELD), cs = field ? null : getComputedStyle(el);
    const ov = cs ? cs.overflowX + cs.overflowY : '', scroll = /auto|scroll/.test(ov), hid = /hidden/.test(ov);
    const clips = hid || /clip/.test(ov) || (!!cs && /paint|strict|content/.test(cs.contain));
    // The ring is laid over the element's own border (1px out from its padding box, 0 for a borderless pill). A box that
    // scrolls, or clips where it can't be told to let the ring out, gets it just inside instead.
    const inset = !cs || scroll || (clips && !CLIPM) ? 0 : -parseFloat(cs.borderTopWidth) || 0;
    items.push({ el, l: r.left, t: r.top, r: r.right, b: r.bottom, field, scroll, hid, inset });
  }
}
function dark(el: HTMLElement) {
  if (!lit.delete(el)) return;
  el.classList.remove('edge', 'edge-f', 'edge-h');
  ['--ex', '--ey', '--eg', '--es', '--edge-in'].forEach(k => el.style.removeProperty(k));
}
function step(now: number) {
  frame = 0;
  if (out || !glassy()) { [...lit].forEach(dark); return; }
  measure(now);
  const keep = new Set<HTMLElement>();
  for (const it of items) {
    const dx = Math.max(it.l - px, 0, px - it.r), dy = Math.max(it.t - py, 0, py - it.b);
    // inside the element the nearest point of the rim is the nearest side
    const d = dx || dy ? Math.hypot(dx, dy) : Math.min(px - it.l, it.r - px, py - it.t, it.b - py);
    if (d > REACH) continue;
    keep.add(it.el);
    if (!lit.has(it.el)) { lit.add(it.el); it.el.classList.add(it.field ? 'edge-f' : 'edge');
      if (it.hid && CLIPM) it.el.classList.add('edge-h');
      if (!it.field) it.el.style.setProperty('--edge-in', it.inset + 'px');
    }
    if (it.field) {
      // the same falloff as the ring's gradient, as one number for the whole border (money.css tones it down, since
      // the whole rim lights at once)
      const f = d / REACH, g = f < .15 ? 1 : f < .5 ? 1 - (f - .15) / .35 * .6 : .4 * (1 - (f - .5) / .5);
      it.el.style.setProperty('--eg', String(Math.round(g * 100) / 100));
      continue;
    }
    it.el.style.setProperty('--ex', Math.round(px - it.l) + 'px');
    it.el.style.setProperty('--ey', Math.round(py - it.t) + 'px');
    // a scrolling box (the sidebar) carries its ring along with the scroll, so it's held where the box is
    if (it.scroll) it.el.style.setProperty('--es', it.el.scrollTop + 'px');
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

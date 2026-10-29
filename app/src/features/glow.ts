import { App } from '../core/base';
import { toast } from '../core/dom';
import { LS } from '../core/helpers';
import { isHex, lum } from '../core/themevars';

/* Cursor light: a soft glow in the theme's accent that follows the mouse. Only with a mouse or trackpad and not with
   Reduce motion on; Settings → Appearance → Cursor light turns it off on this device. The glow is one fixed element
   moved with a transform, so following the pointer never repaints the page under it. */
export const glowOn = () => LS.get('cursorLight', true) !== false;
export const canGlow = () => !!window.matchMedia && matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
let box: HTMLElement | null = null, x = 0, y = 0, frame = 0, bound = false;

// The accent, unless it's a grey on a light page (Calm light): a grey glow there reads as a smudge, so use the soft green
function tint() {
  const cs = getComputedStyle(document.documentElement), a = cs.getPropertyValue('--accent').trim(), bg = cs.getPropertyValue('--bg').trim();
  if (!isHex(a) || !isHex(bg)) return '';
  const ch = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  return Math.max(...ch) - Math.min(...ch) < 40 && lum(bg) > .5 ? 'var(--income)' : '';
}
function place() { frame = 0; if (box) box.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
function follow(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  if (!box) {
    box = document.createElement('div'); box.className = 'cursor-light'; box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
  }
  x = e.clientX; y = e.clientY;
  if (!box.classList.contains('on')) { box.style.setProperty('--glow', tint() || 'var(--accent)'); place(); box.classList.add('on'); }      // fade in where the pointer is, not where it left
  else if (!frame) frame = requestAnimationFrame(place);
}
// The pointer left the window
function away(e: MouseEvent) { if (!e.relatedTarget && box) box.classList.remove('on'); }

function bindGlow() {
  const on = glowOn() && canGlow();
  if (on === bound) return;
  bound = on;
  if (on) { addEventListener('pointermove', follow, { passive: true }); document.addEventListener('mouseout', away); }
  else { removeEventListener('pointermove', follow); document.removeEventListener('mouseout', away); if (box) box.classList.remove('on'); }
}
function toggleCursorLight(on: boolean) { LS.set('cursorLight', !!on); bindGlow(); toast(on ? 'Cursor light on' : 'Cursor light off'); }
bindGlow();
// A new theme or accent: retint the glow that's showing
new MutationObserver(() => { if (box) box.style.setProperty('--glow', tint() || 'var(--accent)'); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

const methods = { toggleCursorLight };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

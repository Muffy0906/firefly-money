import { html } from '../core/html';
import { App } from '../core/base';
import { icon, toast, vt } from '../core/dom';
import { buzz } from '../core/haptics';
import { LS } from '../core/helpers';

/* ---------- Privacy mode & density ---------- */
function applyPrefs() {
  const r = document.documentElement;
  r.classList.toggle('privacy', !!LS.get('privacy', false));
  r.classList.toggle('compact', !!LS.get('compact', false));
  drawToggles();
}
export function drawToggles() {
  const p = !!LS.get('privacy', false), c = !!LS.get('compact', false);
  document.querySelectorAll<HTMLElement>('[data-tg=privacy]').forEach(b => { b.classList.toggle('on', p); b.innerHTML = String(html`${icon(p ? 'eyeoff' : 'eye')}<span>${p ? 'Show amounts' : 'Hide amounts'}</span>`); b.title = 'Hide or show amounts (P)'; });
  document.querySelectorAll<HTMLElement>('[data-tg=compact]').forEach(b => { b.classList.toggle('on', c); b.innerHTML = String(html`${icon('density')}<span>${c ? 'Comfortable view' : 'Compact view'}</span>`); });
  // the switches on the Settings page
  document.querySelectorAll<HTMLInputElement>('input[data-pref]').forEach(i => { i.checked = i.dataset.pref === 'privacy' ? p : c; });
}
export function togglePrivacy() {
  const on = !LS.get('privacy', false); LS.set('privacy', on);
  vt('prefs', applyPrefs); buzz(8);
  toast(on ? 'Amounts hidden · press P or hover to peek' : 'Amounts visible');
}
// Fold the sidebar down to its icons for more room, or open it again. Kept per device: a laptop and a big screen differ.
const sideLabels = (on: boolean) => document.querySelectorAll<HTMLElement>('.side-tg').forEach(b => { b.title = (on ? 'Expand' : 'Collapse') + ' the sidebar ([)'; b.setAttribute('aria-label', (on ? 'Expand' : 'Collapse') + ' the sidebar'); });
sideLabels(!!LS.get('sideMini', false));
// The page beside it glides with the rail's edge instead of being laid out again on every frame of the fold: for
// the length of the slide it keeps one width, the wider of before and after (so it never leaves a gap; what doesn't
// fit yet is clipped at the window's edge). Folding, it takes its new width at once and slides left into place;
// opening, it slides right and narrows when it gets there.
let glideT = 0;
export function toggleSide() {
  const on = !LS.get('sideMini', false); LS.set('sideMini', on);
  const root = document.documentElement, v = document.getElementById('view'), side = document.querySelector<HTMLElement>('.side');
  const glide = !!v && !!side && innerWidth > 900 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (glide) {
    clearTimeout(glideT);
    const app = v!.parentElement!, w = on ? app.getBoundingClientRect().width - 70 : v!.getBoundingClientRect().width;   // 70: the folded rail (money.css)
    root.style.setProperty('--glide-w', w.toFixed(2) + 'px'); root.classList.add('side-glide');
  }
  root.classList.toggle('side-mini', on); sideLabels(on); buzz(8);
  if (glide && on) dispatchEvent(new Event('resize'));        // already at its new width: the Overview lays its tiles out now
  glideT = window.setTimeout(() => {                          // once it has slid (.34s)
    root.classList.remove('side-glide'); root.style.removeProperty('--glide-w');
    dispatchEvent(new Event('resize'));
  }, 360);
}
function toggleDensity() { LS.set('compact', !LS.get('compact', false)); vt('prefs', applyPrefs); buzz(8); }
applyPrefs();

/* ---------- While scrolling: lets CSS pause expensive effects (the glass theme's moving light) ---------- */
(function scrollFlag() {
  const root = document.documentElement; let t = 0;
  // only Glass with Moving light on uses it: a class change on <html> restyles the whole page, which stutters at the start of a scroll
  addEventListener('scroll', () => { if ((root.dataset.theme !== 'glass' || root.style.getPropertyValue('--glass-motion') !== 'running') && !t) return; if (!t) root.classList.add('scrolling'); clearTimeout(t); t = setTimeout(() => { root.classList.remove('scrolling'); t = 0; }, 160); }, { passive: true, capture: true });
})();

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  togglePrivacy,
  toggleSide,
  toggleDensity,
  drawToggles,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

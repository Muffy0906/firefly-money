import { App } from './base';
import { LS } from './helpers';

/* Haptics: a light tap you feel when you save, delete or flip a switch.
   Android has navigator.vibrate. Safari on iPhone doesn't, but since iOS 18 a <input type="checkbox" switch> ticks
   when it flips, even through its label's click(). That only works inside a tap (not after an await), so buzz()
   runs from the tap's own event: a form's submit, a checkbox's change, the Delete button of confirmBox().
   Settings → Appearance → Haptics turns them off on this device. */
export const hapticsOn = () => LS.get('haptics', true) !== false;
let last = 0, ticking = false;
function tick() {
  const label = document.createElement('label'), input = document.createElement('input');
  label.setAttribute('aria-hidden', 'true'); label.style.display = 'none';
  input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
  label.appendChild(input); document.head.appendChild(label);
  ticking = true;
  try { label.click(); } finally { ticking = false; label.remove(); }
}
// ms, or a pattern like navigator.vibrate's: [on, off, on, …]. iPhone has one strength, so it ticks once per "on".
export function buzz(p: number | number[] = 8) {
  if (!hapticsOn()) return;
  const now = Date.now();
  if (now - last < 60) return;             // one action that triggers two buzzes (a switch that also calls buzz) taps once
  last = now;
  try {
    if (typeof navigator.vibrate === 'function') { navigator.vibrate(p); return; }
    const ps = Array.isArray(p) ? p : [p];
    let at = 0;
    ps.forEach((ms, i) => {
      if (i % 2 === 0) { if (at) setTimeout(tick, at); else tick(); }
      at += ms;
    });
  } catch (e) { /* not supported */ }
}
export const BUZZ_SAVE = 10, BUZZ_DELETE = [12, 80, 12];

// Every form submit (saving a transaction, budget, bill, rule…) and every checkbox or switch you flip
document.addEventListener('submit', () => buzz(BUZZ_SAVE), true);
document.addEventListener('change', e => {
  const t = e.target;
  if (!ticking && t instanceof HTMLInputElement && (t.type === 'checkbox' || t.type === 'radio')) buzz(8);
}, true);

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  buzz,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module './base' { interface AppApi extends Methods {} }

import { el } from '../core/base';
import { loadView } from '../core/progress';

/* ================= Loading status =================
   While a page, a pull to refresh or Recalculate waits for Firefly III, a compact bar says what is actually going on
   (core/progress.ts counts the real requests): "Sending request to Firefly", "Fetching transactions (page 3 of 12)",
   "Receiving accounts from Firefly", "Processing", with the share of requests finished. Loads that finish within
   SHOW_AFTER never show it (no flash), and once it shows it stays at least MIN_SHOWN. Screen readers get a separate
   polite status, updated at most every SAY_EVERY and in 25% steps, not every request. While Firefly can't be reached
   the "can't reach" screen (features/ffstatus.ts) takes over and the bar goes. */
const SHOW_AFTER = 350, MIN_SHOWN = 600, SAY_EVERY = 1500;
let bar: HTMLElement | null = null, sr: HTMLElement | null = null;
let showT: ReturnType<typeof setTimeout> | undefined, hideT: ReturnType<typeof setTimeout> | undefined, shownAt = 0, said = { text: '', step: -1, at: 0 }, raf = 0, drawn = '';
function make() {
  if (bar) return;
  bar = document.createElement('div'); bar.id = 'loadBar'; bar.className = 'ld'; bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<div class="ld-row"><span class="ld-t"></span><span class="ld-d"></span><b class="ld-p"></b></div><div class="ld-track"><i></i></div>';
  sr = document.createElement('div'); sr.id = 'loadSay'; sr.className = 'ld-sr'; sr.setAttribute('role', 'status'); sr.setAttribute('aria-live', 'polite');
  document.body.append(bar, sr);
}
function draw() {
  raf = 0;
  const v = loadView();
  if (!v.on) {
    clearTimeout(showT); showT = undefined;
    if (bar && bar.classList.contains('show')) {
      clearTimeout(hideT);
      hideT = setTimeout(() => { bar!.classList.remove('show'); }, Math.max(0, MIN_SHOWN - (Date.now() - shownAt)));
    }
    said = { text: '', step: -1, at: 0 }; drawn = '';
    return;
  }
  make();
  clearTimeout(hideT);
  if (!showT && !bar!.classList.contains('show')) showT = setTimeout(() => {
    showT = undefined;
    if (el('app').hidden) return;
    shownAt = Date.now(); bar!.classList.add('show'); draw();
  }, SHOW_AFTER);
  // only what changed: a request finishing often leaves the words as they were, and every write restyles the bar
  const sig = [v.retrying, v.text, v.detail, v.pct].join('|');
  if (sig !== drawn) {
    drawn = sig;
    bar!.dataset.k = v.retrying ? 'retry' : 'ok';
    bar!.querySelector('.ld-t')!.textContent = v.text;
    bar!.querySelector('.ld-d')!.textContent = v.detail;
    bar!.querySelector('.ld-p')!.textContent = v.pct + '%';
    (bar!.querySelector('.ld-track > i') as HTMLElement).style.transform = 'scaleX(' + v.pct / 100 + ')';
    bar!.classList.toggle('idle', v.pct === 0);
  }
  // what a screen reader hears: only once the bar is up, and not on every request
  const step = Math.floor(v.pct / 25);
  if (bar!.classList.contains('show') && (v.text !== said.text || step !== said.step) && Date.now() - said.at >= SAY_EVERY) {
    said = { text: v.text, step, at: Date.now() };
    sr!.textContent = 'Loading, ' + v.pct + ' percent. ' + v.text;
  }
}
addEventListener('money-load', () => { if (!raf) raf = requestAnimationFrame(draw); });

/* ================= Big numbers always fit their card =================
   The headline figures (a card's big number, a total, a KPI value) keep their size while they fit; one too wide for its
   card, on a narrow phone or with a long amount, shrinks until it does (and grows back when there is room again). They never clip.
   Checked after the page changes, when the window is resized and once the fonts are in. */
export const HERO = '.stat-v, .total, .big, .kpi .val';
const MIN = 12;      // px: never smaller than this
export function fitHero(root: ParentNode = document) {
  const els = [...root.querySelectorAll<HTMLElement>(HERO)];
  els.forEach(e => { if (e.style.fontSize) e.style.fontSize = ''; });      // back to its own size, then measure all of them in one go
  const todo = els.map(e => ({ e, avail: e.clientWidth, need: e.scrollWidth, px: parseFloat(getComputedStyle(e).fontSize) })).filter(x => x.avail > 0 && x.need > x.avail + 0.5);
  todo.forEach(x => { x.e.style.fontSize = Math.max(MIN, Math.floor(x.px * x.avail / x.need * 100) / 100 - 0.5) + 'px'; });
}
let raf = 0;
const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fitHero(); }); };
(function init() {
  const v = document.getElementById('view'); if (!v) return;
  new MutationObserver(later).observe(v, { childList: true, subtree: true });
  // A number rolling up rewrites its text every frame: wait until it settles instead of re-measuring each tick
  let settle = 0;
  new MutationObserver(() => { clearTimeout(settle); settle = window.setTimeout(later, 120); }).observe(v, { characterData: true, subtree: true });
  addEventListener('resize', later);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(later).catch(() => {});
  later();
})();

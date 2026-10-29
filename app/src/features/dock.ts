/* Dock: the sidebar's icons swell under the mouse like the macOS Dock, the nearest most and its neighbours a little.
   Each link gets --dock (0 to 1, by how close the pointer is), which money.css turns into the icon's scale, and
   --dock-x, the label's nudge, so the rows themselves never move. Only with a mouse or trackpad, and not with Reduce motion on. */
const REACH = 84;           // px from the pointer at which an icon stops growing
let links: { a: HTMLElement; y: number }[] | null = null, stale = false, py = 0, frame = 0;

const allowed = () => !!window.matchMedia && matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
// Where each icon sits, measured once per visit: --dock only transforms, so the boxes don't move while it plays
function measure(side: HTMLElement) {
  stale = false;
  links = [...side.querySelectorAll<HTMLElement>('.nav a')].map(a => { const r = a.getBoundingClientRect(); return { a, y: r.top + r.height / 2 }; });
}
function paint() {
  frame = 0;
  if (!links) return;
  for (const l of links) {
    const d = Math.abs(py - l.y);
    // A cosine bump: 1 right under the pointer, easing to 0 at REACH, so the swell rolls smoothly from icon to icon
    const f = d >= REACH ? 0 : (1 + Math.cos(Math.PI * d / REACH)) / 2;
    l.a.style.setProperty('--dock', f < .01 ? '0' : f.toFixed(3));
    // The label moves in whole device pixels: text between pixels is drawn blurred (Chrome on Windows)
    l.a.style.setProperty('--dock-x', Math.round(f * 3 * devicePixelRatio) / devicePixelRatio + 'px');
  }
}
function settle() {
  cancelAnimationFrame(frame); frame = 0;
  document.querySelectorAll<HTMLElement>('.side .nav a').forEach(a => { a.style.removeProperty('--dock'); a.style.removeProperty('--dock-x'); });
  links = null;
}

function bindDock() {
  const side = document.querySelector<HTMLElement>('.side');
  if (!side) return;
  side.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || !allowed()) return;
    // The links are redrawn on every page change, so measure again if the ones we have are gone
    if (!links || stale || !links[0] || !links[0].a.isConnected) measure(side);
    py = e.clientY;
    if (!frame) frame = requestAnimationFrame(paint);
  });
  side.addEventListener('pointerleave', settle);
  // Opening a page redraws the links under a still pointer: carry the swell over so the icon doesn't snap back
  const redrawn = new MutationObserver(() => { if (links) { measure(side); paint(); } });
  side.querySelectorAll('.nav').forEach(n => redrawn.observe(n, { childList: true }));
  side.addEventListener('scroll', () => { stale = true; }, { passive: true });
  // Collapsing or expanding the sidebar moves every icon
  window.addEventListener('resize', () => { stale = true; });
}
bindDock();

/* Collapsed sidebar: each icon's name in a label beside it, on hover or keyboard focus. The label is fixed to the page
   (the sidebar clips anything that pokes out of it) and replaces the browser's own slower title tooltip. */
let tip: HTMLElement | null = null, tipFor: HTMLElement | null = null;
const ITEM = '.nav a, .side-search, .side-tg, .foot .toggles button';
function tipText(a: HTMLElement) {
  return (a.querySelector(':scope > span')?.textContent || a.getAttribute('aria-label') || a.dataset.title || a.title || '').trim();
}
function showTip(a: HTMLElement) {
  if (!document.documentElement.classList.contains('side-mini')) return;
  const text = tipText(a); if (!text) return;
  if (a.title) { a.dataset.title = a.title; a.removeAttribute('title'); }      // (one label, not two)
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip side-tip'; tip.setAttribute('role', 'tooltip'); tip.id = 'sideTip'; document.body.appendChild(tip); }
  tip.textContent = text; tipFor = a; a.setAttribute('aria-describedby', 'sideTip');
  const r = a.getBoundingClientRect(), side = a.closest('.side')!.getBoundingClientRect();
  tip.style.left = Math.round(side.right + 10) + 'px';
  tip.style.top = Math.round(r.top + r.height / 2 - tip.offsetHeight / 2) + 'px';
  tip.classList.add('on');
}
function hideTip() {
  if (tipFor) { if (!tipFor.title && tipFor.dataset.title) tipFor.title = tipFor.dataset.title; delete tipFor.dataset.title; tipFor.removeAttribute('aria-describedby'); }
  tipFor = null; if (tip) tip.classList.remove('on');
}
function bindTips() {
  const side = document.querySelector<HTMLElement>('.side');
  if (!side) return;
  const pick = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>(ITEM) || null;
  side.addEventListener('pointerover', e => { if ((e as PointerEvent).pointerType === 'touch') return; const a = pick(e); if (a !== tipFor) { hideTip(); if (a) showTip(a); } });
  side.addEventListener('pointerleave', hideTip);
  side.addEventListener('focusin', e => { const a = pick(e); if (a && a.matches(':focus-visible')) { hideTip(); showTip(a); } });
  side.addEventListener('focusout', hideTip);
  side.addEventListener('click', hideTip);
  side.addEventListener('scroll', hideTip, { passive: true });
}
bindTips();

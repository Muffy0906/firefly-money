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

import { el } from '../core/base';

/* =====================================================================
   Pinned page head: each page's title row (title, month, Today, All time,
   Customize, + New…) is position: sticky in money.css. This marks when it
   has reached the top (html.head-pinned shows the soft blur that fades the
   content out behind it), and shares its height as --head-h so the sticky
   day headings on Transactions and the bulk bar sit just below it.
   A head too tall to pin (many rows of buttons on a narrow phone) scrolls
   away as before (html.pinhead is off).
   ===================================================================== */
const root = document.documentElement;
let head: HTMLElement | null = null, tick = false;
const ro = new ResizeObserver(measure);

function measure() {
  const h = head && head.isConnected ? head.offsetHeight : 0;
  const ok = h > 0 && h <= innerHeight * .3;
  root.classList.toggle('pinhead', ok);
  if (ok) root.style.setProperty('--head-h', h + 'px'); else root.style.removeProperty('--head-h');
  pinned();
}
function pinned() {
  tick = false;
  let on = false;
  if (head && root.classList.contains('pinhead') && scrollY > 1) {
    const top = parseFloat(getComputedStyle(head).top) || 0;
    on = head.getBoundingClientRect().top <= top + 1;
  }
  root.classList.toggle('head-pinned', on);
}
function find() {
  const h = document.querySelector<HTMLElement>('#view > .head');
  if (h === head) return;
  if (head) ro.unobserve(head);
  head = h;
  if (head) ro.observe(head);
  measure();
}
new MutationObserver(find).observe(el('view'), { childList: true });
addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(pinned); } }, { passive: true });
addEventListener('resize', measure);
find();

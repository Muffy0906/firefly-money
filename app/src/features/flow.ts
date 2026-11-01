/* Justified card layouts. A `.flow` box lays its cards out in as many columns as fit (each at least data-min px wide,
   360 by default), and the columns share the width evenly, so they stretch or shrink a little to fill the row instead of
   leaving a gap at the right, like justified text. Each card goes under whichever column is shortest so far (masonry),
   so a tall card doesn't leave holes beside it. A card with the class `full` spans every column and starts a new band.
   With room for only one column (a phone) nothing is set and the box is a plain stack (see .flow in money.css).
   The box is a grid of 1px rows: each card gets its column and a row span of its height plus the gap. */
const seen = new WeakSet<Element>();
const ro = 'ResizeObserver' in window ? new ResizeObserver(es => { const bs = new Set<HTMLElement>(); es.forEach(e => { const b = (e.target as HTMLElement).classList.contains('flow') ? e.target : e.target.parentElement; if (b) bs.add(b as HTMLElement); }); bs.forEach(queue); }) : null;
const pending = new Set<HTMLElement>();
let raf = 0;
function queue(b: HTMLElement) { pending.add(b); if (!raf) raf = requestAnimationFrame(() => { raf = 0; const bs = [...pending]; pending.clear(); bs.forEach(flow1); }); }

// How many columns: as many as fit at the minimum width, but no more than the widest band has cards for (a column
// with nothing in it is the gap we're getting rid of).
export function flowCols(width: number, min: number, gap: number, most: number) {
  return Math.max(1, Math.min(Math.floor((width + gap) / (min + gap)), Math.max(1, most)));
}
// Shortest column first, leftmost on a tie. Returns each card's column and top row (0-based, in px rows).
export function flowPlace(hs: { h: number, full?: boolean }[], n: number, gap: number) {
  const tops: number[] = Array.from({ length: n }, () => 0);
  return hs.map(({ h, full }) => {
    const span = Math.ceil(h) + gap;
    if (full) { const y = Math.max(...tops); tops.fill(y + span); return { c: -1, y, span }; }
    const c = tops.indexOf(Math.min(...tops)), y = tops[c]; tops[c] += span;
    return { c, y, span };
  });
}

function flow1(b: HTMLElement) {
  if (!b.isConnected) return;
  const kids = [...b.children].filter((k): k is HTMLElement => k instanceof HTMLElement && !k.hidden);
  const cs = getComputedStyle(b), gap = parseFloat(cs.columnGap) || 20, min = Number(b.dataset.min) || 360;
  let most = 0, run = 0;
  kids.forEach(k => { if (k.classList.contains('full')) run = 0; else most = Math.max(most, ++run); });
  const n = flowCols(b.clientWidth, min, gap, most);
  if (n === 1 || matchMedia('print').matches) {
    if (b.classList.contains('on')) { b.classList.remove('on'); b.style.removeProperty('--fc'); kids.forEach(k => { k.style.gridColumn = ''; k.style.gridRow = ''; }); }
    return;
  }
  b.classList.add('on'); b.style.setProperty('--fc', String(n));
  // Measure each card at the width it will have: one column, or all of them for a `full` one
  kids.forEach(k => { k.style.gridColumn = k.classList.contains('full') ? '1 / -1' : ''; k.style.gridRow = ''; });
  const hs = kids.map(k => { const m = getComputedStyle(k); return { h: k.getBoundingClientRect().height + (parseFloat(m.marginTop) || 0) + (parseFloat(m.marginBottom) || 0), full: k.classList.contains('full') }; });
  flowPlace(hs, n, gap).forEach((p, i) => {
    const k = kids[i];
    k.style.gridColumn = p.c < 0 ? '1 / -1' : String(p.c + 1);
    k.style.gridRow = (p.y + 1) + ' / span ' + p.span;
  });
}
// After each paint: lay out every .flow on the page and keep it laid out as the page or a card changes size
export function bindFlow() {
  document.querySelectorAll<HTMLElement>('#view .flow').forEach(b => {
    flow1(b);
    if (!ro) return;
    if (!seen.has(b)) { seen.add(b); ro.observe(b); }
    [...b.children].forEach(k => { if (!seen.has(k)) { seen.add(k); ro.observe(k); } });
  });
}

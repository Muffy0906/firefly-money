import { el } from '../core/base';
import { closeDrawer } from '../core/dom';
import { escape } from '../core/html';

/* ---------- Accessibility glue: current page/tab marked for screen readers, keyboard on clickable rows, skip link, Menu sheet ---------- */

// The highlighted nav item / tab / segmented button is also announced: .on becomes aria-current, and a segmented
// button gets aria-pressed. Done in one place, after the markup changes, so no page has to remember it.
let queued = false;
export function syncCurrent() {
  queued = false;
  document.querySelectorAll<HTMLElement>('.nav a, .tabbar a, .tabs a').forEach(a => {
    if (a.classList.contains('on')) { if (a.getAttribute('aria-current') !== 'page') a.setAttribute('aria-current', 'page'); }
    else if (a.hasAttribute('aria-current')) a.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLElement>('.seg button').forEach(b => {
    if (b.hasAttribute('role') || b.hasAttribute('aria-haspopup')) return;
    const v = b.classList.contains('on') ? 'true' : 'false'; if (b.getAttribute('aria-pressed') !== v) b.setAttribute('aria-pressed', v);
  });
}
const queue = () => { if (!queued) { queued = true; requestAnimationFrame(syncCurrent); } };
new MutationObserver(queue).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
queue();

// A focused clickable table row (accounts, recurring…) opens with Enter or Space, like a button. (Transaction rows
// have their own handler in keyboard.ts, because they open the edit drawer.)
document.addEventListener('keydown', e => {
  const t = e.target;
  if (!(t instanceof HTMLElement) || !t.matches('tr.click[tabindex]:not([data-gid])') || (e.key !== 'Enter' && e.key !== ' ') || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault(); t.click();
});

// The category and budget pills in a transaction row are buttons of their own: Enter or Space on one changes it and doesn't open the row
document.addEventListener('keydown', e => {
  const t = e.target;
  if (!(t instanceof HTMLElement) || !t.matches('.tbl.feed .inl') || (e.key !== 'Enter' && e.key !== ' ') || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault(); e.stopImmediatePropagation(); t.click();
}, true);

// Back from a page the Menu sheet linked to must not leave the sheet open on top of the previous page
addEventListener('hashchange', () => {
  const d = el('drawer');
  if (d.classList.contains('open') && d.querySelector('.sheet-search')) closeDrawer();
});

// Skip link: jump past the sidebar to the page. (A plain #view link would be read as a route by the router.)
document.addEventListener('click', e => {
  const a = e.target instanceof Element ? e.target.closest('a.skip') : null; if (!a) return;
  e.preventDefault(); el('view').focus({ preventScroll: false });
});

// Required-field errors: a message beside the field, in the app's language and style, instead of the browser's own
// bubble (one field at a time, in the browser's language). The first bad field takes focus; typing clears its message.
let firstBad: HTMLElement | null = null;
document.addEventListener('invalid', e => {
  const f = e.target;
  if (!(f instanceof HTMLInputElement || f instanceof HTMLSelectElement || f instanceof HTMLTextAreaElement) || !f.closest('#drawer')) return;
  e.preventDefault();
  const label = f.closest('label') || f.parentElement; if (!label) return;
  let m = label.querySelector<HTMLElement>(':scope > .field-err');
  if (!m) { m = document.createElement('span'); m.className = 'field-err'; m.id = 'err' + Math.random().toString(36).slice(2, 8); m.setAttribute('role', 'alert'); label.appendChild(m); }
  m.textContent = f.validity.valueMissing ? (f instanceof HTMLSelectElement ? 'Choose one' : 'Required') : 'Enter a valid value';
  f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', m.id);
  if (!firstBad) { firstBad = f; setTimeout(() => { firstBad?.focus(); firstBad = null; }, 0); }
}, true);      // capture: invalid doesn't bubble
const clearBad = (e: Event) => {
  const f = e.target; if (!(f instanceof HTMLElement) || f.getAttribute('aria-invalid') !== 'true') return;
  f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); f.closest('label')?.querySelector(':scope > .field-err')?.remove();
};
document.addEventListener('input', clearBad); document.addEventListener('change', clearBad);

// Charts are drawn for the pointer: each bar or point shows its amount on hover (data-tip). The same text is offered as a
// table under the chart ("Show as table", like the income flow already has), so a keyboard or screen reader user gets the
// numbers too. Charts with more than 60 points (the activity grid) keep their summary label instead.
function chartTables() {
  document.querySelectorAll<SVGSVGElement>('#view svg[role="img"][aria-label]').forEach(svg => {
    // A donut or ring is a grid centred on its own box, so the table goes after the whole chart (and its list), never inside it: a row in there pushes the ring up and its centre text down.
    const at: Element = svg.closest('.share, .donut, .ring') || svg;
    if (at.nextElementSibling?.classList.contains('chart-data') || svg.closest('.sk-table, .tile-preview, .mini')) return;
    const tips = [...svg.querySelectorAll<SVGElement>('[data-tip]')].map(n => n.getAttribute('data-tip') || '').filter(Boolean);
    if (tips.length < 2 || tips.length > 60) return;
    const rows = tips.map(t => {
      const lines = t.split('\n'); let label = lines[0], rest = lines.slice(1).join(' · ');
      if (!rest && label.includes(' · ')) { const i = label.indexOf(' · '); rest = label.slice(i + 3); label = label.slice(0, i); }
      return '<tr><th scope="row"></th><td></td></tr>'.replace('<th scope="row"></th>', '<th scope="row">' + escape(label) + '</th>').replace('<td></td>', '<td>' + escape(rest) + '</td>');
    });
    const d = document.createElement('details'); d.className = 'sk-table chart-data';
    d.innerHTML = '<summary>Show as table</summary><table class="tbl"><thead><tr><th scope="col">Point</th><th scope="col">Value</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    at.insertAdjacentElement('afterend', d);
  });
}
let ctQueued = false;
const view0 = document.getElementById('view');
// Added in the same frame as the chart (a microtask, before the browser paints), so the card doesn't grow once it is on screen
if (view0) new MutationObserver(() => { if (!ctQueued) { ctQueued = true; queueMicrotask(() => { ctQueued = false; chartTables(); }); } }).observe(view0, { childList: true, subtree: true });

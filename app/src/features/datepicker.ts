import { Html, html, htmlList } from '../core/html';
import { el, isoDate, todayIso } from '../core/base';
import { ICON_NEXT, ICON_PREV } from '../core/dom';

/* ---------- Date picker ---------- */
let calInput: HTMLInputElement | null = null, calView = { y: 0, m: 0 };
function openCal(input: HTMLInputElement) {
  calInput = input;
  const v = input.value || todayIso(), d = new Date(v + 'T12:00:00');
  calView = { y: d.getFullYear(), m: d.getMonth() };
  drawCal();
  const box = el('calpop'), r = input.getBoundingClientRect();
  box.hidden = false;
  const top = r.bottom + 6 + box.offsetHeight > innerHeight ? r.top - box.offsetHeight - 6 : r.bottom + 6;
  box.style.top = Math.max(8, top) + 'px'; box.style.left = Math.min(innerWidth - box.offsetWidth - 8, Math.max(8, r.left)) + 'px';
}
function drawCal() {
  const { y, m } = calView, first = new Date(y, m, 1), startDow = (first.getDay() + 6) % 7;
  const input = calInput!, sel = input.value, tIso = todayIso();
  let cells: Html | string = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - startDow + i, 12), iso = isoDate(d);
    if (i >= 35 && d.getMonth() !== m) break;
    cells = html`${cells}<button type="button" class="d${d.getMonth() !== m ? ' out' : ''}${iso === tIso ? ' today' : ''}${iso === sel ? ' sel' : ''}" data-d="${iso}">${d.getDate()}</button>`;
  }
  el('calpop').innerHTML = String(html`<div class="ch"><button type="button" data-nav="-1" aria-label="Previous month">${ICON_PREV}</button><span>${first.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span><button type="button" data-nav="1" aria-label="Next month">${ICON_NEXT}</button></div><div class="grid7">${htmlList(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(x => html`<span class="dow">${x}</span>`))}${cells}</div><div class="cf"><button type="button" class="link" data-d="${tIso}">Today</button>${input.required ? '' : html`<button type="button" class="link" data-d="">Clear</button>`}</div>`);
}
function closeCal() { el('calpop').hidden = true; calInput = null; }
el('calpop').addEventListener('mousedown', e => e.preventDefault());
el('calpop').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || !calInput) return;
  if (b.dataset.nav) { calView.m += +b.dataset.nav; const d = new Date(calView.y, calView.m, 1); calView = { y: d.getFullYear(), m: d.getMonth() }; drawCal(); return; }
  if (b.dataset.d !== undefined) {
    calInput.value = b.dataset.d;
    calInput.dispatchEvent(new Event('input', { bubbles: true })); calInput.dispatchEvent(new Event('change', { bubbles: true }));
    closeCal();
  }
});
document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (t && t.matches && t.matches('input[type=date]') && !('ontouchstart' in window)) {
    e.preventDefault();
    if (calInput === t && !el('calpop').hidden) closeCal(); else openCal(t as HTMLInputElement);
    return;
  }
  if (!el('calpop').hidden && !el('calpop').contains(t)) closeCal();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el('calpop').hidden) { e.stopPropagation(); closeCal(); } }, true);
window.addEventListener('scroll', () => { if (!el('calpop').hidden) closeCal(); }, true);

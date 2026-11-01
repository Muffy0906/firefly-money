import { html, htmlList } from '../core/html';
import { App, S, el } from '../core/base';
import type { RouteInfo } from '../core/router';
import { openDrawer } from '../core/dom';
import { selChanged } from './bulk';
import { fitSankey } from './charts';
import { bindFlow } from './flow';
import { bindDash } from './dashboard';
import { bindFeed } from './gestures';
import { pick } from './picker';
import { reduceMotion, typing } from './polish';
import { drawToggles, togglePrivacy, toggleSide } from './prefs';
import { editTx } from './txform';

/* ---------- Keyboard: j/k to move, Enter to open, c/b to recategorize, x to select, p for privacy, ? for help ---------- */
function kRows() { return [...document.querySelectorAll<HTMLElement>('#view tr[data-gid]')]; }
function kMark(i: number) {
  const rows = kRows(); if (!rows.length) return;
  S.kIdx = Math.max(0, Math.min(rows.length - 1, i));
  rows.forEach((r, j) => r.classList.toggle('kfocus', j === S.kIdx));
  rows[S.kIdx].scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
}
document.addEventListener('keydown', e => {
  if (el('app').hidden || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (el('drawer').classList.contains('open') || !el('palette').hidden || el<HTMLDialogElement>('confirm').open || !el('pickpop').hidden) return;
  const k = e.key;
  if (k === 'p' || k === 'P') { e.preventDefault(); return togglePrivacy(); }
  if (k === '?') { e.preventDefault(); return shortcutsSheet(); }
  if (k === '[') { e.preventDefault(); return toggleSide(); }
  if (k === 'j' || k === 'ArrowDown' && (S.kIdx ?? -1) >= 0) { e.preventDefault(); return kMark((S.kIdx ?? -1) + 1); }
  if (k === 'k' || k === 'ArrowUp' && (S.kIdx ?? -1) >= 0) { e.preventDefault(); return kMark(Math.max(0, (S.kIdx ?? 0) - 1)); }
  const i = S.kIdx ?? -1, tr = i >= 0 && kRows()[i]; if (!tr) return;
  if (k === 'Enter' || k === 'o') { e.preventDefault(); editTx(tr.dataset.gid!); }
  else if (k === 'c' || k === 'b') { const n = [...tr.querySelectorAll<HTMLElement>('[data-k="' + (k === 'c' ? 'category' : 'budget') + '"]')].find(x => x.offsetParent !== null); if (n) { e.preventDefault(); pick(n); } }
  else if (k === 'x') { const cb = tr.querySelector<HTMLInputElement>('input[data-sel]'); if (cb) { cb.checked = !cb.checked; selChanged(); } }
  else if (k === 'Escape') { S.kIdx = -1; kRows().forEach(r => r.classList.remove('kfocus')); }
});
function shortcutsSheet() {
  const rows = [['N', 'New transaction'], ['⌘/Ctrl K', 'Search everything'], ['/', 'Search transactions'], ['J / K', 'Next / previous transaction'], ['Enter', 'Open the selected transaction'],
    ['C', 'Change its category'], ['B', 'Change its budget'], ['X', 'Select it for bulk edit'], ['P', 'Hide or show amounts'], ['[', 'Collapse or expand the sidebar'], ['Esc', 'Close / clear']];
  openDrawer('Keyboard shortcuts', html`<div class="list">${htmlList(rows.map(([a, b]) => html`<div class="row"><span class="name">${b}</span><kbd>${a}</kbd></div>`))}</div>`);
}

/* ---------- After each page paint ---------- */
function afterPaint2(r: RouteInfo) {
  bindFeed(); bindDash(); drawToggles(); fitSankey(); bindFlow();
  S.kIdx = -1;
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  afterPaint2,
  shortcutsSheet,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

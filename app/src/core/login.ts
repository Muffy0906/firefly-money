import { html, htmlList } from './html';
import { AuthError, CACHE, PAGES, PDB, api } from './api';
import { migrateSavedPassword, rememberedSignIn, showLogin, signIn, signOut } from './auth';
import { App, S, el, nowMonth } from './base';
import { closeDrawer, vt } from './dom';
import { lists } from './lists';
import { hashWith, route } from './router';
import { applyCustom } from './themevars';
import { blankSplit, collectTx, newTx, renderTxForm } from '../features/txform';

/* ================= Login / boot ================= */
function showApp() { S.lastRefresh = S.lastRefresh || Date.now(); el('login').hidden = true; el('app').hidden = false; el('fab').hidden = false; route(); if (App.syncPrefs) App.syncPrefs(); }
el('loginForm').onsubmit = async ev => {
  ev.preventDefault();
  const btn = (ev.target as HTMLElement).querySelector<HTMLButtonElement>('button[type=submit]')!;
  btn.disabled = true;
  try { await signIn(el<HTMLInputElement>('loginPw').value, el<HTMLInputElement>('loginRemember').checked); el<HTMLInputElement>('loginPw').value = ''; showApp(); }
  catch (e) { el('loginErr').hidden = false; el('loginErr').textContent = (e as Error).message; }
  finally { btn.disabled = false; }
};
export const THEMES = [
  ['auto', 'Calm (follows your system)', 'linear-gradient(135deg,#f6f5f1 50%,#1d1e1b 50%)'],
  ['light', 'Calm light', '#f6f5f1'], ['dark', 'Calm dark', '#1d1e1b'],
  ['carbon', 'Carbon neon', 'linear-gradient(135deg,#1f1f23 45%,#39ff9f 45%,#19e3ff)'],
  ['midnight', 'Midnight', 'linear-gradient(135deg,#7c5cff,#38bdf8)'], ['neon', 'Neon', 'linear-gradient(135deg,#ff2e97,#00e0ff)'],
  ['glass', 'Liquid glass neon', 'radial-gradient(circle at 30% 30%,#ffffffcc 0 12%,transparent 13%),linear-gradient(135deg,#37f5ff,#b86bff 50%,#ff4fd8)'],
  ['frosted', 'Frosted glass', 'radial-gradient(circle at 30% 30%,#ffffffd9 0 14%,transparent 15%),linear-gradient(135deg,#efe4d6,#b98a64 55%,#e2552c)'],
  ['ocean', 'Ocean', 'linear-gradient(135deg,#14b8a6,#3b9eff)'], ['sunrise', 'Sunrise', 'linear-gradient(135deg,#e8452c,#f59e0b)'],
  ['forest', 'Forest', 'linear-gradient(135deg,#15211b 45%,#6fcf97 45%,#f2c94c)'], ['nord', 'Nord', 'linear-gradient(135deg,#2e3440 45%,#88c0d0 45%,#b48ead)'],
  ['rose', 'Rosé', 'linear-gradient(135deg,#d6456e,#9b6bdf)'],
];
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'auto'; }
// border-box origin: otherwise the gradient tiles under the 2px border and a sliver of the opposite colour shows at the edge
export function themeButtons() {
  return htmlList(THEMES.map(([k, label, sw]) => html`<button type="button" title="${label}" aria-label="${label} theme" class="${k === currentTheme() ? 'on' : ''}" style="background:${sw};background-origin:border-box" data-onclick="App.setTheme('${k}')"></button>`));
}
// The theme picker on the Settings page
function drawThemes() { document.querySelectorAll('.themes').forEach(t => { t.innerHTML = String(themeButtons()); }); }
export function setTheme(k: string) {
  if (k === currentTheme()) return;
  const apply = () => {
    if (k === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', k);
    applyCustom(k);
    drawThemes();
    // a Settings page kept for going back would still show the old theme's picker
    [...PAGES.keys()].forEach(p => { if (p.startsWith('settings/')) PAGES.delete(p); });
    if (App.drawThemeCustom) App.drawThemeCustom();
  };
  try { localStorage.setItem('moneyTheme', k); } catch (e) { /* storage blocked */ }
  const t = vt('theme', apply);
  if (t) {           // reveal the new theme as a circle growing from where you tapped
    const x = S.lastPtr ? S.lastPtr.x : innerWidth / 2, y = S.lastPtr ? S.lastPtr.y : innerHeight / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    t.ready.then(() => document.documentElement.animate({ clipPath: ['circle(0 at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
      { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  }
}
document.addEventListener('pointerdown', e => { S.lastPtr = { x: e.clientX, y: e.clientY }; }, true);
// Remember which account name was clicked so it can morph into the next page's title
document.addEventListener('click', e => {
  const src = (e.target as HTMLElement).closest && (e.target as HTMLElement).closest('a[href^="#/account/"], tr[data-onclick*="#/account/"]');
  const node = src && src.querySelector('.name, .nm');
  S.vtFrom = node ? { node, t: Date.now() } : null;
}, true);
(function initFireflyLink() {
  const a = el('ffLink'), href = a.getAttribute('href') || '';
  if (!/^https?:\/\//.test(href)) a.hidden = true;
})();
window.addEventListener('hashchange', () => { const instant = S.tabNav; S.tabNav = false; if (!el('app').hidden) route({ nav: true, instant }); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && el('drawer').classList.contains('open') && !el<HTMLDialogElement>('confirm').open) closeDrawer(); });
(async function boot() {
  await migrateSavedPassword();
  S.remember = S.signedIn = rememberedSignIn();
  // Signed in before: show the data saved on this device right away, then refresh it in the background.
  if (S.remember) {
    try { (await PDB.loadAll()).forEach(([k, e]) => { if (e && e.t > Date.now() - 14 * 864e5 && !CACHE.has(k)) CACHE.set(k, e); }); } catch (e) { /* no saved data */ }
    if (CACHE.size) { S.bootStale = true; S.lastRefresh = Date.now(); showApp(); return; }
  }
  try { await api('/about'); S.signedIn = true; showApp(); }
  catch (e) { if (e instanceof AuthError) showLogin(S.remember ? 'Please sign in again.' : ''); else showApp(); }
})();

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  reload: route,
  newTx: async () => { await lists(); newTx(); },
  newTxFor: async (id: string) => { await lists(); newTx({ account: id }); },
  txType: (t: string) => { collectTx(); S.form.type = t; if (t === 'transfer' && !S.form.dst) S.form.src = S.form.main; renderTxForm(); },
  addSplit: () => { collectTx(); S.form.splits.push(blankSplit()); renderTxForm(); setTimeout(() => { const b = el('drawerBody'); b.scrollTop = b.scrollHeight; }, 60); },
  removeSplit: (i: number) => { collectTx(); S.form.splits.splice(i, 1); renderTxForm(); },
  search: (q: string) => { location.hash = hashWith({ search: q.trim(), page: '' }); },
  allTime: () => { S.all = true; route({ nav: true }); },
  // An account's range buttons; "Month" also leaves All time in the month selector
  pickRange: (h: string) => { if (h.includes('range=month')) S.all = false; if (location.hash === h) route(); else location.hash = h; },
  thisMonth: () => { if (S.all) { S.all = false; return route({ nav: true }); } const [y, m] = nowMonth(); S.vtDir = (S.y - y) * 12 + S.m - m > 0 ? 'prev' : 'next'; S.y = y; S.m = m; route(); },
  shiftMonth: (d: number) => { S.vtDir = d > 0 ? 'next' : 'prev'; S.m += d; const x = new Date(S.y, S.m, 1); S.y = x.getFullYear(); S.m = x.getMonth(); route({ nav: true }); },
  setTheme,
  signOut: () => { signOut(); showLogin(); },
  // Small steps that markup handlers used to write inline (see events.js)
  go: (h: string) => { location.hash = h; },
  submit: (id: string) => el<HTMLFormElement>(id).requestSubmit(),
  print: () => window.print(),
  removeRow: (b: HTMLElement) => b.closest('.editor-row')!.remove(),
  palBackdrop: (e: Event, box: HTMLElement) => { if (e.target === box) App.closePalette(); },
  enterClick: (e: KeyboardEvent, n: HTMLElement) => { if (e.key === 'Enter') n.click(); },
  nlKey: (e: KeyboardEvent, input: HTMLInputElement) => { if (e.key === 'Enter') { e.preventDefault(); App.nlParse(input.value, true); } },
  linkKey: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); App.findLink(); } },
  rulesSearch: (f: HTMLFormElement & { q: HTMLInputElement }) => { const q = f.q.value.trim(); location.hash = '#/rules' + (q ? '?q=' + encodeURIComponent(q) : ''); },
  reportsRange: (f: HTMLFormElement & { s: HTMLInputElement, e: HTMLInputElement }) => { location.hash = hashWith({ start: f.s.value, end: f.e.value, preset: '' }); },
  nativeSettings: () => window.webkit.messageHandlers.native.postMessage('settings'),
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module './base' { interface AppApi extends Methods {} }

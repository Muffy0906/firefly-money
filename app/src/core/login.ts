import { AuthError, PAGES, api, dropSavedCopies } from './api';
import { SIGN_OUT_FAILED, migrateSavedPassword, rememberedSignIn, showLogin, signIn, signOut } from './auth';
import { App, S, el, nowMonth } from './base';
import { closeDrawer, toast, vt } from './dom';
import { lists } from './lists';
import { hashWith, route } from './router';
import { applyCustom, currentTheme } from './themevars';
import { THEMES, themeButtons, rememberAccent } from './themepick';
import { blankSplit, collectTx, newTx, renderTxForm } from '../features/txform';

/* ================= Login / boot ================= */
function showApp() { S.lastRefresh = S.lastRefresh || Date.now(); el('login').hidden = true; el('app').hidden = false; el('fab').hidden = false; route(); if (App.syncPrefs) App.syncPrefs(); if (App.whatsNew) App.whatsNew(); if (App.startedInit) App.startedInit(); }
el('loginForm').onsubmit = async ev => {
  ev.preventDefault();
  const btn = (ev.target as HTMLElement).querySelector<HTMLButtonElement>('button[type=submit]')!;
  btn.disabled = true;
  try { await signIn(el<HTMLInputElement>('loginPw').value, el<HTMLInputElement>('loginRemember').checked); el<HTMLInputElement>('loginPw').value = ''; showApp(); }
  catch (e) { el('loginErr').hidden = false; el('loginErr').textContent = (e as Error).message; }
  finally { btn.disabled = false; }
};
export { THEMES, themeButtons };
// The theme picker on the Settings page (the focus goes back to the chosen theme after it's redrawn)
function drawThemes() {
  document.querySelectorAll('.tpick').forEach(t => {
    const had = t.contains(document.activeElement);
    t.outerHTML = String(themeButtons());
    if (had) document.querySelector<HTMLElement>('.tpick .tp.on')?.focus();
  });
}
export function setTheme(k: string) {
  if (k === currentTheme()) return;
  rememberAccent(currentTheme()); rememberAccent(k);
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
document.addEventListener('keydown', e => { if (e.key === 'Escape' && el('drawer').classList.contains('open') && !el<HTMLDialogElement>('confirm').open) { e.preventDefault(); App.closeDrawerAsk ? App.closeDrawerAsk() : closeDrawer(); } });
(async function boot() {
  await migrateSavedPassword();
  S.remember = rememberedSignIn(); S.signedIn = false;      // the saved flag only says how long to stay in: the server says whether you are
  dropSavedCopies();      // left by versions that kept a copy of your data on the device
  try { await api('/about'); S.signedIn = true; showApp(); }
  catch (e) { if (e instanceof AuthError) showLogin(S.remember ? 'Please sign in again.' : ''); else { showApp(); addEventListener('online', () => { api('/about', { fresh: true }).then(() => { S.signedIn = true; }, () => {}); }, { once: true }); } }
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
  signOut: async () => { if (await signOut()) showLogin(); else toast(SIGN_OUT_FAILED); },
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

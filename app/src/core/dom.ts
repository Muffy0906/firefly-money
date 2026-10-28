import { type Html, html, htmlList } from './html';
import { App, S, type State, el, fmtDate, fmtDay, monthRange, nowMonth } from './base';
import { BUZZ_DELETE, buzz } from './haptics';

/* ================= UI plumbing ================= */
const ICONS: Record<string, Html> = {
  overview: html`<path d="M3 12l9-8 9 8M5 10v10h14V10"/>`,
  transactions: html`<path d="M4 7h13M13 3l4 4-4 4M20 17H7M11 13l-4 4 4 4"/>`,
  accounts: html`<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>`,
  budgets: html`<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 5"/>`,
  categories: html`<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>`,
  bills: html`<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>`,
  forecast: html`<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>`,
  inbox: html`<path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>`,
  loans: html`<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  recurring: html`<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>`,
  rules: html`<path d="M4 6h10M4 12h16M4 18h7M17 4v4M11 16v4"/>`,
  map: html`<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>`,
  recap: html`<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M8 15l2.5 2.5L16 12"/>`,
  review: html`<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>`,
  reports: html`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
  settings: html`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`,
  piggy: html`<path d="M5 11a7 6 0 0 1 13-2h2v4l-2 1-1 4h-3v-2h-4v2H7l-1-4a5 5 0 0 1-1-3z"/><circle cx="15" cy="11" r=".6"/>`,
  search: html`<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>`,
  year: html`<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 11.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>`,
  spark: html`<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>`,
  eye: html`<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  eyeoff: html`<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>`,
  density: html`<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>`,
};
export const icon = (k: string) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
export const NAV = [['', 'Overview', 'overview'], ['forecast', 'Forecast', 'forecast'], ['transactions', 'Transactions', 'transactions'], ['review', 'To do', 'review'],
  ['accounts', 'Accounts', 'accounts'], ['loans', 'Loan planner', 'loans'],
  ['budgets', 'Budgets', 'budgets'], ['categories', 'Categories & tags', 'categories'], ['bills', 'Bills', 'bills'], ['recurring', 'Recurring', 'recurring'],
  ['piggy', 'Piggy banks', 'piggy'], ['rules', 'Rules', 'rules'], ['recap', 'Monthly recap', 'recap'], ['year', 'Year in Money', 'year'], ['ask', 'Ask', 'spark'], ['map', 'Map', 'map'], ['reports', 'Reports', 'reports'], ['settings', 'Settings', 'settings']];
// How the sidebar and the phone's More menu group the pages (Settings sits at the bottom of the sidebar)
export const NAV_GROUPS: [string, string[]][] = [['', ['', 'transactions', 'review']],
  ['Plan', ['budgets', 'bills', 'recurring', 'piggy', 'forecast', 'loans']], ['Insights', ['reports', 'recap', 'year', 'ask', 'map']],
  ['Manage', ['accounts', 'categories', 'rules']]];
export const navItem = (r: string) => NAV.find(n => n[0] === r)!;
// To do: Review (new transactions to look over) and Categorize (ones without a category), as two tabs of one page
export const todoTabs = (on: string) => html`<div class="tabs"><a href="#/review" class="${on === 'review' ? 'on' : ''}">Review new</a><a href="#/inbox" class="${on === 'inbox' ? 'on' : ''}">Categorize</a></div>`;
export function drawNav(active: string) {
  const a = (r: string) => { const [, label, ic] = navItem(r); return html`<a href="#/${r}" class="${r === active ? 'on' : ''}" title="${label}" data-onmouseenter="App.prefetch('${r}')">${icon(ic)}<span>${label}</span></a>`; };
  el('nav').innerHTML = String(htmlList(NAV_GROUPS.map(([title, rs]) => html`${title ? html`<div class="nav-h">${title}</div>` : ''}${htmlList(rs.map(a))}`)));
  el('navFoot').innerHTML = String(a('settings'));
  if (window.App && App.drawTabbar) App.drawTabbar(active);
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  const t = el('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
export function confirmBox(title: string, text: string, okLabel = 'Delete') {
  return new Promise<boolean>(res => {
    const d = el<HTMLDialogElement>('confirm');
    d.innerHTML = String(html`<h3>${title}</h3><p>${text}</p><div class="btns"><button class="btn" value="no">Cancel</button><button class="btn primary" value="yes">${okLabel}</button></div>`);
    d.querySelectorAll('button').forEach(b => b.onclick = () => { if (b.value === 'yes') buzz(BUZZ_DELETE); d.close(); res(b.value === 'yes'); });
    d.oncancel = () => res(false);
    d.showModal();
  });
}

/* ---------- View Transitions (animated morphs between states) ---------- */
export const VT_OK = !!document.startViewTransition && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// Run a DOM update inside a view transition. kind sets a class on <html> so CSS can pick the animation.
export function vt(kind: string, update: () => void, setup?: () => void) {
  if (!VT_OK || document.hidden) { update(); return null; }
  const root = document.documentElement;
  if (S.vtRun) { try { S.vtRun.skipTransition(); } catch (e) { /* already done */ } }
  root.classList.add('vt-' + kind);
  if (setup) setup();
  let t: ViewTransition & { kind?: string };
  try { t = document.startViewTransition(update); } catch (e) { root.classList.remove('vt-' + kind); update(); return null; }
  S.vtRun = t;
  // The browser may skip or abort a transition (a newer one starts, the viewport or scrollbar changes size...).
  // The DOM update still happens, so that's expected, not an error. A real error in the update itself still surfaces.
  const quiet = () => {};
  t.ready.catch(quiet);
  t.updateCallbackDone.catch(e => { if (!(e instanceof DOMException)) setTimeout(() => { throw e; }); });
  t.finished.catch(quiet).then(() => { root.classList.remove('vt-' + kind); if (S.vtRun === t) S.vtRun = null; document.querySelectorAll<HTMLElement>('[data-vtn]').forEach(n => { n.style.viewTransitionName = ''; delete n.dataset.vtn; }); });
  return t;
}
export const vtName = (node: Element | null | undefined, name: string) => { if (node) { const n = node as HTMLElement; n.style.viewTransitionName = name; n.dataset.vtn = '1'; } };
// Drawer header "hero": the transaction's avatar, payee and amount, so the row can morph into it
function drawerHeroHtml(h: NonNullable<State['drawerHero']>) {
  return html`<div class="dhero" data-id="${h.id}">${h.av}<div class="dh-txt"><div class="eyebrow">${h.kicker}</div><h2>${h.name}</h2><div class="sub-s num">${h.amount} · ${fmtDate(h.date)}</div></div></div>`;
}
export function openDrawer(title: string, bodyHtml: Html | string, footHtml?: Html | string) {
  const d = el('drawer'), wasOpen = d.classList.contains('open');
  S.drawerTok = (S.drawerTok || 0) + 1;
  let h = S.drawerHero;
  if (h && !(title === 'Loading…' || title === 'Transaction' || (S.form && S.form.id === h.id))) h = S.drawerHero = null;
  const keep = h && wasOpen && d.querySelector('.dhero[data-id="' + h.id + '"]');
  if (keep) {       // same transaction: keep the header node (it may be mid-animation) and swap the rest
    if (title !== 'Loading…') keep.querySelector('.eyebrow')!.textContent = title;
    d.querySelectorAll(':scope > .body, :scope > footer').forEach(n => n.remove());
    d.insertAdjacentHTML('beforeend', String(html`<div class="body" id="drawerBody">${bodyHtml}</div>${footHtml ? html`<footer>${footHtml}</footer>` : ''}`));
    return;
  }
  d.innerHTML = String(html`<div class="grab" aria-hidden="true"></div><header>${h ? drawerHeroHtml({ ...h, kicker: title === 'Loading…' ? h.kicker : title }) : html`<h2>${title}</h2>`}<button class="round" type="button" data-onclick="App.closeDrawer()" aria-label="Close">×</button></header><div class="body" id="drawerBody">${bodyHtml}</div>${footHtml ? html`<footer>${footHtml}</footer>` : ''}`);
  if (!wasOpen) S.drawerReturn = document.activeElement as HTMLElement | null;
  d.setAttribute('aria-label', String(title === 'Loading…' && h ? h.name : title));
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); el('scrim').classList.add('open');
  if (!wasOpen) setTimeout(() => { const f = d.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([type=date]), select'); if (f && innerWidth > 900) f.focus(); }, 280);
}
export function closeDrawer() {
  const d = el('drawer'), h = S.drawerHero;
  S.form = null; S.drawerHero = null;
  const row = h && d.classList.contains('open') && VT_OK && document.querySelector<HTMLElement>('#view tr[data-gid="' + h.id + '"] .av');
  const my = S.drawerTok = (S.drawerTok || 0) + 1;
  const shut = () => {
    if (S.drawerTok !== my) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); el('scrim').classList.remove('open');
    const back = S.drawerReturn; S.drawerReturn = null;
    if (back && back.isConnected && back.focus && d.contains(document.activeElement)) back.focus({ preventScroll: true });
  };
  if (!row) return shut();
  // Morph the drawer's avatar back into its row while the drawer slides away
  vt('drawer-close', () => { const dav = d.querySelector<HTMLElement>('.dhero .av'); if (dav) dav.style.viewTransitionName = ''; shut(); vtName(row, 'txav'); },
    () => vtName(d.querySelector('.dhero .av'), 'txav'));
}
export function formError(msg: string) {
  const b = el('drawerBody'); if (!b) return toast(msg);
  let e = b.querySelector('.form-err');
  if (!e) { e = document.createElement('div'); e.className = 'form-err'; b.prepend(e); }
  e.textContent = msg; b.scrollTop = 0;
}
export function monthNav() {
  if (S.all) return html`<div class="month"><span>All time</span><button class="btn small" style="margin-left:6px" data-onclick="App.thisMonth()">By month</button></div>`;
  const r = monthRange(S.y, S.m), [ny, nm] = nowMonth();
  const ahead = (S.y - ny) * 12 + (S.m - nm);
  const isNow = ahead >= 12;   // allow planning up to a year ahead
  return html`<div class="month"><button class="round" data-onclick="App.shiftMonth(-1)" aria-label="Previous month">‹</button><span title="${fmtDate(r.start)} – ${fmtDate(r.end)}">${r.label}${r.start.endsWith('-01') ? '' : html`<small class="cycle">${fmtDay(r.start)} – ${fmtDay(r.end)}</small>`}</span><button class="round" data-onclick="App.shiftMonth(1)" aria-label="Next month"${isNow ? ' disabled' : ''}>›</button>${ahead !== 0 ? html`<button class="btn small" style="margin-left:6px" data-onclick="App.thisMonth()">Today</button>` : ''}<button class="btn small" style="margin-left:6px" data-onclick="App.allTime()">All time</button></div>`;
}
export function head(title: string | Html, sub: string | Html, actions?: string | Html) {
  return html`<div class="head"><div><h1>${title}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div><div class="actions">${actions || ''}</div></div>`;
}
export const opt = (v: string | number, label: string | number, sel: unknown) => html`<option value="${v}"${String(v) === String(sel) ? ' selected' : ''}>${label}</option>`;

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  closeDrawer,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module './base' { interface AppApi extends Methods {} }

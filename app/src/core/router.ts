import { type Html, html, htmlList } from './html';
import { type ApiError, AuthError, CACHE, INFLIGHT, PAGES, PDB } from './api';
import { showLogin } from './auth';
import { App, S, type State, el, monthOf, setToday, today } from './base';
import { VT_OK, drawNav, toast, vt, vtName } from './dom';
import { lists } from './lists';

/* ================= Router ================= */
function skeleton() {
  const bar = (w: string, h: number) => html`<div class="sk" style="width:${w};height:${h}px"></div>`;
  const card = (n: number) => html`<section class="panel">${bar('40%', 14)}<div style="height:18px"></div>${htmlList(Array.from({ length: n }, () => html`${bar('100%', 12)}<div style="height:16px"></div>`))}</section>`;
  return html`<div class="head"><div>${bar('200px', 26)}</div></div><div class="cards">${card(5)}${card(3)}${card(4)}</div>`;
}
export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  const parts = p.split('/');
  return { name: parts[0] || '', id: parts[1] ? decodeURIComponent(parts[1]) : '', q: Object.fromEntries(new URLSearchParams(q)) };
}
export function hashWith(changes: Record<string, string | null | undefined>) {
  const r = parseHash(), q: Record<string, string | null | undefined> = { ...r.q, ...changes };
  Object.keys(q).forEach(k => (q[k] === '' || q[k] == null) && delete q[k]);
  const qs = new URLSearchParams(q as Record<string, string>).toString();
  return '#/' + r.name + (r.id ? '/' + encodeURIComponent(r.id) : '') + (qs ? '?' + qs : '');
}
// Each page module registers its view here by route name. A view draws the page by calling paint with its markup.
export type RouteInfo = ReturnType<typeof parseHash>;
export type Paint = ((markup: Html | string) => void) & { live?: boolean };
export type View = (r: RouteInfo, paint: Paint) => Promise<unknown> | void;
export const VIEWS: Record<string, View> = {};

/* ---------- Page cache: tabs you've opened come back exactly as you left them ---------- */
const CACHEABLE = new Set(['', 'transactions', 'budgets', 'accounts', 'account', 'categories', 'bills', 'piggy', 'forecast', 'reports', 'recurring', 'loans', 'recap', 'timeline']);
function stashPage(feed: State['feed']) {
  const v = el('view');
  if (!S.pageLive || !S.pageKey || !S.pageCacheable || !v.firstChild) return;
  const scroll = scrollY, frag = document.createDocumentFragment();
  while (v.firstChild) frag.appendChild(v.firstChild);
  PAGES.delete(S.pageKey);
  PAGES.set(S.pageKey, { frag, scroll, feed, html: S.pageHtml, chart: S.chartData });
  while (PAGES.size > 12) PAGES.delete(PAGES.keys().next().value);
  S.pageLive = false;
}
// Keep "today" current when the app stays open past midnight; if you were on the current month, follow it.
function syncToday() {
  const now = new Date();
  if (now.getFullYear() === today.getFullYear() && now.getMonth() === today.getMonth() && now.getDate() === today.getDate()) return;
  const was = monthOf(today);
  if (S.y === was[0] && S.m === was[1]) [S.y, S.m] = monthOf(now);
  setToday(now); S.freshAfter = Date.now(); PAGES.clear();
}
export async function route(opts: { nav?: boolean, quiet?: boolean, instant?: boolean } = {}) {
  syncToday();
  const r = parseHash(), tok = ++S.tok, v = el('view');
  S.swr = !!opts.nav;
  const key = r.name + '/' + r.id + '?' + new URLSearchParams(r.q) + '@' + (S.all ? 'all' : S.y + '-' + S.m);
  const cacheable = CACHEABLE.has(r.name) && !S.dashEdit;
  const prevFeed = S.feed;
  // Which way are we going? Deeper pages slide in (push), shallower slide back (pop).
  // Back/forward swipes inside the iPhone app were already animated by iOS, so those show instantly.
  let traversal = false;
  const hn = history.state && history.state.n;
  if (hn == null) { S.navN = (S.navN || 0) + 1; try { history.replaceState({ n: S.navN }, ''); } catch (e) { /* ignore */ } }
  else { traversal = hn !== S.curNav; S.navN = Math.max(S.navN || 0, hn); }
  S.curNav = (history.state && history.state.n) || S.navN;
  const depth = ({ account: 1, reconcile: 2 })[r.name] || 0;
  if (opts.nav && S.pageDepth != null && !S.vtDir && depth !== S.pageDepth) S.vtDir = depth > S.pageDepth ? 'push' : 'pop';
  S.pageDepth = depth;
  const instant = opts.instant || (traversal && !!window.MONEY_NATIVE);
  if (instant) S.vtDir = '';
  drawNav(r.name === 'account' || r.name === 'reconcile' ? 'accounts' : r.name === 'inbox' ? 'review' : r.name);
  clearTimeout(S.skelT);
  // A tab you've already opened: put it back instantly, no network, same scroll position.
  const saved = opts.nav && cacheable && key !== S.pageKey && PAGES.get(key);
  if (saved) {
    PAGES.delete(key);
    const dir = S.vtDir; S.vtDir = '';
    const swap = () => {
      stashPage(S.feed);
      v.replaceChildren(saved.frag); v.classList.remove('enter');
      if (!instant && (!dir || !VT_OK)) { void v.offsetWidth; v.classList.add('enter'); }     // the same entrance as a first visit
      S.pageKey = key; S.pageHtml = saved.html; S.pageCacheable = true; S.pageLive = true;
      S.feed = saved.feed; S.kIdx = -1; if (saved.chart) S.chartData = saved.chart;
      scrollTo(0, saved.scroll);
      if (window.App && App.replayIn) App.replayIn();
      if (v.querySelector('input[data-sel]:checked')) App.selChanged();
      if (saved.stale) setTimeout(revalidate, 50);
    };
    if (instant || !dir) return swap();     // a tab you've seen comes straight back, like a native tab bar
    const t = vt('page', swap, () => { document.documentElement.dataset.vtdir = dir || ''; });
    if (t) t.kind = 'page';
    return;
  }
  S.feed = null; S.kIdx = -1;
  // Opening a deeper page (an account) keeps the list on screen a little longer, so a quick answer slides straight
  // in; a slow one slides in its placeholder right away and fills it when the data comes.
  const pushing = S.vtDir === 'push' && !instant;
  let painted = false;
  if (!opts.quiet) S.skelT = setTimeout(() => {
    if (tok !== S.tok) return;
    // a skipped slide still runs its update later, so the placeholder must not land on top of a page that already painted
    const show = () => { if (painted || tok !== S.tok) return; stashPage(prevFeed); v.innerHTML = String(skeleton()); };
    if (!pushing || S.vtDir !== 'push') return show();
    S.vtDir = '';
    const t = vt('page', show, () => { document.documentElement.dataset.vtdir = 'push'; });
    if (t) t.kind = 'page';
  }, pushing ? 350 : 140);
  const paint: Paint = markup => {
    if (tok !== S.tok) return;
    clearTimeout(S.skelT);
    // rows ticked for bulk edit while a quiet redraw of this page was loading: keep them, the next refresh catches up
    if (opts.quiet && key === S.pageKey && S.sel && S.sel.size) return;
    if (S.vtRun && S.vtRun.kind !== 'page') { S.vtRun.finished.catch(() => {}).then(() => paint(markup)); return; }   // let a drawer animation finish first
    const fresh = key !== S.pageKey;
    const from = S.vtFrom && S.vtFrom.node.isConnected && Date.now() - S.vtFrom.t < 4000 ? S.vtFrom.node : null; S.vtFrom = null;
    const swap = () => {
      painted = true;
      const keep = fresh ? 0 : scrollY;
      if (fresh) stashPage(prevFeed);
      v.innerHTML = String(markup);
      S.sel = new Set();          // the new rows start unticked
      S.pageKey = key; S.pageHtml = markup; S.pageCacheable = cacheable && !v.querySelector(':scope > .error'); S.pageLive = true;
      if (from) vtName(v.querySelector('.head h1'), 'ptitle');
      if (!fresh || !VT_OK || opts.quiet || instant || !dir) { v.classList.remove('enter'); if (fresh && !opts.quiet && !instant) { void v.offsetWidth; v.classList.add('enter'); } }
      scrollTo(0, fresh ? 0 : keep);          // new pages start at the top; a refresh keeps your place
      if (window.App && App.afterPaint) App.afterPaint(r, { quiet: opts.quiet || !fresh });
      if (S.bootStale) { S.bootStale = false; S.warmed = true; setTimeout(() => refreshAll(), 60); }     // opened from saved data: update quietly (and then warm the tabs)
      else if (!S.warmed) { S.warmed = true; warmTabs(); }    // first page after signing in: get the other tabs ready too
    };
    const dir = S.vtDir; S.vtDir = '';
    // Only moves with a direction (into an account, back out, to another month) slide the page. A plain switch to
    // another page lets its cards rise in instead: snapshotting the whole page for a fade costs the phone a frame or
    // more right as you tap, and the two motions on top of each other look like a stutter.
    if (!fresh || !S.painted || opts.quiet || instant || !dir) { S.painted = true; return swap(); }
    const t = vt('page', swap, () => { document.documentElement.dataset.vtdir = dir || ''; vtName(from, 'ptitle'); });
    if (t) t.kind = 'page';
  };
  paint.live = true;
  try {
    await (VIEWS[r.name] || VIEWS[''])(r, paint);
    netFails = 0;
    if (S.staleTok === tok && tok === S.tok) setTimeout(revalidate, 50);
  } catch (e) {
    if (e instanceof AuthError) return showLogin(e.message);
    const onError = !!v.querySelector(':scope > .error');
    if (opts.quiet && S.pageLive && !onError) { toast('Couldn’t refresh: ' + (e as Error).message); return; }
    if ((e as ApiError).network) {
      paint(html`<div class="error"><strong>Couldn’t load this page.</strong><br>${(e as Error).message}<br>Trying again by itself…<br><br><button class="btn small" data-onclick="App.reload()">Try again now</button></div>`);
      if (tok === S.tok) retryWhenBack(tok);
      return;
    }
    paint(html`<div class="error"><strong>Couldn’t load this page.</strong><br>${(e as Error).message}<br><br><button class="btn small" data-onclick="App.reload()">Try again</button></div>`);
  }
}
// The server couldn't be reached: try the page again after a short wait (longer each time, up to 30 s),
// or straight away when the device comes back online or the tab is shown again. Stops once you go elsewhere.
let netFails = 0, netTimer: ReturnType<typeof setTimeout> | undefined;
function retryWhenBack(tok: number) {
  const go = () => {
    clearTimeout(netTimer); removeEventListener('online', go); document.removeEventListener('visibilitychange', vis);
    if (tok === S.tok) route({ quiet: true });
  };
  const vis = () => { if (document.visibilityState === 'visible') go(); };
  clearTimeout(netTimer);
  netTimer = setTimeout(go, Math.min(30000, 2000 * 2 ** netFails++));
  addEventListener('online', go); document.addEventListener('visibilitychange', vis);
}
// The page on screen was drawn from out-of-date data: fetch what it needs again and redraw only if it changed.
async function revalidate() {
  const r = parseHash(), key = S.pageKey, tok = S.tok; let markup: Html | string | null = null;
  S.swrOff = (S.swrOff || 0) + 1;
  try { await (VIEWS[r.name] || VIEWS[''])(r, h => { markup = h; }); }
  catch (e) { if (e instanceof AuthError) showLogin(e.message); return; }
  finally { S.swrOff--; }
  if (tok === S.tok && key === S.pageKey && markup !== null && markup !== S.pageHtml && !busyHere()) route({ quiet: true });
}
// Something on the page is in use (an open drawer or picker, ticked rows, or something typed into the page itself,
// like a what-if or a budget amount), so a quiet redraw would wipe it
function busyHere() {
  const typed = [...el('view').querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=checkbox]):not([type=radio]), textarea')].some(i => i.value !== i.defaultValue);
  return el('drawer').classList.contains('open') || !!(S.sel && S.sel.size) || !el('pickpop').hidden || typed;
}
/* Fetch everything again. visible: show it right away (pull to refresh).
   Otherwise quietly re-fetch the current page and only redraw if something actually changed. */
export async function refreshAll(opts: { visible?: boolean } = {}) {
  if (S.refreshing) return S.refreshing;
  S.refreshing = (async () => {
    S.freshAfter = Date.now(); S.lastRefresh = Date.now(); S.listsAt = 0; PAGES.clear();
    try {
      if (opts.visible) { S.settledAfter = Date.now(); await route({ quiet: true }); return; }
      const r = parseHash(), key = S.pageKey, tok = S.tok;
      let markup: Html | string | null = null;
      try { await (VIEWS[r.name] || VIEWS[''])(r, h => { markup = h; }); }
      catch (e) { if (e instanceof AuthError) showLogin(e.message); return; }
      if (tok === S.tok && key === S.pageKey && markup !== null && markup !== S.pageHtml && !busyHere()) await route({ quiet: true });
    } finally {
      S.refreshing = null;
      warmTabs();
    }
  })();
  return S.refreshing;
}
// Recalculate: throw away every number this app has kept (responses in memory, saved pages, the copy on this
// device, the offline cache, the account/category lists, the Categorize history) and redraw from Firefly III.
async function recalcAll(btn?: HTMLButtonElement) {
  if (S.recalcing) return;
  S.recalcing = true;
  const label = btn ? btn.textContent : null; if (btn) { btn.disabled = true; btn.textContent = 'Recalculating…'; }
  try {
    CACHE.clear(); INFLIGHT.clear(); PAGES.clear(); PDB.clear();
    S.lists = null; S.listsAt = 0; S.inboxHist = null; S.linkTypes = null; S.dirtyAt = 0; S.freshAfter = Date.now(); S.lastRefresh = Date.now();
    try { if (window.caches) await caches.open('money-v1').then(c => c.keys().then(ks => Promise.all(ks.filter(k => new URL(k.url).pathname.startsWith('/api/')).map(k => c.delete(k))))); } catch (e) { /* no Cache Storage */ }
    await lists(true);
    await route({ quiet: true });
    toast('Recalculated everything from Firefly III');
  } catch (e) {
    if (e instanceof AuthError) return showLogin(e.message);
    toast('Couldn’t recalculate: ' + (e as Error).message);
  } finally {
    S.recalcing = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}
// After a refresh, quietly load the main tabs in the background so opening them is instant.
async function warmTabs() {
  const cur = parseHash().name;
  await new Promise(res => setTimeout(res, 1200));
  for (const name of ['', 'transactions', 'budgets', 'accounts']) {
    if (name === cur || S.refreshing) continue;
    await new Promise(res => setTimeout(res, 250));
    try { await VIEWS[name]({ name, id: '', q: {} }, () => {}); } catch (e) { /* optional */ }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !el('app').hidden && S.signedIn && Date.now() - (S.lastRefresh || 0) > 5 * 60 * 1000) refreshAll();
});
// Tapping the tab you're already on scrolls back to the top.
document.addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest && (e.target as HTMLElement).closest('.tabbar a, .nav a'); if (!a) return;
  const h = a.getAttribute('href'), cur = location.hash || '#/';
  if (h === cur || (h === '#/' && cur === '#')) { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (a.closest('.tabbar') && document.documentElement.classList.contains('shell')) S.tabNav = true;   // app-style: tabs switch instantly
});

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  recalcAll,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module './base' { interface AppApi extends Methods {} }

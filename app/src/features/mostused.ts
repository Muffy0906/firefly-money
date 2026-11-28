import { App, S, el } from '../core/base';
import { netBusy, sleep } from '../core/api';
import { LS } from '../core/helpers';
import { parseHash } from '../core/router';
import { toast } from '../core/dom';

/* ---------- Load your most-used pages ahead of time ----------
   The server (app/pages.js) keeps a count per page, so every device you sign in from loads the same ones. A page
   counts once you've stayed on it a few seconds. A little after the app opens, the top few are fetched into this tab's
   memory (the same cache as hovering a menu link), nothing is saved on the device, and a fetch that fails shows
   nothing. Only page names and counts leave the device. Off in the online demo, with Data Saver, and on slow or
   cellular connections. Settings → Sync turns it off or clears the history. */
const ENDPOINT = '/api/money-pages', DWELL = 4000, AGAIN = 60000, IDLE = 2500;
// The pages that can be loaded ahead, as their route names ('' is the Overview); app/pages.js lists the same ones
export const PRELOAD = ['', 'transactions', 'budgets', 'accounts', 'categories', 'bills', 'piggy', 'forecast', 'reports', 'recurring', 'loans', 'recap', 'timeline'];
export const pageId = (name: string) => name === '' ? 'overview' : name;
const nameOf = (id: string) => id === 'overview' ? '' : id;
export const mostUsedOn = () => LS.get('mostUsed', true) !== false && !window.MONEY_DEMO;

const head = { 'X-Money': '1' };
const call = (method: string, body?: unknown) => fetch(ENDPOINT, { method, cache: 'no-store', keepalive: method !== 'GET',
  headers: body === undefined ? head : { ...head, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

// Save-Data, a very slow network or a cellular one: leave the data alone
function frugal() {
  const c = (navigator as { connection?: { saveData?: boolean, effectiveType?: string, type?: string } }).connection;
  return !!c && (!!c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType || '') || c.type === 'cellular');
}

/* ---------- Counting visits ---------- */
let dwell = 0, lastId = '', lastAt = 0;
function visit() {
  clearTimeout(dwell);
  if (!mostUsedOn() || !S.signedIn) return;
  const name = parseHash().name;
  if (!PRELOAD.includes(name)) return;
  dwell = window.setTimeout(() => {
    const id = pageId(name);
    if (document.visibilityState !== 'visible' || !mostUsedOn() || !S.signedIn || pageId(parseHash().name) !== id) return;
    if (id === lastId && Date.now() - lastAt < AGAIN) return;
    lastId = id; lastAt = Date.now();
    call('POST', { p: id }).catch(() => {});
  }, DWELL);
}

/* ---------- Loading ahead ---------- */
export async function preload() {
  if (!mostUsedOn() || frugal()) return;
  let top: string[];
  try {
    const r = await call('GET');
    if (!r.ok) return;
    top = ((await r.json()).top || []).map((x: { p: string }) => x.p);
  } catch (e) { return; }
  for (const id of top) {
    const name = nameOf(id);
    if (!PRELOAD.includes(name) || name === parseHash().name) continue;
    // one at a time, and only while the app isn't busy with something you asked for
    for (let i = 0; i < 20 && netBusy() > 0; i++) await sleep(500);
    if (!mostUsedOn() || !S.signedIn || netBusy() > 0) return;
    App.prefetch(name);
    await sleep(1500);
  }
}
// Once per sign-in, when the app has been open a moment
let armed = true;
function watch() {
  if (!S.signedIn || el('app').hidden) { armed = true; return; }
  if (!armed) return;
  armed = false;
  setTimeout(() => { if (S.signedIn) preload().catch(() => {}); }, IDLE);
}

/* ---------- Settings ---------- */
function toggleMostUsed(on: boolean) {
  LS.set('mostUsed', !!on);
  if (on) { visit(); toast('Most-used pages load ahead'); } else { clearTimeout(dwell); toast('Pages load only when you open them'); }
}
async function clearMostUsed() {
  try { const r = await call('DELETE'); toast(r.ok ? 'Most-used history cleared' : 'Couldn’t clear it. Try again.', !r.ok); }
  catch (e) { toast('Couldn’t reach the server', true); }
}

addEventListener('hashchange', visit);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') visit(); });
if (!window.MONEY_DEMO) { setInterval(() => { watch(); }, 3000); setTimeout(visit, 3000); }

const methods = { toggleMostUsed, clearMostUsed };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

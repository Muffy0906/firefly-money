import { App, el } from '../core/base';
import { FF, type FfState, api } from '../core/api';
import { html } from '../core/html';

/* ================= Firefly III connection pill =================
   Shows whether Firefly III answers. Every request the app makes already tells (core/api.ts ffSeen), so the pill
   mostly listens; when the app has been quiet for a minute it asks Firefly for its version (/about, a few hundred
   bytes), and every 15 seconds while Firefly is down, so the pill turns green again soon after it's back.
   Desktop: a pill under "Money" in the sidebar (just its dot when the sidebar is folded).
   Phone: a row at the top of the More menu. On any screen size, a pill floats at the bottom while Firefly can't be
   reached (with Retry), and says "Connected again" for a moment once it's back. */
const LABEL: Record<FfState, [string, string]> = {      // [short, long]
  checking: ['Checking Firefly', 'Checking Firefly III…'],
  ok: ['Firefly connected', 'Firefly III connected'],
  down: ['Firefly unreachable', 'Can’t reach Firefly III'],
  auth: ['Token rejected', 'Firefly III rejected the token'],
  offline: ['Device offline', 'This device is offline'],
};
let version = '', busy = false, wasDown = false, okTimer: ReturnType<typeof setTimeout> | undefined;
const longLabel = () => FF.state === 'down' && FF.why === 'money' ? 'Can’t reach the Money server' : LABEL[FF.state][1];
function detail() {
  const ago = FF.at ? Math.round((Date.now() - FF.at) / 1000) : -1;
  const when = ago < 0 ? '' : ago < 5 ? 'just now' : ago < 90 ? ago + 's ago' : Math.round(ago / 60) + ' min ago';
  return longLabel() + (FF.state === 'ok' && version ? ' · version ' + version : '') + (when ? ' · checked ' + when : '') + ' · click to check again';
}
export const ffPill = (wide = false) =>
  html`<button type="button" class="ff-pill${wide ? ' wide' : ''}" data-ff="${FF.state}" data-onclick="App.ffCheck()" title="${detail()}"><i aria-hidden="true"></i><span>${wide ? longLabel() : LABEL[FF.state][0]}</span></button>`;

function paint() {
  const st = FF.state, short = LABEL[st][0], long = longLabel();
  document.querySelectorAll<HTMLElement>('.ff-pill').forEach(b => {
    b.dataset.ff = st;
    const s = b.querySelector('span');
    if (s) s.textContent = b.classList.contains('wide') ? long : short;
    b.title = detail(); b.setAttribute('aria-label', long);
  });
  const bad = st === 'down' || st === 'auth';
  let a = document.getElementById('ffAlert');
  if (bad || (wasDown && st === 'ok')) {
    if (!a) {
      a = document.createElement('div'); a.id = 'ffAlert'; a.className = 'ff-alert'; a.setAttribute('role', 'status'); a.setAttribute('aria-live', 'polite');
      document.body.appendChild(a);
    }
    a.dataset.ff = st;
    a.innerHTML = String(html`<i aria-hidden="true"></i><span>${st === 'ok' ? 'Firefly III connected again' : long}</span>${bad ? html`<button type="button" data-onclick="App.ffCheck()">Retry</button>` : ''}`);
    a.hidden = el('app').hidden;
    requestAnimationFrame(() => a!.classList.add('show'));
    clearTimeout(okTimer);
    if (st === 'ok') okTimer = setTimeout(() => a!.classList.remove('show'), 2400);
  } else if (a) a.classList.remove('show');
  wasDown = bad;
}
addEventListener('money-ff', paint);

async function check() {
  if (busy || el('app').hidden) return;
  if (!navigator.onLine) { App.ffSet('offline'); return; }
  busy = true;
  document.querySelectorAll<HTMLElement>('.ff-pill').forEach(b => b.classList.add('busy'));
  try { const r = await api('/about', { fresh: true }); version = (r && r.data && r.data.version) || version; }
  catch (e) { /* the request itself set the state */ }
  finally { busy = false; document.querySelectorAll<HTMLElement>('.ff-pill').forEach(b => b.classList.remove('busy')); paint(); }
}
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  const quiet = Date.now() - FF.at;
  if (FF.state === 'down' || FF.state === 'auth' ? quiet > 14e3 : quiet > 59e3) check();
  else paint();      // keeps "checked 20s ago" honest
}, 15e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - FF.at > 3e4) check(); });
addEventListener('online', () => check());
addEventListener('offline', () => App.ffSet('offline'));
// The sidebar pill is in the page from the start; fill it in once the first request has answered.
const host = document.querySelector('.side .ff-slot');
if (host) host.outerHTML = String(ffPill());
paint();

const methods = {
  ffCheck: () => { check(); },
  ffPill: (wide = false) => ffPill(wide),
  ffSet: (s: FfState) => { FF.state = s; FF.why = ''; FF.at = Date.now(); paint(); },
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

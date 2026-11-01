import { App, el } from '../core/base';
import { FF, type FfState, api, ffSeen } from '../core/api';
import { html } from '../core/html';

/* ================= Firefly III connection pill =================
   Shows whether Firefly III answers. Every request the app makes already tells (core/api.ts ffSeen), and while the
   page is on screen a background ping asks Firefly every 5 seconds (every 3 while it’s down), and at once when the
   app comes back to the screen or the network returns. The ping is a HEAD of /api/v1/about: no body, no retries,
   given up on after 4 seconds (a switched-off Firefly host can leave the proxy waiting a minute), and the service
   worker leaves HEAD alone, so it can't answer from its saved copy and make a dead server look alive.
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
  return longLabel() + (FF.state === 'ok' && version ? ' · version ' + version : '') + (when ? ' · checked ' + when : '') + ' · click to check now';
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

const PING_OK = 5e3, PING_DOWN = 3e3, PING_WAIT = 4e3;
let pingTimer: ReturnType<typeof setTimeout> | undefined;
async function ping() {
  const ctl = new AbortController(), give = setTimeout(() => ctl.abort(), PING_WAIT);
  try {
    const r = await fetch('/api/v1/about', { method: 'HEAD', cache: 'no-store', headers: { 'X-Money': '1' }, signal: ctl.signal });
    if (r.status === 401 && r.headers.get('X-Dash-Auth')) return;      // signed out: that says nothing about Firefly
    ffSeen(r.status === 401 ? 'auth' : r.status >= 502 && r.status <= 504 ? 'down' : 'ok');
    if (FF.state === 'ok' && !version) api('/about').then(j => { version = (j && j.data && j.data.version) || ''; }).catch(() => {});
  } catch (e) {
    // aborted after PING_WAIT: something along the way is hanging, so Firefly isn't answering; otherwise this server is gone
    ffSeen(!navigator.onLine ? 'offline' : 'down', ctl.signal.aborted ? '' : 'money');
  } finally { clearTimeout(give); }
}
async function check() {
  clearTimeout(pingTimer);
  if (!busy && !el('app').hidden && document.visibilityState === 'visible') {
    if (!navigator.onLine) App.ffSet('offline');
    else {
      busy = true;
      document.querySelectorAll<HTMLElement>('.ff-pill').forEach(b => b.classList.add('busy'));
      try { await ping(); } finally { busy = false; document.querySelectorAll<HTMLElement>('.ff-pill').forEach(b => b.classList.remove('busy')); paint(); }
    }
  }
  // the next one; a hidden page waits until it's shown again (visibilitychange below)
  if (document.visibilityState === 'visible') pingTimer = setTimeout(check, FF.state === 'ok' || FF.state === 'checking' ? PING_OK : PING_DOWN);
}
setInterval(paint, 15e3);      // keeps "checked 20s ago" honest
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); else clearTimeout(pingTimer); });
addEventListener('focus', () => { if (Date.now() - FF.at > 3e3) check(); });
addEventListener('online', () => check());
addEventListener('offline', () => App.ffSet('offline'));
// the app shows after sign-in or once saved data is on screen: start pinging then
new MutationObserver(() => { if (!el('app').hidden) check(); }).observe(el('app'), { attributes: true, attributeFilter: ['hidden'] });
if (!el('app').hidden) check();
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

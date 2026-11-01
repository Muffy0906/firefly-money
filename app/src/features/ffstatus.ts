import { App, el } from '../core/base';
import { FF, type FfState, api, ffSeen, ffSeenResponse, sleep } from '../core/api';
import { refreshAll } from '../core/router';
import { html, htmlList } from '../core/html';

/* ================= Firefly III connection pill =================
   Shows whether Firefly III answers. Every request the app makes already tells (core/api.ts ffSeen), and while the
   page is on screen a background ping asks Firefly every 5 seconds (every 3 while it’s down), and at once when the
   app comes back to the screen or the network returns. The ping is a HEAD of /api/v1/about: no body, no retries,
   given up on after 4 seconds (a switched-off Firefly host can leave the proxy waiting a minute), and the service
   worker leaves HEAD alone, so it can't answer from its saved copy and make a dead server look alive.
   Desktop: a pill under "Money" in the sidebar (just its dot when the sidebar is folded).
   Phone: a row at the top of the More menu. While Firefly (or this server, or the network) can't be reached, the
   page gives way to a screen saying so: Money keeps no copy of your data to show instead. Once it's back the page
   fetches its data again and a pill says "Connected again" for a moment. */
const LABEL: Record<FfState, [string, string]> = {      // [short, long]
  checking: ['Checking Firefly', 'Checking Firefly III…'],
  ok: ['Firefly connected', 'Firefly III connected'],
  down: ['Firefly unreachable', 'Can’t reach Firefly III'],
  auth: ['Token rejected', 'Firefly III rejected the token'],
  offline: ['Device offline', 'This device is offline'],
};
let version = '', apiVersion = '', busy = false, wasDown = false, okTimer: ReturnType<typeof setTimeout> | undefined;
const moneyDown = () => FF.state === 'down' && FF.why === 'money';
const longLabel = () => moneyDown() ? 'Can’t reach the Money server' : LABEL[FF.state][1];
const shortLabel = () => moneyDown() ? 'Money server down' : LABEL[FF.state][0];
function detail() {
  const ago = FF.at ? Math.round((Date.now() - FF.at) / 1000) : -1;
  const when = ago < 0 ? '' : ago < 5 ? 'just now' : ago < 90 ? ago + 's ago' : Math.round(ago / 60) + ' min ago';
  return longLabel() + (FF.state === 'ok' && version ? ' · version ' + version : '') + (when ? ' · checked ' + when : '') + ' · click for details';
}
const OUT_ICON = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5.1 12.9a10 10 0 0 1 4.6-2.7M14.6 10.4a10 10 0 0 1 4.3 2.5"/><path d="M1.8 9.4a15 15 0 0 1 3.9-2.6M10.5 5.3a15 15 0 0 1 11.7 4.1"/><path d="M12 19.6h.01"/></svg>`;
function outText(): [string, string] {
  const none = 'Money shows your data straight from Firefly III and keeps no copy of it, so there’s nothing to show until ';
  if (FF.state === 'offline') return ['You’re offline', none + 'this device is back online. The page comes back by itself.'];
  if (FF.state === 'auth') return ['Firefly III rejected the token', 'Check FIREFLY_TOKEN in the app settings on your server, then try again.'];
  if (moneyDown()) return ['Can’t reach the Money server', 'The Money app on your server isn’t answering. It may be restarting. ' + none + 'it does. The page comes back by itself.'];
  return ['Can’t reach Firefly III', none + 'Firefly answers again. The page comes back by itself.'];
}
function paintOut() {
  let o = document.getElementById('ffOut');
  if (!o) { o = document.createElement('section'); o.id = 'ffOut'; o.className = 'ff-out'; o.setAttribute('role', 'alert'); el('app').appendChild(o); }
  const [title, text] = outText();
  o.dataset.ff = FF.state;
  o.innerHTML = String(html`<div class="ff-out-card"><span class="ff-out-ic">${OUT_ICON}</span><h2>${title}</h2><p>${text}</p>${chainHtml()}<button type="button" class="btn primary" data-onclick="App.ffCheck()">Try again</button><p class="ff-out-note">Checking again every few seconds</p></div>`);
}
/* ---------- Which part is down: this device → the Money server → Firefly III (and its token) ---------- */
type Link = 'ok' | 'bad' | 'unknown';
function chain(): [string, Link, string][] {
  const st = FF.state, money = moneyDown();
  const dev: Link = st === 'offline' ? 'bad' : 'ok';
  const srv: Link = st === 'offline' ? 'unknown' : money ? 'bad' : st === 'checking' ? 'unknown' : 'ok';
  const ff: Link = st === 'ok' ? 'ok' : st === 'auth' || (st === 'down' && !money) ? 'bad' : 'unknown';
  return [['This device', dev, dev === 'bad' ? 'Offline' : 'Online'],
    ['Money server', srv, srv === 'bad' ? 'Not answering' : srv === 'ok' ? 'Answering' : 'Unknown'],
    ['Firefly III', ff, st === 'auth' ? 'Token rejected' : ff === 'bad' ? 'Not answering' : ff === 'ok' ? 'Answering' : 'Unknown']];
}
const chainHtml = () => html`<ol class="ff-chain">${htmlList(chain().map(([name, k, what]) =>
  html`<li data-k="${k}"><i aria-hidden="true"></i><b>${name}</b><span>${what}</span></li>`))}</ol>`;
function ago(t: number) {
  if (!t) return 'Not yet';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 5 ? 'Just now' : s < 90 ? s + 's ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function ffAddress() { const a = el('ffLink'), h = a.getAttribute('href') || ''; return !a.hidden && /^https?:\/\//.test(h) ? h : ''; }
let popFor: HTMLElement | null = null;
const BADGE: Record<FfState, string> = { checking: 'Checking', ok: 'Connected', down: 'Unreachable', auth: 'Token rejected', offline: 'Offline' };
function popHtml() {
  const st = FF.state, addr = ffAddress();
  const token = st === 'auth' ? 'Rejected' : st === 'ok' ? 'Valid' : 'Unknown';
  return html`<div class="ff-pop-head"><b>Firefly III</b><span class="ff-badge" data-ff="${st}"><i aria-hidden="true"></i>${BADGE[st]}</span></div>
${chainHtml()}
<dl class="ff-facts">
${addr ? html`<dt>Server</dt><dd><a href="${addr}" target="_blank" rel="noopener">${addr.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></dd>` : ''}
<dt>Version</dt><dd>${version ? version + (apiVersion ? ' · API ' + apiVersion : '') : 'Unknown'}</dd>
<dt>Last answer</dt><dd>${ago(FF.okAt)}${FF.okAt && FF.ms && (st === 'ok' || st === 'auth') ? ' · ' + FF.ms + ' ms' : ''}</dd>
<dt>Access token</dt><dd data-k="${token === 'Rejected' ? 'bad' : token === 'Valid' ? 'ok' : 'unknown'}">${token}</dd>
</dl>
<div class="ff-pop-foot"><button type="button" class="btn small" data-onclick="App.ffCheck()">Check now</button><span>Checks every ${st === 'ok' || st === 'checking' ? '5' : '3'} seconds</span></div>`;
}
function placePop() {
  const p = document.getElementById('ffPop');
  if (!p || !popFor) return;
  const r = popFor.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight, m = 12;
  const folded = document.documentElement.classList.contains('side-mini') && !!popFor.closest('.side');
  let x = folded ? r.right + 10 : r.left, y = folded ? r.top - 14 : r.bottom + 8;
  x = Math.max(m, Math.min(x, innerWidth - w - m)); y = Math.max(m, Math.min(y, innerHeight - h - m));
  p.style.left = x + 'px'; p.style.top = y + 'px';
}
function paintPop() {
  const p = document.getElementById('ffPop');
  if (!p || p.hidden) return;
  p.innerHTML = String(popHtml());
  placePop();
}
function closePop() {
  const p = document.getElementById('ffPop');
  if (p) p.hidden = true;
  if (popFor) popFor.setAttribute('aria-expanded', 'false');
  popFor = null;
}
function openPop(anchor: HTMLElement) {
  if (popFor === anchor) { closePop(); return; }
  let p = document.getElementById('ffPop');
  if (!p) { p = document.createElement('div'); p.id = 'ffPop'; p.className = 'ff-pop'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Firefly III connection'); document.body.appendChild(p); }
  popFor = anchor; anchor.setAttribute('aria-expanded', 'true');
  p.hidden = false; paintPop();
  if (!version) loadVersion().then(paintPop);
  check();
}
document.addEventListener('pointerdown', e => {
  const t = e.target as Element;
  if (popFor && !t.closest('#ffPop') && !t.closest('.ff-pill')) closePop();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && popFor) { closePop(); } });
addEventListener('resize', placePop);
addEventListener('hashchange', closePop);

export const ffPill = (wide = false) =>
  html`<button type="button" class="ff-pill${wide ? ' wide' : ''}" data-ff="${FF.state}" data-onclick="App.ffPop(this)" aria-haspopup="dialog" title="${detail()}"><i aria-hidden="true"></i><span>${wide ? longLabel() : shortLabel()}</span></button>`;

function paint() {
  const st = FF.state, short = shortLabel(), long = longLabel();
  document.querySelectorAll<HTMLElement>('.ff-pill').forEach(b => {
    b.dataset.ff = st;
    const s = b.querySelector('span');
    if (s) s.textContent = b.classList.contains('wide') ? long : short;
    b.title = detail(); b.setAttribute('aria-label', long);
  });
  paintPop();
  // Money keeps no copy of Firefly's data, so while it can't be reached the page gives way to a screen saying so
  const bad = st === 'down' || st === 'auth' || st === 'offline';
  document.documentElement.classList.toggle('ff-out', bad);
  if (bad) paintOut();
  let a = document.getElementById('ffAlert');
  if (wasDown && st === 'ok') {
    if (!a) {
      a = document.createElement('div'); a.id = 'ffAlert'; a.className = 'ff-alert'; a.setAttribute('role', 'status'); a.setAttribute('aria-live', 'polite');
      document.body.appendChild(a);
    }
    a.dataset.ff = st;
    a.innerHTML = String(html`<i aria-hidden="true"></i><span>Firefly III connected again</span>`);
    a.hidden = el('app').hidden;
    requestAnimationFrame(() => a!.classList.add('show'));
    clearTimeout(okTimer);
    okTimer = setTimeout(() => a!.classList.remove('show'), 2400);
    refreshAll().catch(() => {});      // fetch the page again: anything it tried while Firefly was gone failed
  }
  wasDown = bad;
}
addEventListener('money-ff', paint);

const PING_OK = 5e3, PING_DOWN = 3e3, PING_WAIT = 4e3;
let pingTimer: ReturnType<typeof setTimeout> | undefined;
// One HEAD of /about: 'ok' | 'auth' from a Firefly answer, a failed Response, 'hang' (no answer in PING_WAIT),
// 'gone' (this server can't be reached at all) or 'out' (signed out: says nothing about Firefly)
async function pingOnce(): Promise<Response | 'hang' | 'gone' | 'out'> {
  const ctl = new AbortController(), give = setTimeout(() => ctl.abort(), PING_WAIT);
  try {
    const t0 = performance.now();
    const r = await fetch('/api/v1/about', { method: 'HEAD', cache: 'no-store', headers: { 'X-Money': '1' }, signal: ctl.signal });
    FF.ms = Math.round(performance.now() - t0);
    return r.status === 401 && r.headers.get('X-Dash-Auth') ? 'out' : r;
  } catch (e) { return ctl.signal.aborted ? 'hang' : 'gone'; }
  finally { clearTimeout(give); }
}
// A quick failure is tried again three times (a busy Firefly drops the odd request) before the page gives way to the
// "can't reach" screen; a hang already waited PING_WAIT, so it counts at once.
const PING_RETRY = [400, 1200, 3000];      // the same waits as a read that fails (core/api.ts NET_RETRY)
async function ping() {
  for (let k = 0; ; k++) {
    const r = await pingOnce();
    if (r === 'out') return;
    const bad = r === 'hang' || r === 'gone' || r.status >= 502 && r.status <= 504 || (r.status === 503 && !r.headers.get('Date'));
    if (bad && r !== 'hang' && k < PING_RETRY.length && navigator.onLine) { await sleep(PING_RETRY[k]); continue; }
    if (!navigator.onLine) ffSeen('offline');
    else if (r === 'hang') ffSeen('down');
    else if (r === 'gone') ffSeen('down', 'money');
    else ffSeenResponse(r, true);
    if (FF.state === 'ok' && !version) loadVersion();
    return;
  }
}
function loadVersion() {
  return api('/about').then(j => { const d = (j && j.data) || {}; version = d.version || ''; apiVersion = d.api_version || ''; }).catch(() => {});
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
addEventListener('money-ff-suspect', () => { if (!busy) check(); });      // a request failed: check now
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
  ffPop: (b: HTMLElement) => { openPop(b); },
  ffPill: (wide = false) => ffPill(wide),
  ffSet: (s: FfState) => { FF.state = s; FF.why = ''; FF.at = Date.now(); paint(); },
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

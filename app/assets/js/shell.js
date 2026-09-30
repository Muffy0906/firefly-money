'use strict';
/* =====================================================================
   App shell: iOS-style title bar, sheet effect, and the bridge to the
   native tab bar when running inside the iPhone app.
   ===================================================================== */
const SHELL = document.documentElement.classList.contains('shell');
function postNative(name, body) { try { window.webkit.messageHandlers[name].postMessage(body); } catch (e) { /* not in the app */ } }

/* ---------- Title bar: large title collapses into a small one; back button on detail pages ---------- */
const appbar = document.createElement('header');
appbar.id = 'appbar'; appbar.className = 'appbar';
appbar.innerHTML = '<a class="ab-back" hidden><svg viewBox="0 0 12 21" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L2 10.5 10 19"/></svg><span></span></a><div class="ab-title"></div>';
el('app').prepend(appbar);
let abTick = false;
function appbarScroll() {
  abTick = false;
  const h1 = document.querySelector('#view .head h1');
  const edge = appbar.getBoundingClientRect().bottom || 44;
  appbar.classList.toggle('scrolled', h1 ? h1.getBoundingClientRect().bottom < edge + 2 : scrollY > 4);
}
function updateAppbar() {
  const h1 = document.querySelector('#view .head h1');
  appbar.querySelector('.ab-title').textContent = h1 ? h1.textContent : '';
  const backP = [...document.querySelectorAll('#view > p')].find(p => { const a = p.querySelector('a.link'); return a && /^\s*←/.test(a.textContent); });
  const btn = appbar.querySelector('.ab-back');
  if (backP) {
    const a = backP.querySelector('a.link');
    btn.hidden = false; btn.setAttribute('href', a.getAttribute('href'));
    btn.querySelector('span').textContent = a.textContent.replace(/^\s*←\s*/, '');
    backP.classList.add('shell-hide');
  } else btn.hidden = true;
  appbarScroll();
}
if (SHELL) {
  addEventListener('scroll', () => { if (!abTick) { abTick = true; requestAnimationFrame(appbarScroll); } }, { passive: true });
  new MutationObserver(updateAppbar).observe(el('view'), { childList: true });
}

/* ---------- Sheet open: page steps back; native tab bar hides ---------- */
let lastChrome = '';
function nativeChrome() {
  const open = el('drawer').classList.contains('open');
  if (SHELL && open !== document.documentElement.classList.contains('sheet-open')) {
    if (open) document.documentElement.style.setProperty('--sy', (scrollY + innerHeight / 2) + 'px');
    document.documentElement.classList.toggle('sheet-open', open);
  }
  if (!window.MONEY_NATIVE) return;
  const r = parseHash();
  const tab = r.name === '' ? 'home' : ['transactions', 'budgets'].includes(r.name) ? r.name : '';
  const msg = { visible: !el('app').hidden && !open && el('palette').hidden, tab };
  const key = JSON.stringify(msg);
  if (key !== lastChrome) { lastChrome = key; postNative('chrome', msg); }
}
new MutationObserver(nativeChrome).observe(el('drawer'), { attributes: true, attributeFilter: ['class'] });
new MutationObserver(nativeChrome).observe(el('palette'), { attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(nativeChrome).observe(el('app'), { attributes: true, attributeFilter: ['hidden'] });
addEventListener('hashchange', nativeChrome);
setTimeout(nativeChrome, 0);

/* ---------- Called by the native tab bar ---------- */
function tabTap(id) {
  if (id === 'add') return quickAdd();
  if (id === 'more') return moreSheet();
  const h = id === 'home' ? '#/' : '#/' + id, cur = location.hash || '#/';
  if (cur === h || (h === '#/' && cur === '#')) { scrollTo({ top: 0, behavior: 'smooth' }); return; }
  S.tabNav = true;              // tabs switch instantly, like a native tab bar
  location.hash = h;
}
Object.assign(window.App, { tabTap, updateAppbar });

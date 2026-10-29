/* The online demo (npm run build:demo, published to GitHub Pages). It runs before the app and answers the
   app's /api/v1 calls in the browser with made-up data from mockapi.ts, so the demo needs no server at all.
   It's signed in from the start (nothing checks the session) and adds a small "Demo" badge that links to the repo.
   When built with GOATCOUNTER set, it also counts visits to each page for GoatCounter (no cookies, no personal data). */
import { NotFound, createMockApi } from './mockapi';

// The demo opens in Frosted glass, with the Overview arranged like the README's screenshots (this runs before boot.js
// reads the theme): four small tiles a row even on a big screen, net worth over three years. A phone puts Where it
// went first in its row so Cash and Credit cards pair up. It's set up once per LOOK version, so a visitor who was here
// before gets a new look once too; after that, anything they change is kept (Customize → Reset gives the usual defaults).
const LOOK = '2';
window.MONEY_DEMO = true;
try {
  if (localStorage.getItem('money.demoLook') !== LOOK) {
    const phone = innerWidth < 1000;
    localStorage.setItem('moneyTheme', 'frosted');
    localStorage.setItem('money.nwYears', '3');
    localStorage.setItem('money.dash', JSON.stringify({
      v: 3, units: 4, order: ['insights', 'networth', 'earned', 'spent', 'attention', ...(phone ? ['spending', 'cash'] : ['cash', 'spending']), 'cards', 'flow', 'heatmap', 'loans'],
      shown: ['cash', 'cards', 'flow', 'heatmap', 'loans'], hidden: ['safe', 'budgets', 'bills', 'cashflow'],
      size: { networth: 's', attention: 's', cash: 's', cards: 's', heatmap: 's', loans: 's', spending: 'm', flow: 'm' },
    }));
    localStorage.setItem('money.demoLook', LOOK);
  }
} catch (e) { /* storage blocked */ }

const handle = createMockApi();
const realFetch = window.fetch.bind(window);
const json = { 'Content-Type': 'application/json' };

window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const u = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (u.pathname.endsWith('/api/money-session')) return new Response(null, { status: 204 });   // sign in or out
  if (u.pathname.endsWith('/api/money-ingest')) return new Response(JSON.stringify({ key: 'demo-key' }), { status: 200, headers: json });   // Settings → Apple Pay
  const at = u.pathname.indexOf('/api/v1/');
  if (at < 0) return realFetch(input, init);
  await new Promise(r => setTimeout(r, 60 + Math.random() * 120));   // feels like a real server
  const method = (init.method || 'GET').toUpperCase();
  const q = Object.fromEntries(u.searchParams);
  try {
    let body = {};
    try { body = typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch (e) { /* not JSON */ }
    const out = handle(u.pathname.slice(at + '/api/v1'.length), q, method, body && typeof body === 'object' ? body : {});
    if (out === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(out), { status: 200, headers: json });
  } catch (e) {
    if (e instanceof NotFound) return new Response(JSON.stringify({ message: 'Resource not found' }), { status: 404, headers: json });
    return new Response(JSON.stringify({ message: 'The demo doesn’t support that.' }), { status: 500, headers: json });
  }
};

// No offline service worker: the app registers /sw.js at the site root, which on GitHub Pages isn't the demo's
try { if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('Not in the demo')); } catch (e) { /* ignore */ }

// GoatCounter counts the address without the #, so every page would look like the front page. Count the page
// part of the hash instead (#/reports, not #/transactions?category=…), and count again on every page change.
type GoatCounter = { path?: (p: string) => string, count?: () => void };
const gc: GoatCounter = ((window as unknown as { goatcounter?: GoatCounter }).goatcounter = { path: () => location.pathname + (location.hash.split('?')[0] || '#/') });
addEventListener('hashchange', () => gc.count?.());

addEventListener('DOMContentLoaded', () => {
  const a = document.createElement('a');
  a.className = 'demo-badge';
  a.href = 'https://github.com/Muffy0906/firefly-money';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Demo · made-up data · Get Money ↗';
  document.body.append(a);
});

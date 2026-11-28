// Most-used pages, run inside nginx (njs). Loaded by default.conf.template.
//
// The app reports each page you spend time on (POST /api/money-pages with {p}) and, after it opens, asks which
// pages you use most (GET) so it can load their data ahead of time, on any device you sign in from. Only a page
// name and a count are kept, never any Firefly data. Money has one sign-in, so the counts belong to this
// install. They live in a small JSON file in MONEY_DATA (default /data), so they survive a restart when that
// folder is a volume; without one they last until the container is recreated. DELETE forgets everything.
//
// njs supports less JavaScript than a browser: no for…of.
import fs from 'fs';

// The pages the app can load ahead (app/src/features/mostused.ts keeps the same list; a test checks they match)
const PAGES = ['overview', 'transactions', 'budgets', 'accounts', 'categories', 'bills', 'piggy', 'forecast', 'reports', 'recurring', 'loans', 'recap', 'timeline'];
const TOP = 3, SAVE_EVERY = 15, MAX_TOTAL = 5000;

const dir = () => (process.env.MONEY_DATA || '/data').replace(/\/+$/, '');
const file = () => dir() + '/pages.json';
const now = () => Math.floor(Date.now() / 1000);
const dict = () => ngx.shared.money_pages;

// The counts from disk, once per start. A missing or unreadable file means no history yet.
function load() {
  const d = dict();
  if (d.get('_loaded')) return;
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    PAGES.forEach(p => { const n = saved && saved[p]; if (typeof n === 'number' && n > 0 && n < 1e9) d.set(p, Math.floor(n)); });
  } catch (e) { /* no file yet, or not readable */ }
  d.set('_loaded', 1);
}
// Whole file at once through a temporary name, so a crash never leaves half a file. A folder that can't be
// written to isn't an error: the counts just stay in memory.
function save() {
  const d = dict(), out = {};
  PAGES.forEach(p => { const n = d.get(p); if (n) out[p] = n; });
  d.set('_saved', now()); d.set('_dirty', 0);
  try {
    try { fs.mkdirSync(dir(), { recursive: true }); } catch (e) { /* exists, or not allowed */ }
    fs.writeFileSync(file() + '.tmp', JSON.stringify(out));
    fs.renameSync(file() + '.tmp', file());
  } catch (e) { /* read-only folder */ }
}
// At most one write every SAVE_EVERY seconds; a change that has to wait goes out with the next request
function flush(force) {
  const d = dict();
  if (force || (d.get('_dirty') && now() - (d.get('_saved') || 0) >= SAVE_EVERY)) save();
}
function top() {
  const d = dict();
  return PAGES.map(p => ({ p, n: d.get(p) || 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n || PAGES.indexOf(a.p) - PAGES.indexOf(b.p)).slice(0, TOP);
}
// Old habits fade: past MAX_TOTAL visits every count is halved
function fade() {
  const d = dict();
  if (PAGES.reduce((s, p) => s + (d.get(p) || 0), 0) > MAX_TOTAL) PAGES.forEach(p => { const n = d.get(p); if (n) d.set(p, Math.floor(n / 2)); });
}

// GET the pages you use most, POST {p} to count a visit, DELETE to forget (the session is checked by nginx)
function endpoint(r) {
  r.headersOut['Cache-Control'] = 'no-store';
  if (r.method !== 'GET' && r.method !== 'POST' && r.method !== 'DELETE') return r.return(405);
  load();
  const d = dict();
  if (r.method === 'GET') {
    flush(false);
    r.headersOut['Content-Type'] = 'application/json';
    return r.return(200, JSON.stringify({ top: top() }));
  }
  if (r.method === 'DELETE') {
    PAGES.forEach(p => d.delete(p));
    save();
    return r.return(204);
  }
  let body = {};
  try { body = JSON.parse(r.requestText || '{}') || {}; } catch (e) { /* not JSON: refused below */ }
  if (typeof body.p !== 'string' || PAGES.indexOf(body.p) < 0) return r.return(400);
  d.incr(body.p, 1, 0);
  fade();
  d.set('_dirty', 1);
  flush(false);
  r.return(204);
}

export default { endpoint, PAGES };

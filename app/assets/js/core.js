'use strict';
/* ================= Settings ================= */
const LOAN_MONTHLY_PAYMENT = 500;   // used for the "months to go" estimate on loans
const PAGE_SIZE = 50;

/* ================= State & helpers ================= */
let today = new Date();
const S = { y: today.getFullYear(), m: today.getMonth(), key: '', lists: null, tok: 0, form: null, currency: 'USD' };
const el = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayIso = () => isoDate(new Date());
function monthRange(y, m) {
  const d = new Date(y, m, 1), yy = d.getFullYear(), mm = d.getMonth();
  return {
    start: yy + '-' + pad(mm + 1) + '-01',
    end: yy + '-' + pad(mm + 1) + '-' + pad(new Date(yy, mm + 1, 0).getDate()),
    label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    short: d.toLocaleString('en-US', { month: 'short' }), y: yy, m: mm,
  };
}
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const arr = r => Array.isArray(r) ? r : (r && Array.isArray(r.data)) ? r.data : [];
const absDiff = x => Math.abs(num(x.difference_float ?? x.difference));
const sumDiff = r => arr(r).reduce((s, x) => s + absDiff(x), 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FMT = new Map();
function fmtFor(key, make) { let f = FMT.get(key); if (!f) { f = make(); FMT.set(key, f); } return f; }
const money = (n, dec = 2) => fmtFor(S.currency + dec, () => new Intl.NumberFormat('en-US', { style: 'currency', currency: S.currency, minimumFractionDigits: dec, maximumFractionDigits: dec })).format(n || 0);
const money0 = n => money(n, 0);
const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }), DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDay = s => s ? DAY_FMT.format(new Date(String(s).slice(0, 10) + 'T12:00:00')) : '';
const fmtDate = s => s ? DATE_FMT.format(new Date(String(s).slice(0, 10) + 'T12:00:00')) : '';
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/* ================= API ================= */
class AuthError extends Error {}
// Responses are kept until something changes (your edits), you pull to refresh, or the app comes back
// after a while; they're also saved on the device so the app opens instantly with your last data.
const CACHE = new Map(), INFLIGHT = new Map();
S.freshAfter = 0;          // cached responses older than this are fetched again
// After a change, saved responses are only "out of date", not thrown away: the page you're on reloads fresh,
// other pages show their saved data at once and then quietly update (see revalidate()).
S.dirtyAt = 0;
function clearCache() { S.dirtyAt = Date.now(); S.listsAt = 0; PAGES.forEach(p => { p.stale = true; }); }

/* ---------- On-device copy of API responses (IndexedDB) ---------- */
const PDB = (() => {
  let dbp = null, timer = null;
  const queue = new Map();
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    try {
      const q = indexedDB.open('money-cache', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('api');
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    } catch (e) { rej(e); }
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => { const t = db.transaction('api', mode); fn(t.objectStore('api')); t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  };
  const flush = () => { const items = [...queue]; queue.clear(); run('readwrite', st => items.forEach(([k, v]) => st.put(v, k))).catch(() => {}); };
  return {
    async loadAll() {
      const db = await open();
      return new Promise(res => {
        const out = [], c = db.transaction('api', 'readonly').objectStore('api').openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
        c.onerror = () => res(out);
      });
    },
    put(key, entry) { queue.set(key, entry); clearTimeout(timer); timer = setTimeout(flush, 500); },
    clear() { queue.clear(); clearTimeout(timer); run('readwrite', st => st.clear()).catch(() => {}); },
  };
})();
async function api(path, opt = {}) {
  const u = new URL('/api/v1' + path, location.origin);
  for (const [k, v] of Object.entries(opt.params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  const method = opt.method || 'GET';
  if (method === 'GET' && !opt.as && !opt.fresh) {
    const key = u.toString(), hit = CACHE.get(key);
    if (hit && hit.t >= S.freshAfter) {
      if (hit.t >= S.dirtyAt) return hit.v;
      if (S.swr && !S.swrOff) { S.staleTok = S.tok; return hit.v; }      // out of date: show it now, update after
    }
    if (INFLIGHT.has(key)) return INFLIGHT.get(key);
    const pr = apiRaw(u, opt).then(v => { const e = { t: Date.now(), v }; CACHE.set(key, e); if (S.remember) PDB.put(key, e); return v; }).finally(() => INFLIGHT.delete(key));
    INFLIGHT.set(key, pr);
    return pr;
  }
  const out = await apiRaw(u, opt);
  if (method !== 'GET') clearCache();
  return out;
}
// Firefly (often a small PHP server on a NAS) drops requests when too many arrive at once: the proxy then
// answers 502/503/504, or Firefly says 429. So at most NET_MAX requests are sent at a time, and reads that
// fail like that (or lose the connection) are retried a few times before the error is shown.
const NET_MAX = 6, NET_RETRY = [400, 1200, 3000], NET_BUSY = new Set([429, 502, 503, 504]);
let netActive = 0; const netQueue = [];
async function netSlot(fn) {
  if (netActive >= NET_MAX) await new Promise(res => netQueue.push(res));
  netActive++;
  try { return await fn(); } finally { netActive--; const next = netQueue.shift(); if (next) next(); }
}
const sleep = ms => new Promise(res => setTimeout(res, ms));
// Returns { r, body }: the slot is held until the whole response has arrived, not just its headers.
async function netFetch(u, init, blob) {
  const read = init.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    let res = null, r = null, wait = NET_RETRY[attempt];
    try { res = await netSlot(async () => { const x = await fetch(u, init); return { r: x, body: await (blob && x.ok ? x.blob() : x.text()) }; }); r = res.r; }
    catch (e) { if (!read || wait === undefined || !navigator.onLine) throw e; }
    if (r && !(read && NET_BUSY.has(r.status) && wait !== undefined && navigator.onLine)) return res;
    const ra = r && +r.headers.get('Retry-After');
    if (ra > 0) wait = Math.min(10000, ra * 1000);
    await sleep(wait + Math.random() * 200);
  }
}
async function apiRaw(u, opt) {
  const { r, body } = await netFetch(u, {
    method: opt.method || 'GET', cache: 'no-store',
    headers: { Accept: opt.as ? '*/*' : 'application/vnd.api+json', 'Content-Type': opt.raw ? (opt.contentType || 'application/octet-stream') : 'application/json', 'X-Dash-Key': S.key || '' },
    body: opt.raw ? opt.raw : opt.body ? JSON.stringify(opt.body) : undefined,
  }, opt.as === 'blob');
  if (r.status === 401 && r.headers.get('X-Dash-Auth')) throw new AuthError('Wrong password.');
  if (r.status === 204) return null;
  if (opt.as === 'blob' && r.ok) return body;
  const txt = body;
  if (opt.as === 'text' && r.ok) return txt;
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
  if (!r.ok) {
    let msg = (j && j.errors && typeof j.errors === 'object') ? Object.values(j.errors).flat().join(' ') : (j && j.message) || ('Request failed (' + r.status + ')');
    if (r.status === 401) msg = 'Firefly III rejected the access token. Check FIREFLY_TOKEN in the app settings.';
    if (r.status === 404 && !j) msg = 'Not found';
    if (r.status === 409 && (!j || !j.message)) msg = 'Firefly refused because this is still in use.';
    if (NET_BUSY.has(r.status) && !(j && j.message)) msg = 'Firefly III didn’t respond (' + r.status + '). It may be busy or restarting. Try again in a moment.';
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return j;
}
// Run fn over items, a few at a time (Firefly handles parallel writes to different transactions fine).
async function eachLimited(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
async function getAll(path, params = {}) {
  const first = await api(path, { params: { ...params, page: 1, limit: 100 } });
  const pages = Math.min(60, (first && first.meta && first.meta.pagination && first.meta.pagination.total_pages) || 1);
  const out = [...arr(first)];
  for (let p = 2; p <= pages; p += 6) {      // remaining pages, six at a time
    const batch = await Promise.all(Array.from({ length: Math.min(6, pages - p + 1) }, (_, i) => api(path, { params: { ...params, page: p + i, limit: 100 } })));
    batch.forEach(r => out.push(...arr(r)));
  }
  return out;
}

/* ================= Reference lists (cached) ================= */
function normAccount(a) {
  const t = a.attributes || {};
  return {
    id: String(a.id), name: t.name, type: String(t.type || ''), role: t.account_role || '', active: t.active !== false,
    balance: num(t.current_balance), debt: t.current_debt != null ? Math.abs(num(t.current_debt)) : Math.abs(num(t.current_balance)),
    opening: num(t.opening_balance), liabType: t.liability_type || '', interest: t.interest || '', interestPeriod: t.interest_period || '',
    paymentDate: t.monthly_payment_date || '', number: t.account_number || '', notes: t.notes || '', currency: t.currency_code || '',
    netWorth: t.include_net_worth !== false, openingDate: t.opening_balance_date || '', plan: parsePlan(t.notes),
  };
}
// A loan's planned monthly payment lives in its Firefly notes as one line, e.g.
// "Monthly payment: $500.00 on day 30 from Chase Checking", so every device sees it.
const PLAN_RE = /^[ \t]*Monthly payment:[ \t]*\$?([\d,.]+)(?:[ \t]+on day[ \t]+(\d{1,2}))?(?:[ \t]+from[ \t]+(.+?))?[ \t]*$/im;
function parsePlan(notes) { const m = PLAN_RE.exec(notes || ''); return m ? { amount: num(m[1].replace(/,/g, '')), day: m[2] ? +m[2] : null, from: m[3] ? m[3].trim() : '' } : null; }
function stripPlan(notes) { return String(notes || '').replace(PLAN_RE, '').replace(/\n{3,}/g, '\n\n').trim(); }
function withPlan(notes, p) {
  const base = stripPlan(notes);
  if (!p || !(p.amount > 0)) return base;
  const line = 'Monthly payment: $' + p.amount.toFixed(2) + (p.day ? ' on day ' + p.day : '') + (p.from ? ' from ' + p.from : '');
  return (base ? base + '\n\n' : '') + line;
}
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const planText = p => p && p.amount > 0 ? money(p.amount) + '/month' + (p.day ? ' on the ' + ordinal(p.day) : '') + (p.from ? ' from ' + p.from : '') : '';
const isAsset = a => a.type === 'asset';
const isCard = a => a.type === 'asset' && a.role === 'ccAsset';
const isLiab = a => a.type.startsWith('liab') || ['loan', 'debt', 'mortgage'].includes(a.type);
async function lists(force) {
  if (S.lists && !force && Date.now() - S.listsAt < 300000) return S.lists;
  const [accounts, categories, budgets, bills, tags, currencies] = await Promise.all([
    getAll('/accounts', { type: 'all' }), getAll('/categories'), getAll('/budgets'), getAll('/bills'), getAll('/tags'), getAll('/currencies').catch(() => []),
  ]);
  const acc = accounts.map(normAccount);
  const L = {
    accounts: acc,
    byId: Object.fromEntries(acc.map(a => [a.id, a])),
    own: acc.filter(a => (isAsset(a) || isLiab(a)) && a.active),
    expense: acc.filter(a => a.type === 'expense'),
    revenue: acc.filter(a => a.type === 'revenue'),
    categories: categories.map(c => ({ id: String(c.id), name: c.attributes.name, notes: c.attributes.notes || '' })).sort((a, b) => a.name.localeCompare(b.name)),
    budgets: budgets.map(b => ({ id: String(b.id), name: b.attributes.name, active: b.attributes.active !== false, notes: b.attributes.notes || '' })),
    bills: bills.map(b => ({ id: String(b.id), name: b.attributes.name, active: b.attributes.active !== false })),
    tags: tags.map(t => ({ id: String(t.id), name: t.attributes.tag })).sort((a, b) => a.name.localeCompare(b.name)),
    currencies: currencies.map(c => ({ id: String(c.id), code: c.attributes.code, name: c.attributes.name, symbol: c.attributes.symbol, enabled: !!c.attributes.enabled,
      primary: !!(c.attributes.primary || c.attributes.default || c.attributes.native) })),
  };
  L.foreign = L.currencies.filter(c => c.enabled && c.code !== S.currency);
  S.currency = (L.currencies.find(c => c.primary) || acc.find(a => isAsset(a) && a.currency) || {}).code || (acc.find(a => isAsset(a) && a.currency) || {}).currency || S.currency;
  L.foreign = L.currencies.filter(c => c.enabled && c.code !== S.currency);
  S.lists = L; S.listsAt = Date.now();
  return L;
}
const invalidate = () => { clearCache(); };

/* ================= Loan progress ================= */
// Original amount = opening balance + everything borrowed from the loan (money flowing out of it);
// repaid = everything paid into it. Works whether the loan was set up with an opening balance or a deposit.
async function loanProgress(loans) {
  const out = {};
  await Promise.all(loans.map(async l => {
    try {
      const groups = (await getAll('/accounts/' + l.id + '/transactions')).map(normGroup);
      let borrowed = Math.abs(l.opening), repaid = 0;
      groups.forEach(g => g.splits.forEach(s => {
        if (s.type === 'opening balance') return;          // already counted via the opening balance
        if (s.source_id === l.id) borrowed += s.amount;
        else if (s.destination_id === l.id) repaid += s.amount;
      }));
      out[l.id] = { borrowed, repaid, pct: borrowed > 0 ? Math.min(100, Math.max(0, repaid / borrowed * 100)) : null };
    } catch (e) { /* leave this loan without progress */ }
  }));
  return out;
}

/* ================= Transactions: normalize ================= */
function normGroup(g) {
  const a = g.attributes || {};
  const splits = (a.transactions || []).map(t => ({
    jid: String(t.transaction_journal_id), type: t.type, date: t.date, amount: num(t.amount), description: t.description || '',
    source_id: String(t.source_id || ''), source_name: t.source_name || '', source_type: t.source_type || '',
    destination_id: String(t.destination_id || ''), destination_name: t.destination_name || '', destination_type: t.destination_type || '',
    category: t.category_name || '', budget_id: t.budget_id ? String(t.budget_id) : '', budget_name: t.budget_name || '',
    bill_id: t.bill_id ? String(t.bill_id) : '', bill_name: t.bill_name || '', tags: t.tags || [], notes: t.notes || '',
    sba: t.source_balance_after, dba: t.destination_balance_after,
    fa: t.foreign_amount != null && t.foreign_amount !== '' ? String(num(t.foreign_amount)) : '', fc: t.foreign_currency_code || '', reconciled: !!t.reconciled,
  }));
  const f = splits[0] || {};
  return { id: String(g.id), title: a.group_title || '', type: f.type, date: f.date, splits, total: splits.reduce((s, x) => s + x.amount, 0) };
}
// Signed amount: negative = money out. With an account in view, sign is relative to that account.
function signed(g, accountId) {
  if (accountId) return g.splits.reduce((s, x) => s + (x.source_id === accountId ? -x.amount : x.destination_id === accountId ? x.amount : 0), 0);
  if (g.type === 'withdrawal') return -g.total;
  if (g.type === 'deposit') return g.total;
  return 0;
}
function amountCell(g, accountId) {
  const v = signed(g, accountId);
  if (!accountId && g.type === 'transfer') return '<td class="amt neutral">' + money(g.total) + '</td>';
  return '<td class="amt ' + (v < 0 ? 'neg' : v > 0 ? 'pos' : 'neutral') + '">' + (v > 0 ? '+' : '') + money(v) + '</td>';
}
/* ---------- Merchant avatars ---------- */
const AV_NOISE = /^(sq|tst|pos|ach|dd|pp|paypal|aplpay|sp|py|ic|in|web|pmt)\s*\*\s*|^(sq|tst)\s+/i;
function payeeOf(g) {
  const f = g.splits[0] || {};
  if (g.type === 'transfer') return { name: g.splits.length > 1 ? (g.title || f.description) : f.destination_name || f.description, kind: 'transfer' };
  const side = g.type === 'deposit' ? 'source_name' : 'destination_name';
  const names = [...new Set(g.splits.map(s => s[side]).filter(Boolean))];
  let name = names.length === 1 ? names[0] : (g.title || f.description);
  if (!name || /^\(?(no name|cash account)\)?$/i.test(name)) name = f.description;
  return { name: String(name || '?'), kind: g.type };
}
function monogram(name) {
  const words = String(name).replace(AV_NOISE, '').replace(/[^A-Za-z0-9&' ]+/g, ' ').split(/\s+/).filter(w => w && !/^(the|and|of|inc|llc|co)$/i.test(w));
  if (!words.length) return '•';
  if (words.length === 1 || /^\d/.test(words[1])) return (/^[A-Z]{2,4}$/.test(words[0]) ? words[0].slice(0, 2) : words[0][0]).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function hueOf(name) {
  let h = 0; const k = String(name).replace(AV_NOISE, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 10);
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return h % 360;
}
function avatarHtml(g, cls = '') {
  const p = payeeOf(g);
  if (p.kind === 'transfer') return '<span class="av xfer ' + cls + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/></svg></span>';
  return '<span class="av ' + cls + '" style="--h:' + hueOf(p.name) + '" aria-hidden="true">' + esc(monogram(p.name)) + '</span>';
}

/* ---------- Day labels for the grouped feed ---------- */
function dayLabel(iso) {
  const d = String(iso).slice(0, 10), t = todayIso(), diff = daysBetween(d, t);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  const dt = new Date(d + 'T12:00:00');
  if (diff > 1 && diff < 7) return dt.toLocaleDateString('en-US', { weekday: 'long' });
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(dt.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

S.txMeta = {};
function txRows(groups, opts = {}) {
  if (S.pendingDel && S.pendingDel.size) groups = groups.filter(g => !S.pendingDel.has(g.id));
  if (!groups.length) return '<div class="center-empty">' + (opts.empty || 'No transactions.') + '</div>';
  const cols = (opts.select ? 1 : 0) + 4;
  // Net per day (relative to the account when one is in view; transfers count as zero otherwise)
  const byDay = {};
  groups.forEach(g => { const d = String(g.date).slice(0, 10); byDay[d] = (byDay[d] || 0) + signed(g, opts.accountId); });
  let lastDay = '';
  const rows = groups.map(g => {
    const f = g.splits[0], multi = g.splits.length > 1, day = String(g.date).slice(0, 10);
    const desc = multi ? (g.title || f.description) : f.description;
    const dests = [...new Set(g.splits.map(s => s.destination_name))], srcs = [...new Set(g.splits.map(s => s.source_name))];
    const flow = esc(srcs.length > 1 ? srcs.length + ' sources' : srcs[0]) + ' → ' + esc(dests.length > 1 ? dests.length + ' payees' : dests[0]);
    const cats = [...new Set(g.splits.map(s => s.category).filter(Boolean))];
    const buds = [...new Set(g.splits.map(s => s.budget_name).filter(Boolean))];
    const tags = [...new Set(g.splits.flatMap(s => s.tags))].filter(t => !/^Data Import on/.test(t));
    const fx = g.splits.filter(s => s.fa && s.fc).map(s => '<span class="chip">' + esc(s.fc) + ' ' + esc(num(s.fa).toFixed(2)) + '</span>').join('');
    const inl = k => multi ? '' : ' inl" data-k="' + k + '" data-onclick="event.stopPropagation();App.pick(this)" title="Change ' + k;
    const chips = '<span class="cat-s' + inl('category') + '">' + (cats.length ? esc(cats.join(', ')) : g.type === 'withdrawal' ? 'Uncategorized' : g.type === 'deposit' ? 'Income' : 'Transfer') + '</span>' + fx +
      (multi ? '<span class="chip">' + g.splits.length + ' splits</span>' : '') +
      buds.map(b => '<span class="chip' + inl('budget') + '">Budget · ' + esc(b) + '</span>').join('') +
      (!buds.length && !multi && g.type === 'withdrawal' ? '<span class="chip ghost' + inl('budget') + '">+ Budget</span>' : '') +
      tags.map(t => '<span class="chip"># ' + esc(t) + '</span>').join('');
    S.txMeta[g.id] = { g, accountId: opts.accountId || '', opts: { select: !!opts.select, accountId: opts.accountId || '' } };
    let dh = '';
    if (day !== lastDay) {
      const close = lastDay ? '</tbody>' : ''; lastDay = day; const net = byDay[day];
      dh = close + '<tbody class="day"><tr class="dayhead" data-day="' + day + '"><td colspan="' + cols + '"><div><span>' + esc(dayLabel(day)) + '</span>' +
        (Math.abs(net) >= .005 ? '<span class="num ' + (net < 0 ? '' : 'pos') + '">' + (net > 0 ? '+' : '') + money(net) + '</span>' : '') + '</div></td></tr>';
    }
    return dh + '<tr class="click" data-gid="' + g.id + '" data-day="' + day + '" data-onclick="App.editTx(\'' + g.id + '\')">' +
      (opts.select ? '<td class="sel" data-onclick="event.stopPropagation()"><input type="checkbox" data-sel="' + g.id + '" data-onchange="App.selChanged()"' + ((S.sel || new Set()).has(g.id) ? ' checked' : '') + ' aria-label="Select"></td>' : '') +
      '<td><div class="txmain">' + avatarHtml(g) + '<div class="txt"><div class="desc">' + esc(desc) + '</div><div class="meta">' + chips + '</div></div></div></td>' +
      '<td class="flow hide-s"><span>' + flow + '</span></td>' +
      '<td class="catcol hide-s"><span class="' + (cats.length ? '' : 'neutral') + inl('category') + '">' + (cats.length ? esc(cats.join(', ')) : '—') + '</span></td>' +
      amountCell(g, opts.accountId) + '</tr>';
  }).join('');
  return '<table class="tbl feed' + (opts.select ? ' has-sel' : '') + '">' + rows + '</tbody></table>';
}
// After rows are removed (undo-delete, swipe), drop day headers left with nothing under them
function tidyDays() {
  document.querySelectorAll('#view tbody.day').forEach(b => { if (!b.querySelector('tr[data-gid]')) b.remove(); });
}

/* ================= UI plumbing ================= */
const ICONS = {
  overview: '<path d="M3 12l9-8 9 8M5 10v10h14V10"/>',
  transactions: '<path d="M4 7h13M13 3l4 4-4 4M20 17H7M11 13l-4 4 4 4"/>',
  accounts: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
  budgets: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 5"/>',
  categories: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  bills: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  forecast: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  loans: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  recurring: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  rules: '<path d="M4 6h10M4 12h16M4 18h7M17 4v4M11 16v4"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  piggy: '<path d="M5 11a7 6 0 0 1 13-2h2v4l-2 1-1 4h-3v-2h-4v2H7l-1-4a5 5 0 0 1-1-3z"/><circle cx="15" cy="11" r=".6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  density: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
};
const icon = k => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + '</svg>';
const NAV = [['', 'Overview', 'overview'], ['forecast', 'Forecast', 'forecast'], ['transactions', 'Transactions', 'transactions'], ['inbox', 'Categorize', 'inbox'],
  ['accounts', 'Accounts', 'accounts'], ['loans', 'Loan planner', 'loans'],
  ['budgets', 'Budgets', 'budgets'], ['categories', 'Categories & tags', 'categories'], ['bills', 'Bills', 'bills'], ['recurring', 'Recurring', 'recurring'],
  ['piggy', 'Piggy banks', 'piggy'], ['rules', 'Rules', 'rules'], ['reports', 'Reports', 'reports'], ['settings', 'Settings', 'settings']];
function drawNav(active) {
  el('nav').innerHTML = NAV.map(([r, label, ic]) => '<a href="#/' + r + '" class="' + (r === active ? 'on' : '') + '" data-onmouseenter="App.prefetch(\'' + r + '\')">' + icon(ic) + '<span>' + label + '</span></a>').join('');
  if (window.App && App.drawTabbar) App.drawTabbar(active);
}
function toast(msg) {
  const t = el('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}
function confirmBox(title, text, okLabel = 'Delete') {
  return new Promise(res => {
    const d = el('confirm');
    d.innerHTML = '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="btns"><button class="btn" value="no">Cancel</button><button class="btn primary" value="yes">' + esc(okLabel) + '</button></div>';
    d.querySelectorAll('button').forEach(b => b.onclick = () => { d.close(); res(b.value === 'yes'); });
    d.oncancel = () => res(false);
    d.showModal();
  });
}
/* ---------- View Transitions (animated morphs between states) ---------- */
const VT_OK = !!document.startViewTransition && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
// Run a DOM update inside a view transition. kind sets a class on <html> so CSS can pick the animation.
function vt(kind, update, setup) {
  if (!VT_OK || document.hidden) { update(); return null; }
  const root = document.documentElement;
  if (S.vtRun) { try { S.vtRun.skipTransition(); } catch (e) { /* already done */ } }
  root.classList.add('vt-' + kind);
  if (setup) setup();
  let t;
  try { t = document.startViewTransition(update); } catch (e) { root.classList.remove('vt-' + kind); update(); return null; }
  S.vtRun = t;
  // The browser may skip or abort a transition (a newer one starts, the viewport or scrollbar changes size...).
  // The DOM update still happens, so that's expected, not an error. A real error in the update itself still surfaces.
  const quiet = () => {};
  t.ready.catch(quiet);
  t.updateCallbackDone.catch(e => { if (!(e instanceof DOMException)) setTimeout(() => { throw e; }); });
  t.finished.catch(quiet).then(() => { root.classList.remove('vt-' + kind); if (S.vtRun === t) S.vtRun = null; document.querySelectorAll('[data-vtn]').forEach(n => { n.style.viewTransitionName = ''; delete n.dataset.vtn; }); });
  return t;
}
const vtName = (node, name) => { if (node) { node.style.viewTransitionName = name; node.dataset.vtn = '1'; } };

// Drawer header "hero": the transaction's avatar, payee and amount, so the row can morph into it
function drawerHeroHtml(h) {
  return '<div class="dhero" data-id="' + h.id + '">' + h.av + '<div class="dh-txt"><div class="eyebrow">' + esc(h.kicker) + '</div><h2>' + esc(h.name) + '</h2>' +
    '<div class="sub-s num">' + h.amount + ' · ' + esc(fmtDate(h.date)) + '</div></div></div>';
}
function openDrawer(title, bodyHtml, footHtml) {
  const d = el('drawer'), wasOpen = d.classList.contains('open');
  S.drawerTok = (S.drawerTok || 0) + 1;
  let h = S.drawerHero;
  if (h && !(title === 'Loading…' || title === 'Transaction' || (S.form && S.form.id === h.id))) h = S.drawerHero = null;
  const keep = h && wasOpen && d.querySelector('.dhero[data-id="' + h.id + '"]');
  if (keep) {       // same transaction: keep the header node (it may be mid-animation) and swap the rest
    if (title !== 'Loading…') keep.querySelector('.eyebrow').textContent = title;
    d.querySelectorAll(':scope > .body, :scope > footer').forEach(n => n.remove());
    d.insertAdjacentHTML('beforeend', '<div class="body" id="drawerBody">' + bodyHtml + '</div>' + (footHtml ? '<footer>' + footHtml + '</footer>' : ''));
    return;
  }
  d.innerHTML = '<div class="grab" aria-hidden="true"></div><header>' + (h ? drawerHeroHtml({ ...h, kicker: title === 'Loading…' ? h.kicker : title }) : '<h2>' + esc(title) + '</h2>') +
    '<button class="round" type="button" data-onclick="App.closeDrawer()" aria-label="Close">×</button></header>' +
    '<div class="body" id="drawerBody">' + bodyHtml + '</div>' + (footHtml ? '<footer>' + footHtml + '</footer>' : '');
  if (!wasOpen) S.drawerReturn = document.activeElement;
  d.setAttribute('aria-label', title === 'Loading…' && h ? h.name : title);
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); el('scrim').classList.add('open');
  if (!wasOpen) setTimeout(() => { const f = d.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=date]), select'); if (f && innerWidth > 900) f.focus(); }, 280);
}
function closeDrawer() {
  const d = el('drawer'), h = S.drawerHero;
  S.form = null; S.drawerHero = null;
  const row = h && d.classList.contains('open') && VT_OK && document.querySelector('#view tr[data-gid="' + h.id + '"] .av');
  const my = S.drawerTok = (S.drawerTok || 0) + 1;
  const shut = () => {
    if (S.drawerTok !== my) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); el('scrim').classList.remove('open');
    const back = S.drawerReturn; S.drawerReturn = null;
    if (back && back.isConnected && back.focus && d.contains(document.activeElement)) back.focus({ preventScroll: true });
  };
  if (!row) return shut();
  // Morph the drawer's avatar back into its row while the drawer slides away
  vt('drawer-close', () => { const dav = d.querySelector('.dhero .av'); if (dav) dav.style.viewTransitionName = ''; shut(); vtName(row, 'txav'); },
    () => vtName(d.querySelector('.dhero .av'), 'txav'));
}
function formError(msg) {
  const b = el('drawerBody'); if (!b) return toast(msg);
  let e = b.querySelector('.form-err');
  if (!e) { e = document.createElement('div'); e.className = 'form-err'; b.prepend(e); }
  e.textContent = msg; b.scrollTop = 0;
}
async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.l = btn.textContent; btn.textContent = 'Saving…'; }
  try { await fn(); } catch (e) { if (e instanceof AuthError) return showLogin(e.message); formError(e.message); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.l; } }
}
function monthNav() {
  const r = monthRange(S.y, S.m);
  const ahead = (S.y - today.getFullYear()) * 12 + (S.m - today.getMonth());
  const isNow = ahead >= 12;   // allow planning up to a year ahead
  return '<div class="month"><button class="round" data-onclick="App.shiftMonth(-1)" aria-label="Previous month">‹</button><span>' + r.label +
    '</span><button class="round" data-onclick="App.shiftMonth(1)" aria-label="Next month"' + (isNow ? ' disabled' : '') + '>›</button>' +
    (ahead !== 0 ? '<button class="btn small" style="margin-left:6px" data-onclick="App.thisMonth()">Today</button>' : '') + '</div>';
}
function head(title, sub, actions) {
  return '<div class="head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div><div class="actions">' + (actions || '') + '</div></div>';
}
const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(label) + '</option>';

/* ================= Router ================= */
function skeleton() {
  const bar = (w, h) => '<div class="sk" style="width:' + w + ';height:' + h + 'px"></div>';
  const card = n => '<section class="panel">' + bar('40%', 14) + '<div style="height:18px"></div>' + Array.from({ length: n }, () => bar('100%', 12) + '<div style="height:16px"></div>').join('') + '</section>';
  return '<div class="head"><div>' + bar('200px', 26) + '</div></div><div class="cards">' + card(5) + card(3) + card(4) + '</div>';
}
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  const parts = p.split('/');
  return { name: parts[0] || '', id: parts[1] ? decodeURIComponent(parts[1]) : '', q: Object.fromEntries(new URLSearchParams(q)) };
}
function hashWith(changes) {
  const r = parseHash(), q = { ...r.q, ...changes };
  Object.keys(q).forEach(k => (q[k] === '' || q[k] == null) && delete q[k]);
  const qs = new URLSearchParams(q).toString();
  return '#/' + r.name + (r.id ? '/' + encodeURIComponent(r.id) : '') + (qs ? '?' + qs : '');
}
const VIEWS = {};
/* ---------- Page cache: tabs you've opened come back exactly as you left them ---------- */
const PAGES = new Map();     // page key → { frag, scroll, feed, html, chart }
const CACHEABLE = new Set(['', 'transactions', 'budgets', 'accounts', 'account', 'categories', 'bills', 'piggy', 'forecast', 'reports', 'recurring', 'loans']);
function stashPage(feed) {
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
  if (S.y === today.getFullYear() && S.m === today.getMonth()) { S.y = now.getFullYear(); S.m = now.getMonth(); }
  today = now; S.freshAfter = Date.now(); PAGES.clear();
}
async function route(opts = {}) {
  syncToday();
  const r = parseHash(), tok = ++S.tok, v = el('view');
  S.swr = !!opts.nav;
  const key = r.name + '/' + r.id + '?' + new URLSearchParams(r.q) + '@' + S.y + '-' + S.m;
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
  drawNav(r.name === 'account' || r.name === 'reconcile' ? 'accounts' : r.name);
  clearTimeout(S.skelT);
  // A tab you've already opened: put it back instantly, no network, same scroll position.
  const saved = opts.nav && cacheable && key !== S.pageKey && PAGES.get(key);
  if (saved) {
    PAGES.delete(key);
    const dir = S.vtDir; S.vtDir = '';
    const swap = () => {
      stashPage(S.feed);
      v.replaceChildren(saved.frag); v.classList.remove('enter');
      S.pageKey = key; S.pageHtml = saved.html; S.pageCacheable = true; S.pageLive = true;
      S.feed = saved.feed; S.kIdx = -1; if (saved.chart) S.chartData = saved.chart;
      scrollTo(0, saved.scroll);
      if (v.querySelector('input[data-sel]:checked')) selChanged();
      if (saved.stale) setTimeout(revalidate, 50);
    };
    if (instant) return swap();
    const t = vt('page', swap, () => { document.documentElement.dataset.vtdir = dir || ''; });
    if (t) t.kind = 'page';
    return;
  }
  S.feed = null; S.kIdx = -1;
  if (!opts.quiet) S.skelT = setTimeout(() => { if (tok === S.tok) { stashPage(prevFeed); v.innerHTML = skeleton(); } }, 140);
  const paint = html => {
    if (tok !== S.tok) return;
    clearTimeout(S.skelT);
    if (S.vtRun && S.vtRun.kind !== 'page') { S.vtRun.finished.catch(() => {}).then(() => paint(html)); return; }   // let a drawer animation finish first
    const fresh = key !== S.pageKey;
    const from = S.vtFrom && S.vtFrom.node.isConnected && Date.now() - S.vtFrom.t < 4000 ? S.vtFrom.node : null; S.vtFrom = null;
    const swap = () => {
      const keep = fresh ? 0 : scrollY;
      if (fresh) stashPage(prevFeed);
      v.innerHTML = html;
      S.pageKey = key; S.pageHtml = html; S.pageCacheable = cacheable && !v.querySelector(':scope > .error'); S.pageLive = true;
      if (from) vtName(v.querySelector('.head h1'), 'ptitle');
      if (!fresh || !VT_OK || opts.quiet || instant) { v.classList.remove('enter'); if (fresh && !opts.quiet && !instant) { void v.offsetWidth; v.classList.add('enter'); } }
      scrollTo(0, fresh ? 0 : keep);          // new pages start at the top; a refresh keeps your place
      if (window.App && App.afterPaint) App.afterPaint(r, { quiet: opts.quiet || !fresh });
      if (S.bootStale) { S.bootStale = false; setTimeout(() => refreshAll(), 60); }     // opened from saved data: update quietly
    };
    const dir = S.vtDir; S.vtDir = '';
    if (!fresh || !S.painted || opts.quiet || instant) { S.painted = true; return swap(); }
    const t = vt('page', swap, () => { document.documentElement.dataset.vtdir = dir || ''; vtName(from, 'ptitle'); });
    if (t) t.kind = 'page';
  };
  paint.live = true;
  try {
    await (VIEWS[r.name] || VIEWS[''])(r, paint);
    if (S.staleTok === tok && tok === S.tok) setTimeout(revalidate, 50);
  } catch (e) {
    if (e instanceof AuthError) return showLogin(e.message);
    if (opts.quiet && S.pageLive) { toast('Couldn’t refresh: ' + e.message); return; }
    paint('<div class="error"><strong>Couldn’t load this page.</strong><br>' + esc(e.message) + '<br><br><button class="btn small" data-onclick="App.reload()">Try again</button></div>');
  }
}
// The page on screen was drawn from out-of-date data: fetch what it needs again and redraw only if it changed.
async function revalidate() {
  const r = parseHash(), key = S.pageKey, tok = S.tok; let html = null;
  S.swrOff = (S.swrOff || 0) + 1;
  try { await (VIEWS[r.name] || VIEWS[''])(r, h => { html = h; }); }
  catch (e) { if (e instanceof AuthError) showLogin(e.message); return; }
  finally { S.swrOff--; }
  const busyHere = el('drawer').classList.contains('open') || (S.sel && S.sel.size) || !el('pickpop').hidden;
  if (tok === S.tok && key === S.pageKey && html !== null && html !== S.pageHtml && !busyHere) route({ quiet: true });
}
/* Fetch everything again. visible: show it right away (pull to refresh).
   Otherwise quietly re-fetch the current page and only redraw if something actually changed. */
async function refreshAll(opts = {}) {
  if (S.refreshing) return S.refreshing;
  S.refreshing = (async () => {
    S.freshAfter = Date.now(); S.lastRefresh = Date.now(); S.listsAt = 0; PAGES.clear();
    try {
      if (opts.visible) { await route({ quiet: true }); return; }
      const r = parseHash(), key = S.pageKey, tok = S.tok;
      let html = null;
      try { await (VIEWS[r.name] || VIEWS[''])(r, h => { html = h; }); }
      catch (e) { if (e instanceof AuthError) showLogin(e.message); return; }
      const busyHere = el('drawer').classList.contains('open') || (S.sel && S.sel.size) || !el('pickpop').hidden;
      if (tok === S.tok && key === S.pageKey && html !== null && html !== S.pageHtml && !busyHere) await route({ quiet: true });
    } finally {
      S.refreshing = null;
      warmTabs();
    }
  })();
  return S.refreshing;
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
  if (document.visibilityState === 'visible' && !el('app').hidden && S.key && Date.now() - (S.lastRefresh || 0) > 5 * 60 * 1000) refreshAll();
});
// Tapping the tab you're already on scrolls back to the top.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('.tabbar a, .nav a'); if (!a) return;
  const h = a.getAttribute('href'), cur = location.hash || '#/';
  if (h === cur || (h === '#/' && cur === '#')) { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (a.closest('.tabbar') && document.documentElement.classList.contains('shell')) S.tabNav = true;   // app-style: tabs switch instantly
});

/* ================= Overview ================= */
VIEWS[''] = async (r, paint) => {
  const L = await lists();
  const cur = monthRange(S.y, S.m), prev = monthRange(S.y, S.m - 1);
  const months = [...Array(6)].map((_, i) => monthRange(S.y, S.m - 5 + i));
  const p = x => ({ start: x.start, end: x.end });
  const future = S.y > today.getFullYear() || (S.y === today.getFullYear() && S.m > today.getMonth());
  const uncatQ = 'has_no_category:true transaction_type:withdrawal date_after:' + cur.start + ' date_before:' + cur.end;
  const own = L.accounts.filter(a => a.active);
  const cash = own.filter(a => isAsset(a) && !isCard(a)), cards = own.filter(isCard), loans = own.filter(isLiab);
  // Everything is requested at once (the main numbers first, so they reach Firefly first). The page is drawn
  // as soon as those are in; the slower cards show placeholders and fill in when their data arrives.
  const coreP = Promise.all([
    api('/summary/basic', { params: p(cur) }).catch(() => ({})),
    api('/insight/expense/category', { params: p(cur) }), api('/insight/expense/category', { params: p(prev) }),
    api('/insight/expense/no-category', { params: p(cur) }).catch(() => []), api('/insight/expense/no-category', { params: p(prev) }).catch(() => []),
    Promise.all(months.map(mo => Promise.all([api('/insight/income/total', { params: p(mo) }), api('/insight/expense/total', { params: p(mo) })])
      .then(([i, e]) => ({ label: mo.short, income: sumDiff(i), spend: sumDiff(e), go: 'month:' + mo.y + ':' + mo.m })))),
    api('/transactions', { params: { limit: 8, page: 1 } }),
    api('/budgets', { params: p(cur) }), budgetLimits(cur, L),
    getAll('/bills', { start: todayIso(), end: addDays(todayIso(), 45) }),      // same request as the safe-to-spend card
    future ? null : api('/search/transactions', { params: { query: uncatQ, search: uncatQ, limit: 1, page: 1 } }).catch(() => null),
  ]);
  const slowP = Promise.all([loanHistory(loans), App.safeCard(),
    coreP.then(c => App.insightCards({ cur, future, budgets: arr(c[7]), limits: c[8], cards, trend: c[5] })).catch(() => ''),
    App.balanceSparks([...cash, ...cards]).catch(() => ({})),
    future ? [] : getAll('/transactions', { start: cur.start, end: cur.end, type: 'withdrawal' }).catch(() => []),
    api('/insight/income/revenue', { params: p(cur) }).catch(() => [])]);
  slowP.catch(() => {});
  const [summary, catNow, catPrev, noCatNow, noCatPrev, trend, recent, budgets, limits, bills, uncat] = await coreP;
  const nwKey = Object.keys(summary || {}).find(k => k.startsWith('net-worth-in'));
  const computedNW = own.filter(isAsset).reduce((s, a) => s + a.balance, 0) - loans.reduce((s, l) => s + l.debt, 0);
  const netWorth = nwKey ? num(summary[nwKey].monetary_value) : computedNW;
  const last = trend[5], before = trend[4];

  // categories
  const cats = new Map();
  arr(catNow).forEach(x => cats.set(x.name, { name: x.name, id: x.id, amt: absDiff(x), prev: 0 }));
  arr(catPrev).forEach(x => { const c = cats.get(x.name) || { name: x.name, id: x.id, amt: 0, prev: 0 }; c.prev = absDiff(x); cats.set(x.name, c); });
  const un = sumDiff(noCatNow), unP = sumDiff(noCatPrev);
  if (un || unP) cats.set('Uncategorized', { name: 'Uncategorized', amt: un, prev: unP });

  const build = slow => {
    const [prog, safe, insights, sparks, dayTx, incomeSrc] = slow || [];
    const wait = k => slow ? null : skeletonPanel(k);
    const W = [
      ['safe', future ? '' : wait('safe') ?? safe],
      ['attention', attentionPanel({ uncat, uncatQ, bills: arr(bills), budgets: arr(budgets), limits, future })],
      ['spending', spendingPanel([...cats.values()], future)],
      ['budgets', budgetsMini(arr(budgets), limits)],
      ['cash', balancesPanel('Cash & savings', 'Bank account balances', cash, a => a.balance, false, sparks)],
      ['cards', balancesPanel('Credit cards', 'Current balances owed', cards, a => Math.max(0, -a.balance), true, sparks)],
      ['loans', loans.length ? wait('loans') ?? loansPanel(loans, prog) : loansPanel(loans, {})], ['bills', billsMini(arr(bills))],
      ['heatmap', future ? '' : wait('heatmap') ?? App.heatmapPanel(cur, dayTx.map(normGroup))],
      ['flow', future ? '' : wait('flow') ?? App.sankeyPanel(arr(incomeSrc), last.income, [...cats.values()].filter(c => c.amt > 0), cur)],
      ['cashflow', '<section class="panel chart">' + cashFlow(trend) + '</section>'],
      ['recent', '<section class="panel flush"><div style="padding:24px 26px 6px" class="panel-head"><div><h2>Recent transactions</h2></div><a class="link" href="#/transactions">See all</a></div>' +
          txRows(arr(recent).map(normGroup)) + '</section>'],
    ];
    const ins = slow ? insights : future ? '' : '<div class="insights" id="insights" aria-hidden="true">' + '<div class="insight"><div class="sk" style="width:100%;height:42px"></div></div>'.repeat(3) + '</div>';
    return head('Overview', '', monthNav() + App.dashButton()) + heroHtml(netWorth, last, before, prev.short, future) + ins + App.dashboard(W);
  };
  // Saved data (or a fast server): everything is here already, draw once.
  const quick = await Promise.race([slowP, sleep(60).then(() => null)]);
  if (quick || !paint.live) return paint(build(quick || await slowP));
  const first = build(null), tok = S.tok;
  paint(first);
  const full = build(await slowP);
  if (tok !== S.tok) return;
  if (S.pageHtml !== first || !fillIn(full)) paint(full);
};
// Replace only the placeholders and the cards that changed, so the numbers already on screen don't redraw.
function fillIn(html) {
  const v = el('view'), t = document.createElement('template'); t.innerHTML = html;
  const olds = [...v.querySelectorAll('#dash > .w')], news = [...t.content.querySelectorAll('#dash > .w')];
  if (olds.map(w => w.dataset.w).join() !== news.map(w => w.dataset.w).join()) return false;      // a card came or went: redraw it all
  const insOld = v.querySelector('#insights'), insNew = t.content.querySelector('#insights');
  if (insOld) insNew ? insOld.replaceWith(insNew) : insOld.remove();
  olds.forEach((o, i) => { if (news[i].innerHTML !== o.innerHTML) o.replaceWith(news[i]); });
  S.pageHtml = html;
  bindSwipe();
  return true;
}
function skeletonPanel(k) {
  const h = { safe: 70, loans: 90, heatmap: 230, flow: 240 }[k] || 120;
  return '<section class="panel" aria-busy="true"><h2>' + esc(DASH_NAMES[k] || '') + '</h2><p class="lead">&nbsp;</p><div class="sk" style="height:' + h + 'px"></div></section>';
}
function attentionPanel({ uncat, uncatQ, bills, budgets, limits, future }) {
  const items = [];
  const n = uncat && uncat.meta && uncat.meta.pagination ? uncat.meta.pagination.total : 0;
  if (n) items.push('<a class="row" href="#/inbox"><span class="name">🏷 ' + n + ' expense' + (n === 1 ? '' : 's') + ' without a category</span><span class="neutral">Categorize →</span></a>');
  const week = isoDate(new Date(Date.now() + 7 * 864e5));
  bills.filter(b => b.attributes.active !== false && !(b.attributes.paid_dates || []).length).forEach(b => {
    const d = String((b.attributes.pay_dates || [])[0] || '').slice(0, 10);
    if (d && d <= week) items.push('<a class="row" href="#/bills"><span class="name">📅 ' + esc(b.attributes.name) + ' due ' + fmtDay(d) + '</span><span class="num">' + money(billAmount(b.attributes)) + '</span></a>');
  });
  if (!future) budgets.forEach(b => {
    const lim = limits[String(b.id)], spent = Math.abs((b.attributes.spent || []).reduce((s, x) => s + num(x.sum), 0));
    if (lim && lim.amount && spent > lim.amount) items.push('<a class="row" href="#/transactions?budget=' + b.id + '"><span class="name">⚠️ ' + esc(b.attributes.name) + ' is over budget</span><span class="num up">' + money0(spent - lim.amount) + ' over</span></a>');
    else if (lim && lim.amount && spent > lim.amount * .85) items.push('<a class="row" href="#/transactions?budget=' + b.id + '"><span class="name">◔ ' + esc(b.attributes.name) + ' is at ' + Math.round(spent / lim.amount * 100) + '%</span><span class="num">' + money0(lim.amount - spent) + ' left</span></a>');
  });
  if (!items.length) return '';
  return '<section class="panel attention"><h2>Needs attention</h2><p class="lead">Quick things to tidy up</p><div class="list">' + items.join('') + '</div></section>';
}
function heroHtml(netWorth, last, before, prevShort, future) {
  const change = before.spend ? (last.spend - before.spend) / before.spend * 100 : 0, kept = last.income - last.spend;
  if (future && !last.spend) before = { spend: 0 };
  return '<section class="hero"><div><div class="eyebrow">Net worth</div><div class="big num' + (netWorth < 0 ? ' negative' : '') + '" data-count="' + netWorth + '">' + money0(netWorth) + '</div></div><div class="stats">' +
    '<div class="stat"><div class="eyebrow">Spent</div><div class="val num" data-count="' + last.spend + '">' + money0(last.spend) + '</div><div class="sub">' +
      (before.spend ? '<span class="' + (change > 0 ? 'up' : 'down') + '">' + (change > 0 ? '▲' : '▼') + ' ' + Math.abs(change).toFixed(0) + '%</span> vs ' + esc(prevShort) : '&nbsp;') + '</div></div>' +
    '<div class="stat"><div class="eyebrow">Earned</div><div class="val num" data-count="' + last.income + '">' + money0(last.income) + '</div><div class="sub">&nbsp;</div></div>' +
    '<div class="stat"><div class="eyebrow">Kept</div><div class="val num" data-count="' + kept + '">' + money0(kept) + '</div><div class="sub">' + (last.income ? (kept / last.income * 100).toFixed(0) + '% of income' : '&nbsp;') + '</div></div>' +
    '</div></section>';
}
function spendingPanel(cats, future) {
  cats = cats.filter(c => c.amt > 0 || (c.prev > 0 && !future)).sort((a, b) => b.amt - a.amt);
  if (cats.length > 8) {
    const rest = cats.slice(7); cats = cats.slice(0, 7);
    cats.push({ name: rest.length + ' others', amt: rest.reduce((s, c) => s + c.amt, 0), prev: rest.reduce((s, c) => s + c.prev, 0) });
  }
  const max = Math.max(1, ...cats.map(c => Math.max(c.amt, c.prev)));
  const rows = cats.map(c => {
    const d = c.amt - c.prev;
    const sub = !c.prev ? 'Nothing last month' : Math.abs(d) < 1 ? 'Same as last month' :
      '<span class="' + (d > 0 ? 'up' : 'down') + '">' + money0(Math.abs(d)) + ' ' + (d > 0 ? 'more' : 'less') + '</span> than last month';
    const name = c.id ? '<a href="#/transactions?category=' + c.id + '" style="text-decoration:none">' + esc(c.name) + '</a>' : esc(c.name);
    return '<div class="cat"><div class="row"><span class="name">' + name + '</span><span class="num">' + money0(c.amt) + '</span></div>' +
      '<div class="track"><div class="fill" style="width:' + (c.amt / max * 100).toFixed(1) + '%"></div>' +
      (c.prev ? '<div class="tick" style="left:calc(' + (c.prev / max * 100).toFixed(1) + '% - 1px)"></div>' : '') + '</div><div class="sub">' + sub + '</div></div>';
  }).join('');
  return '<section class="panel"><h2>Where it went</h2><p class="lead">Spending by category this month</p>' + (rows || '<p class="empty">' + (future ? 'This month hasn’t started yet.' : 'No spending recorded this month.') + '</p>') +
    (rows ? '<div class="legend"><span><i style="background:var(--spend)"></i>This month</span><span><i style="background:var(--text);opacity:.35;width:2px"></i>Last month</span></div>' : '') + '</section>';
}
function balancesPanel(title, lead, items, val, paidOff, sparks = {}) {
  const rows = [...items].sort((a, b) => val(b) - val(a)).map(a => '<a class="row" href="#/account/' + a.id + '"><span class="name">' + esc(a.name) + '</span>' +
    (sparks[a.id] ? App.sparkline(sparks[a.id], paidOff) : '') + '<span class="num">' +
    (paidOff && !val(a) ? '<span class="down">Paid off</span>' : money(val(a))) + '</span></a>').join('');
  return '<section class="panel"><h2>' + title + '</h2><p class="lead">' + lead + '</p>' +
    (items.length ? '<div class="total num">' + money0(items.reduce((s, a) => s + val(a), 0)) + '</div><div class="list">' + rows + '</div>' : '<p class="empty">None yet.</p>') + '</section>';
}
function loansPanel(loans, prog = {}) {
  const rows = [...loans].sort((a, b) => b.debt - a.debt).map(l => {
    const pr = prog[l.id] || {}, paid = l.debt ? pr.pct ?? null : null;
    const months = pr.monthly > 0 && l.debt > 0 ? Math.ceil(l.debt / pr.monthly) : 0;
    const bits = [];
    if (paid !== null) bits.push(paid.toFixed(0) + '% paid' + (pr.repaid ? ' (' + money0(pr.repaid) + ' of ' + money0(pr.borrowed) + ')' : ' of ' + money0(pr.borrowed)));
    if (months) bits.push('about ' + months + ' month' + (months === 1 ? '' : 's') + ' to go at ' + money0(pr.monthly) + '/mo');
    else if (l.debt) bits.push('no payments in the last 3 months');
    if (!l.debt) bits.push('Paid off');
    return '<div style="padding:11px 0;border-top:1px solid var(--line)"><a class="row" href="#/account/' + l.id + '" style="text-decoration:none"><span class="name">' + esc(l.name) +
      '</span><span class="num">' + money0(l.debt) + '</span></a>' + (paid ? '<div class="track"><div class="fill good" style="width:' + paid.toFixed(1) + '%"></div></div>' : '') +
      '<div class="sub-s">' + bits.join(' · ') + '</div></div>';
  }).join('');
  return '<section class="panel"><div class="panel-head"><h2>Loans</h2><a class="link" href="#/loans">Plan payoff</a></div><p class="lead">Remaining balance and payoff progress</p>' +
    (loans.length ? '<div class="total num" style="margin-bottom:4px">' + money0(loans.reduce((s, l) => s + l.debt, 0)) + '</div>' + rows : '<p class="empty">No loans.</p>') + '</section>';
}
function cashFlow(trend) {
  const W = window.innerWidth < 600 ? 420 : 960, H = 210, top = 10, bottom = 28, n = trend.length;
  const max = Math.max(1, ...trend.flatMap(t => [t.income, t.spend])), slot = W / n, bw = Math.min(34, slot / 4);
  const yy = v => top + (H - top - bottom) * (1 - v / max);
  const bars = trend.map((t, i) => {
    const cx = slot * i + slot / 2;
    return '<rect class="hit" x="' + (slot * i) + '" y="0" width="' + slot + '" height="' + H + '" fill="transparent" data-i="' + i + '"' + (t.go ? ' data-go="' + t.go + '" style="cursor:pointer"' : '') + '></rect>' +
      '<rect data-i="' + i + '" x="' + (cx - bw - 3) + '" y="' + yy(t.income) + '" width="' + bw + '" height="' + (H - bottom - yy(t.income)) + '" rx="6" fill="var(--income)" style="color:var(--income)' + (t.go ? ';cursor:pointer' : '') + '"><title>Earned ' + money0(t.income) + '</title></rect>' +
      '<rect data-i="' + i + '" x="' + (cx + 3) + '" y="' + yy(t.spend) + '" width="' + bw + '" height="' + (H - bottom - yy(t.spend)) + '" rx="6" fill="var(--spend)" style="color:var(--spend)' + (t.go ? ';cursor:pointer' : '') + '" opacity=".85"><title>Spent ' + money0(t.spend) + '</title></rect>' +
      '<text x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(t.label) + '</text>';
  }).join('');
  const avgS = trend.reduce((s, t) => s + t.spend, 0) / n, avgK = trend.reduce((s, t) => s + t.income - t.spend, 0) / n;
  S.chartData = trend;
  return '<h2>Cash flow</h2><p class="lead">Earned vs. spent over the last six months · click a month to open it</p><svg class="flowchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Income and spending by month">' +
    '<line x1="0" x2="' + W + '" y1="' + (H - bottom) + '" y2="' + (H - bottom) + '" stroke="var(--line)"/>' + bars + '</svg>' +
    '<div style="display:flex;gap:40px;margin-top:18px"><div><div class="eyebrow">Avg. spent / month</div><div class="num" style="font-size:21px">' + money0(avgS) + '</div></div>' +
    '<div><div class="eyebrow">Avg. kept / month</div><div class="num" style="font-size:21px">' + money0(avgK) + '</div></div></div>' +
    '<div class="legend"><span><i style="background:var(--income)"></i>Earned</span><span><i style="background:var(--spend)"></i>Spent</span></div>';
}
function budgetsMini(budgets, limits) {
  const rows = budgets.filter(b => b.attributes.active !== false).map(b => {
    const spent = Math.abs((b.attributes.spent || []).reduce((s, x) => s + num(x.sum), 0)), lim = limits[String(b.id)];
    const pct = lim ? spent / lim.amount * 100 : 0;
    return '<div class="cat"><div class="row"><a class="name" href="#/transactions?budget=' + b.id + '" style="text-decoration:none">' + esc(b.attributes.name) + '</a><span class="num">' + money0(spent) +
      (lim ? ' <span class="neutral">of ' + money0(lim.amount) + '</span>' : '') + '</span></div>' +
      (lim ? '<div class="track"><div class="fill ' + (pct > 100 ? 'over' : 'good') + '" style="width:' + Math.min(100, pct).toFixed(1) + '%"></div></div><div class="sub">' +
        (pct > 100 ? '<span class="up">' + money0(spent - lim.amount) + ' over</span>' : money0(lim.amount - spent) + ' left') + '</div>' : '<div class="sub">No amount set for this month</div>') + '</div>';
  }).join('');
  return '<section class="panel"><div class="panel-head"><h2>Budgets</h2><a class="link" href="#/budgets">Manage</a></div><p class="lead">This month</p>' + (rows || '<p class="empty">No budgets yet.</p>') + '</section>';
}
function billsMini(bills) {
  const up = bills.filter(b => b.attributes.active !== false).map(b => ({ b, next: (b.attributes.pay_dates || [])[0] || b.attributes.next_expected_match }))
    .filter(x => x.next).sort((a, b) => String(a.next).localeCompare(String(b.next)));
  const rows = up.map(({ b, next }) => '<div class="row"><span class="name">' + esc(b.attributes.name) + '<br><span class="sub-s">Due ' + fmtDate(next) + '</span></span><span class="num">' + money(billAmount(b.attributes)) + '</span></div>').join('');
  return '<section class="panel"><div class="panel-head"><h2>Coming up</h2><a class="link" href="#/bills">All bills</a></div><p class="lead">Bills due in the next 45 days</p>' +
    (rows ? '<div class="list">' + rows + '</div>' : '<p class="empty">Nothing due soon.</p>') + '</section>';
}

/* ================= Transactions page ================= */
VIEWS.transactions = async (r, paint) => {
  const L = await lists();
  const q = r.q, page = Math.max(1, +q.page || 1), type = q.type || 'all', search = (q.search || '').trim();
  const cur = monthRange(S.y, S.m);
  let endpoint = '/transactions', scope = '';
  const find = (list, id) => (list.find(x => x.id === id) || {}).name || '#' + id;
  if (q.budget) { endpoint = '/budgets/' + q.budget + '/transactions'; scope = 'Budget: ' + find(L.budgets, q.budget); }
  else if (q.category) { endpoint = '/categories/' + q.category + '/transactions'; scope = 'Category: ' + find(L.categories, q.category); }
  else if (q.tag) { endpoint = '/tags/' + q.tag + '/transactions'; scope = 'Tag: ' + find(L.tags, q.tag); }
  else if (q.bill) { endpoint = '/bills/' + q.bill + '/transactions'; scope = 'Bill: ' + find(L.bills, q.bill); }
  const query = search + (type !== 'all' ? ' transaction_type:' + type : '');
  const load = pg => search ? api('/search/transactions', { params: { query, search: query, page: pg, limit: PAGE_SIZE } })
    : api(endpoint, { params: { start: cur.start, end: cur.end, type, page: pg, limit: PAGE_SIZE } });
  const res = await load(page);
  const groups = arr(res).map(normGroup), pg = (res && res.meta && res.meta.pagination) || {};
  if (paint.live) { S.txPage = groups; S.sel = new Set(); }
  const pages = pg.total_pages || 1, total = pg.total ?? groups.length;
  if (paint.live) S.feed = { next: page + 1, pages: pg.total_pages || 1, opts: { select: true }, more: async n => arr(await load(n)).map(normGroup) };
  const tab = (t, label) => '<a href="' + hashWith({ type: t === 'all' ? '' : t, page: '' }) + '" class="' + (type === t ? 'on' : '') + '">' + label + '</a>';
  paint(
    head(scope || 'Transactions', search ? 'Search results across all dates' : total + ' transaction' + (total === 1 ? '' : 's') + ' in ' + cur.label +
      (scope ? ' · <a class="link" href="#/transactions">Show all</a>' : ''),
      (search ? '' : monthNav()) + '<button class="btn primary" data-onclick="App.newTx()">+ New transaction</button>') +
    '<div class="tabs">' + tab('all', 'All') + tab('withdrawal', 'Expenses') + tab('deposit', 'Income') + tab('transfer', 'Transfers') + '</div>' +
    '<div class="toolbar"><form class="search" data-onsubmit="event.preventDefault();App.search(this.q.value)">' + icon('search') +
      '<input type="search" name="q" placeholder="Search all transactions — try: amazon, category:Gas, amount_more:100" value="' + esc(search) + '"></form>' +
      (search ? '<button class="link" data-onclick="App.search(\'\')">Clear search</button>' : '') +
      (groups.length ? '<label class="check selall"><input type="checkbox" data-onchange="App.selAll(this.checked)"> Select all</label>' : '') + '</div>' +
    '<div id="bulkbar" class="bulkbar" hidden></div>' +
    '<section class="panel flush">' + txRows(groups, { select: true, empty: search ? 'Nothing matches that search.' : 'No transactions this month.' }) +
      (page < pages ? '<div class="more" id="feedMore"><span class="spin"></span>Loading older transactions…</div>' : '') +
    '</section>');
};

/* ================= Transaction form ================= */
function blankSplit() { return { jid: '', description: '', amount: '', counter: '', category: '', budget: '', bill: '', tags: '', notes: '', fa: '', fc: '', orig: {} }; }
function newTx(preset = {}) {
  const L = S.lists; S.drawerHero = null;
  const firstAsset = (L.own.find(a => isAsset(a) && !isCard(a)) || L.own[0] || {}).id || '';
  S.form = { id: '', type: preset.type || 'withdrawal', date: preset.date || todayIso(), title: '', main: preset.account || firstAsset, src: preset.account || firstAsset, dst: '', rules: true, splits: [blankSplit()] };
  if (preset.description) S.form.splits[0].description = preset.description;
  if (preset.amount) S.form.splits[0].amount = preset.amount;
  renderTxForm();
}
async function editTx(id) {
  const meta = S.txMeta && S.txMeta[id], row = document.querySelector('#view tr[data-gid="' + id + '"]');
  if (meta) {
    const g = meta.g, v = signed(g, meta.accountId);
    S.drawerHero = { id, av: avatarHtml(g, 'lg'), name: payeeOf(g).name, date: g.date, kicker: 'Transaction',
      amount: !meta.accountId && g.type === 'transfer' ? money(g.total) : (v > 0 ? '+' : '') + money(v) };
  } else S.drawerHero = null;
  const loading = '<div style="padding:8px 0">' + ['60%', '100%', '100%', '80%'].map(w => '<div class="sk" style="width:' + w + ';height:38px;margin-bottom:16px"></div>').join('') + '</div>';
  const rowAv = row && row.querySelector('.av');
  const opening = vt('drawer-open', () => { if (rowAv) rowAv.style.viewTransitionName = ''; openDrawer('Loading…', loading); vtName(el('drawer').querySelector('.dhero .av'), 'txav'); },
    () => vtName(rowAv, 'txav'));
  try {
    const [res] = await Promise.all([api('/transactions/' + id), lists()]);
    if (opening) await opening.updateCallbackDone.catch(() => {});   // the drawer shell must be in place before the form goes in
    const g = normGroup(res.data), f = g.splits[0];
    S.form = {
      id: g.id, type: g.type, date: String(g.date).slice(0, 10), title: g.title, rules: false,
      main: g.type === 'deposit' ? f.destination_id : f.source_id, src: f.source_id, dst: f.destination_id,
      splits: g.splits.map(s => {
        const x = { jid: s.jid, description: s.description, amount: String(s.amount), counter: g.type === 'deposit' ? s.source_name : s.destination_name,
          category: s.category, budget: s.budget_id, bill: s.bill_id, tags: s.tags.join(', '), notes: s.notes, fa: s.fa, fc: s.fc };
        x.orig = { ...x };
        return x;
      }),
    };
    if (!['withdrawal', 'deposit', 'transfer'].includes(g.type)) {
      openDrawer('Transaction', '<p>This is a <strong>' + esc(g.type) + '</strong> transaction (' + money(g.total) + ' on ' + fmtDate(g.date) + '). Edit it in Firefly III.</p>',
        '<button class="btn danger" data-onclick="App.deleteTx()">Delete</button><span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Close</button>');
      return;
    }
    renderTxForm();
  } catch (e) {
    if (e instanceof AuthError) return showLogin(e.message);
    openDrawer('Transaction', '<div class="form-err">' + esc(e.message) + '</div>');
  }
}
function accountOptions(sel, allowEmpty) {
  const L = S.lists;
  const group = (label, list) => list.length ? '<optgroup label="' + label + '">' + list.map(a => opt(a.id, a.name, sel)).join('') + '</optgroup>' : '';
  return (allowEmpty ? opt('', 'Choose…', sel) : '') + group('Bank accounts', L.own.filter(a => isAsset(a) && !isCard(a))) + group('Credit cards', L.own.filter(isCard)) + group('Loans & debts', L.own.filter(isLiab));
}
function renderTxForm() {
  const f = S.form, L = S.lists, multi = f.splits.length > 1;
  const typeBtn = (t, label) => '<button type="button" class="' + (f.type === t ? 'on' : '') + '" data-onclick="App.txType(\'' + t + '\')">' + label + '</button>';
  const counterList = f.type === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  let accountsHtml;
  if (f.type === 'transfer') {
    accountsHtml = '<div class="grid2"><label>From<select id="f-src" required>' + accountOptions(f.src, true) + '</select></label><label>To<select id="f-dst" required>' + accountOptions(f.dst, true) + '</select></label></div>';
  } else {
    accountsHtml = '<label>' + (f.type === 'withdrawal' ? 'Paid from' : 'Deposited into') + '<select id="f-main" required>' + accountOptions(f.main, true) + '</select></label>';
  }
  const splitHtml = f.splits.map((s, i) =>
    '<div class="split" data-i="' + i + '">' +
      (multi ? '<div class="split-head"><span>Split ' + (i + 1) + '</span><button type="button" class="link" data-onclick="App.removeSplit(' + i + ')">Remove</button></div>' : '') +
      '<label>Description<input type="text" data-k="description" value="' + esc(s.description) + '" required></label>' +
      '<div class="grid2"><label>Amount<input type="number" data-k="amount" value="' + esc(s.amount) + '" step="0.01" min="0.01" inputmode="decimal" required></label>' +
        (f.type !== 'transfer' ? '<label>' + (f.type === 'withdrawal' ? 'Paid to' : 'Received from') + '<input type="text" data-k="counter" list="dl-counter" value="' + esc(s.counter) + '" placeholder="Name" data-onchange="App.payeeFill(' + i + ', this.value)"></label>' : '<span></span>') + '</div>' +
      '<div class="grid2"><label>Category<input type="text" data-k="category" list="dl-cat" value="' + esc(s.category) + '" placeholder="None"></label>' +
        (f.type === 'withdrawal' ? '<label>Budget<select data-k="budget">' + opt('', 'None', s.budget) + L.budgets.filter(b => b.active || b.id === s.budget).map(b => opt(b.id, b.name, s.budget)).join('') + '</select></label>' : '<span></span>') + '</div>' +
      '<div class="grid2">' + (f.type === 'withdrawal' ? '<label>Bill<select data-k="bill">' + opt('', 'None', s.bill) + L.bills.map(b => opt(b.id, b.name, s.bill)).join('') + '</select></label>' : '<span></span>') +
        '<label>Tags<input type="text" data-k="tags" list="dl-tags" value="' + esc(s.tags) + '" placeholder="Comma separated"></label></div>' +
      (L.foreign.length ? '<div class="grid2"><label>Foreign amount (optional)<input type="number" data-k="fa" step="0.01" min="0" value="' + esc(s.fa) + '"></label>' +
        '<label>Foreign currency<select data-k="fc">' + opt('', 'None', s.fc) + L.foreign.map(c => opt(c.code, c.code + ' · ' + c.name, s.fc)).join('') + '</select></label></div>' : '') +
      '<label>Notes<textarea data-k="notes" rows="2">' + esc(s.notes) + '</textarea></label>' +
    '</div>').join('');
  const body =
    '<form id="txForm" data-onsubmit="event.preventDefault();App.saveTx(this)">' +
    (f.id ? '' : '<div class="nlq">' + icon('spark') + '<input type="text" id="nlq" value="' + esc(f.nl || '') + '" placeholder="Describe it — e.g. starbucks 5.40 amex yesterday" autocomplete="off" enterkeyhint="done" ' +
      'data-oninput="App.nlParse(this.value)" data-onkeydown="App.nlKey(event,this)"><div id="nlChips" class="nlchips">' + (f.nlChips || '') + '</div></div>') +
    '<div class="seg">' + typeBtn('withdrawal', 'Expense') + typeBtn('deposit', 'Income') + typeBtn('transfer', 'Transfer') + '</div>' +
    '<label>Date<input type="date" id="f-date" value="' + esc(f.date) + '" required></label>' + accountsHtml +
    (multi ? '<label>Title for the whole transaction<input type="text" id="f-title" value="' + esc(f.title) + '" required></label>' : '') +
    splitHtml +
    '<button type="button" class="btn small" data-onclick="App.addSplit()" style="margin-bottom:18px">+ Split into another part</button>' +
    '<label class="check"><input type="checkbox" id="f-rules"' + (f.rules ? ' checked' : '') + '> Run my Firefly rules on this transaction</label>' +
    '<datalist id="dl-counter">' + counterList.map(a => '<option value="' + esc(a.name) + '">').join('') + '</datalist>' +
    '<datalist id="dl-cat">' + L.categories.map(c => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' +
    '<datalist id="dl-tags">' + L.tags.map(t => '<option value="' + esc(t.name) + '">').join('') + '</datalist>' +
    '<button type="submit" hidden></button></form>' + (f.id ? '<div id="txExtras"><p class="sub-s">Loading attachments and links…</p></div>' : '');
  const foot = (f.id ? '<button class="btn danger" type="button" data-onclick="App.deleteTx()">Delete</button>' : '') + '<span class="grow"></span>' +
    '<button class="btn" type="button" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" type="button" id="txSave" data-onclick="App.submit(\'txForm\')">' + (f.id ? 'Save changes' : 'Add transaction') + '</button>';
  const wasOpen = el('drawer').classList.contains('open') && el('txForm');
  const scroll = wasOpen ? el('drawerBody').scrollTop : 0;
  openDrawer(f.id ? 'Edit transaction' : 'New transaction', body, foot);
  if (wasOpen) el('drawerBody').scrollTop = scroll;
  if (f.id && window.App.loadTxExtras) App.loadTxExtras(f.id, f.splits.map(s => s.jid).filter(Boolean));
}
function collectTx() {
  const f = S.form; if (!f || !el('txForm')) return;
  const v = id => el(id) ? el(id).value : undefined;
  f.date = v('f-date') ?? f.date; f.title = v('f-title') ?? f.title; f.rules = el('f-rules') ? el('f-rules').checked : f.rules;
  if (el('f-main')) f.main = v('f-main');
  if (el('f-src')) f.src = v('f-src');
  if (el('f-dst')) f.dst = v('f-dst');
  document.querySelectorAll('#txForm .split').forEach(card => {
    const s = f.splits[+card.dataset.i];
    card.querySelectorAll('[data-k]').forEach(inp => { s[inp.dataset.k] = inp.value; });
  });
}
function resolveCounter(name, kind) {
  const L = S.lists, pool = kind === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  const hit = pool.find(a => sameName(a.name, name));
  return hit ? { id: hit.id } : { name: name.trim() };
}
function buildTxPayload() {
  const f = S.form, edit = !!f.id;
  const txs = f.splits.map(s => {
    const o = { type: f.type, date: f.date, amount: String(Math.abs(num(s.amount))), description: s.description.trim() };
    if (edit && s.jid) o.transaction_journal_id = s.jid;
    const changed = k => !edit || !s.jid || String(s[k] || '') !== String((s.orig || {})[k] || '');
    if (f.type === 'withdrawal') {
      o.source_id = f.main;
      if (s.counter.trim()) { const c = resolveCounter(s.counter, 'withdrawal'); c.id ? (o.destination_id = c.id) : (o.destination_name = c.name); }
      if (changed('budget')) o.budget_id = s.budget || '0';
      if (changed('bill')) o.bill_id = s.bill || '0';
    } else if (f.type === 'deposit') {
      o.destination_id = f.main;
      if (s.counter.trim()) { const c = resolveCounter(s.counter, 'deposit'); c.id ? (o.source_id = c.id) : (o.source_name = c.name); }
    } else {
      o.source_id = f.src; o.destination_id = f.dst;
    }
    if (changed('category')) o.category_name = s.category.trim();
    if (changed('tags')) o.tags = s.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (changed('notes')) o.notes = s.notes;
    if (changed('fa') || changed('fc')) {
      if (s.fa && num(s.fa) > 0 && s.fc) { o.foreign_amount = String(num(s.fa)); o.foreign_currency_code = s.fc; }
      else if (edit && s.jid) { o.foreign_amount = '0'; }
    }
    // On edit, fields left out stay as they are in Firefly, so only changed ones are sent.
    return o;
  });
  const body = { apply_rules: f.rules, fire_webhooks: true, transactions: txs };
  if (txs.length > 1) body.group_title = f.title.trim();
  if (!edit) body.error_if_duplicate_hash = false;
  return body;
}
async function saveTx(formEl) {
  collectTx();
  const f = S.form;
  if (f.type === 'transfer') {
    if (!f.src || !f.dst) return formError('Choose both accounts for the transfer.');
    if (f.src === f.dst) return formError('A transfer needs two different accounts.');
  } else if (!f.main) return formError('Choose the account.');
  for (const s of f.splits) {
    if (s.fa && num(s.fa) > 0 && !s.fc) return formError('Pick the currency for the foreign amount.');
    if (!s.description.trim()) return formError('Every part needs a description.');
    if (!(num(s.amount) > 0)) return formError('Every part needs an amount above zero.');
  }
  // Optimistic: close right away and show the change; if Firefly refuses, reopen the form with the error.
  const body = buildTxPayload(), row = f.id && document.querySelector('#view tr[data-gid="' + f.id + '"]');
  closeDrawer();
  if (row) {
    row.classList.add('saving');
    const d = row.querySelector('.desc'); if (d && f.splits.length === 1) d.textContent = f.splits[0].description;
    const a = row.querySelector('.amt'); if (a && f.splits.length === 1 && f.type !== 'transfer') a.textContent = (f.type === 'deposit' ? '+' : '-') + money(num(f.splits[0].amount)).replace('-', '');
    const c = row.querySelector('.catcol span'); if (c && f.splits.length === 1) { c.textContent = f.splits[0].category || '—'; }
  } else toast('Saving…');
  if (window.App && App.buzz) App.buzz(8);
  try {
    if (f.id) await api('/transactions/' + f.id, { method: 'PUT', body });
    else await api('/transactions', { method: 'POST', body });
    invalidate(); toast(f.id ? 'Transaction updated' : 'Transaction added'); route();
  } catch (e) {
    if (e instanceof AuthError) return showLogin(e.message);
    if (row) row.classList.remove('saving');
    S.drawerHero = null; S.form = f; renderTxForm(); formError(e.message);
  }
}
async function deleteTx() {
  const f = S.form; if (!f || !f.id) return;
  closeDrawer();
  App.softDeleteTx([f.id]);
}

/* ================= Accounts ================= */
const ROLE_LABEL = { defaultAsset: 'Checking / default', savingAsset: 'Savings', sharedAsset: 'Shared', cashWalletAsset: 'Cash wallet', ccAsset: 'Credit card' };
VIEWS.accounts = async (r, paint) => {
  const L = await lists(true);
  const tab = r.q.tab || 'assets';
  const prog = tab === 'liabilities' ? await loanHistory(L.accounts.filter(isLiab)) : {};
  const show = r.q.inactive === '1';
  const sets = {
    assets: L.accounts.filter(a => isAsset(a) && !isCard(a)), cards: L.accounts.filter(isCard), liabilities: L.accounts.filter(isLiab),
    expense: L.accounts.filter(a => a.type === 'expense'), revenue: L.accounts.filter(a => a.type === 'revenue'),
  };
  let items = sets[tab] || []; const inactiveCount = items.filter(a => !a.active).length;
  if (!show) items = items.filter(a => a.active);
  const tabLink = (k, label) => '<a href="#/accounts?tab=' + k + '" class="' + (tab === k ? 'on' : '') + '">' + label + ' <span class="neutral">' + sets[k].filter(a => a.active).length + '</span></a>';
  let cols, row, total = '';
  if (tab === 'assets') {
    cols = '<th>Name</th><th class="hide-s">Type</th><th class="r">Balance</th>';
    row = a => '<td class="desc"><span class="nm">' + esc(a.name) + '</span></td><td class="hide-s neutral">' + esc(ROLE_LABEL[a.role] || a.role) + '</td><td class="amt">' + money(a.balance) + '</td>';
    total = money(items.reduce((s, a) => s + a.balance, 0)) + ' total';
  } else if (tab === 'cards') {
    cols = '<th>Name</th><th class="hide-s">Payment due</th><th class="r">Owed</th>';
    row = a => '<td class="desc"><span class="nm">' + esc(a.name) + '</span></td><td class="hide-s neutral">' + (a.paymentDate ? 'Day ' + new Date(String(a.paymentDate).slice(0, 10) + 'T12:00:00').getDate() + ' of the month' : '—') + '</td><td class="amt">' + (a.balance < 0 ? money(-a.balance) : '<span class="pos">Paid off</span>') + '</td>';
    total = money(items.reduce((s, a) => s + Math.max(0, -a.balance), 0)) + ' owed in total';
  } else if (tab === 'liabilities') {
    cols = '<th>Name</th><th class="hide-s">Paid off</th><th class="hide-s">Interest</th><th class="r">Remaining</th>';
    row = a => { const pr = prog[a.id] || {}; return '<td class="desc"><span class="nm">' + esc(a.name) + '</span><div class="sub-s" style="text-transform:capitalize">' + esc(a.liabType) + '</div></td><td class="hide-s" style="min-width:200px">' +
      (pr.pct != null ? '<div class="track" style="max-width:220px"><div class="fill good" style="width:' + (a.debt ? pr.pct : 100).toFixed(1) + '%"></div></div><div class="sub-s">' +
        (a.debt ? pr.pct.toFixed(0) + '% · ' + money0(pr.repaid) + ' of ' + money0(pr.borrowed) : 'Paid off') + '</div>' : '<span class="neutral">—</span>') + '</td><td class="hide-s neutral">' +
      (num(a.interest) ? num(a.interest) + '% ' + esc(a.interestPeriod) : '—') + '</td><td class="amt">' + money(a.debt) + '</td>'; };
    total = money(items.reduce((s, a) => s + a.debt, 0)) + ' owed in total';
  } else {
    cols = '<th>Name</th><th class="r"></th>';
    row = a => '<td class="desc"><span class="nm">' + esc(a.name) + '</span></td><td class="act neutral">View →</td>';
    total = items.length + ' ' + (tab === 'expense' ? 'payees' : 'income sources');
  }
  const body = items.length ? '<table class="tbl"><thead><tr>' + cols + '</tr></thead><tbody>' +
    items.sort((a, b) => a.name.localeCompare(b.name)).map(a => '<tr class="click" data-onclick="App.go(\'#/account/' + a.id + '\')"' + (a.active ? '' : ' style="opacity:.5"') + '>' + row(a) + '</tr>').join('') +
    '</tbody></table>' : '<div class="center-empty">Nothing here yet.</div>';
  paint(head('Accounts', total, '<button class="btn primary" data-onclick="App.accountForm(null,\'' + (tab === 'assets' ? 'asset' : tab === 'cards' ? 'card' : tab === 'liabilities' ? 'liability' : tab) + '\')">+ New account</button>') +
    '<div class="tabs">' + tabLink('assets', 'Bank accounts') + tabLink('cards', 'Credit cards') + tabLink('liabilities', 'Loans & debts') + tabLink('expense', 'Payees') + tabLink('revenue', 'Income sources') + '</div>' +
    '<section class="panel flush">' + body + '</section>' +
    (inactiveCount ? '<p style="margin-top:14px"><a class="link" href="' + hashWith({ inactive: show ? '' : '1' }) + '">' + (show ? 'Hide' : 'Show') + ' ' + inactiveCount + ' inactive</a></p>' : ''));
};
VIEWS.account = async (r, paint) => {
  const L = await lists();
  const accRes = await api('/accounts/' + r.id);
  const a = normAccount(accRes.data);
  const range = ['month', 'year', 'all'].includes(r.q.range) ? r.q.range : (isLiab(a) ? 'all' : 'month');
  const cur = monthRange(S.y, S.m);
  const period = range === 'month' ? { start: cur.start, end: cur.end, label: cur.label, short: cur.short }
    : range === 'year' ? { start: addDays(todayIso(), -365), end: todayIso(), label: 'the last 12 months', short: '12 mo' }
    : { label: 'all time', short: 'all time' };
  const txs = await getAll('/accounts/' + r.id + '/transactions', period.start ? { start: period.start, end: period.end } : {});
  const groups = txs.map(normGroup).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const kind = isCard(a) ? 'card' : isLiab(a) ? 'liability' : a.type;
  const own = isAsset(a) || isLiab(a);
  const headline = isCard(a) ? (a.balance < 0 ? money(-a.balance) + ' owed' : 'Paid off') : isLiab(a) ? money(a.debt) + ' remaining' : own ? money(a.balance) : '';
  const inflow = groups.reduce((s, g) => s + Math.max(0, signed(g, a.id)), 0), outflow = groups.reduce((s, g) => s + Math.max(0, -signed(g, a.id)), 0);
  const subtitle = '<span style="text-transform:capitalize">' + (isCard(a) ? 'Credit card' : isLiab(a) ? esc(a.liabType || 'Liability') : a.type === 'expense' ? 'Payee' : a.type === 'revenue' ? 'Income source' : (ROLE_LABEL[a.role] || 'Account')) + '</span>' +
    (a.active ? '' : ' · inactive') + (a.number ? ' · ' + esc(a.number) : '') +
    (isLiab(a) ? (a.plan && a.plan.amount ? ' · pays ' + esc(planText(a.plan)) : ' · <button class="link" data-onclick="App.accountForm(\'' + a.id + '\',\'liability\')">set a monthly payment</button>') : '');
  const PER = 50, pages = Math.max(1, Math.ceil(groups.length / PER)), page = 1;
  const shown = groups.slice(0, PER);
  if (paint.live) S.feed = { next: 2, pages, opts: { accountId: own ? a.id : '' }, more: async n => groups.slice((n - 1) * PER, n * PER) };
  const rangeBtn = (k, l) => '<button type="button" class="' + (range === k ? 'on' : '') + '" data-onclick="App.go(\'' + hashWith({ range: k, page: '' }) + '\')">' + l + '</button>';
  const owedStyle = isLiab(a) || isCard(a);
  paint(
    '<p style="margin:0 0 6px"><a class="link" href="#/accounts">← Accounts</a></p>' +
    head(a.name, subtitle, (range === 'month' ? monthNav() : '') +
      (own ? '<button class="btn" data-onclick="App.newTxFor(\'' + a.id + '\')">+ Transaction</button>' : '') +
      (isAsset(a) || isLiab(a) ? '<a class="btn" href="#/reconcile/' + a.id + '">Reconcile</a>' : '') +
      '<button class="btn" data-onclick="App.accountForm(\'' + a.id + '\',\'' + kind + '\')">Edit</button>') +
    '<div class="seg" style="margin:-8px 0 20px">' + rangeBtn('month', 'Month') + rangeBtn('year', 'Last 12 months') + rangeBtn('all', 'All time') + '</div>' +
    '<div class="kpis">' +
      (own ? '<div class="kpi"><div class="eyebrow">' + (owedStyle ? 'Balance' : 'Current balance') + '</div><div class="val num">' + headline + '</div></div>' : '') +
      '<div class="kpi"><div class="eyebrow">' + (isLiab(a) ? 'Paid' : 'In') + ' · ' + period.short + '</div><div class="val num pos">' + money(inflow) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">' + (isLiab(a) ? 'Borrowed' : 'Out') + ' · ' + period.short + '</div><div class="val num neg">' + money(outflow) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Transactions</div><div class="val num">' + groups.length + '</div></div>' +
    '</div>' +
    (own ? '<section class="panel chart" style="margin-bottom:20px"><h2>' + (owedStyle && isLiab(a) ? 'Amount owed' : 'Balance') + ' · ' + period.label + '</h2><p class="lead">After each transaction</p>' + balanceChart(groups, a, range) + '</section>' : '') +
    (stripPlan(a.notes) ? '<section class="panel" style="margin-bottom:20px"><h2>Notes</h2><p style="margin:6px 0 0;white-space:pre-wrap">' + esc(stripPlan(a.notes)) + '</p></section>' : '') +
    '<section class="panel flush">' + txRows(shown, { accountId: own ? a.id : '', empty: 'No transactions in ' + period.label + '.' }) +
      (pages > 1 ? '<div class="more" id="feedMore"><span class="spin"></span>Loading older transactions…</div>' : '') +
    '</section>');
};
function balanceChart(groups, a, range) {
  const owed = isLiab(a);                       // loans read better as "amount owed" going down
  const pts = [];
  groups.flatMap(g => g.splits.map(s => ({ s, d: String(s.date) }))).sort((x, y) => x.d.localeCompare(y.d)).forEach(({ s, d }) => {
    let after = null;
    if (s.source_id === a.id && s.sba != null) after = num(s.sba);
    else if (s.destination_id === a.id && s.dba != null) after = num(s.dba);
    if (after !== null) pts.push({ d, v: owed ? -after : after, desc: s.description, amt: s.source_id === a.id ? -s.amount : s.amount });
  });
  if (!pts.length) return '<p class="empty">No activity in this period.</p>';
  const W = 960, H = 190, pl = 6, pr = 6, pt = 26, pb = 26;
  const vals = pts.map(p => p.v), lo = Math.min(...vals, owed ? 0 : Infinity), hi = Math.max(...vals);
  const span = (hi - lo) || 1, n = pts.length, long = range && range !== 'month';
  const t0 = new Date(pts[0].d.slice(0, 10) + 'T12:00:00').getTime(), t1 = new Date(pts[n - 1].d.slice(0, 10) + 'T12:00:00').getTime();
  const x = i => n === 1 ? W / 2 : long && t1 > t0 ? pl + (W - pl - pr) * (new Date(pts[i].d.slice(0, 10) + 'T12:00:00').getTime() - t0) / (t1 - t0) : pl + (W - pl - pr) * i / (n - 1);
  const y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
  let path = '';
  pts.forEach((p, i) => { path += (i ? ' H' + x(i).toFixed(1) + ' V' : 'M' + x(i).toFixed(1) + ' ') + y(p.v).toFixed(1); });
  const tip = p => { const ch = owed ? -p.amt : p.amt; return fmtDate(p.d) + '\n' + p.desc + '\n' + (ch > 0 ? '+' : '') + money(ch) + '  →  ' + money(p.v) + (owed ? ' owed' : ''); };
  const dots = pts.map((p, i) => '<g class="pt" data-tip="' + esc(tip(p)) + '"><circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="' + (n > 150 ? 6 : 11) + '" fill="transparent"/>' +
    (n <= 150 ? '<circle class="dot" cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="3.5" fill="var(--good)"/>' : '') + '</g>').join('');
  const zero = lo < 0 && hi > 0 ? '<line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line)" stroke-dasharray="4 4"/>' : '';
  const fd = long ? fmtDate : fmtDay;
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Balance over time">' + zero +
    '<path d="' + path + '" fill="none" stroke="var(--good)" stroke-width="2"/>' + dots +
    '<text x="' + pl + '" y="' + (H - 6) + '">' + fd(pts[0].d) + '</text><text x="' + (W - pr) + '" y="' + (H - 6) + '" text-anchor="end">' + fd(pts[n - 1].d) + '</text>' +
    '<text x="' + pl + '" y="14">' + (owed ? 'Highest owed ' : 'High ') + money0(hi) + '</text></svg>';
}
async function accountForm(id, kind) {
  const L = await lists();
  const a = id ? (L.byId[id] || normAccount((await api('/accounts/' + id)).data)) : null;
  S.form = { kind: kind || 'asset', id };
  const k = S.form.kind;
  const kinds = [['asset', 'Bank account'], ['card', 'Credit card'], ['liability', 'Loan or debt'], ['expense', 'Payee'], ['revenue', 'Income source']];
  let f = '<form id="accForm" data-onsubmit="event.preventDefault();App.saveAccount()">';
  if (!id) f += '<label>Kind of account<select id="a-kind" data-onchange="App.accountForm(null,this.value)">' + kinds.map(([v, l]) => opt(v, l, k)).join('') + '</select></label>';
  f += '<label>Name<input type="text" id="a-name" value="' + esc(a ? a.name : '') + '" required></label>';
  if (k === 'asset') {
    f += '<label>Type<select id="a-role">' + ['defaultAsset', 'savingAsset', 'sharedAsset', 'cashWalletAsset'].map(v => opt(v, ROLE_LABEL[v], a ? a.role : 'defaultAsset')).join('') + '</select></label>';
    f += '<label>Account number (optional)<input type="text" id="a-number" value="' + esc(a ? a.number : '') + '"></label>';
    if (!id) f += '<div class="grid2"><label>Starting balance<input type="number" step="0.01" id="a-open" placeholder="0.00"></label><label>As of<input type="date" id="a-opendate" value="' + todayIso() + '"></label></div>';
  } else if (k === 'card') {
    f += '<label>Payment due date<input type="date" id="a-paydate" value="' + esc(a && a.paymentDate ? String(a.paymentDate).slice(0, 10) : todayIso()) + '" required></label><p class="hint">Only the day of the month matters.</p>';
    if (!id) f += '<div class="grid2"><label>Amount owed now<input type="number" step="0.01" min="0" id="a-open" placeholder="0.00"></label><label>As of<input type="date" id="a-opendate" value="' + todayIso() + '"></label></div>';
  } else if (k === 'liability') {
    f += '<label>Type<select id="a-ltype">' + [['loan', 'Loan'], ['debt', 'Debt'], ['mortgage', 'Mortgage']].map(([v, l]) => opt(v, l, a ? a.liabType : 'loan')).join('') + '</select></label>';
    if (!id) f += '<div class="grid2"><label>Amount you owe<input type="number" step="0.01" min="0.01" id="a-open" required></label><label>As of<input type="date" id="a-opendate" value="' + todayIso() + '" required></label></div>';
    f += '<div class="grid2"><label>Interest %<input type="number" step="0.001" min="0" id="a-interest" value="' + esc(a ? num(a.interest) || '' : '') + '" placeholder="0"></label><label>Per<select id="a-iperiod">' +
      ['monthly', 'yearly', 'weekly', 'daily', 'quarterly', 'half-year'].map(v => opt(v, v, a ? a.interestPeriod || 'monthly' : 'monthly')).join('') + '</select></label></div>';
    const pl = (a && a.plan) || {};
    f += '<div class="grid2"><label>Monthly payment<input type="number" step="0.01" min="0" id="a-pamt" value="' + (pl.amount || '') + '" placeholder="e.g. 500"></label>' +
      '<label>Due day of the month<input type="number" min="1" max="31" step="1" id="a-pday" value="' + (pl.day || '') + '" placeholder="e.g. 30"></label></div>' +
      '<label>Paid from<select id="a-pfrom">' + opt('', 'Not set', pl.from || '') + L.own.filter(x => !isLiab(x)).map(x => opt(x.name, x.name, pl.from || '')).join('') + '</select></label>' +
      '<p class="hint">Used by the Overview, Forecast and Loan planner. Saved in the loan’s notes in Firefly.</p>';
  }
  if (id && (k === 'asset' || k === 'card' || k === 'liability')) {
    const ob = k === 'asset' ? a.opening : Math.abs(a.opening);
    f += '<div class="grid2"><label>' + (k === 'asset' ? 'Opening balance' : 'Opening amount owed') + '<input type="number" step="0.01" id="a-open" value="' + (a.opening ? ob : '') + '" placeholder="None"></label>' +
      '<label>Opening date<input type="date" id="a-opendate" value="' + esc(a.openingDate ? String(a.openingDate).slice(0, 10) : '') + '"></label></div>';
  }
  f += '<label>Notes<textarea id="a-notes" rows="3">' + esc(a ? (k === 'liability' ? stripPlan(a.notes) : a.notes) : '') + '</textarea></label>';
  if (id) f += '<label class="check"><input type="checkbox" id="a-active"' + (a.active ? ' checked' : '') + '> Active</label>';
  if (id && (k === 'asset' || k === 'card' || k === 'liability')) f += '<label class="check"><input type="checkbox" id="a-networth"' + (a.netWorth ? ' checked' : '') + '> Include in net worth</label>';
  f += '<button type="submit" hidden></button></form>';
  openDrawer(id ? 'Edit account' : 'New account', f,
    (id ? '<button class="btn danger" type="button" data-onclick="App.deleteAccount(\'' + id + '\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="accSave" data-onclick="App.submit(\'accForm\')">' + (id ? 'Save' : 'Create account') + '</button>');
}
async function saveAccount() {
  const { kind, id } = S.form, v = x => el(x) ? el(x).value.trim() : '';
  const b = { name: v('a-name'), notes: v('a-notes') };
  if (!b.name) return formError('Give the account a name.');
  if (kind === 'asset') { b.type = 'asset'; b.account_role = v('a-role'); b.account_number = v('a-number'); }
  if (kind === 'card') { b.type = 'asset'; b.account_role = 'ccAsset'; b.credit_card_type = 'monthlyFull'; b.monthly_payment_date = v('a-paydate'); }
  if (kind === 'liability') {
    b.type = 'liability'; b.liability_type = v('a-ltype'); b.liability_direction = 'credit'; b.interest = v('a-interest') || '0'; b.interest_period = v('a-iperiod');
    const day = parseInt(v('a-pday'), 10);
    if (v('a-pday') && !(day >= 1 && day <= 31)) return formError('The due day must be between 1 and 31.');
    b.notes = withPlan(b.notes, { amount: num(v('a-pamt')), day: day || null, from: v('a-pfrom') });
  }
  if (kind === 'expense' || kind === 'revenue') b.type = kind;
  if (id && el('a-open') && v('a-open') !== '') {
    const amt = Math.abs(num(v('a-open')));
    b.opening_balance = String(kind === 'card' || kind === 'liability' ? -amt : num(v('a-open')));
    b.opening_balance_date = v('a-opendate') || todayIso();
  }
  if (!id && el('a-open') && v('a-open') !== '') {
    const amt = Math.abs(num(v('a-open')));
    // Credit-card and loan balances are stored in Firefly as negative numbers (money owed).
    b.opening_balance = String(kind === 'card' || kind === 'liability' ? -amt : num(v('a-open')));
    b.opening_balance_date = v('a-opendate') || todayIso();
  }
  if (!id) b.currency_code = S.currency;
  if (id) { b.active = el('a-active').checked; if (el('a-networth')) b.include_net_worth = el('a-networth').checked; delete b.type; }
  await busy(el('accSave'), async () => {
    const res = id ? await api('/accounts/' + id, { method: 'PUT', body: b }) : await api('/accounts', { method: 'POST', body: b });
    invalidate(); closeDrawer(); toast(id ? 'Account saved' : 'Account created');
    if (!id && res && res.data) location.hash = '#/account/' + res.data.id; else route();
  });
}
async function deleteAccount(id) {
  if (!await confirmBox('Delete this account?', 'Firefly III will also delete every transaction that uses this account. This cannot be undone. To keep the history, uncheck "Active" instead.')) return;
  try { await api('/accounts/' + id, { method: 'DELETE' }); invalidate(); closeDrawer(); toast('Account deleted'); location.hash = '#/accounts'; }
  catch (e) { formError(e.message); }
}

/* ================= Budgets ================= */
async function budgetLimits(cur, L) {
  const out = {};
  const take = (bid, x) => { const at = x.attributes || {}; out[String(bid)] = { id: String(x.id), amount: num(at.amount) }; };
  try {
    const all = await getAll('/budget-limits', { start: cur.start, end: cur.end });
    all.forEach(x => take(x.attributes.budget_id, x));
  } catch (e) {
    await Promise.all(L.budgets.map(b => getAll('/budgets/' + b.id + '/limits', { start: cur.start, end: cur.end }).then(ls => ls.forEach(x => take(b.id, x))).catch(() => {})));
  }
  return out;
}
VIEWS.budgets = async (r, paint) => {
  const L = await lists();
  const cur = monthRange(S.y, S.m);
  const [res, limits, noBudget, avail] = await Promise.all([
    api('/budgets', { params: { start: cur.start, end: cur.end } }), budgetLimits(cur, L),
    api('/insight/expense/no-budget', { params: { start: cur.start, end: cur.end } }).catch(() => []),
    api('/available-budgets', { params: { start: cur.start, end: cur.end } }).catch(() => ({ data: [] })),
  ]);
  const available = arr(avail).reduce((s, x) => s + num(x.attributes.amount), 0);
  const showInactive = r.q.inactive === '1';
  const bs = arr(res).map(b => ({ id: String(b.id), name: b.attributes.name, active: b.attributes.active !== false, notes: b.attributes.notes || '',
    auto: b.attributes.auto_budget_type && b.attributes.auto_budget_type !== 'none' ? b.attributes.auto_budget_type : '', autoAmt: num(b.attributes.auto_budget_amount),
    spent: Math.abs((b.attributes.spent || []).reduce((s, x) => s + num(x.sum), 0)), lim: limits[String(b.id)] }));
  const visible = bs.filter(b => b.active || showInactive);
  const totLim = visible.reduce((s, b) => s + (b.lim ? b.lim.amount : 0), 0), totSpent = visible.reduce((s, b) => s + b.spent, 0), unb = sumDiff(noBudget);
  const rows = visible.map(b => {
    const pct = b.lim && b.lim.amount ? b.spent / b.lim.amount * 100 : 0;
    return '<tr' + (b.active ? '' : ' style="opacity:.5"') + '><td style="min-width:220px"><a class="desc" href="#/transactions?budget=' + b.id + '" style="text-decoration:none">' + esc(b.name) + '</a>' +
      (b.lim ? '<div class="track" style="max-width:360px"><div class="fill ' + (pct > 100 ? 'over' : 'good') + '" style="width:' + Math.min(100, pct).toFixed(1) + '%"></div></div><div class="sub-s">' +
        (pct > 100 ? '<span class="up">' + money(b.spent - b.lim.amount) + ' over</span>' : money(b.lim.amount - b.spent) + ' left · ' + pct.toFixed(0) + '% used') + '</div>' : '<div class="sub-s">No amount set for ' + cur.short + '</div>') +
      (b.auto ? '<span class="chip" title="Auto-budget">Auto ' + esc(b.auto) + ' · ' + money0(b.autoAmt) + '/mo</span>' : '') + '</td>' +
      '<td class="amt">' + money(b.spent) + '</td>' +
      '<td class="r"><input class="inline num" type="number" min="0" step="1" placeholder="Set…" value="' + (b.lim ? b.lim.amount : '') + '" data-onchange="App.setLimit(\'' + b.id + '\',this)" aria-label="Budget for ' + esc(b.name) + '"></td>' +
      '<td class="act"><button class="btn small" data-onclick="App.budgetForm(\'' + b.id + '\')">Edit</button></td></tr>';
  }).join('');
  const inactiveCount = bs.filter(b => !b.active).length;
  paint(head('Budgets', 'Set how much you plan to spend each month', monthNav() + '<button class="btn primary" data-onclick="App.budgetForm()">+ New budget</button>') +
    '<div class="kpis">' + (available ? '<div class="kpi"><div class="eyebrow">Available to budget</div><div class="val num">' + money0(available) + '</div><div class="sub-s">' +
        (available - totLim >= 0 ? money0(available - totLim) + ' not yet assigned' : '<span class="up">' + money0(totLim - available) + ' more assigned than available</span>') + '</div></div>' : '') +
      '<div class="kpi"><div class="eyebrow">Budgeted</div><div class="val num">' + money0(totLim) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Spent in budgets</div><div class="val num">' + money0(totSpent) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Left</div><div class="val num ' + (totLim - totSpent < 0 ? 'neg' : '') + '">' + money0(totLim - totSpent) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Spent outside budgets</div><div class="val num">' + money0(unb) + '</div></div></div>' +
    '<section class="panel flush">' + (rows ? '<table class="tbl"><thead><tr><th>Budget</th><th class="r">Spent</th><th class="r">Budget for ' + cur.short + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div class="center-empty">No budgets yet. Create one to start tracking.</div>') + '</section>' +
    (inactiveCount ? '<p style="margin-top:14px"><a class="link" href="' + hashWith({ inactive: showInactive ? '' : '1' }) + '">' + (showInactive ? 'Hide' : 'Show') + ' ' + inactiveCount + ' inactive</a></p>' : '') +
    '<p class="sub-s" style="margin-top:14px">Type an amount in the right column and press Enter to set that month’s budget. Clear it to remove it.</p>');
  S.budgetLimits = limits; S.budgetCache = Object.fromEntries(bs.map(b => [b.id, b]));
};
async function setLimit(bid, input) {
  const cur = monthRange(S.y, S.m), lim = (S.budgetLimits || {})[bid], val = input.value.trim();
  input.disabled = true;
  try {
    if (val === '' || num(val) <= 0) { if (lim) await api('/budgets/' + bid + '/limits/' + lim.id, { method: 'DELETE' }); }
    else if (lim) await api('/budgets/' + bid + '/limits/' + lim.id, { method: 'PUT', body: { amount: String(num(val)), start: cur.start, end: cur.end } });
    else await api('/budgets/' + bid + '/limits', { method: 'POST', body: { amount: String(num(val)), start: cur.start, end: cur.end, currency_code: S.currency } });
    toast('Budget updated'); route();
  } catch (e) { input.disabled = false; if (e instanceof AuthError) return showLogin(e.message); toast(e.message); }
}
async function budgetForm(id) {
  const L = await lists(true), b = id ? L.budgets.find(x => x.id === id) : null;
  S.form = { id };
  openDrawer(id ? 'Edit budget' : 'New budget',
    '<form id="budForm" data-onsubmit="event.preventDefault();App.saveBudget()"><label>Name<input type="text" id="b-name" value="' + esc(b ? b.name : '') + '" required></label>' +
    (!id ? '<label>Amount for ' + monthRange(S.y, S.m).label + ' (optional)<input type="number" min="0" step="1" id="b-amount"></label>' : '') +
    (() => { const bc = (S.budgetCache || {})[id] || {}; return '<div class="grid2"><label>Auto-budget<select id="b-auto">' +
      [['none', 'Off'], ['reset', 'Same amount every month'], ['rollover', 'Roll over what’s left'], ['adjusted', 'Adjust for overspending']].map(([v, l]) => opt(v, l, bc.auto || 'none')).join('') +
      '</select></label><label>Monthly amount<input type="number" min="0" step="1" id="b-autoamt" value="' + (bc.autoAmt || '') + '"></label></div><p class="hint">Auto-budget sets this budget’s amount at the start of each month for you.</p>'; })() +
    '<label>Notes<textarea id="b-notes" rows="3">' + esc(b ? b.notes : '') + '</textarea></label>' +
    (id ? '<label class="check"><input type="checkbox" id="b-active"' + (b.active ? ' checked' : '') + '> Active</label>' : '') + '<button type="submit" hidden></button></form>',
    (id ? '<button class="btn danger" data-onclick="App.deleteThing(\'budgets\',\'' + id + '\',\'budget\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="budSave" data-onclick="App.submit(\'budForm\')">' + (id ? 'Save' : 'Create budget') + '</button>');
}
async function saveBudget() {
  const id = S.form.id, name = el('b-name').value.trim();
  if (!name) return formError('Give the budget a name.');
  await busy(el('budSave'), async () => {
    const body = { name, notes: el('b-notes').value };
    const auto = el('b-auto').value, autoAmt = num(el('b-autoamt').value);
    if (auto !== 'none' && !(autoAmt > 0)) throw new Error('Set the monthly amount for the auto-budget.');
    body.auto_budget_type = auto;
    if (auto !== 'none') { body.auto_budget_amount = String(autoAmt); body.auto_budget_period = 'monthly'; body.auto_budget_currency_code = S.currency; }
    if (id) { body.active = el('b-active').checked; await api('/budgets/' + id, { method: 'PUT', body }); }
    else {
      const res = await api('/budgets', { method: 'POST', body: { ...body, active: true } });
      const amt = num(el('b-amount').value), cur = monthRange(S.y, S.m);
      if (amt > 0 && res && res.data) await api('/budgets/' + res.data.id + '/limits', { method: 'POST', body: { amount: String(amt), start: cur.start, end: cur.end, currency_code: S.currency } });
    }
    invalidate(); closeDrawer(); toast(id ? 'Budget saved' : 'Budget created'); route();
  });
}

/* ================= Categories & tags ================= */
VIEWS.categories = async (r, paint) => {
  const L = await lists(true);
  const cur = monthRange(S.y, S.m), prev = monthRange(S.y, S.m - 1), p = x => ({ start: x.start, end: x.end });
  const [spNow, spPrev, inNow] = await Promise.all([
    api('/insight/expense/category', { params: p(cur) }), api('/insight/expense/category', { params: p(prev) }),
    api('/insight/income/category', { params: p(cur) }).catch(() => []),
  ]);
  const by = res => Object.fromEntries(arr(res).map(x => [String(x.id), absDiff(x)]));
  const a = by(spNow), b = by(spPrev), c = by(inNow);
  const cats = L.categories.map(x => ({ ...x, now: a[x.id] || 0, prev: b[x.id] || 0, inc: c[x.id] || 0 })).sort((x, y) => y.now - x.now || x.name.localeCompare(y.name));
  const rows = cats.map(x => {
    const d = x.now - x.prev;
    return '<tr><td><a class="desc" href="#/transactions?category=' + x.id + '" style="text-decoration:none">' + esc(x.name) + '</a></td>' +
      '<td class="amt">' + (x.now ? money(x.now) : '<span class="neutral">—</span>') + '</td>' +
      '<td class="r hide-s sub-s">' + (x.prev ? (Math.abs(d) < 1 ? 'Same' : '<span class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '−') + money0(Math.abs(d)) + '</span>') + ' vs ' + money0(x.prev) : '') + '</td>' +
      '<td class="amt hide-s">' + (x.inc ? '<span class="pos">' + money(x.inc) + '</span>' : '<span class="neutral">—</span>') + '</td>' +
      '<td class="act"><button class="btn small" data-onclick="App.categoryForm(\'' + x.id + '\')">Edit</button></td></tr>';
  }).join('');
  const tags = L.tags.map(t => '<span class="chip"><a href="#/transactions?tag=' + t.id + '">' + esc(t.name) + '</a><button title="Delete tag" data-onclick="App.deleteTag(\'' + t.id + '\')">×</button></span>').join('');
  paint(head('Categories & tags', '', monthNav() + '<button class="btn primary" data-onclick="App.categoryForm()">+ New category</button>') +
    '<section class="panel flush" style="margin-bottom:28px">' + (rows ? '<table class="tbl"><thead><tr><th>Category</th><th class="r">Spent in ' + cur.short + '</th><th class="r hide-s">vs ' + prev.short + '</th><th class="r hide-s">Earned</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div class="center-empty">No categories yet.</div>') + '</section>' +
    '<section class="panel"><div class="panel-head"><div><h2>Tags</h2><p class="lead">Click a tag to see its transactions</p></div></div>' +
      '<form data-onsubmit="event.preventDefault();App.addTag(this.t)" style="display:flex;gap:10px;margin-bottom:18px;max-width:420px"><input type="text" name="t" placeholder="New tag name" style="flex:1" required><button class="btn">Add tag</button></form>' +
      (tags ? '<div class="tagcloud">' + tags + '</div>' : '<p class="empty">No tags yet.</p>') + '</section>');
};
async function categoryForm(id) {
  const L = await lists(), c = id ? L.categories.find(x => x.id === id) : null;
  S.form = { id };
  openDrawer(id ? 'Edit category' : 'New category',
    '<form id="catForm" data-onsubmit="event.preventDefault();App.saveCategory()"><label>Name<input type="text" id="c-name" value="' + esc(c ? c.name : '') + '" required></label>' +
    '<label>Notes<textarea id="c-notes" rows="3">' + esc(c ? c.notes : '') + '</textarea></label><button type="submit" hidden></button></form>',
    (id ? '<button class="btn danger" data-onclick="App.deleteThing(\'categories\',\'' + id + '\',\'category\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="catSave" data-onclick="App.submit(\'catForm\')">' + (id ? 'Save' : 'Create category') + '</button>');
}
async function saveCategory() {
  const id = S.form.id, name = el('c-name').value.trim();
  if (!name) return formError('Give the category a name.');
  await busy(el('catSave'), async () => {
    const body = { name, notes: el('c-notes').value };
    await api(id ? '/categories/' + id : '/categories', { method: id ? 'PUT' : 'POST', body });
    invalidate(); closeDrawer(); toast(id ? 'Category saved' : 'Category created'); route();
  });
}
async function addTag(input) {
  const tag = input.value.trim(); if (!tag) return;
  try { await api('/tags', { method: 'POST', body: { tag } }); invalidate(); toast('Tag added'); route(); }
  catch (e) { if (e instanceof AuthError) return showLogin(e.message); toast(e.message); }
}
async function deleteTag(id) {
  const t = (S.lists.tags.find(x => x.id === id) || {}).name || 'this tag';
  if (!await confirmBox('Delete tag “' + t + '”?', 'The tag is removed from all transactions. The transactions themselves stay.')) return;
  try { await api('/tags/' + id, { method: 'DELETE' }); invalidate(); toast('Tag deleted'); route(); }
  catch (e) { toast(e.message); }
}
async function deleteThing(path, id, noun) {
  const extra = { budget: 'Transactions in this budget are kept but will no longer have a budget.', category: 'Transactions keep existing but lose this category.',
    bill: 'Linked transactions are kept.', 'piggy bank': 'The money saved stays in your account; only the goal is removed.' }[noun] || '';
  if (!await confirmBox('Delete this ' + noun + '?', extra)) return;
  try { await api('/' + path + '/' + id, { method: 'DELETE' }); invalidate(); closeDrawer(); toast(noun[0].toUpperCase() + noun.slice(1) + ' deleted'); route(); }
  catch (e) { formError(e.message); }
}

/* ================= Bills ================= */
const FREQ = { daily: ['day', 30.44], weekly: ['week', 4.35], monthly: ['month', 1], quarterly: ['quarter', 1 / 3], 'half-year': ['6 months', 1 / 6], yearly: ['year', 1 / 12] };
const billAmount = at => at.amount_avg != null ? num(at.amount_avg) : (num(at.amount_min) + num(at.amount_max)) / 2;
VIEWS.bills = async (r, paint) => {
  await lists();
  const cur = monthRange(S.y, S.m);
  const bills = await getAll('/bills', { start: cur.start, end: cur.end });
  const active = bills.filter(b => b.attributes.active !== false);
  const monthly = active.reduce((s, b) => s + billAmount(b.attributes) * (FREQ[b.attributes.repeat_freq] || ['', 1])[1] / ((b.attributes.skip || 0) + 1), 0);
  const grp = b => b.attributes.object_group_title || '';
  const rows = bills.sort((a, b) => grp(a).localeCompare(grp(b)) || String((a.attributes.pay_dates || [])[0] || '9').localeCompare(String((b.attributes.pay_dates || [])[0] || '9'))).map((b, i, all) => {
    const heading = grp(b) && (i === 0 || grp(all[i - 1]) !== grp(b)) ? '<tr><td colspan="4" class="eyebrow" style="padding-top:18px">' + esc(grp(b)) + '</td></tr>' : '';
    const at = b.attributes, paid = (at.paid_dates || []).length, due = (at.pay_dates || [])[0];
    const f = FREQ[at.repeat_freq] || [at.repeat_freq, 1], every = (at.skip ? 'Every ' + (at.skip + 1) + ' ' + f[0] + 's' : 'Every ' + f[0]);
    const status = at.active === false ? '<span class="chip">Inactive</span>' : paid ? '<span class="chip good">Paid this month</span>' :
      due ? '<span class="chip warn">Due ' + fmtDay(due) + '</span>' : '<span class="chip">Next ' + esc(at.next_expected_match ? fmtDate(at.next_expected_match) : '—') + '</span>';
    const amt = num(at.amount_min) === num(at.amount_max) ? money(num(at.amount_min)) : money0(num(at.amount_min)) + '–' + money0(num(at.amount_max));
    return heading + '<tr' + (at.active === false ? ' style="opacity:.5"' : '') + '><td><a class="desc" href="#/transactions?bill=' + b.id + '" style="text-decoration:none">' + esc(at.name) + '</a><div class="sub-s">' + every + '</div></td>' +
      '<td>' + status + '</td><td class="amt">' + amt + '</td><td class="act"><button class="btn small" data-onclick="App.billForm(\'' + b.id + '\')">Edit</button></td></tr>';
  }).join('');
  S.billCache = Object.fromEntries(bills.map(b => [String(b.id), b.attributes]));
  paint(head('Bills', 'About ' + money0(monthly) + ' a month across ' + active.length + ' active bill' + (active.length === 1 ? '' : 's'), monthNav() + '<button class="btn primary" data-onclick="App.billForm()">+ New bill</button>') +
    '<section class="panel flush">' + (rows ? '<table class="tbl"><thead><tr><th>Bill</th><th>' + cur.label + '</th><th class="r">Amount</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div class="center-empty">No bills yet. Add rent, subscriptions or insurance to see what’s coming.</div>') + '</section>' +
    '<p class="sub-s" style="margin-top:14px">Firefly marks a bill paid when a transaction is linked to it — pick the bill in the transaction form, or let your rules do it.</p>');
};
function billForm(id) {
  const at = id ? (S.billCache || {})[id] : null;
  S.form = { id };
  openDrawer(id ? 'Edit bill' : 'New bill',
    '<form id="billForm" data-onsubmit="event.preventDefault();App.saveBill()"><label>Name<input type="text" id="bl-name" value="' + esc(at ? at.name : '') + '" required></label>' +
    '<div class="grid2"><label>Lowest amount<input type="number" step="0.01" min="0" id="bl-min" value="' + esc(at ? num(at.amount_min) : '') + '" required></label>' +
    '<label>Highest amount<input type="number" step="0.01" min="0" id="bl-max" value="' + esc(at ? num(at.amount_max) : '') + '" required></label></div><p class="hint">Use the same number twice for a fixed amount.</p>' +
    '<label>' + (id ? 'First due date' : 'Next due date') + '<input type="date" id="bl-date" value="' + esc(at ? String(at.date).slice(0, 10) : todayIso()) + '" required></label>' +
    '<div class="grid2"><label>Repeats<select id="bl-freq">' + Object.keys(FREQ).map(k => opt(k, k === 'half-year' ? 'every 6 months' : k, at ? at.repeat_freq : 'monthly')).join('') + '</select></label>' +
    '<label>Skip<input type="number" min="0" step="1" id="bl-skip" value="' + esc(at ? at.skip || 0 : 0) + '"></label></div><p class="hint">Skip 1 with “monthly” means every other month.</p>' +
    '<label>Group (optional)<input type="text" id="bl-group" list="dl-groups" value="' + esc(at ? at.object_group_title || '' : '') + '" placeholder="e.g. Housing, Subscriptions"></label>' +
    '<datalist id="dl-groups">' + [...new Set(Object.values(S.billCache || {}).map(x => x.object_group_title).filter(Boolean))].map(g => '<option value="' + esc(g) + '">').join('') + '</datalist>' +
    '<label>Notes<textarea id="bl-notes" rows="3">' + esc(at ? at.notes || '' : '') + '</textarea></label>' +
    '<label class="check"><input type="checkbox" id="bl-active"' + (!at || at.active !== false ? ' checked' : '') + '> Active</label><button type="submit" hidden></button></form>',
    (id ? '<button class="btn danger" data-onclick="App.deleteThing(\'bills\',\'' + id + '\',\'bill\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="billSave" data-onclick="App.submit(\'billForm\')">' + (id ? 'Save' : 'Create bill') + '</button>');
}
async function saveBill() {
  const id = S.form.id, v = x => el(x).value.trim();
  const mn = num(v('bl-min')), mx = num(v('bl-max'));
  if (!v('bl-name')) return formError('Give the bill a name.');
  if (mx < mn) return formError('The highest amount can’t be below the lowest.');
  const body = { name: v('bl-name'), amount_min: String(mn), amount_max: String(mx), date: v('bl-date'), repeat_freq: v('bl-freq'), skip: parseInt(v('bl-skip') || '0', 10), active: el('bl-active').checked, notes: el('bl-notes').value, object_group_title: v('bl-group') };
  if (!id) body.currency_code = S.currency;
  await busy(el('billSave'), async () => {
    await api(id ? '/bills/' + id : '/bills', { method: id ? 'PUT' : 'POST', body });
    invalidate(); closeDrawer(); toast(id ? 'Bill saved' : 'Bill created'); route();
  });
}

/* ================= Piggy banks ================= */
function normPiggy(p) {
  const at = p.attributes || {};
  const accounts = (at.accounts || []).map(x => ({ id: String(x.account_id ?? x.id), name: x.name || x.account_name || '', amount: num(x.current_amount) }));
  if (!accounts.length && at.account_id) accounts.push({ id: String(at.account_id), name: at.account_name || '', amount: num(at.current_amount) });
  return { id: String(p.id), name: at.name, target: num(at.target_amount), current: num(at.current_amount), left: num(at.left_to_save), perMonth: num(at.save_per_month),
    targetDate: at.target_date || '', startDate: at.start_date || '', notes: at.notes || '', active: at.active !== false, accounts, group: at.object_group_title || '' };
}
VIEWS.piggy = async (r, paint) => {
  const L = await lists();
  const piggies = (await getAll('/piggy-banks')).map(normPiggy);
  S.piggyCache = Object.fromEntries(piggies.map(p => [p.id, p]));
  const saved = piggies.reduce((s, p) => s + p.current, 0), goal = piggies.reduce((s, p) => s + p.target, 0);
  piggies.sort((a, b) => a.group.localeCompare(b.group));
  const cards = piggies.map((p, i) => {
    const heading = p.group && (i === 0 || piggies[i - 1].group !== p.group) ? '<div class="eyebrow" style="grid-column:1/-1;margin:6px 0 -6px">' + esc(p.group) + '</div>' : '';
    const pct = p.target ? Math.min(100, p.current / p.target * 100) : 0;
    return heading + '<section class="panel"><div class="panel-head"><h2>' + esc(p.name) + '</h2><button class="btn small" data-onclick="App.piggyForm(\'' + p.id + '\')">Edit</button></div>' +
      '<p class="lead">' + esc(p.accounts.map(a => a.name || (L.byId[a.id] || {}).name).filter(Boolean).join(', ') || 'No account') + (p.targetDate ? ' · by ' + fmtDate(p.targetDate) : '') + '</p>' +
      '<div class="total num" style="margin-bottom:2px">' + money0(p.current) + ' <span class="neutral" style="font-size:16px">of ' + money0(p.target) + '</span></div>' +
      '<div class="track"><div class="fill good" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="sub-s" style="margin-bottom:16px">' + pct.toFixed(0) + '% saved' + (p.left > 0 ? ' · ' + money0(p.left) + ' to go' : ' · Goal reached') + (p.perMonth > 0 ? ' · about ' + money0(p.perMonth) + '/month' : '') + '</div>' +
      '<div style="display:flex;gap:8px"><button class="btn small" data-onclick="App.piggyMoney(\'' + p.id + '\',1)">+ Add money</button><button class="btn small" data-onclick="App.piggyMoney(\'' + p.id + '\',-1)">− Take out</button></div></section>';
  }).join('');
  paint(head('Piggy banks', piggies.length ? money0(saved) + ' saved toward ' + money0(goal) + ' in goals' : 'Set money aside for goals', '<button class="btn primary" data-onclick="App.piggyForm()">+ New piggy bank</button>') +
    (cards ? '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">' + cards + '</div>' :
      '<section class="panel"><div class="center-empty">No piggy banks yet.<br>Use one to set money aside in an account for a goal — a trip, tuition, an emergency fund.</div></section>'));
};
function piggyForm(id) {
  const L = S.lists, p = id ? S.piggyCache[id] : null;
  S.form = { id };
  const accId = p && p.accounts[0] ? p.accounts[0].id : ((L.own.find(a => a.role === 'savingAsset') || L.own.find(a => isAsset(a) && !isCard(a)) || {}).id || '');
  openDrawer(id ? 'Edit piggy bank' : 'New piggy bank',
    '<form id="pgForm" data-onsubmit="event.preventDefault();App.savePiggy()"><label>Name<input type="text" id="p-name" value="' + esc(p ? p.name : '') + '" required></label>' +
    '<label>Account the money sits in<select id="p-acc"' + (id ? ' disabled' : '') + '>' + L.own.filter(a => isAsset(a) && !isCard(a)).map(a => opt(a.id, a.name, accId)).join('') + '</select></label>' +
    '<div class="grid2"><label>Goal amount<input type="number" min="0.01" step="0.01" id="p-target" value="' + esc(p ? p.target : '') + '" required></label>' +
    '<label>Target date (optional)<input type="date" id="p-date" value="' + esc(p && p.targetDate ? String(p.targetDate).slice(0, 10) : '') + '"></label></div>' +
    (!id ? '<label>Already saved (optional)<input type="number" min="0" step="0.01" id="p-current" placeholder="0.00"></label>' : '') +
    '<label>Group (optional)<input type="text" id="p-group" list="dl-pgroups" value="' + esc(p ? p.group : '') + '"></label>' +
    '<datalist id="dl-pgroups">' + [...new Set(Object.values(S.piggyCache || {}).map(x => x.group).filter(Boolean))].map(g => '<option value="' + esc(g) + '">').join('') + '</datalist>' +
    '<label>Notes<textarea id="p-notes" rows="3">' + esc(p ? p.notes : '') + '</textarea></label><button type="submit" hidden></button></form>' +
    (id ? '<div id="pgHistory"><p class="sub-s">Loading history…</p></div>' : ''),
    (id ? '<button class="btn danger" data-onclick="App.deleteThing(\'piggy-banks\',\'' + id + '\',\'piggy bank\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="pgSave" data-onclick="App.submit(\'pgForm\')">' + (id ? 'Save' : 'Create piggy bank') + '</button>');
  if (id) getAll('/piggy-banks/' + id + '/events').then(ev => {
    const box = el('pgHistory'); if (!box) return;
    box.innerHTML = '<h3 style="font-size:14px;margin:8px 0 10px">History</h3>' + (ev.length ? '<div class="list">' + ev.map(e => {
      const a = num(e.attributes.amount);
      return '<div class="row"><span class="name">' + fmtDate(e.attributes.created_at || e.attributes.date) + (e.attributes.transaction_journal_id ? ' <span class="sub-s">· from a transaction</span>' : '') + '</span><span class="num ' + (a < 0 ? 'neg' : 'pos') + '">' + (a > 0 ? '+' : '') + money(a) + '</span></div>';
    }).join('') + '</div>' : '<p class="empty">No changes yet.</p>');
  }).catch(() => { const box = el('pgHistory'); if (box) box.innerHTML = ''; });
}
async function savePiggy() {
  const id = S.form.id, v = x => el(x) ? el(x).value.trim() : '';
  if (!v('p-name')) return formError('Give it a name.');
  if (!(num(v('p-target')) > 0)) return formError('Set a goal amount above zero.');
  const body = { name: v('p-name'), target_amount: String(num(v('p-target'))), notes: el('p-notes').value, object_group_title: v('p-group') };
  if (v('p-date')) body.target_date = v('p-date');
  if (!id) {
    body.start_date = todayIso(); body.transaction_currency_code = S.currency;
    body.accounts = [{ account_id: v('p-acc'), current_amount: String(num(v('p-current'))) }];
  }
  await busy(el('pgSave'), async () => {
    await api(id ? '/piggy-banks/' + id : '/piggy-banks', { method: id ? 'PUT' : 'POST', body });
    closeDrawer(); toast(id ? 'Piggy bank saved' : 'Piggy bank created'); route();
  });
}
function piggyMoney(id, dir) {
  const p = S.piggyCache[id];
  S.form = { id, dir };
  openDrawer((dir > 0 ? 'Add money to ' : 'Take money out of ') + p.name,
    '<form id="pmForm" data-onsubmit="event.preventDefault();App.savePiggyMoney()"><p class="sub-s" style="margin-top:0">Currently ' + money(p.current) + ' of ' + money(p.target) + '. This only moves money in Firefly’s bookkeeping — no transaction is created.</p>' +
    (p.accounts.length > 1 ? '<label>Account<select id="pm-acc">' + p.accounts.map(a => opt(a.id, (a.name || (S.lists.byId[a.id] || {}).name) + ' (' + money(a.amount) + ')', '')).join('') + '</select></label>' : '') +
    '<label>Amount<input type="number" min="0.01" step="0.01" id="pm-amt" required></label><button type="submit" hidden></button></form>',
    '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="pmSave" data-onclick="App.submit(\'pmForm\')">' + (dir > 0 ? 'Add' : 'Take out') + '</button>');
}
async function savePiggyMoney() {
  const { id, dir } = S.form, p = S.piggyCache[id], amt = num(el('pm-amt').value);
  if (!(amt > 0)) return formError('Enter an amount above zero.');
  const accId = el('pm-acc') ? el('pm-acc').value : (p.accounts[0] || {}).id;
  if (!accId) return formError('This piggy bank has no account linked. Edit it in Firefly III.');
  const accounts = p.accounts.map(a => ({ account_id: a.id, current_amount: String(a.id === accId ? Math.max(0, a.amount + dir * amt) : a.amount) }));
  if (dir < 0 && (p.accounts.find(a => a.id === accId) || {}).amount < amt) return formError('There isn’t that much saved in it.');
  await busy(el('pmSave'), async () => {
    await api('/piggy-banks/' + id, { method: 'PUT', body: { accounts } });
    closeDrawer(); toast(dir > 0 ? 'Money added' : 'Money taken out'); route();
  });
}

/* ================= Login / boot ================= */
function storedKey() {
  try { const k = localStorage.getItem('moneyKey'); S.remember = !!k; return k || sessionStorage.getItem('moneyKey') || ''; } catch (e) { return ''; }
}
function saveKey(k, remember) { S.remember = !!remember; try { (remember ? localStorage : sessionStorage).setItem('moneyKey', k); } catch (e) { /* storage blocked */ } }
function clearKey() { try { localStorage.removeItem('moneyKey'); sessionStorage.removeItem('moneyKey'); } catch (e) { /* ignore */ } }
// Everything this device saved (in memory, IndexedDB and the offline cache) goes when the sign-in screen shows.
function forgetDeviceData() {
  CACHE.clear(); PAGES.clear(); PDB.clear(); S.remember = false;
  try { if (window.caches) caches.open('money-v1').then(c => c.keys().then(ks => ks.forEach(k => { if (new URL(k.url).pathname.startsWith('/api/')) c.delete(k); }))).catch(() => {}); } catch (e) { /* no Cache Storage */ }
}
function showLogin(msg) {
  closeDrawer(); S.lists = null; forgetDeviceData();
  el('app').hidden = true; el('login').hidden = false;
  const e = el('loginErr'); e.hidden = !msg || msg === 'Wrong password.' && !S.key; e.textContent = msg || '';
  el('loginPw').value = ''; el('loginPw').focus();
}
function showApp() { S.lastRefresh = S.lastRefresh || Date.now(); el('login').hidden = true; el('app').hidden = false; el('fab').hidden = false; route(); }
el('loginForm').onsubmit = async ev => {
  ev.preventDefault();
  const k = el('loginPw').value, btn = ev.target.querySelector('button[type=submit]');
  S.key = k; btn.disabled = true;
  try { await api('/about'); saveKey(k, el('loginRemember').checked); showApp(); }
  catch (e) { el('loginErr').hidden = false; el('loginErr').textContent = e instanceof AuthError ? 'That password isn’t right.' : e.message; }
  finally { btn.disabled = false; }
};
const THEMES = [
  ['auto', 'Calm (follows your system)', 'linear-gradient(135deg,#f6f5f1 50%,#1d1e1b 50%)'],
  ['light', 'Calm light', '#f6f5f1'], ['dark', 'Calm dark', '#1d1e1b'],
  ['carbon', 'Carbon neon', 'linear-gradient(135deg,#1f1f23 45%,#39ff9f 45%,#19e3ff)'],
  ['midnight', 'Midnight', 'linear-gradient(135deg,#7c5cff,#38bdf8)'], ['neon', 'Neon', 'linear-gradient(135deg,#ff2e97,#00e0ff)'],
  ['glass', 'Liquid glass neon', 'radial-gradient(circle at 30% 30%,#ffffffcc 0 12%,transparent 13%),linear-gradient(135deg,#37f5ff,#b86bff 50%,#ff4fd8)'],
  ['ocean', 'Ocean', 'linear-gradient(135deg,#14b8a6,#3b9eff)'], ['sunrise', 'Sunrise', 'linear-gradient(135deg,#e8452c,#f59e0b)'],
];
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'auto'; }
function drawThemes() {
  el('themes').innerHTML = THEMES.map(([k, label, sw]) => '<button type="button" title="' + label + '" aria-label="' + label + ' theme" class="' + (k === currentTheme() ? 'on' : '') +
    '" style="background:' + sw + '" data-onclick="App.setTheme(\'' + k + '\')"></button>').join('');
}
function setTheme(k) {
  if (k === currentTheme()) return;
  const apply = () => {
    if (k === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', k);
    drawThemes(); if (el('themes2')) { el('themes2').innerHTML = el('themes').innerHTML; el('themes2').querySelectorAll('button').forEach(b => b.style.cssText += ';width:34px;height:34px;border-radius:50%;border:2px solid var(--line);display:inline-block;padding:0'); }
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
  const src = e.target.closest && e.target.closest('a[href^="#/account/"], tr[data-onclick*="#/account/"]');
  const node = src && src.querySelector('.name, .nm');
  S.vtFrom = node ? { node, t: Date.now() } : null;
}, true);
drawThemes();
(function initFireflyLink() {
  const a = el('ffLink'), href = a.getAttribute('href') || '';
  if (!/^https?:\/\//.test(href)) a.hidden = true;
})();

window.el = el;
window.App = {
  reload: route, closeDrawer, newTx: async () => { await lists(); newTx(); }, newTxFor: async id => { await lists(); newTx({ account: id }); }, editTx, saveTx, deleteTx,
  txType: t => { collectTx(); S.form.type = t; if (t === 'transfer' && !S.form.dst) S.form.src = S.form.main; renderTxForm(); },
  addSplit: () => { collectTx(); S.form.splits.push(blankSplit()); renderTxForm(); setTimeout(() => { const b = el('drawerBody'); b.scrollTop = b.scrollHeight; }, 60); },
  removeSplit: i => { collectTx(); S.form.splits.splice(i, 1); renderTxForm(); },
  search: q => { location.hash = hashWith({ search: q.trim(), page: '' }); },
  thisMonth: () => { S.vtDir = (S.y - today.getFullYear()) * 12 + S.m - today.getMonth() > 0 ? 'prev' : 'next'; S.y = today.getFullYear(); S.m = today.getMonth(); route(); },
  shiftMonth: d => { S.vtDir = d > 0 ? 'next' : 'prev'; S.m += d; const x = new Date(S.y, S.m, 1); S.y = x.getFullYear(); S.m = x.getMonth(); route({ nav: true }); },
  accountForm, saveAccount, deleteAccount, setLimit, budgetForm, saveBudget, categoryForm, saveCategory, addTag, deleteTag, deleteThing,
  billForm, saveBill, piggyForm, savePiggy, piggyMoney, savePiggyMoney,
  setTheme,
  signOut: () => { clearKey(); S.key = ''; showLogin(); },
  // Small steps that markup handlers used to write inline (see events.js)
  go: h => { location.hash = h; },
  submit: id => el(id).requestSubmit(),
  print: () => window.print(),
  removeRow: b => b.closest('.editor-row').remove(),
  palBackdrop: (e, box) => { if (e.target === box) App.closePalette(); },
  enterClick: (e, n) => { if (e.key === 'Enter') n.click(); },
  nlKey: (e, input) => { if (e.key === 'Enter') { e.preventDefault(); App.nlParse(input.value, true); } },
  linkKey: e => { if (e.key === 'Enter') { e.preventDefault(); App.findLink(); } },
  rulesSearch: f => { const q = f.q.value.trim(); location.hash = '#/rules' + (q ? '?q=' + encodeURIComponent(q) : ''); },
  reportsRange: f => { location.hash = '#/reports?start=' + f.s.value + '&end=' + f.e.value; },
  nativeSettings: () => window.webkit.messageHandlers.native.postMessage('settings'),
};
window.addEventListener('hashchange', () => { const instant = S.tabNav; S.tabNav = false; if (!el('app').hidden) route({ nav: true, instant }); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && el('drawer').classList.contains('open') && !el('confirm').open) closeDrawer(); });

(async function boot() {
  S.key = storedKey();
  // Signed in before: show the data saved on this device right away, then refresh it in the background.
  if (S.key && S.remember) {
    try { (await PDB.loadAll()).forEach(([k, e]) => { if (e && e.t > Date.now() - 14 * 864e5 && !CACHE.has(k)) CACHE.set(k, e); }); } catch (e) { /* no saved data */ }
    if (CACHE.size) { S.bootStale = true; S.lastRefresh = Date.now(); showApp(); return; }
  }
  try { await api('/about'); showApp(); }
  catch (e) { if (e instanceof AuthError) showLogin(S.key ? 'Please sign in again.' : ''); else showApp(); }
})();

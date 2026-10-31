import { type ApiData, S, arr, todayIso } from './base';

/* ================= API ================= */
export class AuthError extends Error {}
// What api() throws for a failed response: the message to show, and the HTTP status.
export type ApiError = Error & { status?: number, network?: boolean };
// Responses are kept until something changes (your edits), you pull to refresh, or the app comes back
// after a while; they're also saved on the device so the app opens instantly with your last data.
export type CacheEntry = { t: number, v: ApiData };
export const CACHE = new Map<string, CacheEntry>(), INFLIGHT = new Map<string, Promise<ApiData>>();
export const PAGES = new Map();     // page key → { frag, scroll, feed, html, chart }
// Cached responses older than S.freshAfter are fetched again. After a change (S.dirtyAt), saved responses are only
// "out of date", not thrown away: the page you're on reloads fresh, other pages show their saved data at once and
// then quietly update (see revalidate()).
export function clearCache() { S.dirtyAt = Date.now(); S.listsAt = 0; PAGES.forEach(p => { p.stale = true; }); }

/* ---------- On-device copy of API responses (IndexedDB) ---------- */
export const PDB = (() => {
  let dbp: Promise<IDBDatabase> | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const queue = new Map<string, CacheEntry>();
  const open = () => dbp || (dbp = new Promise<IDBDatabase>((res, rej) => {
    try {
      const q = indexedDB.open('money-cache', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('api');
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    } catch (e) { rej(e); }
  }));
  const run = async (mode: IDBTransactionMode, fn: (st: IDBObjectStore) => void) => {
    const db = await open();
    return new Promise((res, rej) => { const t = db.transaction('api', mode); fn(t.objectStore('api')); t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  };
  const flush = () => { const items = [...queue]; queue.clear(); run('readwrite', st => items.forEach(([k, v]) => st.put(v, k))).catch(() => {}); };
  return {
    async loadAll() {
      const db = await open();
      return new Promise<[string, CacheEntry][]>(res => {
        const out: [string, CacheEntry][] = [], c = db.transaction('api', 'readonly').objectStore('api').openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key as string, cur.value]); cur.continue(); } else res(out); };
        c.onerror = () => res(out);
      });
    },
    put(key: string, entry: CacheEntry) { queue.set(key, entry); clearTimeout(timer); timer = setTimeout(flush, 500); },
    clear() { queue.clear(); clearTimeout(timer); run('readwrite', st => st.clear()).catch(() => {}); },
  };
})();
export type ApiOpts = {
  params?: Record<string, string | number | boolean | null | undefined>,
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, raw?: BodyInit, contentType?: string,
  as?: 'blob' | 'text', fresh?: boolean, keepCache?: boolean,
};
// Numbers for months that have ended (a balance on Sep 30, September's spending) only change when someone edits
// old transactions. So when the app opens or refreshes, those saved answers are kept for a day instead of being
// fetched again: a change made here still marks them out of date (S.dirtyAt), pull to refresh fetches them again
// (S.settledAfter), and Settings → Recalculate everything throws them away.
const SETTLED_FOR = 864e5;
function settled(u: URL) {
  const q = u.searchParams, end = q.get('end') || q.get('date');
  return !!end && /^\d{4}-\d{2}-\d{2}$/.test(end) && end < todayIso().slice(0, 8) + '01' && !q.has('query');
}
export async function api(path: string, opt: ApiOpts = {}): Promise<ApiData> {
  const u = new URL('/api/v1' + path, location.origin);
  for (const [k, v] of Object.entries(opt.params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const method = opt.method || 'GET';
  if (method === 'GET' && !opt.as && !opt.fresh) {
    const key = u.toString(), hit = CACHE.get(key);
    if (hit && (hit.t >= S.freshAfter || (hit.t >= (S.settledAfter || 0) && Date.now() - hit.t < SETTLED_FOR && settled(u)))) {
      if (hit.t >= S.dirtyAt) return hit.v;
      if (S.swr && !S.swrOff) { S.staleTok = S.tok; return hit.v; }      // out of date: show it now, update after
    }
    if (INFLIGHT.has(key)) return INFLIGHT.get(key);
    const pr = apiRaw(u, opt).then(v => { const e = { t: Date.now(), v }; CACHE.set(key, e); if (S.remember) PDB.put(key, e); return v; }).finally(() => INFLIGHT.delete(key));
    INFLIGHT.set(key, pr);
    return pr;
  }
  const out = await apiRaw(u, opt);
  if (method !== 'GET' && !opt.keepCache) clearCache();
  return out;
}
// Firefly (often a small PHP server on a NAS) drops requests when too many arrive at once: the proxy then
// answers 502/503/504, or Firefly says 429. So at most NET_MAX requests are sent at a time, and reads that
// fail like that (or lose the connection) are retried a few times before the error is shown. A 429 (too many
// requests, from Firefly or this server's rate limit) means nothing was done, so writes are retried after one too.
const NET_MAX = 6, NET_RETRY = [400, 1200, 3000], NET_BUSY = new Set([429, 502, 503, 504]);
let netActive = 0;
const netQueue: (() => void)[] = [];
// How many requests are being sent or waiting, so loading ahead can wait until the network is quiet
export const netBusy = () => netActive + netQueue.length;
async function netSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (netActive >= NET_MAX) await new Promise<void>(res => netQueue.push(res));
  netActive++;
  try { return await fn(); } finally { netActive--; const next = netQueue.shift(); if (next) next(); }
}
export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
// The browser couldn't reach this server at all (connection dropped, laptop waking up, app restarting):
// fetch only says "Failed to fetch", so say what that means and mark it so the page can retry by itself.
function unreachable(e: unknown): unknown {
  if (!(e instanceof TypeError)) return e;
  const err: ApiError = new Error('Couldn’t reach Money. The connection dropped or the app is restarting.'); err.network = true; return err;
}
// Returns { r, body }: the slot is held until the whole response has arrived, not just its headers.
async function netFetch(u: URL, init: RequestInit, blob: boolean): Promise<{ r: Response, body: string | Blob }> {
  const read = init.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    let res: { r: Response, body: string | Blob } | null = null, r: Response | null = null, wait = NET_RETRY[attempt];
    try { res = await netSlot(async () => { const x = await fetch(u, init); return { r: x, body: await (blob && x.ok ? x.blob() : x.text()) }; }); r = res.r; }
    catch (e) { if (!read || wait === undefined || !navigator.onLine) throw unreachable(e); }
    if (r && !((read && NET_BUSY.has(r.status) || r.status === 429) && wait !== undefined && navigator.onLine)) return res!;
    const ra = r ? +(r.headers.get('Retry-After') as string) : 0;
    if (ra > 0) wait = Math.min(10000, ra * 1000);
    await sleep(wait + Math.random() * 200);
  }
}
async function apiRaw(u: URL, opt: ApiOpts): Promise<ApiData> {
  const { r, body } = await netFetch(u, {
    method: opt.method || 'GET', cache: 'no-store',
    headers: { Accept: opt.as ? '*/*' : 'application/vnd.api+json', 'Content-Type': opt.raw ? (opt.contentType || 'application/octet-stream') : 'application/json', 'X-Money': '1' },
    body: opt.raw ? opt.raw : opt.body ? JSON.stringify(opt.body) : undefined,
  }, opt.as === 'blob');
  if (r.status === 401 && r.headers.get('X-Dash-Auth')) throw new AuthError('Please sign in again.');
  if (r.status === 204) return null;
  if (opt.as === 'blob' && r.ok) return body;
  const txt = body as string;
  if (opt.as === 'text' && r.ok) return txt;
  let j: ApiData = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
  if (!r.ok) {
    let msg = (j && j.errors && typeof j.errors === 'object') ? Object.values(j.errors as Record<string, string[]>).flat().join(' ') : (j && j.message) || ('Request failed (' + r.status + ')');
    if (r.status === 401) msg = 'Firefly III rejected the access token. Check FIREFLY_TOKEN in the app settings.';
    if (r.status === 404 && !j) msg = 'Not found';
    if (r.status === 409 && (!j || !j.message)) msg = 'Firefly refused because this is still in use.';
    if (NET_BUSY.has(r.status) && !(j && j.message)) msg = 'Firefly III didn’t respond (' + r.status + '). It may be busy or restarting. Try again in a moment.';
    const err: ApiError = new Error(msg); err.status = r.status; throw err;
  }
  return j;
}
// Run fn over items, a few at a time (Firefly handles parallel writes to different transactions fine).
export async function eachLimited<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<unknown>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
export async function getAll(path: string, params: ApiOpts['params'] = {}): Promise<ApiData[]> {
  const first = await api(path, { params: { ...params, page: 1, limit: 100 } });
  const pages = Math.min(60, (first && first.meta && first.meta.pagination && first.meta.pagination.total_pages) || 1);
  const out = [...arr(first)];
  for (let p = 2; p <= pages; p += 6) {      // remaining pages, six at a time
    const batch = await Promise.all(Array.from({ length: Math.min(6, pages - p + 1) }, (_, i) => api(path, { params: { ...params, page: p + i, limit: 100 } })));
    batch.forEach(r => out.push(...arr(r)));
  }
  return out;
}

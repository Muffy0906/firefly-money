/* ================= What a loading page is doing right now =================
   Real numbers only: every request the app sends reports here (core/api.ts netFetch), and a page load counts the
   requests it has sent, how many have finished, which list is being paged through (page 3 of 12), and whether
   Firefly is answering slowly or being retried. features/loadbar.ts draws it. No timers make the percentage move:
   it is requests finished out of requests known, held under 100 until the page has actually been drawn. */
export type Stage = 'queued' | 'sending' | 'receiving' | 'retrying';
type Req = { label: string, stage: Stage, retry: number };
type Pages = { of: number, done: number };
const L = { depth: 0, total: 0, done: 0, shown: 0, reqs: new Set<Req>(), pages: new Map<string, Pages>() };
const tell = () => { if (typeof dispatchEvent === 'function' && typeof Event === 'function') dispatchEvent(new Event('money-load')); };

// What a request is for, in words: /api/v1/transactions?... → "transactions"
const NAMES: [RegExp, string][] = [
  [/^\/(transactions|search)/, 'transactions'], [/^\/accounts/, 'accounts'], [/^\/budgets/, 'budgets'], [/^\/categories/, 'categories'],
  [/^\/bills|^\/subscriptions/, 'bills'], [/^\/piggy/, 'piggy banks'], [/^\/insight|^\/summary|^\/chart/, 'totals'], [/^\/rules/, 'rules'],
  [/^\/recurrences/, 'recurring'], [/^\/available/, 'budget limits'], [/^\/tags/, 'tags'], [/^\/currencies/, 'currencies'], [/^\/about/, 'Firefly'],
];
export function progLabel(path: string) {
  const p = path.replace(/^\/api\/v1/, '');
  for (const [re, name] of NAMES) if (re.test(p)) return name;
  return 'data';
}

/* A page load starts here and ends when its view has finished. Loads can overlap (tap, tap again), so they are
   counted: the numbers restart when the first begins and the bar goes when the last ends. */
export function loadBegin(): () => void {
  if (!L.depth) { L.total = 0; L.done = 0; L.shown = 0; L.reqs.clear(); L.pages.clear(); }
  L.depth++; tell();
  let over = false;
  return () => { if (over) return; over = true; L.depth--; if (!L.depth) { L.reqs.clear(); L.pages.clear(); } tell(); };
}
export type ReqHandle = { stage: (s: Stage, retry?: number) => void, done: () => void };
const NONE: ReqHandle = { stage: () => {}, done: () => {} };
export function progReq(path: string): ReqHandle {
  if (!L.depth) return NONE;
  const q: Req = { label: progLabel(path), stage: 'queued', retry: 0 };
  L.total++; L.reqs.add(q); tell();
  let fin = false;
  return {
    stage: (s, retry = 0) => { if (fin) return; q.stage = s; q.retry = retry; tell(); },
    done: () => {
      if (fin) return; fin = true;
      L.reqs.delete(q); L.done++;
      const pg = L.pages.get(q.label); if (pg) pg.done = Math.min(pg.of, pg.done + 1);
      tell();
    },
  };
}
// A list turned out to have `of` pages (getAll): the pages still to come are known work now, and the first is in
export function progPages(path: string, of: number) {
  if (!L.depth || of < 2) return;
  const label = progLabel(path);
  if (L.pages.has(label)) return;
  L.pages.set(label, { of, done: 1 }); L.total += of - 1; tell();
}

export const RETRIES = 3;      // how many times a failed read is tried again (core/api.ts NET_RETRY)
export type LoadView = { on: boolean, pct: number, text: string, detail: string, retrying: boolean };
export function loadView(): LoadView {
  if (!L.depth) return { on: false, pct: 0, text: '', detail: '', retrying: false };
  // finished ÷ known, never going backwards and never reaching 100 before the page is drawn
  L.shown = Math.max(L.shown, L.total ? Math.min(99, Math.floor(L.done / L.total * 100)) : 0);
  const reqs = [...L.reqs], retry = reqs.find(r => r.stage === 'retrying');
  let text = t('Starting');
  if (retry) text = t('Firefly is slow, retrying ({attempt} of {total})', { attempt: Math.min(RETRIES, retry.retry), total: RETRIES });
  else if (!L.total) text = t('Starting');
  else if (!reqs.length) text = t('Processing');
  else {
    // a list being paged through says which page; otherwise the furthest-along request says what it's doing
    let page: [string, Pages] | null = null;
    for (const [k, p] of L.pages) if (p.done < p.of && reqs.some(r => r.label === k) && (!page || p.of - p.done > page[1].of - page[1].done)) page = [k, p];
    const front = reqs.find(r => r.stage === 'receiving') || reqs.find(r => r.stage === 'sending') || reqs[0];
    if (page) text = t('Fetching {name} (page {page} of {total})', { name: t(page[0]), page: Math.min(page[1].of, page[1].done + 1), total: page[1].of });
    else if (front.stage === 'receiving') text = t('Receiving {name} from Firefly', { name: t(front.label) });
    else text = t('Sending request to Firefly');
  }
  return { on: true, pct: L.shown, text, detail: L.total ? t('{done} of {total} requests', { done: Math.min(L.done, L.total), total: L.total }) : '', retrying: !!retry };
}

import { t } from './spanish';

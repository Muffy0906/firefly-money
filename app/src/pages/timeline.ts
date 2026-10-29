import { type Html, html, htmlList } from '../core/html';
import { api } from '../core/api';
import { App, S, absDiff, arr, money0, monthRange, nowMonth, sumDiff, todayIso } from '../core/base';
import { head } from '../core/dom';
import { type Account, isAsset, isLiab, lists } from '../core/lists';
import { VIEWS, parseHash } from '../core/router';
import { insight, refundsIn } from '../features/refunds';
import { type NetWorthPoint, netWorthOn } from '../features/networth';

/* ================= Timeline =================
   Your money as a story, one month at a time down a line: the newest month on top, and older ones load as you
   scroll, back to the month your first account was opened. Each month shows net worth and how it moved, what came
   in and went out, where most of it went, and the moments worth remembering (a round number passed, an account
   opened, a loan paid off). */
const BATCH = 6;
type Month = { k: number, y: number, m: number, label: string, soFar: boolean, earned: number, spent: number, top: [string, number] | null, nw: NetWorthPoint, before: NetWorthPoint, moments: Html[] };
// How many months are on the page (kept, so coming back or a quiet refresh draws as many again), how far back the
// history goes, and whether more is on its way
let startAcc: Account | undefined, shown = BATCH, floor = '', loading = false, done = false, quiet = 0, lastY: number | null = null;

// The round numbers worth a mention when net worth passes them
const MARKS = [1e3, 5e3, 1e4, 2.5e4, 5e4, 7.5e4, 1e5, 1.5e5, 2e5, 2.5e5, 5e5, 7.5e5, 1e6, 1.5e6, 2e6, 2.5e6, 5e6, 1e7];
const short$ = (v: number) => v >= 1e6 ? '$' + +(v / 1e6).toFixed(2) + 'm' : '$' + +(v / 1e3).toFixed(1) + 'k';
export function crossed(before: number, now: number) {
  if (before < 0 && now >= 0) return 'Net worth turned positive';
  const up = MARKS.filter(t => before < t && now >= t).pop(), down = MARKS.filter(t => before >= t && now < t)[0];
  return up ? 'Net worth passed ' + short$(up) : down ? 'Dipped below ' + short$(down) : '';
}
// What made the month stand out, best news first
function momentsOf(o: { start: string, end: string, earned: number, spent: number, nw: NetWorthPoint, before: NetWorthPoint, accounts: Account[] }) {
  const out: Html[] = [], chip = (cls: string, text: string) => html`<li class="${cls}">${text}</li>`;
  const c = crossed(o.before.net, o.nw.net); if (c) out.push(chip(c.startsWith('Dipped') ? 'neg' : 'pos', c));
  o.accounts.filter(a => isLiab(a) && (o.before.by?.[a.id] ?? 0) <= -1 && (o.nw.by?.[a.id] ?? -1) > -1).forEach(a => out.push(chip('pos', 'Paid off ' + a.name)));
  o.accounts.filter(a => a.openingDate && a.openingDate.slice(0, 10) >= o.start && a.openingDate.slice(0, 10) <= o.end).forEach(a => out.push(chip('', 'Opened ' + a.name)));
  if (o.earned > 0 && o.spent > o.earned) out.push(chip('neg', 'Spent ' + money0(o.spent - o.earned) + ' more than came in'));
  return out;
}

// Months k to k + n - 1 back from this one (0 = this month), newest first
async function load(k: number, n: number): Promise<Month[]> {
  const L = await lists(), [ny, nm] = nowMonth(), t = todayIso();
  const ranges = [...Array(n)].map((_, i) => monthRange(ny, nm - k - i)).filter(r => !floor || r.end >= floor);
  if (!ranges.length) return [];
  const own = L.accounts.filter(a => a.netWorth && (isAsset(a) || isLiab(a)));
  // Net worth at the end of each month, and at the end of the month before the oldest (for its change)
  const ends = ranges.map(r => r.end > t ? t : r.end), oldest = ranges[ranges.length - 1];
  const prevEnd = monthRange(oldest.y, oldest.m - 1).end;
  const rs = refundsIn(oldest.start, ranges[0].end);
  const [pts, flows] = await Promise.all([
    netWorthOn([...ends, prevEnd]),
    Promise.all(ranges.map(r => Promise.all([insight('/insight/income/total', r, rs), insight('/insight/expense/total', r, rs), insight('/insight/expense/category', r, rs).catch(() => [])]))),
  ]);
  return ranges.map((r, i) => {
    const [inc, exp, cats] = flows[i], earned = sumDiff(inc), spent = sumDiff(exp), nw = pts[i], before = pts[i + 1];
    const best = arr(cats).map(c => [String(c.name || 'Uncategorized'), absDiff(c)] as [string, number]).sort((a, b) => b[1] - a[1])[0] || null;
    return { k: k + i, y: r.y, m: r.m, label: r.label, soFar: r.end >= t, earned, spent, top: best && best[1] >= 1 ? best : null, nw, before,
      moments: momentsOf({ start: r.start, end: r.end, earned, spent, nw, before, accounts: own }) };
  });
}

/* ---------- Drawing ---------- */
const chevron = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
function card(mo: Month, fresh: boolean) {
  const d = mo.nw.net - mo.before.net, kept = mo.earned - mo.spent, top = Math.max(mo.earned, mo.spent, 1);
  const still = !mo.earned && !mo.spent && Math.abs(d) < 1 && !mo.moments.length;
  const side = mo.k % 2 ? 'r' : 'l', short = new Date(mo.y, mo.m, 1).toLocaleString('en-US', { month: 'short' });
  const dot = html`<span class="tl-dot ${d >= 1 ? 'pos' : d <= -1 ? 'neg' : ''}" aria-hidden="true"></span><span class="tl-date" aria-hidden="true"><strong>${short}</strong>${mo.y}</span>`;
  if (still) return html`<li class="tl-item quiet ${side}${fresh ? ' tl-new' : ''}">${dot}<article class="tl-card panel"><h2>${mo.label}</h2><p class="sub-s">A quiet month: nothing came in or went out.</p></article></li>`;
  return html`<li class="tl-item ${side}${fresh ? ' tl-new' : ''}">${dot}<article class="tl-card panel">
    <div class="tl-head"><h2>${mo.label}</h2>${mo.soFar ? html`<span class="tl-tag">So far</span>` : ''}</div>
    <div class="tl-nw"><span class="eyebrow">Net worth</span><strong class="num${mo.nw.net < 0 ? ' neg' : ''}">${money0(mo.nw.net)}</strong>${Math.abs(d) >= 1 ? html`<span class="num ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${money0(Math.abs(d))}</span>` : html`<span class="neutral">no change</span>`}</div>
    <div class="tl-flow">
      <div><span class="eyebrow">Earned</span><span class="num">${money0(mo.earned)}</span><i style="--w:${(mo.earned / top * 100).toFixed(1)}%;background:var(--income)"></i></div>
      <div><span class="eyebrow">Spent</span><span class="num">${money0(mo.spent)}</span><i style="--w:${(mo.spent / top * 100).toFixed(1)}%;background:var(--spend)"></i></div>
      <div><span class="eyebrow">Kept</span><span class="num ${kept < 0 ? 'neg' : ''}">${money0(kept)}</span>${mo.earned > 0 ? html`<span class="sub-s">${Math.round(kept / mo.earned * 100)}%<span class="tl-of"> of income</span></span>` : ''}</div>
    </div>
    ${mo.top ? html`<p class="tl-top">Most went to <strong>${mo.top[0]}</strong> · <span class="num">${money0(mo.top[1])}</span></p>` : ''}
    ${mo.moments.length ? html`<ul class="tl-moments">${htmlList(mo.moments)}</ul>` : ''}
    <div class="tl-links"><button type="button" class="tl-go" data-onclick="App.nwOpen(${mo.y},${mo.m})">Overview${chevron}</button><button type="button" class="tl-go" data-onclick="App.tlRecap(${mo.y},${mo.m})">Recap${chevron}</button></div>
  </article></li>`;
}
// The months, with the year on the line wherever a new one starts (going down: above each December, and the current year at the top)
function items(ms: Month[], fresh: boolean, prevYear: number | null) {
  const out: Html[] = [];
  ms.forEach(mo => { if (mo.y !== prevYear) out.push(html`<li class="tl-year${fresh ? ' tl-new' : ''}"><span>${mo.y}</span></li>`); prevYear = mo.y; out.push(card(mo, fresh)); });
  lastY = prevYear;
  return htmlList(out);
}
const more = () => html`<li class="tl-more" id="tlMore" aria-label="Loading older months"><span class="tl-dot" aria-hidden="true"></span><div class="tl-card panel"><div class="sk" style="width:40%;height:14px"></div><div style="height:14px"></div><div class="sk" style="width:70%;height:22px"></div><div style="height:14px"></div><div class="sk" style="width:100%;height:12px"></div></div></li>`;
function endCap() {
  const when = (d: string) => new Date(d + 'T12:00:00').toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const note = startAcc ? html`Where it starts: <strong>${startAcc.name}</strong> opened in ${when(floor)}.` : floor ? html`Where it starts: your first transaction, in ${when(floor)}.` : 'That’s as far back as your history goes.';
  return html`<li class="tl-end"><span class="tl-dot" aria-hidden="true"></span><p>${note}</p></li>`;
}
// The day of the oldest transaction: Firefly lists newest first, so it's the last one on the last page
async function oldestTx() {
  const q = { start: '1970-01-01', end: todayIso(), limit: 1 }, one = await api('/transactions', { params: { ...q, page: 1 } });
  const pages = (one && one.meta && one.meta.pagination && one.meta.pagination.total_pages) || 1;
  const last = pages > 1 ? await api('/transactions', { params: { ...q, page: pages } }) : one, g = arr(last)[0];
  return g ? String(g.attributes.transactions[0].date).slice(0, 10) : '';
}
const firstAccount = (accts: Account[]) => accts.filter(a => (isAsset(a) || isLiab(a)) && a.openingDate).sort((a, b) => a.openingDate.localeCompare(b.openingDate))[0];

VIEWS.timeline = async (r, paint) => {
  const [L, tx] = await Promise.all([lists(), oldestTx().catch(() => '')]), first = firstAccount(L.accounts);
  // History starts at the first account opened or the first transaction, whichever is earlier. With neither, it goes
  // back up to 20 years, stopping after a year of nothing.
  const opened = first ? first.openingDate.slice(0, 10) : '';
  floor = [opened, tx].filter(Boolean).sort()[0] || ''; startAcc = opened && opened === floor ? first : undefined; loading = false; quiet = 0;
  const ms = await load(0, shown);
  done = ms.length < shown || ms.length === 0;
  paint(html`${head('Timeline', 'Your money, month by month. The newest is on top; scroll down to go back in time.')}<ol class="tl" id="tl">${items(ms, false, null)}${done ? endCap() : more()}</ol>`);
  requestAnimationFrame(check);
};
// Near the bottom: fetch the next six months and add them under the others
async function loadMore() {
  const list = document.getElementById('tl'), spot = document.getElementById('tlMore'); if (!list || !spot || loading || done) return;
  loading = true; const tok = S.tok;
  try {
    const ms = await load(shown, BATCH);
    if (tok !== S.tok || !spot.isConnected) return;
    shown += ms.length;
    // Without opening dates, a year of empty months in a row ends it
    ms.forEach(mo => { quiet = !mo.earned && !mo.spent ? quiet + 1 : 0; });
    done = ms.length < BATCH || (!floor && (quiet >= 12 || shown >= 240));
    spot.insertAdjacentHTML('beforebegin', String(items(ms, true, lastY)));
    if (done) spot.outerHTML = String(endCap());
  } catch (e) {
    spot.querySelector('.tl-card')!.innerHTML = String(html`<p class="sub-s">Couldn’t load older months: ${(e as Error).message}</p><button type="button" class="btn small" data-onclick="App.tlMore()">Try again</button>`);
    done = true; loading = false; return;
  } finally { if (loading) loading = false; }
  requestAnimationFrame(check);
}
function check() {
  if (parseHash().name !== 'timeline' || loading || done) return;
  const spot = document.getElementById('tlMore');
  if (spot && spot.getBoundingClientRect().top < innerHeight + 900) loadMore();
}
let ticking = false;
addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; check(); }); }, { passive: true });
function tlMore() { done = false; const spot = document.getElementById('tlMore'); if (spot) spot.outerHTML = String(more()); loadMore(); }
function tlRecap(y: number, m: number) { S.all = false; S.y = y; S.m = m; location.hash = '#/recap'; }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = { tlRecap, tlMore };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

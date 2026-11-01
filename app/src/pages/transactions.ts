import { type Html, html, htmlList, raw } from '../core/html';
import { type Snap, morph, morphOk, snapshot } from '../core/morph';
import { api, getAll } from '../core/api';
import { App, PAGE_SIZE, type Period, S, absDiff, arr, el, money, money0, sumDiff, todayIso, viewPeriod } from '../core/base';
import { head, icon, monthNav, toast } from '../core/dom';
import { catColor, normGroup, rankCats, txRows } from '../core/feed';
import { addDays, daysBetween } from '../core/helpers';
import { insight, refundsIn } from '../features/refunds';
import { draftsPanel } from '../features/txform';
import { lists } from '../core/lists';
import { VIEWS, hashWith } from '../core/router';
import { customizeButton, pageCard, pageOpt } from '../features/pageopts';

/* ================= Transactions page ================= */
VIEWS.transactions = async (r, paint) => {
  const L = await lists();
  const q = r.q, page = Math.max(1, +q.page || 1), type = q.type || 'all', search = (q.search || '').trim();
  const cur = viewPeriod(r);
  let endpoint = '/transactions', scope = '';
  const find = (list: { id: string, name: string }[], id: string) => (list.find(x => x.id === id) || {}).name || '#' + id;
  if (q.budget) { endpoint = '/budgets/' + q.budget + '/transactions'; scope = 'Budget: ' + find(L.budgets, q.budget); }
  else if (q.category) { endpoint = '/categories/' + q.category + '/transactions'; scope = 'Category: ' + find(L.categories, q.category); }
  else if (q.tag) { endpoint = '/tags/' + q.tag + '/transactions'; scope = 'Tag: ' + find(L.tags, q.tag); }
  else if (q.bill) { endpoint = '/bills/' + q.bill + '/transactions'; scope = 'Bill: ' + find(L.bills, q.bill); }
  const query = search + (type !== 'all' ? ' transaction_type:' + type : '');
  const load = (pg: number) => search ? api('/search/transactions', { params: { query, search: query, page: pg, limit: PAGE_SIZE } })
    : api(endpoint, { params: { start: cur.start, end: cur.end, type, page: pg, limit: PAGE_SIZE } });
  // The month strip loads on its own and is filled in when it's ready, so it never holds up the list
  const stripOn = !search && !scope && !cur.all && pageCard('transactions', 'strip'), stripKey = cur.start + '|' + cur.end + '|' + pageOpt('transactions', 'bars');
  // Another month's strip that isn't ready yet: keep showing the one on screen (dimmed) so it can change in place
  const prev = paint.live && shown ? STRIPS.get(shown.k) : null;
  const strip = !stripOn ? '' : STRIPS.get(stripKey)?.html || (prev ? raw(String(prev.html).replace(/ data-k="[^"]*" data-n="\d+"/, ` data-k="${stripKey}" data-n="0"`).replace('class="panel txsum"', 'class="panel txsum wait"'))
    : html`<section class="panel txsum" id="txsum" data-k="${stripKey}"></section>`);
  const res = await load(page);
  // loading a month ahead: keep its strip ready too (without touching the colours of the month on screen)
  if (r.at) { if (stripOn) await monthStrip(cur, stripKey, false).then(h => keepStrip(stripKey, h)).catch(() => {}); return; }
  const groups = arr(res).map(normGroup), pg = (res && res.meta && res.meta.pagination) || {};
  if (paint.live) S.txPage = groups;
  const pages = pg.total_pages || 1, total = pg.total ?? groups.length;
  if (paint.live) S.feed = { next: page + 1, pages: pg.total_pages || 1, opts: { select: true }, more: async n => arr(await load(n)).map(normGroup) };
  const tab = (t: string, label: string) => html`<a href="${hashWith({ type: t === 'all' ? '' : t, page: '' })}" class="${type === t ? 'on' : ''}">${label}</a>`;
  paint(
    html`${head(scope || 'Transactions', search ? 'Search results across all dates' : total + ' transaction' + (total === 1 ? '' : 's') + (cur.all ? ' in total' : ' in ' + cur.label) +
      (scope ? html` · <a class="link" href="#/transactions">Show all</a>` : ''),
      html`${search ? '' : monthNav()}${customizeButton('transactions')}<button class="btn primary new-tx" data-onclick="App.newTx()">+ New transaction</button>`)}${strip}<div class="txbar${search ? ' searching' : ''}"><form class="search" data-onsubmit="event.preventDefault();App.search(this.q.value)">${icon('search')}<input type="search" name="q" placeholder="Search, e.g. amazon or category:Gas" title="Search all transactions — try: amazon, category:Gas, amount_more:100" value="${search}" aria-label="Search transactions"></form><div class="tabs">${tab('all', 'All')}${tab('withdrawal', 'Expenses')}${tab('deposit', 'Income')}${tab('transfer', 'Transfers')}</div>${search ? html`<button class="link" data-onclick="App.search('')">Clear</button>` : ''}${groups.length ? html`<label class="check selall"><input type="checkbox" data-onchange="App.selAll(this.checked)"> Select all</label>` : ''}</div><div id="bulkbar" class="bulkbar" hidden></div>${search || scope || page > 1 ? '' : draftsPanel()}<section class="daycards">${txRows(groups, { select: true, empty: search ? 'Nothing matches that search.' : (cur.all ? 'No transactions yet.' : 'No transactions this month.') })}${page < pages ? html`<div class="more" id="feedMore"><span class="spin"></span>Loading older transactions…</div>` : ''}</section>`);
  if (stripOn) monthStrip(cur, stripKey).then(h => { keepStrip(stripKey, h); fillStrip(); }).catch(() => { const box = el('txsum'); if (box && box.dataset.k === stripKey && !box.childElementCount) box.remove(); });
};
// The month strips drawn so far (by period), so going back to a month shows its strip straight away
const STRIPS = new Map<string, { n: number, html: Html }>();
let stripN = 0;
function keepStrip(key: string, h: { n: number, html: Html }) {
  // the same numbers again (a refresh, or loading ahead then opening it): keep the version that may be on screen, so
  // it isn't swapped for an identical copy halfway through changing into place
  const was = STRIPS.get(key), bare = (x: { html: Html }) => String(x.html).replace(/ data-n="\d+"/, '');
  if (was && bare(was) === bare(h)) h = was;
  STRIPS.delete(key); STRIPS.set(key, h);
  while (STRIPS.size > 24) STRIPS.delete(STRIPS.keys().next().value!);
}
// Puts the strip into the page on screen once it's ready. It's matched to its month by data-k, never just to whatever
// #txsum is there: the page may not be on screen yet when the numbers come (a month change slides the old page out
// first), the page may have been put away before they came (a quick month change, or a tap to another tab, keeps
// that page as it was, empty strip and all, to bring back later), or it may be another month's page by then.
// So this also runs after every paint and every page brought back (polish.ts).
function fillStrip() {
  let box = el('txsum');
  const k = box && box.dataset.k, s = k ? STRIPS.get(k) : null;
  if (!box || !k) { if (!document.querySelector('#view .daycards')) shown = null; return; }
  // What it changes from: the strip on screen (or its dimmed stand-in), else the last month's strip seen
  let from = shown && shown.k !== k ? shown : null;
  if (s && box.dataset.n !== String(s.n)) {
    if (box.childElementCount) from = seen(box, k);
    box.outerHTML = String(s.html);
    box = el('txsum')!;
    // the month's ranking can change the category colours of rows already drawn
    document.querySelectorAll<HTMLElement>('#view tr[data-gid]').forEach(tr => {
      const m = S.txMeta[tr.dataset.gid!], c = m && m.g.splits.map(x => x.category).find(Boolean);
      if (c) tr.style.setProperty('--cat', catColor(c));
    });
  }
  if (!box.childElementCount || box.classList.contains('wait')) return;
  if (from && morphOk()) changeStrip(box, from);
  shown = seen(box, k);
}
// The strip last seen on screen: its month, numbers and bar heights, for the next one to change from
type Seen = { k: string, snap: Snap, vs: number[] };
let shown: Seen | null = null;
const seen = (box: HTMLElement, k: string): Seen => ({ k, snap: snapshot(box), vs: [...box.querySelectorAll<HTMLElement>('.dbars .db')].map(b => parseFloat(b.style.getPropertyValue('--v')) || 0) });
// Another month in the same place: the totals roll to their new values and each day's bar grows or shrinks to its new
// height (a 31st day grows from nothing), instead of the strip sliding away with the list
function changeStrip(box: HTMLElement, from: Seen) {
  morph(box, from.snap);
  const H = box.querySelector<HTMLElement>('.dbars')?.clientHeight || 0;
  if (!H) return;
  box.querySelectorAll<HTMLElement>('.dbars .db').forEach((b, i) => {
    const h0 = Math.max(3, (from.vs[i] || 0) * H), h1 = Math.max(3, (parseFloat(b.style.getPropertyValue('--v')) || 0) * H);
    if (Math.abs(h0 - h1) < .5) return;
    b.querySelector('i')?.animate([{ transform: 'scaleY(' + (h0 / h1).toFixed(4) + ')' }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(.32,.72,0,1)' });
  });
}

// The month at a glance: spent, earned and what's left, and a bar for each day's spending (tap one to go to that day).
// Its category totals also set the feed's category colours, the same as the overview's donut.
async function monthStrip(cur: Period, key: string, rank = true) {
  const p = { start: cur.start, end: cur.end }, rs = refundsIn(cur.start, cur.end), days = daysBetween(cur.start, cur.end) + 1;
  const [inc, exp, cats, noCat, spends] = await Promise.all([insight('/insight/income/total', p, rs), insight('/insight/expense/total', p, rs),
    insight('/insight/expense/category', p, rs), insight('/insight/expense/no-category', p, rs).catch(() => []),
    days <= 45 ? getAll('/transactions', { ...p, type: 'withdrawal' }).catch(() => []) : []]);
  if (rank) rankCats([...arr(cats).map(x => ({ name: String(x.name), v: absDiff(x) })), { name: 'Uncategorized', v: sumDiff(noCat) }]);
  const earned = sumDiff(inc), spent = sumDiff(exp), net = earned - spent;
  const byDay: Record<string, number> = {}, nDay: Record<string, number> = {};
  arr(spends).map(normGroup).forEach(g => { const d = String(g.date).slice(0, 10); byDay[d] = (byDay[d] || 0) + g.total; nDay[d] = (nDay[d] || 0) + 1; });
  const today = todayIso(), list = days <= 45 ? Array.from({ length: days }, (_, i) => addDays(cur.start, i)) : [];
  // Customize: each day's spending, or the month adding up day by day
  const running = pageOpt('transactions', 'bars') === 'running', cum: Record<string, number> = {};
  list.reduce((t, d) => (cum[d] = t + (byDay[d] || 0)), 0);
  const most = Math.max(1, ...list.map(d => (running ? cum : byDay)[d] || 0));
  const fmt = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const bars = htmlList(list.map(d => {
    const v = byDay[d] || 0, n = nDay[d] || 0, label = fmt(d) + ': ' + (v ? money(v) + ' spent' : 'nothing spent');
    const tip = fmt(d) + (d === today ? ' (today)' : '') + '\n' + (v ? money(v) + ' spent · ' + n + (n === 1 ? ' purchase' : ' purchases') : 'Nothing spent') + (running ? '\n' + money(cum[d]) + ' so far this month' : '');
    return d > today
      ? html`<button type="button" class="db fut" style="--v:0" aria-label="${fmt(d)}" disabled><i></i></button>`
      : html`<button type="button" class="db${d === today ? ' now' : ''}" data-day="${d}" data-onclick="App.txDay(this.dataset.day)" style="--v:${((running ? cum[d] : v) / most).toFixed(3)}" data-tip="${tip}" aria-label="${label}"><i></i></button>`;
  }));
  return { n: ++stripN, html: html`<section class="panel txsum" id="txsum" data-k="${key}" data-n="${stripN}"><div class="ts-k"><div><span class="eyebrow">Spent</span><strong class="num">${money0(spent)}</strong></div><div><span class="eyebrow">Earned</span><strong class="num pos">${money0(earned)}</strong></div><div><span class="eyebrow">Net</span><strong class="num${net < 0 ? ' neg' : ''}">${net > 0 ? '+' : ''}${money0(net)}</strong></div></div>${list.length ? html`<div class="dbars" role="group" aria-label="Spending each day">${bars}</div>` : ''}</section>` };
}

// On a phone the first tap on a day's bar shows its tip (see polish.ts) and a second tap on it goes to the day, since
// scrolling away straight off would leave the tip floating over the feed. A mouse or keyboard goes there at once.
let tapType = '', armed = '', armedAt = 0;
document.addEventListener('pointerdown', e => { tapType = e.pointerType; }, true);

// Scrolls the feed to a day (from the bars above), loading older pages until it's there. A day with nothing on it
// goes to the closest day before it.
async function txDay(day: string) {
  const touch = tapType && tapType !== 'mouse', tip = el('tip');
  tapType = '';
  if (touch && (armed !== day || Date.now() - armedAt > 2500)) {
    armed = day; armedAt = Date.now();
    tip.textContent += '\nTap again to see this day';
    const r = document.querySelector<HTMLElement>(`.dbars .db[data-day="${day}"]`)?.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    if (r) { tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = Math.max(8, r.top - h - 10) + 'px'; }
    return;
  }
  armed = ''; tip.hidden = true;
  const find = () => [...document.querySelectorAll<HTMLElement>('#view tr.dayhead')].find(h => h.dataset.day! <= day);
  let more = true;
  while (!find() && more) more = await App.feedMore();
  const h = find();
  if (!h) return toast('Nothing on ' + new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const body = h.closest<HTMLElement>('tbody.day') || h;
  body.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  body.classList.remove('flash'); void body.offsetWidth; body.classList.add('flash');
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  txDay,
  fillStrip,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { App, PAGE_SIZE, type Period, S, absDiff, arr, money, money0, period, sumDiff, todayIso } from '../core/base';
import { head, icon, monthNav, toast } from '../core/dom';
import { normGroup, rankCats, txRows } from '../core/feed';
import { addDays, daysBetween } from '../core/helpers';
import { insight, refundsIn } from '../features/refunds';
import { draftsPanel } from '../features/txform';
import { lists } from '../core/lists';
import { VIEWS, hashWith } from '../core/router';

/* ================= Transactions page ================= */
VIEWS.transactions = async (r, paint) => {
  const L = await lists();
  const q = r.q, page = Math.max(1, +q.page || 1), type = q.type || 'all', search = (q.search || '').trim();
  const cur = period();
  let endpoint = '/transactions', scope = '';
  const find = (list: { id: string, name: string }[], id: string) => (list.find(x => x.id === id) || {}).name || '#' + id;
  if (q.budget) { endpoint = '/budgets/' + q.budget + '/transactions'; scope = 'Budget: ' + find(L.budgets, q.budget); }
  else if (q.category) { endpoint = '/categories/' + q.category + '/transactions'; scope = 'Category: ' + find(L.categories, q.category); }
  else if (q.tag) { endpoint = '/tags/' + q.tag + '/transactions'; scope = 'Tag: ' + find(L.tags, q.tag); }
  else if (q.bill) { endpoint = '/bills/' + q.bill + '/transactions'; scope = 'Bill: ' + find(L.bills, q.bill); }
  const query = search + (type !== 'all' ? ' transaction_type:' + type : '');
  const load = (pg: number) => search ? api('/search/transactions', { params: { query, search: query, page: pg, limit: PAGE_SIZE } })
    : api(endpoint, { params: { start: cur.start, end: cur.end, type, page: pg, limit: PAGE_SIZE } });
  const [res, strip] = await Promise.all([load(page), search || scope || cur.all ? '' : monthStrip(cur).catch(() => '')]);
  const groups = arr(res).map(normGroup), pg = (res && res.meta && res.meta.pagination) || {};
  if (paint.live) { S.txPage = groups; S.sel = new Set(); }
  const pages = pg.total_pages || 1, total = pg.total ?? groups.length;
  if (paint.live) S.feed = { next: page + 1, pages: pg.total_pages || 1, opts: { select: true }, more: async n => arr(await load(n)).map(normGroup) };
  const tab = (t: string, label: string) => html`<a href="${hashWith({ type: t === 'all' ? '' : t, page: '' })}" class="${type === t ? 'on' : ''}">${label}</a>`;
  paint(
    html`${head(scope || 'Transactions', search ? 'Search results across all dates' : total + ' transaction' + (total === 1 ? '' : 's') + (cur.all ? ' in total' : ' in ' + cur.label) +
      (scope ? html` · <a class="link" href="#/transactions">Show all</a>` : ''),
      html`${search ? '' : monthNav()}<button class="btn primary new-tx" data-onclick="App.newTx()">+ New transaction</button>`)}${strip}<div class="txbar${search ? ' searching' : ''}"><form class="search" data-onsubmit="event.preventDefault();App.search(this.q.value)">${icon('search')}<input type="search" name="q" placeholder="Search, e.g. amazon or category:Gas" title="Search all transactions — try: amazon, category:Gas, amount_more:100" value="${search}" aria-label="Search transactions"></form><div class="tabs">${tab('all', 'All')}${tab('withdrawal', 'Expenses')}${tab('deposit', 'Income')}${tab('transfer', 'Transfers')}</div>${search ? html`<button class="link" data-onclick="App.search('')">Clear</button>` : ''}${groups.length ? html`<label class="check selall"><input type="checkbox" data-onchange="App.selAll(this.checked)"> Select all</label>` : ''}</div><div id="bulkbar" class="bulkbar" hidden></div>${search || scope || page > 1 ? '' : draftsPanel()}<section class="daycards">${txRows(groups, { select: true, empty: search ? 'Nothing matches that search.' : (cur.all ? 'No transactions yet.' : 'No transactions this month.') })}${page < pages ? html`<div class="more" id="feedMore"><span class="spin"></span>Loading older transactions…</div>` : ''}</section>`);
};

// The month at a glance: spent, earned and what's left, and a bar for each day's spending (tap one to go to that day).
// Its category totals also set the feed's category colours, the same as the overview's donut.
async function monthStrip(cur: Period) {
  const p = { start: cur.start, end: cur.end }, rs = refundsIn(cur.start, cur.end), days = daysBetween(cur.start, cur.end) + 1;
  const [inc, exp, cats, noCat, spends] = await Promise.all([insight('/insight/income/total', p, rs), insight('/insight/expense/total', p, rs),
    insight('/insight/expense/category', p, rs), insight('/insight/expense/no-category', p, rs).catch(() => []),
    days <= 45 ? getAll('/transactions', { ...p, type: 'withdrawal' }).catch(() => []) : []]);
  rankCats([...arr(cats).map(x => ({ name: String(x.name), v: absDiff(x) })), { name: 'Uncategorized', v: sumDiff(noCat) }]);
  const earned = sumDiff(inc), spent = sumDiff(exp), net = earned - spent;
  const byDay: Record<string, number> = {};
  arr(spends).map(normGroup).forEach(g => { const d = String(g.date).slice(0, 10); byDay[d] = (byDay[d] || 0) + g.total; });
  const today = todayIso(), list = days <= 45 ? Array.from({ length: days }, (_, i) => addDays(cur.start, i)) : [];
  const most = Math.max(1, ...list.map(d => byDay[d] || 0));
  const fmt = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const bars = htmlList(list.map(d => {
    const v = byDay[d] || 0, label = fmt(d) + ': ' + (v ? money(v) + ' spent' : 'nothing spent');
    return html`<button type="button" class="db${d === today ? ' now' : d > today ? ' fut' : ''}" data-day="${d}" data-onclick="App.txDay(this.dataset.day)" style="--v:${(v / most).toFixed(3)}" title="${label}" aria-label="${label}"${d > today ? ' disabled' : ''}><i></i></button>`;
  }));
  return html`<section class="panel txsum"><div class="ts-k"><div><span class="eyebrow">Spent</span><strong class="num">${money0(spent)}</strong></div><div><span class="eyebrow">Earned</span><strong class="num pos">${money0(earned)}</strong></div><div><span class="eyebrow">Net</span><strong class="num${net < 0 ? ' neg' : ''}">${net > 0 ? '+' : ''}${money0(net)}</strong></div></div>${list.length ? html`<div class="dbars" role="group" aria-label="Spending each day">${bars}</div>` : ''}</section>`;
}

// Scrolls the feed to a day (from the bars above), loading older pages until it's there. A day with nothing on it
// goes to the closest day before it.
async function txDay(day: string) {
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
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

import { html, htmlList, raw } from '../core/html';
import { App } from '../core/base';
import { openDrawer } from '../core/dom';
import { buzz } from '../core/haptics';
import { LS } from '../core/helpers';
import { route } from '../core/router';

/* ---------- Each page's own options: Customize in a page's header ----------
   Like the Overview's tile settings (dashboard.ts TILE_OPTS), but for a whole page: how its charts are drawn, what
   they compare with, and which cards it shows. Saved in money.pageOpts {page: {option: value}}, synced with the other
   settings (sync.ts). A page reads them with pageOpt(page, id) and puts customizeButton(page) in its header. */
type Val = string | number | boolean;
// choices: [value, label] pairs (a select); no choices: an on/off switch. card: listed under "Cards to show".
type PageOpt = { id: string, label: string, hint?: string, def: Val, choices?: [Val, string][], card?: boolean };
const on = (id: string, label: string, def = true, hint?: string): PageOpt => ({ id, label, def, hint, card: true });
const STYLE_SHARE: [Val, string][] = [['donut', 'Donut and bars'], ['bars', 'Bars only']];
export const PAGE_OPTS: Record<string, { title: string, opts: PageOpt[] }> = {
  reports: { title: 'Reports', opts: [
    { id: 'trend', label: 'Earned vs. spent', hint: 'How the top chart draws the period', def: 'lines', choices: [['lines', 'Lines'], ['bars', 'Bars'], ['net', 'What you kept']] },
    { id: 'share', label: 'Breakdowns', hint: 'The category, budget, tag and payee cards', def: 'donut', choices: STYLE_SHARE },
    { id: 'rows', label: 'Rows in each breakdown', def: 12, choices: [[6, '6'], [8, '8'], [12, '12'], [20, '20']] },
    on('kpis', 'Totals'), on('lines', 'Earned vs. spent'), on('ring', 'Where it went'), on('months', 'Cash flow by month', true, 'For periods longer than a month'),
    on('weekday', 'Spending by weekday', false, 'Which days of the week you spend the most'),
    on('daily', 'Average day', false, 'What a typical day cost, and your biggest days'),
    on('cat', 'Spending by category'), on('bud', 'Spending by budget'), on('tag', 'Spending by tag'), on('inccat', 'Income by category'),
    on('payee', 'Top payees'), on('src', 'Income by source'), on('balances', 'Account balances'),
  ] },
  recap: { title: 'Monthly recap', opts: [
    { id: 'usual', label: 'Compare with', hint: 'What “usual” means on this page', def: 3, choices: [[1, 'Last month'], [3, 'The 3 months before'], [6, 'The 6 months before'], [12, 'The 12 months before']] },
    { id: 'share', label: 'Where it went', def: 'donut', choices: STYLE_SHARE },
    { id: 'top', label: 'Biggest purchases to list', def: 5, choices: [[3, '3'], [5, '5'], [10, '10']] },
    on('notes', 'Highlights'), on('kpis', 'Totals'), on('cats', 'Where it went'), on('weeks', 'Week by week', false, 'What you spent each week of the month'),
    on('buys', 'Biggest purchases'), on('fresh', 'New payees'), on('bills', 'Bills'),
  ] },
  categories: { title: 'Categories', opts: [
    { id: 'chart', label: 'Chart', hint: 'Shown above the table', def: 'none', choices: [['none', 'None'], ['donut', 'Donut and bars'], ['bars', 'Bars only'], ['change', 'Change vs. last month']] },
    { id: 'sort', label: 'Sort by', def: 'spent', choices: [['spent', 'Most spent'], ['change', 'Biggest change'], ['name', 'Name']] },
    { id: 'empty', label: 'Categories with nothing spent', def: true, choices: [[true, 'Show'], [false, 'Hide']] },
    on('cmp', 'Change vs. last month column'), on('earned', 'Earned column'), on('tags', 'Tags'),
  ] },
  budgets: { title: 'Budgets', opts: [
    { id: 'chart', label: 'Chart', hint: 'Shown above the list', def: 'none', choices: [['none', 'None'], ['rings', 'A ring for each budget'], ['bars', 'Spent vs. budgeted']] },
    { id: 'sort', label: 'Sort by', def: 'firefly', choices: [['firefly', 'Firefly’s order'], ['used', 'Most used'], ['left', 'Most left'], ['spent', 'Most spent'], ['name', 'Name']] },
    { id: 'pace', label: 'Today marker on the bars', def: true, choices: [[true, 'Show'], [false, 'Hide']] },
    on('kpis', 'Totals'),
  ] },
  piggy: { title: 'Piggy banks', opts: [
    { id: 'style', label: 'Progress as', def: 'ring', choices: [['ring', 'Rings'], ['bar', 'Bars']] },
    { id: 'sort', label: 'Sort by', def: 'group', choices: [['group', 'Group'], ['progress', 'Closest to the goal'], ['date', 'Target date'], ['left', 'Most left to save']] },
    on('chart', 'All goals at a glance', false, 'Every goal’s progress in one chart'), on('done', 'Goals already reached'),
  ] },
  transactions: { title: 'Transactions', opts: [
    { id: 'bars', label: 'Bars in the month strip', def: 'daily', choices: [['daily', 'Each day’s spending'], ['running', 'Adding up through the month']] },
    on('strip', 'Month strip', true, 'The month’s totals and its day-by-day bars'),
  ] },
};
const saved = (): Record<string, Record<string, Val>> => LS.get('pageOpts', {}) || {};
// An option's value, or its default when unset or no longer one of the choices
export function pageOpt(page: string, id: string): any {
  const o = (PAGE_OPTS[page] || { opts: [] }).opts.find(x => x.id === id && !x.card) || (PAGE_OPTS[page] || { opts: [] }).opts.find(x => x.id === id);
  if (!o) return undefined;
  const v = (saved()[page] || {})[o.card ? 'show.' + id : id];
  if (o.choices ? o.choices.some(c => c[0] === v) : typeof v === 'boolean') return v;
  return o.def;
}
// Whether a page shows one of its cards
export function pageCard(page: string, id: string): boolean {
  const o = (PAGE_OPTS[page] || { opts: [] }).opts.find(x => x.id === id && x.card);
  if (!o) return true;
  const v = (saved()[page] || {})['show.' + id];
  return typeof v === 'boolean' ? v : !!o.def;
}
// The header button (the same one the Overview's Customize uses: an icon on a phone)
export const customizeButton = (page: string) => html`<button class="btn dash-edit page-cust" data-onclick="App.pageCustomize('${page}')" title="Charts and cards on this page" aria-label="Customize"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg><span>Customize</span></button>`;

const SWITCH = raw('type="checkbox" class="switch" role="switch"');
function sheet(page: string) {
  const P = PAGE_OPTS[page]; if (!P) return '';
  const row = (o: PageOpt, ctl: unknown) => html`<div class="set-row"><div class="set-label"><div>${o.label}</div>${o.hint ? html`<div class="sub-s">${o.hint}</div>` : ''}</div><div class="set-ctl">${ctl}</div></div>`;
  const ctl = (o: PageOpt) => {
    if (o.card) return html`<input ${SWITCH}${pageCard(page, o.id) ? ' checked' : ''} aria-label="${o.label}" data-onchange="App.pageSet('${page}','show.${o.id}',this.checked)">`;
    const v = pageOpt(page, o.id);
    return html`<select aria-label="${o.label}" data-onchange="App.pageSet('${page}','${o.id}',this.value)">${htmlList(o.choices!.map(([x, l]) => html`<option value="${String(x)}"${x === v ? ' selected' : ''}>${l}</option>`))}</select>`;
  };
  const charts = P.opts.filter(o => !o.card), cards = P.opts.filter(o => o.card);
  return html`<div class="page-opts">${charts.length ? html`<h3 class="set-h">Charts</h3><div class="panel set-panel">${htmlList(charts.map(o => row(o, ctl(o))))}</div>` : ''}${cards.length ? html`<h3 class="set-h">Cards to show</h3><div class="panel set-panel">${htmlList(cards.map(o => row(o, ctl(o))))}</div>` : ''}<p class="sub-s">Changes show on the page straight away and are saved with your other settings.</p></div>`;
}
function pageCustomize(page: string) {
  const P = PAGE_OPTS[page]; if (!P) return;
  openDrawer('Customize ' + P.title, sheet(page), html`<button class="btn" type="button" data-onclick="App.pageReset('${page}')">Reset</button><span class="grow"></span><button class="btn primary" type="button" data-onclick="App.closeDrawer()">Done</button>`);
}
// Save one option (a select's value comes as text: matched back to its choice) and redraw the page behind the sheet
function pageSet(page: string, key: string, raw: string | boolean) {
  const card = key.startsWith('show.'), o = (PAGE_OPTS[page] || { opts: [] }).opts.find(x => card ? x.card && 'show.' + x.id === key : !x.card && x.id === key);
  if (!o) return;
  const v = card ? !!raw : o.choices!.find(c => String(c[0]) === String(raw))?.[0];
  if (v === undefined) return;
  const all = saved(); all[page] = { ...all[page], [key]: v }; LS.set('pageOpts', all);
  buzz(6); route({ quiet: true });
}
function pageReset(page: string) {
  const all = saved(); delete all[page]; LS.set('pageOpts', all);
  route({ quiet: true }); pageCustomize(page);
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = { pageCustomize, pageSet, pageReset };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

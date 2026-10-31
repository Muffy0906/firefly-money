import { type Html, html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { App, S, arr, el, fmtDay, money, money0 } from '../core/base';
import { NAV, closeDrawer } from '../core/dom';
import { normGroup, payeeOf, signed } from '../core/feed';
import { LS } from '../core/helpers';
import { isAsset, isCard, isLiab, lists } from '../core/lists';
import { THEMES, setTheme } from '../core/login';
import { normPiggy } from '../pages/piggy';
import { drafts, draftLabel } from './txform';

/* ---------- Universal search (⌘K, / , the search button on phones) ----------
   One box for pages, settings, actions, accounts, budgets, categories, tags, bills, payees, piggy banks,
   recurring transactions, rules, drafts, and, as you type, matching transactions from Firefly. */
type PalItem = { label: string, kind: string, sub?: string, keys?: string, go?: string, focus?: string, run?: () => void, low?: boolean, tx?: boolean, amt?: number };
let palItems: PalItem[] = [], palShown: PalItem[] = [], palIdx = 0;

// Extra words each page answers to, so "debt" finds the Loan planner and "savings" finds Piggy banks
const PAGE_KEYS: Record<string, string> = {
  '': 'home dashboard summary net worth', forecast: 'future cash flow safe to spend what if scenarios', transactions: 'activity spending history expenses income transfers',
  inbox: 'uncategorized categorize sort', review: 'new imported check', accounts: 'banks balances checking savings credit cards', loans: 'debt payoff mortgage interest',
  budgets: 'limits spending plan', categories: 'tags labels', bills: 'subscriptions due calendar', recurring: 'repeating scheduled automatic',
  piggy: 'savings goals', rules: 'automation auto categorize', recap: 'month summary', year: 'wrapped year review annual story recap', timeline: 'history past months net worth over time story milestones scroll back', ask: 'question how much', map: 'places locations',
  reports: 'charts compare year csv sankey', settings: 'preferences options',
};
// Settings: [label, extra words, where on the Settings page: a group (#set-…) or a folded section (data-k), which opens]
const SETTINGS: [string, string, string][] = [
  ['Month start day (payday)', 'cycle pay period month starts budget period', '#set-months'],
  ['Budget warning', 'alert warn threshold 80% percent budget full', '#set-months'],
  ['Appearance', 'theme dark light color look', '#set-look'],
  ['Customize theme colors', 'theme color colour background accent liquid glass frosted blur tint frost glow light custom scene background wallpaper photo', 'theme-custom'],
  ['Payee and bank logos', 'logos icons images duckduckgo merchant', '#set-look'],
  ['About logos', 'logos duckduckgo privacy', 'logos'],
  ['Hours of work', 'hours work wage hourly salary time cost lens worked', '#set-look'],
  ['Magnetic hover', 'magnet magnetic cursor mouse pointer hover pull attract motion animation', '#set-look'],
  ['Haptics', 'haptic feedback vibration vibrate buzz tap feel iphone android', '#set-look'],
  ['Sync between devices', 'sync iphone ipad devices cloud preferences sync now', '#set-sync'],
  ['Apple Pay', 'shortcut iphone wallet automation ingest key', '#set-applepay'],
  ['Apple Pay cards', 'wallet card account match', 'cards'],
  ['How Apple Pay works', 'shortcut setup instructions', 'applepay-how'],
  ['Main currency', 'currencies default primary usd euro', '#set-currencies'],
  ['Enable another currency', 'currencies foreign add', 'cur-add'],
  ['Exchange rates', 'currency conversion rate fx', 'rates'],
  ['Export to CSV', 'download backup excel numbers csv export data', 'export'],
  ['Webhooks', 'home assistant n8n automation url', 'hooks'],
  ['Recalculate everything', 'refresh reload cache wrong totals', '#set-data'],
  ['About and versions', 'version firefly api about', '#set-about'],
  ['What’s new', 'whats new release notes changelog update version highlights', '#set-about'],
];
// The Settings category each folded section lives in (a #set-… target names its own), since Settings shows one at a time
const FOLDED_IN: Record<string, string> = { 'theme-custom': 'look', logos: 'look', cards: 'applepay', 'applepay-how': 'applepay', 'cur-add': 'currencies', rates: 'currencies', export: 'data', hooks: 'data' };
const settingsCat = (focus: string) => focus.startsWith('#set-') ? focus.slice(5) : FOLDED_IN[focus];
// Piggy banks and recurring transactions aren't in lists(), so fetch them once in a while
let extra: { at: number, items: PalItem[] } | null = null;
async function extras() {
  if (extra && Date.now() - extra.at < 300000) return extra.items;
  const [piggies, recs] = await Promise.all([getAll('/piggy-banks').catch(() => []), getAll('/recurrences').catch(() => [])]);
  const items: PalItem[] = [];
  piggies.map(normPiggy).forEach(p => items.push({ label: p.name, kind: 'Piggy bank', sub: money0(p.current) + (p.target ? ' of ' + money0(p.target) : ' saved'), go: '#/piggy' }));
  recs.forEach(x => items.push({ label: x.attributes.title, kind: 'Recurring', keys: x.attributes.description || '', go: '#/recurring', low: true }));
  extra = { at: Date.now(), items };
  return items;
}
function baseItems(): PalItem[] {
  const items: PalItem[] = [...NAV, ['inbox', 'Categorize']].map(([r, label]) => ({ label, kind: 'Page', keys: PAGE_KEYS[r], go: '#/' + r }));
  items.push({ label: 'New transaction', kind: 'Action', keys: 'add expense income create', run: () => App.quickAdd() }, { label: 'New rule', kind: 'Action', run: () => { location.hash = '#/rules'; setTimeout(() => App.ruleForm(), 400); } },
    { label: 'New recurring transaction', kind: 'Action', run: () => { location.hash = '#/recurring'; setTimeout(() => App.recurForm(), 400); } },
    { label: 'Reconcile an account', kind: 'Action', go: '#/accounts' },
    { label: 'Clean up unused payees, categories and tags', kind: 'Action', keys: 'delete remove tidy unused empty zero transactions budgets income sources', go: '#/cleanup' },
    { label: 'Recalculate everything (fetch all numbers fresh)', kind: 'Action', run: () => App.recalcAll() });
  SETTINGS.forEach(([label, keys, focus]) => items.push({ label, kind: 'Setting', keys: 'settings ' + keys, go: '#/settings?s=' + settingsCat(focus), focus }));
  items.push({ label: 'Hide amounts (privacy)', kind: 'Setting', keys: 'settings privacy blur hide numbers', run: () => App.togglePrivacy() },
    { label: 'Hours of work: show what purchases cost in hours', kind: 'Setting', keys: 'settings lens wage hourly time', run: () => App.toggleWorkLens(!LS.get('workLens', false)) },
    { label: 'Compact view', kind: 'Setting', keys: 'settings density compact spacing', run: () => App.toggleDensity() },
    { label: 'Sign out', kind: 'Setting', keys: 'log out', run: () => App.signOut() });
  THEMES.forEach(([k, label]) => items.push({ label: 'Theme: ' + label, kind: 'Setting', keys: 'settings appearance dark light color', run: () => setTheme(k) }));
  drafts().forEach(d => items.push({ label: draftLabel(d), kind: 'Draft', keys: 'draft unfinished', run: () => App.openDraft(d.id) }));
  if (S.rules) Object.entries<any>(S.rules).forEach(([id, r]) => items.push({ label: r.title, kind: 'Rule', run: () => { location.hash = '#/rules'; setTimeout(() => App.ruleForm(id), 500); }, low: true }));
  return items;
}
export async function openPalette() {
  closeDrawer();
  const q = el<HTMLInputElement>('palQ');
  clearTimeout(palOut); el('palette').classList.remove('out');
  el('palette').hidden = false; q.value = ''; q.focus();      // focus before any await, or iPhone won't show the keyboard
  document.documentElement.classList.add('pal-open');
  palItems = baseItems(); palFilter();
  const [L, more] = await Promise.all([lists().catch(() => null), extras().catch(() => [])]);
  if (el('palette').hidden) return;
  const items = baseItems();
  if (L) {
    L.accounts.filter(a => a.active && (isAsset(a) || isLiab(a))).forEach(a => items.push({ label: a.name, kind: isCard(a) ? 'Credit card' : isLiab(a) ? 'Loan' : 'Account', sub: isLiab(a) ? money(a.debt) + ' owed' : money(a.balance), keys: a.number, go: '#/account/' + a.id }));
    L.budgets.filter(b => b.active).forEach(b => items.push({ label: b.name, kind: 'Budget', keys: b.notes, go: '#/transactions?budget=' + b.id }));
    L.categories.forEach(c => items.push({ label: c.name, kind: 'Category', keys: c.notes, go: '#/transactions?category=' + c.id }));
    L.tags.forEach(t => items.push({ label: t.name, kind: 'Tag', go: '#/transactions?tag=' + t.id }));
    L.bills.forEach(b => items.push({ label: b.name, kind: 'Bill', go: '#/transactions?bill=' + b.id, low: !b.active }));
    L.expense.forEach(a => items.push({ label: a.name, kind: 'Payee', go: '#/account/' + a.id, low: true }));
    L.revenue.forEach(a => items.push({ label: a.name, kind: 'Income source', go: '#/account/' + a.id, low: true }));
  }
  palItems = items.concat(more); palFilter(true);
}
function score(label: string, q: string) {
  const l = label.toLowerCase();
  if (!q) return 1;
  if (l.startsWith(q)) return 100 - l.length / 100;
  if (l.includes(' ' + q)) return 80 - l.indexOf(q) / 10;          // start of a later word
  const i = l.indexOf(q); if (i >= 0) return 60 - i;
  let j = 0; for (const w of l.split(/[\s&/(-]+/)) if (w[0] === q[j]) j++;   // first letters of words, e.g. "cc" → "Capital one Credit card"
  return j === q.length && q.length > 1 && !q.includes(' ') ? 20 : 0;
}
// Every word typed must match the label or the item's extra words; "export csv" → Export data
function itemScore(it: PalItem, q: string) {
  if (!q) return 1;
  const whole = score(it.label, q); if (whole) return whole;
  const hay = (it.label + ' ' + it.kind + ' ' + (it.keys || '')).toLowerCase(), words = q.split(/\s+/);
  return words.every(w => hay.includes(w)) ? 30 - words.length : 0;
}

/* ---------- Transactions, fetched from Firefly as you type ---------- */
let txFor = '', txHits: PalItem[] = [], txBusy = false, txTimer: ReturnType<typeof setTimeout> | undefined;
const txCache = new Map<string, PalItem[]>();
function txSearch(typed: string) {
  clearTimeout(txTimer);
  if (typed.length < 2) { txFor = ''; txHits = []; txBusy = false; return; }
  if (txCache.has(typed)) { txFor = typed; txHits = txCache.get(typed)!; txBusy = false; return; }
  txBusy = true;
  txTimer = setTimeout(async () => {
    let hits: PalItem[] = [];
    try {
      const res = await api('/search/transactions', { params: { query: typed, page: 1, limit: 8 } });
      hits = arr(res).map(normGroup).map((g): PalItem => {
        const s = g.splits[0] || {} as Partial<typeof g.splits[0]>, name = String(payeeOf(g).name || g.title || '');
        return { label: name, kind: 'Transaction', tx: true, amt: g.type === 'transfer' ? g.total : signed(g),
          sub: fmtDay(g.date) + (s.category ? ' · ' + s.category : '') + (g.splits.length === 1 && s.description && s.description !== name ? ' · ' + s.description : ''),
          run: () => { App.editTx(g.id); } };
      });
    } catch (e) { /* offline or signed out: the other results still work */ }
    txCache.set(typed, hits);
    if (el<HTMLInputElement>('palQ').value.trim() !== typed) return;
    txFor = typed; txHits = hits; txBusy = false; palFilter(true);
  }, 260);
}

const RECENT_MAX = 6;
const recents = (): PalItem[] => (LS.get('palRecent', []) as PalItem[]).filter(r => r && r.label && r.go);
function remember(it: PalItem) {
  if (!it.go || it.tx) return;
  const keep = { label: it.label, kind: it.kind, go: it.go, focus: it.focus };
  LS.set('palRecent', [keep, ...recents().filter(r => !(r.label === it.label && r.go === it.go))].slice(0, RECENT_MAX));
}

// keepIdx: results updated underneath (data or transactions arrived), so leave the highlight where it is
function palFilter(keepIdx?: boolean) {
  const typed = el<HTMLInputElement>('palQ').value.trim(), q = typed.toLowerCase();
  const prev = keepIdx === true ? palShown[palIdx] : null;
  let shown: PalItem[];
  if (!q) {
    const rec: PalItem[] = recents().map(r => ({ ...r, sub: 'Recent' }));
    shown = rec.concat(palItems.filter(it => it.kind === 'Page' || it.kind === 'Action').filter(it => !rec.some(r => r.go === it.go && r.label === it.label)));
  } else {
    shown = palItems.map(it => ({ it, s: itemScore(it, q) - (it.low && q.length < 3 ? 50 : 0) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, 30).map(x => x.it);
    // A question goes first unless something matched it well
    if (q.includes(' ') && q.length > 6) shown.splice(palItems.some(it => itemScore(it, q) >= 28) ? Math.min(shown.length, 3) : 0, 0, { label: 'Ask: ' + typed, kind: 'Ask', go: '#/ask?q=' + encodeURIComponent(typed) });
    if (!keepIdx) txSearch(typed);
    if (txFor === typed) shown.push(...txHits);
    shown.push({ label: 'Search all transactions for “' + typed + '”', kind: 'Search', go: '#/transactions?search=' + encodeURIComponent(typed) });
  }
  palShown = shown;
  const at = prev ? palShown.indexOf(prev) : -1;
  palIdx = at >= 0 ? at : 0; drawPal();
}
function itemHtml(it: PalItem, i: number): Html {
  const right = it.tx ? html`<span class="num ${it.amt! < 0 ? 'neg' : it.amt! > 0 ? 'pos' : 'neutral'}">${it.amt! > 0 ? '+' : ''}${money(it.amt!)}</span>` : html`<span class="k">${it.kind}</span>`;
  return html`<div class="pal-item${i === palIdx ? ' on' : ''}" role="option" data-i="${i}" data-onmousemove="App.palHover(${i})" data-onclick="App.palRun(${i})"><span class="pal-main"><span class="pal-l">${it.label}</span>${it.sub ? html`<span class="pal-sub">${it.sub}</span>` : ''}</span>${right}</div>`;
}
function drawPal() {
  const q = el<HTMLInputElement>('palQ').value.trim();
  const parts: Html[] = [];
  let lastGroup = '';
  palShown.forEach((it, i) => {
    const group = !q ? (it.sub === 'Recent' ? 'Recent' : 'Go to') : it.tx ? 'Transactions' : it.kind === 'Search' ? '' : 'Top results';
    if (group && group !== lastGroup) parts.push(html`<div class="pal-h">${group}</div>`);
    if (group) lastGroup = group;
    if (q && it.kind === 'Search' && txBusy) parts.push(html`<div class="pal-h">Transactions</div><div class="pal-item pal-wait"><span class="neutral"><span class="spin"></span>Searching transactions…</span></div>`);
    parts.push(itemHtml(it, i));
  });
  el('palList').innerHTML = String(htmlList(parts));
  const on = el('palList').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function palHover(i: number) { if (i !== palIdx) { palIdx = i; drawPal(); } }
function palKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palShown.length - 1, palIdx + 1); drawPal(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(0, palIdx - 1); drawPal(); }
  else if (e.key === 'Enter') { e.preventDefault(); palRun(palIdx); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
}
function palRun(i: number) {
  const it = palShown[i]; if (!it) return;
  closePalette(); remember(it);
  if (it.go) {
    const same = (location.hash || '#/') === it.go;
    if (!same) location.hash = it.go;
    if (it.focus) jumpTo(it.focus, same ? 0 : 4000);
  } else if (it.run) it.run();
}
// Scroll to a part of the Settings page once it has drawn (opening it if it's folded away), and flash it
function jumpTo(target: string, wait: number) {
  const t0 = Date.now();
  const look = () => {
    const box = target.startsWith('#') ? document.querySelector<HTMLElement>('#view ' + target) : document.querySelector<HTMLDetailsElement>('#view details[data-k="' + target + '"]');
    if (!box) { if (Date.now() - t0 < wait) setTimeout(look, 120); return; }
    if (box instanceof HTMLDetailsElement) box.open = true;
    box.classList.remove('pal-flash'); void box.offsetWidth; box.classList.add('pal-flash');   // (its scroll-margin keeps it clear of the title bar)
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  setTimeout(look, wait ? 150 : 0);
}
// Closing plays the short out-motion first (desktop, motion allowed: the phone's full-screen search has none, see money.css)
let palOut: ReturnType<typeof setTimeout> | undefined;
function closePalette() {
  const p = el('palette'); if (p.hidden) return;
  clearTimeout(txTimer); document.documentElement.classList.remove('pal-open');
  if (p.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();     // the keyboard goes with it
  const hide = () => { p.hidden = true; p.classList.remove('out'); };
  if (getComputedStyle(p).animationName === 'none') return hide();
  p.classList.add('out'); clearTimeout(palOut); palOut = setTimeout(hide, 140);
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  openPalette,
  closePalette,
  palFilter,
  palKey,
  palRun,
  palHover,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

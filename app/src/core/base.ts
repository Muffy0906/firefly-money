import type { Html } from './html';
import type { Group, TxMeta } from './feed';
import type { Lists } from './lists';

/* ================= Settings ================= */
export const PAGE_SIZE = 50;

/* ================= State & helpers ================= */
// The methods that markup handlers (data-onclick and friends, see events.ts) call; each module adds its own.
// Each module adds its methods to the AppApi type next to where it adds them to App.
export interface AppApi {}
export const App = window.App = {} as AppApi;
export let today = new Date();
export const setToday = (d: Date) => { today = d; };
// Firefly's JSON as the API returns it. Not typed yet: each use reads the fields it needs.
export type ApiData = any;
// The open form in the drawer. Each form keeps its own fields here (txform.ts has the biggest).
export type FormState = ApiData;
export type Feed = { next: number, pages: number, opts: { accountId?: string, select?: boolean }, more: (n: number) => Promise<Group[]>, busy?: Promise<boolean> | null };
// The app's state: what's on screen, what's open, and data kept between pages
export interface State {
  y: number, m: number, all?: boolean,                 // the month in view, or all time
  signedIn: boolean, remember?: boolean,                 // signed in (the session cookie itself is HttpOnly), and whether data is kept on this device
  currency: string,
  lists: Lists | null, listsAt?: number,
  freshAfter: number, dirtyAt: number,                   // cached responses older than freshAfter are fetched again; older than dirtyAt are out of date (api.ts)
  settledAfter?: number,                                 // the same for responses about months that have ended (api.ts)
  tok: number, staleTok?: number,                        // bumped on every navigation, so late responses for an old page are dropped
  form: FormState | null,
  // Pages and navigation
  pageKey?: string, pageHtml?: string | Html, pageLive?: boolean, pageCacheable?: boolean, pageDepth?: number, painted?: boolean, bootStale?: boolean, warmed?: boolean,
  navN?: number, curNav?: number, tabNav?: boolean, kIdx?: number, skelT?: ReturnType<typeof setTimeout>, dimT?: ReturnType<typeof setTimeout>,
  vtDir?: string, vtRun?: (ViewTransition & { kind?: string }) | null, vtFrom?: { node: Element, t: number } | null, lastPtr?: { x: number, y: number },
  // Cache freshness (api.ts)
  swr?: boolean, swrOff?: number, lastRefresh?: number, refreshing?: Promise<void> | null, recalcing?: boolean,
  // Transaction lists
  feed?: Feed | null, txMeta: Record<string, TxMeta>, txPage?: Group[], sel?: Set<string>, pendingDel: Set<string>, catRank?: string[],
  undoCommit?: (() => void) | null, undoT?: ReturnType<typeof setTimeout>, chartData?: { label: string, income: number, spend: number, go?: string }[],
  // The drawer
  drawerHero?: { id: string, av: Html, name: string | undefined, date: string, kicker: string, amount: string } | null, drawerReturn?: HTMLElement | null, drawerTok?: number,
  extrasCtx?: { gid: string, jids: string[] }, linkTypes?: ApiData[] | null,
  // Data kept by pages
  billCache?: Record<string, ApiData>, billRises?: Record<string, ApiData>, subs?: ApiData[], budgetCache?: Record<string, ApiData>, budgetLimits?: Record<string, ApiData>,
  piggyCache?: Record<string, ApiData>, recCache?: Record<string, ApiData>, rules?: Record<string, ApiData>, ruleGroups?: ApiData[], rates?: ApiData[],
  rec?: ApiData, inbox?: ApiData, inboxHist?: { t: number, v: ApiData } | null, loanModel?: ApiData,
  dashEdit?: boolean, dashOptsOpen?: string | null, dashMore?: boolean, syncError?: string,
}
export const S: State = { y: 0, m: 0, signedIn: false, lists: null, tok: 0, form: null, currency: 'USD',
  freshAfter: 0, dirtyAt: 0, txMeta: {}, pendingDel: new Set() };
// An element by id, for ids the page is known to have; pass the element type when it matters: el<HTMLInputElement>('q')
export const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const todayIso = () => isoDate(new Date());
export type Period = { start: string, end: string, label: string, short: string, y?: number, m?: number, all?: boolean };
/* A "month" can start on any day (Settings → Month starts on, e.g. payday). Month m then runs from that day of m
   to the day before it in m + 1, clamped to short months; the 1st gives calendar months. */
export function cycleDay() { try { const v = +(localStorage.getItem('money.cycleDay') || 1); return v >= 1 && v <= 28 ? Math.floor(v) : 1; } catch (e) { return 1; } }
const cycleStart = (y: number, m: number, day: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12);
// The month (year, month index) a date falls in
export function monthOf(d: Date): [number, number] {
  const day = cycleDay(), s = cycleStart(d.getFullYear(), d.getMonth(), day);
  const x = d.getDate() >= s.getDate() ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return [x.getFullYear(), x.getMonth()];
}
export const nowMonth = () => monthOf(new Date());
export function monthRange(y: number, m: number) {
  const d = new Date(y, m, 1), yy = d.getFullYear(), mm = d.getMonth(), day = cycleDay();
  const s = cycleStart(yy, mm, day), e = cycleStart(yy, mm + 1, day); e.setDate(e.getDate() - 1);
  return {
    start: isoDate(s), end: isoDate(e),
    label: fmtD(d, { month: 'long', year: 'numeric' }),
    short: fmtD(d, { month: 'short' }), y: yy, m: mm,
  };
}
// The period the month selector shows: one month, or everything up to today when "All time" is picked.
const ALL_START = '1970-01-01';
export const period = (): Period => S.all ? { start: ALL_START, end: todayIso(), label: 'all time', short: 'all time', all: true } : monthRange(S.y, S.m);
// The month a page loads. Usually the one picked at the top; `at` asks for another month (the one before or after),
// which the router loads ahead of time so stepping to it is instant. A view given `at` only fetches, it draws nothing.
export const viewYM = (r: { at?: [number, number] }): [number, number] => r.at || [S.y, S.m];
export const viewPeriod = (r: { at?: [number, number] }): Period => r.at ? monthRange(...r.at) : period();
// A number from Firefly's strings ("12.50"); anything that isn't one counts as 0
export const num = (v: unknown) => { const n = parseFloat(v as string); return isNaN(n) ? 0 : n; };
// The list in a response: either the response itself or its data
export const arr = (r: ApiData): ApiData[] => Array.isArray(r) ? r : (r && Array.isArray(r.data)) ? r.data : [];
export const absDiff = (x: ApiData) => Math.abs(num(x.difference_float ?? x.difference));
export const sumDiff = (r: ApiData): number => arr(r).reduce((s, x) => s + absDiff(x), 0);
/* ---------- Regional formats ----------
   Every amount and date goes through these, in the locale picked in Settings → Appearance → Number & date format
   ("Automatic" follows the browser). Interface text stays English; only how numbers and dates are written changes. */
export const LOCALE_KEY = 'money.locale';
let locCache: [string | null, string] | null = null;
// Read on every format call (a setting synced from another device can change it), so the parsed value is kept
export function locale() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LOCALE_KEY); } catch (e) { /* storage blocked */ }
  if (locCache && locCache[0] === raw) return locCache[1];
  let pick = '';
  try { pick = raw ? String(JSON.parse(raw) || '') : ''; } catch (e) { /* not JSON */ }
  const want = pick || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  let ok = 'en-US';
  try { ok = Intl.NumberFormat.supportedLocalesOf([want])[0] || 'en-US'; } catch (e) { /* not a locale tag */ }
  locCache = [raw, ok];
  return ok;
}
const FMT = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function fmtFor<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: (loc: string) => T): T {
  const loc = locale(), k = loc + '|' + key;
  let f = FMT.get(k) as T | undefined;
  if (!f) { f = make(loc); FMT.set(k, f); }
  return f;
}
export const money = (n: number, dec = 2) => fmtFor('$' + S.currency + dec, loc => new Intl.NumberFormat(loc, { style: 'currency', currency: S.currency, minimumFractionDigits: dec, maximumFractionDigits: dec })).format(n || 0);
export const money0 = (n: number) => money(n, 0);
// A plain number with the locale's grouping (1,234 or 1.234)
export const fmtNum = (n: number, dec = 0) => fmtFor('n' + dec, loc => new Intl.NumberFormat(loc, { minimumFractionDigits: 0, maximumFractionDigits: dec })).format(n || 0);
// A date (or ISO day) written the locale's way, with the given parts
export function fmtD(d: Date | string, opts: Intl.DateTimeFormatOptions) {
  const dt = typeof d === 'string' ? new Date(d.slice(0, 10) + 'T12:00:00') : d;
  return fmtFor('d' + JSON.stringify(opts), loc => new Intl.DateTimeFormat(loc, opts)).format(dt);
}
export const fmtDay = (s: string | null | undefined) => s ? fmtD(String(s), { month: 'short', day: 'numeric' }) : '';
export const fmtDate = (s: string | null | undefined) => s ? fmtD(String(s), { month: 'short', day: 'numeric', year: 'numeric' }) : '';
// The locale's decimal mark: '.' in en-US, ',' in de-DE
export const decimalMark = () => fmtFor('n1', loc => new Intl.NumberFormat(loc, { minimumFractionDigits: 0, maximumFractionDigits: 1 })).formatToParts(1.5).find(p => p.type === 'decimal')?.value || '.';
/* An amount someone typed, written their way: "5,40", "1.234,56 €", "$1,234.56", "1 234,5". With both marks the last
   one is the decimal; with one mark followed by three digits ("1,234" or "1.234") the locale decides. null if it isn't one. */
export function parseAmount(text: string): number | null {
  const t = String(text).replace(/[\p{Sc}\s\u00a0\u202f']/gu, '');
  if (!/^-?\d[\d.,]*$/.test(t) || /[.,]{2}|[.,]$/.test(t)) return null;
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  let dec = '';
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? '.' : ',', parts = t.split(mark);
    dec = parts.length === 2 && (parts[1].length !== 3 || decimalMark() === mark) ? mark : '';
  }
  const [int, frac = ''] = dec ? [t.slice(0, t.lastIndexOf(dec)), t.slice(t.lastIndexOf(dec) + 1)] : [t, ''];
  if (/[.,]/.test(frac) || (dec && !/^-?\d{1,3}([.,]\d{3})*$|^-?\d+$/.test(int))) return null;
  const n = parseFloat(int.replace(/[.,]/g, '') + (frac ? '.' + frac : ''));
  return isNaN(n) ? null : n;
}
// The day a week starts on in the locale: 0 Sunday, 1 Monday … 6 Saturday
export function weekStart() {
  try {
    const L = new Intl.Locale(locale()) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }, weekInfo?: { firstDay: number } };
    const w = L.getWeekInfo ? L.getWeekInfo() : L.weekInfo;
    if (w && w.firstDay) return w.firstDay % 7;
    // Browsers without week info (Firefox): Sunday where the region uses it, Monday elsewhere
    return /^(US|CA|MX|BR|JP|KR|TW|HK|IL|IN|PH|ZA|AU|SA|PE|CO|VE|GT|DO|PA|PR)$/.test(L.maximize().region || 'US') ? 0 : 1;
  } catch (e) { return 0; }
}
// Weekday labels in the order the locale's week runs, from English names starting on Sunday
export const weekOrder = <T>(sunFirst: T[]) => { const s = weekStart(); return [...sunFirst.slice(s), ...sunFirst.slice(0, s)]; };
// How many blank cells come before the 1st in a month grid that starts on weekStart()
export const leadDays = (d: Date) => (d.getDay() - weekStart() + 7) % 7;
[S.y, S.m] = nowMonth();
export const sameName = (a: string | null | undefined, b: string | null | undefined) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/* ---------- Drill-down links: where a number in a chart or card leads ---------- */
// The transactions behind a number: q filters the list (category, budget, tag, type, search…) and range, when it isn't
// the month picked at the top, limits it to those dates (Transactions then shows them in place of the month).
export type Range = { start: string, end: string };
export function txHref(q: Record<string, string | null | undefined>, range?: Range | null) {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v) p.set(k, v); });
  if (range && !q.search) { p.set('start', range.start); p.set('end', range.end); }
  const s = p.toString();
  return '#/transactions' + (s ? '?' + s : '');
}
// Spending with no category (or no budget) over some dates, as a search: Firefly has no list of those otherwise
export const noneHref = (what: 'category' | 'budget', r: Range) => txHref({ search: 'has_no_' + what + ':true transaction_type:withdrawal date_after:' + r.start + ' date_before:' + r.end });

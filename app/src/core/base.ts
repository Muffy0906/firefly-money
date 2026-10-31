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
    label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    short: d.toLocaleString('en-US', { month: 'short' }), y: yy, m: mm,
  };
}
// The period the month selector shows: one month, or everything up to today when "All time" is picked.
const ALL_START = '1970-01-01';
export const period = (): Period => S.all ? { start: ALL_START, end: todayIso(), label: 'all time', short: 'all time', all: true } : monthRange(S.y, S.m);
// A number from Firefly's strings ("12.50"); anything that isn't one counts as 0
export const num = (v: unknown) => { const n = parseFloat(v as string); return isNaN(n) ? 0 : n; };
// The list in a response: either the response itself or its data
export const arr = (r: ApiData): ApiData[] => Array.isArray(r) ? r : (r && Array.isArray(r.data)) ? r.data : [];
export const absDiff = (x: ApiData) => Math.abs(num(x.difference_float ?? x.difference));
export const sumDiff = (r: ApiData): number => arr(r).reduce((s, x) => s + absDiff(x), 0);
const FMT = new Map<string, Intl.NumberFormat>();
function fmtFor(key: string, make: () => Intl.NumberFormat) { let f = FMT.get(key); if (!f) { f = make(); FMT.set(key, f); } return f; }
export const money = (n: number, dec = 2) => fmtFor(S.currency + dec, () => new Intl.NumberFormat('en-US', { style: 'currency', currency: S.currency, minimumFractionDigits: dec, maximumFractionDigits: dec })).format(n || 0);
export const money0 = (n: number) => money(n, 0);
const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }), DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtDay = (s: string | null | undefined) => s ? DAY_FMT.format(new Date(String(s).slice(0, 10) + 'T12:00:00')) : '';
export const fmtDate = (s: string | null | undefined) => s ? DATE_FMT.format(new Date(String(s).slice(0, 10) + 'T12:00:00')) : '';
[S.y, S.m] = nowMonth();
export const sameName = (a: string | null | undefined, b: string | null | undefined) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

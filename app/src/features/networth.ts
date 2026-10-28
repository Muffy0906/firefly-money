import { html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, todayIso } from '../core/base';
import { type Account, isAsset, isLiab, lists, normAccount } from '../core/lists';
import { LS, monthEnds } from '../core/helpers';
import { route } from '../core/router';

/* ---------- Net worth over time ----------
   Firefly reports an account's balance on any past day (GET /accounts?date=…), so the history is one request per
   point and type: the last day of each month, plus today. */
const POINTS = 13;
export type NetWorthPoint = { date: string, assets: number, debts: number, net: number };
export const nwYears = () => LS.get('nwYears', 1) === 3 ? 3 : 1;
async function netWorthHistory(): Promise<NetWorthPoint[]> {
  const L = await lists(), years = nwYears();
  const own = L.accounts.filter(a => a.active && a.netWorth && (isAsset(a) || isLiab(a))), ids = new Set(own.map(a => a.id));
  // A liability's debt is Firefly's current_debt, which isn't reported for past days; the dated balance is, so past
  // debts are the dated balance shifted by however much the two differ today.
  const shift = Object.fromEntries(own.filter(isLiab).map(a => [a.id, a.debt - Math.abs(a.balance)]));
  const total = (accts: Account[]) => {
    let assets = 0, debts = 0;
    accts.filter(a => ids.has(a.id)).forEach(a => { if (isLiab(a)) debts += Math.abs(a.balance) + (shift[a.id] || 0); else assets += a.balance; });
    return { assets, debts, net: assets - debts };
  };
  const days = monthEnds(todayIso(), POINTS, years * 12 / (POINTS - 1));
  const past = await Promise.all(days.slice(0, -1).map(date => Promise.all([getAll('/accounts', { type: 'asset', date }), getAll('/accounts', { type: 'liabilities', date })])
    .then(([as, ls]) => ({ date, ...total([...as, ...ls].map(normAccount)) }))));
  return [...past, { date: days[days.length - 1], ...total(own) }];
}
// One year or three, for the Overview's net worth tile
export const nwSeg = () => { const years = nwYears(); return html`<div class="seg mini">${htmlList([1, 3].map(y => html`<button type="button" class="${years === y ? 'on' : ''}" data-onclick="App.nwRange(${y})">${y === 1 ? '1Y' : '3Y'}</button>`))}</div>`; };
function nwRange(y: number) { LS.set('nwYears', y === 3 ? 3 : 1); route(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  netWorthHistory,
  nwRange,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

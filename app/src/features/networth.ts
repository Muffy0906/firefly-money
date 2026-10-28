import { html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, money0, todayIso } from '../core/base';
import { type Account, isAsset, isLiab, lists, normAccount } from '../core/lists';
import { LS, monthEnds } from '../core/helpers';
import { route } from '../core/router';
import { smoothPath } from './charts';

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
const label = (d: string, withYear?: boolean) => new Date(d + 'T12:00:00').toLocaleString('en-US', withYear ? { month: 'short', year: '2-digit' } : { month: 'short' });
function netWorthPanel(pts: NetWorthPoint[]) {
  const years = nwYears(), seg = html`<div class="seg mini">${htmlList([1, 3].map(y => html`<button type="button" class="${years === y ? 'on' : ''}" data-onclick="App.nwRange(${y})">${y === 1 ? '1 year' : '3 years'}</button>`))}</div>`;
  if (!pts || pts.length < 2) return html`<section class="panel chart"><div class="panel-head"><h2>Net worth</h2>${seg}</div><p class="empty">Couldn’t load your balance history.</p></section>`;
  const W = 380, H = 150, pt = 12, pb = 22, n = pts.length, vals = pts.map(p => p.net);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; }
  const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
  const x = (i: number) => 6 + (W - 12) * i / (n - 1), y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const line = smoothPath(pts.map((p, i) => [x(i), y(p.net)]));
  const area = line + ' L' + x(n - 1).toFixed(1) + ' ' + (H - pb) + ' L' + x(0).toFixed(1) + ' ' + (H - pb) + ' Z';
  const first = pts[0], last = pts[n - 1], d = last.net - first.net, pct = first.net ? d / Math.abs(first.net) * 100 : 0, good = d >= 0;
  const color = good ? 'var(--good)' : 'var(--spend)';
  const dots = htmlList(pts.map((p, i) => html`<g class="pt" data-tip="${(i === n - 1 ? 'Today' : label(p.date, true)) + '\nNet worth ' + money0(p.net) + '\nAssets ' + money0(p.assets) + ' · Debts ' + money0(p.debts)}"><rect x="${(x(i) - W / n / 2).toFixed(1)}" y="0" width="${(W / n).toFixed(1)}" height="${H - pb}" fill="transparent"/><circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.net).toFixed(1)}" r="${i === n - 1 ? 4.5 : 3}" fill="${i === n - 1 ? color : 'var(--panel)'}" stroke="${color}" stroke-width="1.6"/></g>`));
  const ticks = htmlList([0, Math.floor((n - 1) / 2), n - 1].map(i => html`<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${i === n - 1 ? 'Today' : label(pts[i].date, true)}</text>`));
  const zero = lo < 0 && hi > 0 ? html`<line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--line)" stroke-dasharray="4 4"/>` : '';
  return html`<section class="panel chart"><div class="panel-head"><h2>Net worth</h2>${seg}</div><p class="lead">What you own minus what you owe, at the end of each ${years === 1 ? 'month' : 'quarter'}</p><div class="total num${last.net < 0 ? ' negative' : ''}" style="margin-bottom:2px">${money0(last.net)}</div><div class="sub-s" style="margin-bottom:12px"><span class="${good ? 'down' : 'up'}">${good ? '▲' : '▼'} ${money0(Math.abs(d))}${first.net ? ' (' + (pct > 0 ? '+' : '') + pct.toFixed(0) + '%)' : ''}</span> since ${label(first.date, true)}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth over time"><defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${zero}<path class="area" d="${area}" fill="url(#nwg)"/><path class="draw" pathLength="1" d="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${dots}${ticks}</svg><div style="display:flex;gap:32px;margin-top:14px"><div><div class="eyebrow">Assets</div><div class="num" style="font-size:18px">${money0(last.assets)}</div></div><div><div class="eyebrow">Debts</div><div class="num" style="font-size:18px">${money0(last.debts)}</div></div></div></section>`;
}
function nwRange(y: number) { LS.set('nwYears', y === 3 ? 3 : 1); route(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  netWorthHistory,
  netWorthPanel,
  nwRange,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

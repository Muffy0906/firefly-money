import { html, htmlList } from '../core/html';
import { fmtDay, money, money0 } from '../core/base';
import { type SubAudit, type SubItem } from './subaudit';
import { t } from '../core/spanish';

/* The subscription audit on screen: the full list for the Bills page and a compact tile for Overview. The numbers come from subaudit.ts. */
const plural = (n: number, w: string) => t('{count} {unit}', { count: n, unit: t(w + (n === 1 ? '' : 's')) });
// The related charges: a search on the payee, across all dates
export const subChargesHref = (payee: string) => '#/transactions?search=' + encodeURIComponent('destination_account_is:"' + payee.replace(/"/g, '') + '"');

function chips(i: SubItem) {
  return html`${i.hike ? html` <span class="chip warn">${t('Up {percent}% · {from} → {to}', { percent: i.hike.pct, from: money(i.hike.from), to: money(i.hike.to) })}</span>` : i.creep ? html` <span class="chip warn">${t('Up {percent}% since {date}', { percent: i.creep.pct, date: fmtDay(i.creep.since) })}</span>` : ''}${i.status === 'quiet' ? html` <span class="chip bad">${t('No charge in {duration}', { duration: plural(i.daysSince, 'day') })}</span>` : i.status === 'late' ? html` <span class="chip warn">${t('{duration} late', { duration: plural(i.daysLate, 'day') })}</span>` : i.dueSoon ? html` <span class="chip">Due soon</span>` : ''}`;
}
function row(i: SubItem) {
  const when = i.status === 'quiet' ? t('last charged {date}', { date: fmtDay(i.last) }) : i.status === 'late' ? t('expected {date}', { date: fmtDay(i.next) }) : t('next {date}', { date: fmtDay(i.next) });
  return html`<div class="row"${i.status === 'quiet' ? html` style="opacity:.8"` : ''}><span class="name">${i.payee}${chips(i)}<br><span class="sub-s">${i.min === i.max ? money(i.amount) : t('About {amount}', { amount: money(i.amount) })} ${t('every {count}', { count: i.every })} · ${t('{amount} a year', { amount: money0(i.perYear) })} · ${when}</span></span><a class="btn small" href="${subChargesHref(i.payee)}">Charges</a></div>`;
}
export function subAuditPanel(a: SubAudit) {
  if (!a.items.length) return '';
  const kpi = (label: string, v: string, sub = '', cls = '') => html`<div class="kpi"><div class="eyebrow">${label}</div><div class="val num ${cls}">${v}</div>${sub ? html`<div class="sub-s">${sub}</div>` : ''}</div>`;
  const flags = [a.hikes ? plural(a.hikes, 'price rise') : '', a.late ? plural(a.late, 'late charge') : '', a.quiet ? plural(a.quiet, 'quiet one') : ''].filter(Boolean).join(' · ');
  return html`<section class="panel" style="margin-top:20px"><h2>Subscription audit</h2><p class="lead">${t(flags ? 'Every charge that repeats, from the past year of spending · {flags}' : 'Every charge that repeats, from the past year of spending', { flags })}</p><div class="kpis" style="margin-top:14px">${kpi('A month', money0(a.monthly), plural(a.items.length - a.quiet, 'active subscription'))}${kpi('A year', money0(a.yearly))}${a.quiet ? kpi('Maybe cancelled', money0(a.quietYearly), 'a year, if it has really stopped', 'neg') : ''}</div><div class="list">${htmlList(a.items.map(row))}</div></section>`;
}
// Overview: small enough for a slim card (one number and a line of flags)
export function subAuditTile(a: SubAudit | null) {
  if (!a) return html`<section class="panel stat"><div class="eyebrow">Subscriptions</div><div class="stat-v num">—</div><div class="sub-s">Couldn’t load your charges.</div></section>`;
  if (!a.items.length) return html`<section class="panel stat"><div class="eyebrow">Subscriptions</div><div class="stat-v num">${money0(0)}</div><div class="sub-s">No repeating charges found yet.</div></section>`;
  const live = a.items.length - a.quiet;
  return html`<section class="panel stat subs-tile" style="display:flex;flex-direction:column;justify-content:center"><div class="eyebrow">Subscriptions</div><a class="stat-v num" href="#/bills" title="Open the subscription audit" style="display:block;width:fit-content;text-decoration:none">${money0(a.monthly)}</a><div class="sub-s">a month · ${money0(a.yearly)} a year · ${plural(live, 'subscription')}</div><div class="sub-s" style="margin-top:8px">${a.hikes ? html`<span class="chip warn">${plural(a.hikes, 'price rise')}</span> ` : ''}${a.quiet ? html`<span class="chip bad">${a.quiet} quiet</span> ` : ''}${a.dueSoon ? html`<span class="chip">${a.dueSoon} due soon</span>` : ''}${!a.hikes && !a.quiet && !a.dueSoon ? 'Nothing needs a look.' : ''}</div></section>`;
}

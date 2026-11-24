import { html, htmlList } from '../core/html';
import { fmtDay, money, money0 } from '../core/base';
import { type SubAudit, type SubItem } from './subaudit';
import { kpi as kpiCard, panelHead } from '../core/ui';

/* The subscription audit on screen: the full list for the Bills page and a compact tile for Overview. The numbers come from subaudit.ts. */
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
// The related charges: a search on the payee, across all dates
export const subChargesHref = (payee: string) => '#/transactions?search=' + encodeURIComponent('destination_account_is:"' + payee.replace(/"/g, '') + '"');

function chips(i: SubItem) {
  return html`${i.hike ? html` <span class="chip warn">Up ${i.hike.pct}% · ${money(i.hike.from)} → ${money(i.hike.to)}</span>` : i.creep ? html` <span class="chip warn">Up ${i.creep.pct}% since ${fmtDay(i.creep.since)}</span>` : ''}${i.status === 'quiet' ? html` <span class="chip bad">No charge in ${plural(i.daysSince, 'day')}</span>` : i.status === 'late' ? html` <span class="chip warn">${plural(i.daysLate, 'day')} late</span>` : i.dueSoon ? html` <span class="chip">Due soon</span>` : ''}`;
}
function row(i: SubItem) {
  const when = i.status === 'quiet' ? 'last charged ' + fmtDay(i.last) : (i.status === 'late' ? 'expected ' : 'next ') + fmtDay(i.next);
  return html`<div class="row"${i.status === 'quiet' ? html` style="opacity:.8"` : ''}><span class="name">${i.payee}${chips(i)}<br><span class="sub-s">${i.min === i.max ? money(i.amount) : 'About ' + money(i.amount)} every ${i.every} · ${money0(i.perYear)} a year · ${when}</span></span><a class="btn small" href="${subChargesHref(i.payee)}">Charges</a></div>`;
}
export function subAuditPanel(a: SubAudit) {
  if (!a.items.length) return '';
  const kpi = (label: string, v: string, sub = '', cls = '') => kpiCard(label, v, sub || null, cls);
  const flags = [a.hikes ? plural(a.hikes, 'price rise') : '', a.late ? plural(a.late, 'late charge') : '', a.quiet ? plural(a.quiet, 'quiet one') : ''].filter(Boolean).join(' · ');
  return html`<section class="panel" style="margin-top:20px">${panelHead('Subscription audit', html`Every charge that repeats, from the past year of spending${flags ? ' · ' + flags : ''}`)}<div class="kpis" style="margin-top:14px">${kpi('A month', money0(a.monthly), plural(a.items.length - a.quiet, 'active subscription'))}${kpi('A year', money0(a.yearly))}${a.quiet ? kpi('Maybe cancelled', money0(a.quietYearly), 'a year, if it has really stopped', 'neg') : ''}</div><div class="list">${htmlList(a.items.map(row))}</div></section>`;
}
// Overview: small enough for a slim card (one number and a line of flags)
export function subAuditTile(a: SubAudit | null) {
  if (!a) return html`<section class="panel stat"><div class="eyebrow">Subscriptions</div><div class="stat-v num">—</div><div class="sub-s">Couldn’t load your charges.</div></section>`;
  if (!a.items.length) return html`<section class="panel stat"><div class="eyebrow">Subscriptions</div><div class="stat-v num">${money0(0)}</div><div class="sub-s">No repeating charges found yet.</div></section>`;
  const live = a.items.length - a.quiet;
  return html`<section class="panel stat subs-tile" style="display:flex;flex-direction:column;justify-content:center"><div class="eyebrow">Subscriptions</div><a class="stat-v num" href="#/bills" title="Open the subscription audit" style="display:block;width:fit-content;text-decoration:none">${money0(a.monthly)}</a><div class="sub-s">a month · ${money0(a.yearly)} a year · ${plural(live, 'subscription')}</div><div class="sub-s" style="margin-top:8px">${a.hikes ? html`<span class="chip warn">${plural(a.hikes, 'price rise')}</span> ` : ''}${a.quiet ? html`<span class="chip bad">${a.quiet} quiet</span> ` : ''}${a.dueSoon ? html`<span class="chip">${a.dueSoon} due soon</span>` : ''}${!a.hikes && !a.quiet && !a.dueSoon ? 'Nothing needs a look.' : ''}</div></section>`;
}

import { type Html, html, htmlList } from '../core/html';
import { fmtDay, money, money0 } from '../core/base';
import { head } from '../core/dom';
import { VIEWS } from '../core/router';
import { type Flag, type Mover, loadUnusual } from '../features/unusual';
import { panelHead, doneState } from '../core/ui';

/* ================= Unusual: odd charges and merchant trends (features/unusual.ts) ================= */
const KIND: Record<Flag['kind'], string> = { duplicate: 'Repeated', spike: 'Much higher', 'new-large': 'New merchant' };
export const flagRow = (f: Flag): Html => html`<a class="row unusual-row" href="#/transactions" data-onclick="event.preventDefault();App.editTx('${f.charge.id}')"><span class="name">${f.charge.payee}<span class="sub-s" style="display:block">${fmtDay(f.charge.date)} · ${f.why}</span></span><span class="un-r"><span class="chip warn">${KIND[f.kind]}</span><span class="num">${money(f.charge.amount)}</span></span></a>`;
const moverRow = (m: Mover, mode: 'up' | 'down' | 'new'): Html => html`<a class="row" href="${m.payeeId ? '#/account/' + m.payeeId : '#/transactions'}"><span class="name">${m.payee}<span class="sub-s" style="display:block">${mode === 'new' ? 'First charge this month' : 'Usually ' + money0(m.base) + ' by now'}</span></span><span class="num ${mode === 'up' ? 'up' : mode === 'down' ? 'down' : ''}">${mode === 'new' ? money0(m.now) : (mode === 'up' ? '▲ ' : '▼ ') + money0(Math.abs(m.delta))}<span class="sub-s" style="display:block;text-align:right">${mode === 'new' ? '' : money0(m.now) + ' so far'}</span></span></a>`;
const section = (title: string, lead: string, rows: Html[]) => rows.length ? html`<section class="panel">${panelHead(title, lead)}<div class="list">${htmlList(rows)}</div></section>` : '';
VIEWS.unusual = async (r, paint) => {
  let u;
  try { u = await loadUnusual(); } catch (e) {
    paint(html`${head('Unusual charges', 'Charges worth a second look', '')}<section class="panel quiet"><p class="lead">Firefly isn’t answering, so nothing is shown.</p></section>`);
    return;
  }
  const none = !u.flags.length && !u.risers.length && !u.fallers.length && !u.fresh.length;
  paint(html`${head('Unusual charges', 'Charges worth a second look, and who moved most', '')}${none ? html`<section class="panel">${doneState('Nothing unusual', 'No repeated, oversized or brand-new large charges in the last 30 days.', 50)}</section>` : html`<div class="cards">
${section('Unusual charges', 'Last 30 days. Tap one to look at it.', u.flags.map(flagRow))}
${section('Rising merchants', 'This month so far against the same days of the last 3 months', u.risers.map(m => moverRow(m, 'up')))}
${section('Falling merchants', 'This month so far against the same days of the last 3 months', u.fallers.map(m => moverRow(m, 'down')))}
${section('New this month', 'Merchants you hadn’t paid before', u.fresh.map(m => moverRow(m, 'new')))}</div>`}`);
};

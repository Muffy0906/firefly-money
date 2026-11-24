import { type Html, html, htmlList } from '../core/html';
import { S, el, money0 } from '../core/base';
import { openDrawer } from '../core/dom';

/* ---------- Overview cards open a drawer with the full picture behind them ----------
   A card shows a glance (the top few); tapping its empty space slides in everything: every category, payee, budget or month.
   The bodies are built from the figures the Overview already has (nothing new is fetched), and are registered each time the page is
   drawn, so a card without data (Firefly not answering) has no drawer. Links and buttons inside a card still do their own thing. */
const DETAIL = new Map<string, { title: string, body: () => Html }>();
export const detailSet = (key: string, title: string, body: (() => Html) | null) => { if (body) DETAIL.set(key, { title, body }); else DETAIL.delete(key); };
export const detailHas = (key: string) => DETAIL.has(key);
export const detailKeys = () => [...DETAIL.keys()];

export type DetailRow = { name: string, amt: number, prev?: number, href?: string, note?: string };
// A ranked list with a share bar for each row, optionally against the same row last month
export function shareList(rows: DetailRow[], total: number, compare: boolean) {
  const sorted = rows.filter(r => r.amt > 0).sort((a, b) => b.amt - a.amt), top = sorted.length ? sorted[0].amt : 1;
  if (!sorted.length) return html`<p class="empty">Nothing recorded.</p>`;
  return html`<div class="goal-rows">${htmlList(sorted.map(r => {
    const d = r.amt - (r.prev || 0), vs = !compare ? '' : !r.prev ? 'new' : Math.abs(d) < 1 ? 'same as last month' : money0(Math.abs(d)) + (d > 0 ? ' more' : ' less') + ' than last month';
    const name = r.href ? html`<a href="${r.href}" data-onclick="App.closeDrawer()">${r.name}</a>` : r.name;
    return html`<div class="cat"><div class="row"><span class="name">${name}</span><span class="num">${money0(r.amt)}</span></div><div class="track"><div class="fill" style="width:${(r.amt / top * 100).toFixed(1)}%"></div></div><div class="sub">${total ? (r.amt / total * 100).toFixed(0) + '% of the total' : ''}${vs ? (total ? ' · ' : '') + vs : ''}${r.note ? ' · ' + r.note : ''}</div></div>`;
  }))}</div>`;
}
document.addEventListener('click', e => {
  const t = e.target instanceof Element ? e.target : null, w = t && t.closest<HTMLElement>('#dash .w[data-w]');
  if (!t || !w || S.dashEdit || el('drawer').classList.contains('open')) return;
  const d = DETAIL.get(w.dataset.w || ''); if (!d) return;
  if (t.closest('a[href], button, input, select, label, [data-go], [data-onclick], .ring-seg, svg.flowchart')) return;     // a link, button or chart point in the card does its own thing
  openDrawer(d.title, d.body());
});

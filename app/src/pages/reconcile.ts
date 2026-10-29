import { html, htmlList } from '../core/html';
import { api, eachLimited, getAll } from '../core/api';
import { withAuth } from '../core/auth';
import { App, S, el, fmtDay, money, num, todayIso, type ApiData } from '../core/base';
import { confirmBox, head, toast } from '../core/dom';
import { type Group, groupUpdate, normGroup } from '../core/feed';
import { addDays } from '../core/helpers';
import { isCard, isLiab, lists, normAccount } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { newTx } from '../features/txform';

/* ================= Reconcile ================= */
type RecRow = { gid: string, jid: string, date: string, desc: string, amt: number, rec: boolean };
// The statement being reconciled (S.rec): the account, its rows, and the journal ids ticked off so far
type Rec = { a: ApiData, groups: Record<string, Group>, rows: RecRow[], startBal: number, owed: boolean, start: string, end: string, checked: Set<string>, diff?: number | null };
VIEWS.reconcile = async (r, paint) => {
  await lists();
  const a = normAccount((await api('/accounts/' + r.id)).data);
  const end = r.q.end || todayIso(), start = r.q.start || end.slice(0, 8) + '01';
  const [before, txs] = await Promise.all([
    api('/accounts/' + r.id, { params: { date: addDays(start, -1) } }),
    getAll('/accounts/' + r.id + '/transactions', { start, end }),
  ]);
  const owed = isCard(a) || isLiab(a);
  const rows: RecRow[] = [], groups: Record<string, Group> = {};
  txs.map(normGroup).forEach(g => g.splits.forEach(s => {
    groups[g.id] = g;
    if (s.source_id !== a.id && s.destination_id !== a.id) return;
    rows.push({ gid: g.id, jid: s.jid, date: s.date, desc: s.description, amt: s.source_id === a.id ? -s.amount : s.amount, rec: s.reconciled });
  }));
  rows.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  if (!paint.live) return;
  S.rec = { a, groups, rows, startBal: num(before.data.attributes.current_balance), owed, start, end, checked: new Set(rows.filter(x => x.rec).map(x => x.jid)) };
  paint(html`<p style="margin:0 0 6px"><a class="link" href="#/account/${a.id}">← ${a.name}</a></p>${head('Reconcile ' + a.name, 'Tick off each transaction that appears on your statement until the difference is zero.', '')}<section class="panel" style="margin-bottom:20px"><div class="grid2" style="grid-template-columns:repeat(3,1fr);gap:0 16px"><label>Statement start<input type="date" id="rc-start" value="${start}" data-onchange="App.recDates()"></label><label>Statement end<input type="date" id="rc-end" value="${end}" data-onchange="App.recDates()"></label><label>${owed ? 'Statement balance owed' : 'Statement ending balance'}<input type="number" step="0.01" id="rc-bal" value="${r.q.balance || ''}" data-oninput="App.recCalc()" placeholder="From your statement"></label></div><div class="kpis" id="rc-kpis" style="margin:4px 0 0"></div><div id="rc-actions" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"></div></section><section class="panel flush">${rows.length ? html`<table class="tbl"><thead><tr><th class="sel"><input type="checkbox" data-onchange="App.recAll(this.checked)" aria-label="Tick all"></th><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>${htmlList(rows.map(x => html`<tr><td class="sel"><input type="checkbox" data-rec="${x.jid}"${S.rec.checked.has(x.jid) ? ' checked' : ''}${x.rec ? html` disabled title="Already reconciled"` : ''} data-onchange="App.recTick(this)"></td><td class="date">${fmtDay(x.date)}</td><td class="desc">${x.desc}${x.rec ? html` <span class="chip good">Reconciled</span>` : ''}</td><td class="amt ${x.amt < 0 ? 'neg' : 'pos'}">${x.amt > 0 ? '+' : ''}${money(x.amt)}</td></tr>`))}</tbody></table>`
      : html`<div class="center-empty">No transactions in this period.</div>`}</section>`);
  recCalc();
};
function recCalc() {
  const R: Rec = S.rec; if (!R) return;
  const disp = (v: number) => R.owed ? -v : v;
  const cleared = R.startBal + R.rows.filter(x => R.checked.has(x.jid)).reduce((s, x) => s + x.amt, 0);
  const raw = el<HTMLInputElement>('rc-bal').value.trim(), stmt = raw === '' ? null : (R.owed ? -num(raw) : num(raw));
  const diff = stmt === null ? null : Math.round((stmt - cleared) * 100) / 100;
  const newly = R.rows.filter(x => R.checked.has(x.jid) && !x.rec).length;
  el('rc-kpis').innerHTML =
    String(html`<div class="kpi"><div class="eyebrow">Balance before ${fmtDay(R.start)}</div><div class="val num">${money(disp(R.startBal))}</div></div><div class="kpi"><div class="eyebrow">Ticked balance</div><div class="val num">${money(disp(cleared))}</div></div><div class="kpi"><div class="eyebrow">Difference</div><div class="val num ${diff === null ? '' : diff === 0 ? 'pos' : 'neg'}">${diff === null ? '—' : diff === 0 ? 'Balanced ✓' : money(disp(diff))}</div></div>`);
  el('rc-actions').innerHTML =
    String(html`<button class="btn primary" data-onclick="App.recFinish()"${newly ? '' : ' disabled'}>Mark ${newly} as reconciled</button>${diff ? html`<button class="btn" data-onclick="App.recAdjust()">Add a ${money(Math.abs(diff))} adjustment</button>` : ''}`);
  R.diff = diff;
}
function recTick(cb: HTMLInputElement) { cb.checked ? S.rec.checked.add(cb.dataset.rec) : S.rec.checked.delete(cb.dataset.rec); recCalc(); }
function recAll(on: boolean) { document.querySelectorAll<HTMLInputElement>('input[data-rec]:not(:disabled)').forEach(cb => { cb.checked = on; on ? S.rec.checked.add(cb.dataset.rec) : S.rec.checked.delete(cb.dataset.rec); }); recCalc(); }
function recDates() { location.hash = '#/reconcile/' + S.rec.a.id + '?start=' + el<HTMLInputElement>('rc-start').value + '&end=' + el<HTMLInputElement>('rc-end').value + (el<HTMLInputElement>('rc-bal').value ? '&balance=' + encodeURIComponent(el<HTMLInputElement>('rc-bal').value) : ''); }
async function recFinish() {
  const R: Rec = S.rec, todo: { gid: string, jid: string }[] = R.rows.filter(x => R.checked.has(x.jid) && !x.rec);
  if (R.diff && !await confirmBox('The difference isn’t zero', 'You can still mark the ticked transactions as reconciled, but the account won’t match the statement yet.', 'Mark anyway')) return;
  await withAuth(async () => {
    // one request per transaction, so parts of the same one aren't saved over each other
    const jids = new Set(todo.map(x => x.jid)), gids = [...new Set(todo.map(x => x.gid))];
    let n = 0;
    await eachLimited(gids, 4, async gid => {
      const g = R.groups[gid];
      await api('/transactions/' + gid, { method: 'PUT', body: groupUpdate(g, s => jids.has(s.jid) ? { reconciled: true } : null) });
      n += g.splits.filter(s => jids.has(s.jid)).length;
    });
    toast(n + ' transaction' + (n === 1 ? '' : 's') + ' reconciled'); route();
  });
}
async function recAdjust() {
  const R = S.rec, d = R.diff; if (!d) return;
  await lists();
  newTx({ type: d > 0 ? 'deposit' : 'withdrawal', account: R.a.id, amount: String(Math.abs(d)), description: 'Reconciliation adjustment', date: R.end });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  recCalc,
  recTick,
  recAll,
  recDates,
  recFinish,
  recAdjust,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { withAuth } from '../core/auth';
import { App, S, fmtDay, money, todayIso, type ApiData } from '../core/base';
import { confirmBox, head, toast, todoTabs } from '../core/dom';
import { type Group, avatarHtml, normGroup, payeeOf, signed } from '../core/feed';
import { LS, addDays, daysBetween } from '../core/helpers';
import { invalidate, lists } from '../core/lists';
import { VIEWS, route } from '../core/router';

/* ================= Review: new transactions, until you've looked at them =================
   Firefly has no "reviewed" flag, so the queue is every transaction added (created_at) after the moment you last
   cleared it (reviewedAt), minus the ones you ticked off one by one since (reviewed). Both follow you between
   devices. The first time, it starts two weeks back. */
const LOOKBACK = 60;
export function reviewQueue(raw: ApiData[], reviewedAt: string, done: string[]) {
  // Times come with different offsets (Firefly's own, and this device's), so compare them as moments
  const skip = new Set(done), mark = Date.parse(reviewedAt) || 0, at = (g: ApiData) => Date.parse((g.attributes || {}).created_at) || 0;
  return raw.filter(g => at(g) > mark && !skip.has(String(g.id))).sort((a, b) => at(b) - at(a));
}
/* ---------- Transfers to match ----------
   Two banks' imports often record one move as two transactions: money leaving one of your accounts as an expense and
   arriving in another as income. A pair with the same amount within 4 days is offered as one transfer. */
export type XferPair = { id: string, out: Group, in: Group, amount: number };
export function matchTransfers(groups: Group[], own: Set<string>, skip: Set<string>) {
  const one = (g: Group) => g.splits.length === 1 ? g.splits[0] : null;
  const outs = groups.filter(g => g.type === 'withdrawal' && one(g) && own.has(one(g)!.source_id) && !own.has(one(g)!.destination_id));
  const ins = groups.filter(g => g.type === 'deposit' && one(g) && own.has(one(g)!.destination_id) && !own.has(one(g)!.source_id));
  const used = new Set<string>(), out: XferPair[] = [];
  outs.sort((a, b) => a.date.localeCompare(b.date)).forEach(o => {
    const so = one(o)!, d = String(so.date).slice(0, 10);
    const best = ins.filter(i => !used.has(i.id) && one(i)!.destination_id !== so.source_id && Math.abs(one(i)!.amount - so.amount) < .005 && !skip.has(o.id + ':' + i.id))
      .map(i => ({ i, gap: Math.abs(daysBetween(d, String(one(i)!.date).slice(0, 10))) })).filter(x => x.gap <= 4).sort((a, b) => a.gap - b.gap)[0];
    if (best) { used.add(best.i.id); out.push({ id: o.id + ':' + best.i.id, out: o, in: best.i, amount: so.amount }); }
  });
  return out;
}
function pairsPanel(pairs: XferPair[]) {
  if (!pairs.length) return '';
  return html`<section class="panel" style="margin-bottom:20px"><div class="panel-head"><h2>Transfers to match</h2><span class="neutral">${pairs.length} found</span></div><p class="lead">These look like one move between your accounts, imported as an expense and an income. Make each one a transfer so it isn’t counted as spending.</p><div class="list">${htmlList(pairs.map(p => { const a = p.out.splits[0], b = p.in.splits[0]; return html`<div class="row xfer-pair"><span class="name">${a.source_name} → ${b.destination_name}<span class="sub-s" style="display:block">${fmtDay(a.date)} “${a.description}” · ${fmtDay(b.date)} “${b.description}”</span></span><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><span class="num">${money(p.amount)}</span><button type="button" class="btn small primary" data-onclick="App.mergeTransfer('${p.id}')">Make a transfer</button><button type="button" class="link" data-onclick="App.skipPair('${p.id}')">Not a pair</button></span></div>`; }))}</div></section>`;
}
let lastPairs: XferPair[] = [];
async function mergeTransfer(id: string) {
  const p = lastPairs.find(x => x.id === id); if (!p) return;
  const a = p.out.splits[0], b = p.in.splits[0];
  if (!await confirmBox('Make this one transfer?', 'Money adds a transfer of ' + money(p.amount) + ' from ' + a.source_name + ' to ' + b.destination_name + ' on ' + fmtDay(a.date) + ', then deletes the two separate transactions.', 'Make a transfer')) return;
  await withAuth(async () => {
    const tx: Record<string, unknown> = { type: 'transfer', date: String(a.date).slice(0, 10), amount: String(p.amount), description: a.description || b.description, source_id: a.source_id, destination_id: b.destination_id };
    if (a.category) tx.category_name = a.category;
    if (a.tags.length || b.tags.length) tx.tags = [...new Set([...a.tags, ...b.tags])];
    if (a.notes || b.notes) tx.notes = [a.notes, b.notes].filter(Boolean).join('\n');
    await api('/transactions', { method: 'POST', body: { apply_rules: false, fire_webhooks: true, error_if_duplicate_hash: false, transactions: [tx] } });
    await api('/transactions/' + p.out.id, { method: 'DELETE' });
    await api('/transactions/' + p.in.id, { method: 'DELETE' });
    invalidate(); toast('Transfer made'); route();
  });
}
function skipPair(id: string) { LS.set('xferSkip', [...new Set([...LS.get('xferSkip', []), id])].slice(-200)); route(); }
const since = () => LS.get('reviewedAt', '') || addDays(todayIso(), -14) + 'T00:00:00';
VIEWS.review = async (r, paint) => {
  await lists();
  const raw = await getAll('/transactions', { type: 'all', start: addDays(todayIso(), -LOOKBACK), end: addDays(todayIso(), 7) });
  const queue = reviewQueue(raw, since(), LS.get('reviewed', []));
  const own = new Set(S.lists!.own.map(a => a.id)), pairs = lastPairs = matchTransfers(raw.map(normGroup), own, new Set(LS.get('xferSkip', [])));
  // Forget ticked-off ids that have left the queue's window
  const ids = new Set(raw.map(g => String(g.id))), done: string[] = LS.get('reviewed', []);
  if (done.some(id => !ids.has(id))) LS.set('reviewed', done.filter(id => ids.has(id)));
  const rows = htmlList(queue.map(normGroup).map(g => {
    const f = g.splits[0], v = signed(g, ''), cats = [...new Set(g.splits.map(s => s.category).filter(Boolean))];
    const what = g.type === 'transfer' ? 'Transfer' : cats.length ? cats.join(', ') : html`<span class="chip warn">Uncategorized</span>`;
    return html`<div class="review-row" data-gid="${g.id}"><button type="button" class="review-main" data-onclick="App.editTx('${g.id}')">${avatarHtml(g)}<span class="txt"><span class="desc">${g.splits.length > 1 ? g.title || f.description : f.description}</span><span class="sub-s">${fmtDay(g.date)} · ${payeeOf(g).name} · ${what}${f.budget_name ? ' · ' + f.budget_name : ''}</span></span><span class="num ${v < 0 ? 'neg' : v > 0 ? 'pos' : 'neutral'}">${v > 0 ? '+' : ''}${money(g.type === 'transfer' ? g.total : v)}</span></button><button type="button" class="btn small" title="Looks right" aria-label="Looks right" data-onclick="App.reviewDone('${g.id}')">✓<span class="lbl"> Looks right</span></button></div>`;
  }));
  paint(html`${head('To do', queue.length ? queue.length + ' new transaction' + (queue.length === 1 ? '' : 's') + ' to look over' : 'Nothing new to look over', queue.length ? html`<button class="btn" data-onclick="App.reviewAll()">Mark all reviewed</button>` : '')}${todoTabs('review')}${pairsPanel(pairs)}<section class="panel">${rows ? html`<div class="review-list">${rows}</div>` : html`<div class="center-empty" style="padding:60px 20px"><div style="font-size:40px">✓</div><h2 style="font-size:18px;margin:10px 0 4px">All reviewed</h2>New transactions show up here as Firefly gets them, from imports, rules or other apps.</div>`}</section><p class="sub-s" style="margin-top:14px">Open a transaction to fix its category, budget or amount, then tick it off. Transactions added since ${fmtDay(since().slice(0, 10))} show here.</p>`);
};
function reviewDone(id: string) {
  LS.set('reviewed', [...new Set([...LS.get('reviewed', []), String(id)])]);
  const row = document.querySelector<HTMLElement>('.review-row[data-gid="' + id + '"]');
  if (row) row.classList.add('gone');
  setTimeout(() => route({ quiet: true }), 220);
}
function reviewAll() { LS.set('reviewedAt', new Date().toISOString()); LS.set('reviewed', []); route(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  reviewDone,
  reviewAll,
  mergeTransfer,
  skipPair,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

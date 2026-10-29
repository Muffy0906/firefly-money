import { Html, html, htmlList } from './html';
import { type ApiData, S, money, num, todayIso } from './base';
import { daysBetween } from './helpers';
import { logoImg } from './logo';
import { hoursText, learnRate, lensOn } from './worklens';

/* ================= Transactions: normalize ================= */
// One split (Firefly "transaction") of a group, in the shape the app uses
export type Split = {
  jid: string, type: string, date: string, amount: number, description: string,
  source_id: string, source_name: string, source_type: string, destination_id: string, destination_name: string, destination_type: string,
  category: string, budget_id: string, budget_name: string, bill_id: string, bill_name: string, tags: string[], notes: string,
  sba: string | null | undefined, dba: string | null | undefined,      // source/destination balance after, when Firefly sends it
  fa: string, fc: string, reconciled: boolean,                         // foreign amount and currency
  lat: number | null, lng: number | null,                              // where it was paid, when known
};
// A transaction group: what the app calls a transaction. type and date are its first split's.
export type Group = { id: string, title: string, type: string, date: string, splits: Split[], total: number };
export function normGroup(g: ApiData): Group {
  const a = g.attributes || {};
  const splits: Split[] = (a.transactions || []).map((t: ApiData) => ({
    jid: String(t.transaction_journal_id), type: t.type, date: t.date, amount: num(t.amount), description: t.description || '',
    source_id: String(t.source_id || ''), source_name: t.source_name || '', source_type: t.source_type || '',
    destination_id: String(t.destination_id || ''), destination_name: t.destination_name || '', destination_type: t.destination_type || '',
    category: t.category_name || '', budget_id: t.budget_id ? String(t.budget_id) : '', budget_name: t.budget_name || '',
    bill_id: t.bill_id ? String(t.bill_id) : '', bill_name: t.bill_name || '', tags: t.tags || [], notes: t.notes || '',
    sba: t.source_balance_after, dba: t.destination_balance_after,
    fa: t.foreign_amount != null && t.foreign_amount !== '' ? String(num(t.foreign_amount)) : '', fc: t.foreign_currency_code || '', reconciled: !!t.reconciled,
    lat: t.latitude != null && t.latitude !== '' ? Number(t.latitude) : null, lng: t.longitude != null && t.longitude !== '' ? Number(t.longitude) : null,
  }));
  const f: Partial<Split> = splits[0] || {};
  return { id: String(g.id), title: a.group_title || '', type: f.type as string, date: f.date as string, splits, total: splits.reduce((s, x) => s + x.amount, 0) };
}

// The body for PUT /transactions/{id}. Firefly takes the list as every part the group keeps and deletes
// any part left out, so send them all and change only the parts patch returns fields for.
export function groupUpdate(g: Group, patch: (s: Split) => Record<string, unknown> | null | undefined, extra: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = { apply_rules: false, ...extra, transactions: g.splits.map(s => ({ ...patch(s), transaction_journal_id: s.jid })) };
  if (g.splits.length > 1) body.group_title = g.title || g.splits[0].description;
  return body;
}

// Signed amount: negative = money out. With an account in view, sign is relative to that account.
export function signed(g: Group, accountId?: string) {
  if (accountId) return g.splits.reduce((s, x) => s + (x.source_id === accountId ? -x.amount : x.destination_id === accountId ? x.amount : 0), 0);
  if (g.type === 'withdrawal') return -g.total;
  if (g.type === 'deposit') return g.total;
  return 0;
}
function amountCell(g: Group, accountId?: string) {
  const v = signed(g, accountId);
  if (!accountId && g.type === 'transfer') return html`<td class="amt neutral">${money(g.total)}</td>`;
  return html`<td class="amt ${v < 0 ? 'neg' : v > 0 ? 'pos' : 'neutral'}">${amtInner(v)}</td>`;
}
// A signed amount, and under money out the hours of work it cost when that lens is on (Settings → Appearance)
export function amtInner(v: number) {
  const hrs = v < 0 && lensOn() ? hoursText(v, true) : '';
  if (v < 0 && lensOn() && !hrs) learnRate();
  return html`<span>${v > 0 ? '+' : ''}${money(v)}</span>${hrs ? html`<span class="hrs" title="Hours of work">${hrs}</span>` : ''}`;
}

/* ---------- Merchant avatars ---------- */
const AV_NOISE = /^(sq|tst|pos|ach|dd|pp|paypal|aplpay|sp|py|ic|in|web|pmt)\s*\*\s*|^(sq|tst)\s+/i;
export function payeeOf(g: Group) {
  const f: Partial<Split> = g.splits[0] || {};
  if (g.type === 'transfer') return { name: g.splits.length > 1 ? (g.title || f.description) : f.destination_name || f.description, kind: 'transfer' };
  const side = g.type === 'deposit' ? 'source_name' : 'destination_name';
  const names = [...new Set(g.splits.map(s => s[side]).filter(Boolean))];
  let name = names.length === 1 ? names[0] : (g.title || f.description);
  if (!name || /^\(?(no name|cash account)\)?$/i.test(name)) name = f.description;
  return { name: String(name || '?'), kind: g.type };
}
export function monogram(name: string) {
  const words = String(name).replace(AV_NOISE, '').replace(/[^A-Za-z0-9&' ]+/g, ' ').split(/\s+/).filter(w => w && !/^(the|and|of|inc|llc|co)$/i.test(w));
  if (!words.length) return '•';
  if (words.length === 1 || /^\d/.test(words[1])) return (/^[A-Z]{2,4}$/.test(words[0]) ? words[0].slice(0, 2) : words[0][0]).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function hueOf(name: string) {
  let h = 0; const k = String(name).replace(AV_NOISE, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 10);
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return h % 360;
}
export function avatarHtml(g: Group, cls = '') {
  const p = payeeOf(g);
  if (p.kind === 'transfer') return html`<span class="av xfer ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/></svg></span>`;
  return nameAvatar(p.name!, cls);     // only a transfer's name can be missing
}
// A coloured monogram for a payee or account name, with its logo on top when there is one
export const nameAvatar = (name: string, cls = '') => html`<span class="av ${cls}" style="--h:${hueOf(name)}" aria-hidden="true">${monogram(name)}${logoImg(name)}</span>`;

/* ---------- Category colours ---------- */
// Colors for the parts of a whole (a donut's slices and their legend), from the theme so they suit every theme
// (not --text or --good: some themes' accent is the text color or the same green)
export const SERIES = ['var(--accent)', '#4a7bd8', 'var(--warn)', '#9b6bdf', '#e0607e', '#3fa7c4', 'var(--muted)'];
// The month's biggest categories take the donut's colours in the same order (see shareChart), so a category is the
// same colour in the feed as in "Where it went"; any other category gets a steady colour of its own
export function rankCats(rows: { name: string, v: number }[]) {
  S.catRank = rows.filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 6).map(r => r.name);
}
export function catColor(name: string) {
  if (!name) return '';
  const i = (S.catRank || []).indexOf(name);
  return i >= 0 ? SERIES[i] : 'hsl(' + hueOf(name) + ' 50% 55%)';
}

/* ---------- Day labels for the grouped feed ---------- */
export function dayLabel(iso: string) {
  const d = String(iso).slice(0, 10), t = todayIso(), diff = daysBetween(d, t);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  const dt = new Date(d + 'T12:00:00');
  if (diff > 1 && diff < 7) return dt.toLocaleDateString('en-US', { weekday: 'long' });
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(dt.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
// A day header's title: "Today · Tue, Oct 28", "Sunday · Oct 26", "Thu, Oct 2"
function dayTitle(iso: string) {
  const rel = dayLabel(iso), dt = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (rel.includes(',')) return html`${rel}`;
  const date = dt.toLocaleDateString('en-US', rel.endsWith('day') && !/^(Today|Yesterday)$/.test(rel) ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  return html`${rel}<span class="dd"> · ${date}</span>`;
}
// What a rendered transaction row was drawn from, by group id, so a row can be redrawn or edited in place
export type TxMeta = { g: Group, accountId: string, opts: { select: boolean, accountId: string } };
export type TxRowsOpts = { select?: boolean, accountId?: string, empty?: string };
export function txRows(groups: Group[], opts: TxRowsOpts = {}) {
  if (S.pendingDel && S.pendingDel.size) groups = groups.filter(g => !S.pendingDel.has(g.id));
  if (!groups.length) return html`<div class="center-empty">${opts.empty || 'No transactions.'}</div>`;
  const cols = (opts.select ? 1 : 0) + 4;
  // Net per day (relative to the account when one is in view; transfers count as zero otherwise)
  const byDay: Record<string, number> = {};
  groups.forEach(g => { const d = String(g.date).slice(0, 10); byDay[d] = (byDay[d] || 0) + signed(g, opts.accountId); });
  let lastDay = '';
  const rows = htmlList(groups.map(g => {
    const f = g.splits[0], multi = g.splits.length > 1, day = String(g.date).slice(0, 10);
    const desc = multi ? (g.title || f.description) : f.description;
    const dests = [...new Set(g.splits.map(s => s.destination_name))], srcs = [...new Set(g.splits.map(s => s.source_name))];
    const flow = (srcs.length > 1 ? srcs.length + ' sources' : srcs[0]) + ' → ' + (dests.length > 1 ? dests.length + ' payees' : dests[0]);
    const cats = [...new Set(g.splits.map(s => s.category).filter(Boolean))];
    const buds = [...new Set(g.splits.map(s => s.budget_name).filter(Boolean))];
    const tags = [...new Set<string>(g.splits.flatMap(s => s.tags))].filter(t => !t.startsWith('Data Import on'));
    const fx = htmlList(g.splits.filter(s => s.fa && s.fc).map(s => html`<span class="chip">${s.fc} ${num(s.fa).toFixed(2)}</span>`));
    const inl = (k: string) => multi ? '' : html` inl" data-k="${k}" data-onclick="event.stopPropagation();App.pick(this)" title="Change ${k}`;
    const chips = html`<span class="cat-s${inl('category')}">${cats.length ? cats.join(', ') : g.type === 'withdrawal' ? 'Uncategorized' : g.type === 'deposit' ? 'Income' : 'Transfer'}</span>${fx}${multi ? html`<span class="chip">${g.splits.length} splits</span>` : ''}${htmlList(buds.map(b => html`<span class="bud-s${inl('budget')}">${b} budget</span>`))}${!buds.length && !multi && g.type === 'withdrawal' ? html`<span class="chip ghost${inl('budget')}">+ Budget</span>` : ''}${htmlList(tags.map(t => html`<span class="tag-s">#${t}</span>`))}`;
    S.txMeta[g.id] = { g, accountId: opts.accountId || '', opts: { select: !!opts.select, accountId: opts.accountId || '' } };
    let dh: Html | '' = '';
    if (day !== lastDay) {
      const close = lastDay ? html`</tbody>` : ''; lastDay = day; const net = byDay[day];
      dh = html`${close}<tbody class="day"><tr class="dayhead" data-day="${day}"><td colspan="${cols}"><div><span class="dl">${dayTitle(day)}</span>${Math.abs(net) >= .005 ? html`<span class="num ${net < 0 ? '' : 'pos'}">${net > 0 ? '+' : ''}${money(net)}</span>` : ''}</div></td></tr>`;
    }
    return html`${dh}<tr class="click" data-gid="${g.id}" data-day="${day}"${cats.length ? html` style="--cat:${catColor(cats[0])}"` : ''} data-onclick="App.editTx('${g.id}')">${opts.select ? html`<td class="sel" data-onclick="event.stopPropagation()"><input type="checkbox" data-sel="${g.id}" data-onchange="App.selChanged()"${(S.sel || new Set()).has(g.id) ? ' checked' : ''} aria-label="Select"></td>` : ''}<td><div class="txmain">${avatarHtml(g)}<div class="txt"><div class="desc">${desc}</div><div class="meta">${chips}</div></div></div></td><td class="flow hide-s"><span>${flow}</span></td><td class="catcol hide-s"><span class="${cats.length ? '' : 'neutral'}${inl('category')}">${cats.length ? cats.join(', ') : '—'}</span></td>${amountCell(g, opts.accountId)}</tr>`;
  }));
  return html`<table class="tbl feed${opts.select ? ' has-sel' : ''}">${rows}</tbody></table>`;
}
// After rows are removed (undo-delete, swipe), drop day headers left with nothing under them
export function tidyDays() {
  document.querySelectorAll<HTMLElement>('#view tbody.day').forEach(b => { if (!b.querySelector('tr[data-gid]')) b.remove(); });
}

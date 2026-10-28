import { html, htmlList } from '../core/html';
import { App, S, el, money, num } from '../core/base';
import { toast } from '../core/dom';
import { dayLabel } from '../core/feed';
import { type Account, isAsset, isLiab } from '../core/lists';
import { nlDate } from './nldate';
import { payeeFill } from './polish';
import { REFUND_TAG, isRefundTag } from './refunds';
import { collectTx, renderTxForm } from './txform';

/* ---------- Natural-language quick add ---------- */
const FILLER = new Set(['on', 'with', 'via', 'using', 'at', 'for', 'to', 'from', 'paid', 'spent', 'bought', 'got', 'and', 'the', 'a', 'my', 'in']);
const GENERIC = new Set(['card', 'checking', 'savings', 'saving', 'account', 'bank', 'credit', 'debit', 'loan', 'gold', 'the']);
function nlAccount(tok: string) {
  const L = S.lists!, w = tok.toLowerCase(); if (w.length < 3) return null;
  const pool = L.own.filter(a => isAsset(a) || isLiab(a));
  const full = pool.filter(a => a.name.toLowerCase() === w); if (full.length) return full[0];
  const hits = pool.filter(a => a.name.toLowerCase().split(/[\s\-–]+/).some(x => x.startsWith(w) && (!GENERIC.has(w) || x === w)));
  return hits.length === 1 ? hits[0] : hits.find(a => a.name.toLowerCase().startsWith(w)) || null;
}
function nlParse(text: string, submit?: boolean) {
  const f = S.form; if (!f || f.id) return;
  collectTx();
  if (!f.nlBase) { const s0 = f.splits[0]; f.nlBase = { type: f.type, date: f.date, main: f.main, src: f.src, dst: f.dst, split: { amount: s0.amount, description: s0.description, counter: s0.counter, category: s0.category, tags: s0.tags } }; }
  const base = f.nlBase, L = S.lists!, ws = text.trim().split(/\s+/).filter(Boolean), used = new Set(), out: any = {};
  // dates first (so "sep 12" isn't read as an amount of 12)
  for (let i = 0; i < ws.length; i++) { if (used.has(i) || out.date) continue; const r = nlDate(ws, i); if (r) { out.date = r[0]; for (let j = 0; j < r[1]; j++) used.add(i + j); if (/^last$/i.test(ws[i - 1] || '')) used.add(i - 1); } }
  ws.forEach((w, i) => { if (!used.has(i) && out.amount == null && /^\$?\d+(?:[.,]\d{1,2})?\$?$/.test(w)) { out.amount = w.replace(/\$/g, '').replace(',', '.'); used.add(i); } });
  ws.forEach((w, i) => {
    const lw = w.toLowerCase();
    if (used.has(i)) return;
    if (/^(income|salary|paycheck|payday|refund|received|deposit|earned)$/.test(lw)) { out.type = 'deposit'; used.add(i); if (!/^(received|earned)$/.test(lw)) out.kw = lw[0].toUpperCase() + lw.slice(1); if (/^(salary|paycheck)$/.test(lw)) out.catHint = 'Salary'; }
    else if (/^(transfer|transferred|moved|move)$/.test(lw)) { out.type = 'transfer'; used.add(i); }
    else if (lw[0] === '#' && lw.length > 1) { const c = L.categories.find(c => c.name.toLowerCase().startsWith(lw.slice(1))); out.category = c ? c.name : w.slice(1); used.add(i); }
  });
  const accs: { a: Account, i: number, from: boolean, to: boolean }[] = [];
  ws.forEach((w, i) => { if (used.has(i) || FILLER.has(w.toLowerCase())) return; const a = nlAccount(w.replace(/[,.]$/, '')); if (a && !accs.some(x => x.a.id === a.id)) { accs.push({ a, i, from: /^from$/i.test(ws[i - 1] || ''), to: /^to$/i.test(ws[i - 1] || '') }); used.add(i); } });
  // "for groceries" → category if it names one
  ws.forEach((w, i) => { if (!used.has(i) && /^for$/i.test(ws[i - 1] || '') && !out.category) { const c = L.categories.find(c => c.name.toLowerCase().startsWith(w.toLowerCase())); if (c && w.length >= 3) { out.category = c.name; used.add(i); } } });
  if (accs.length >= 2 && !out.type) out.type = 'transfer';
  const payeeWords = ws.filter((w, i) => !used.has(i) && !FILLER.has(w.toLowerCase()));
  let payee = payeeWords.join(' ').replace(/[,.]$/, '');
  const type = out.type || base.type;
  if (payee) {
    const pool = type === 'deposit' ? L.revenue : L.expense, q = payee.toLowerCase();
    const hit = pool.find(a => a.name.toLowerCase() === q) || pool.find(a => a.name.toLowerCase().startsWith(q)) || pool.find(a => a.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q.replace(/[^a-z0-9]/g, '')) && q.length >= 4);
    payee = hit ? hit.name : payee.replace(/\b\w/g, c => c.toUpperCase());
  }
  // rebuild the form from the base + what was understood
  f.type = type; f.date = out.date || base.date;
  const sp = f.splits[0];
  Object.assign(sp, base.split);
  if (out.amount) sp.amount = out.amount;
  if (payee) { sp.description = payee; if (type !== 'transfer') sp.counter = payee; }
  else if (out.kw) sp.description = out.kw;
  if (out.category || out.catHint) sp.category = out.category || out.catHint;
  if (out.kw === 'Refund' && !sp.tags.split(',').some(isRefundTag)) sp.tags = [sp.tags.trim(), REFUND_TAG].filter(Boolean).join(', ');   // counts against spending, see refunds.ts
  f.main = base.main; f.src = base.src; f.dst = base.dst;
  if (type === 'transfer') {
    const from = accs.find(x => x.from) || accs.find(x => !x.to) || accs[0], to = accs.find(x => x !== from);
    if (from) f.src = from.a.id; if (to) f.dst = to.a.id;
    if (!payee && from && to) sp.description = 'Transfer to ' + to.a.name;
  } else if (accs[0]) f.main = accs[0].a.id;
  const chip = (l: string, v: string) => html`<span class="nlchip"><em>${l}</em>${v}</span>`;
  f.nl = text;
  f.nlChips = text.trim() ? htmlList([
    type !== base.type ? chip('Type', ({ deposit: 'Income', transfer: 'Transfer', withdrawal: 'Expense' } as Record<string, string>)[type]) : '',
    out.amount ? chip('Amount', money(num(out.amount))) : '',
    out.date ? chip('Date', dayLabel(out.date)) : '',
    type === 'transfer' ? (accs.length ? html`${chip('From', (L.byId[f.src] || {}).name || '?')}${f.dst ? chip('To', (L.byId[f.dst] || {}).name || '?') : ''}` : '') : accs[0] ? chip('Account', accs[0].a.name) : '',
    payee && type !== 'transfer' ? chip(type === 'deposit' ? 'From' : 'Payee', payee) : '',
    sp.category && (out.category || out.catHint) ? chip('Category', sp.category) : '',
  ]) : '';
  const caret = el<HTMLInputElement>('nlq') ? el<HTMLInputElement>('nlq').selectionStart : text.length;
  renderTxForm();
  const q = el<HTMLInputElement>('nlq'); if (q && document.activeElement !== q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
  if (payee && type !== 'transfer' && !out.category && !out.catHint) payeeFill(0, payee);
  if (submit) {
    if (num(sp.amount) > 0 && sp.description.trim()) el<HTMLFormElement>('txForm').requestSubmit();
    else { const miss = el('drawerBody').querySelector<HTMLElement>(num(sp.amount) > 0 ? '[data-k=description]' : '[data-k=amount]'); if (miss) miss.focus(); toast(num(sp.amount) > 0 ? 'Add a description' : 'Add an amount'); }
  }
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  nlParse,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

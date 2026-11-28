import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { withAuth } from '../core/auth';
import { App, fmtD, fmtDay, isoDate, money0, moneyIn, num, S, todayIso } from '../core/base';
import { convertFromPrimary } from '../core/fx';
import { head, toast } from '../core/dom';
import { acctAmt, normGroup } from '../core/feed';
import { LS, daysBetween } from '../core/helpers';
import { type Account, isCard, isLiab, lists, withPlan } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { INTEREST_RE, debtInsight, debtPanel, interestPaid } from '../features/moneyhealth';
import { kpi } from '../core/ui';

/* ---------- Loan history (payments into each loan) ---------- */
export async function loanHistory(loans: Account[]) {
  const out: any = {};
  await Promise.all(loans.map(async l => {
    const groups = (await getAll('/accounts/' + l.id + '/transactions').catch(() => [])).map(normGroup);
    const pays: { d: string, a: number, from: string, bill: string }[] = [];
    let borrowed = Math.abs(l.opening), repaid = 0, charged = 0;
    groups.forEach(g => g.splits.forEach(s => {
      if (s.type === 'opening balance') return;
      // Money charged as interest never reached the borrower, so it isn't counted as borrowed (only as "charged")
      if (s.source_id === l.id) { if (INTEREST_RE.test(s.description) || INTEREST_RE.test(s.destination_name)) charged += s.amount; else borrowed += s.amount; }
      else if (s.destination_id === l.id) { repaid += s.amount; pays.push({ d: String(s.date).slice(0, 10), a: s.amount, from: s.source_id, bill: s.bill_id }); }
    }));
    pays.sort((a, b) => a.d.localeCompare(b.d));
    const cutoff = isoDate(new Date(Date.now() - 91 * 864e5));
    const recent = pays.filter(p => p.d >= cutoff).reduce((s, p) => s + p.a, 0);
    const last = pays[pays.length - 1] || null;
    // Typical monthly payment: the latest payment if it was recent, otherwise the 3-month average.
    const detected = last && daysBetween(last.d, todayIso()) <= 45 ? Math.round(last.a) : Math.round(recent / 3);
    const monthly = l.plan && l.plan.amount > 0 ? l.plan.amount : detected;   // the loan's own monthly payment, if set
    out[l.id] = { borrowed, repaid, pays, last, monthly, interest: interestPaid(borrowed + charged, repaid, l.debt, charged),
      pct: borrowed > 0 ? Math.min(100, Math.max(0, repaid / borrowed * 100)) : null };
  }));
  return out;
}

/* ================= Loan payoff planner ================= */
export function monthlyRate(l: Account) {
  const r = num(l.interest) / 100; if (!r) return 0;
  return ({ daily: r * 365 / 12, weekly: r * 52 / 12, monthly: r, quarterly: r / 3, 'half-year': r / 6, yearly: r / 12 } as Record<string, number>)[l.interestPeriod || 'yearly'] ?? r / 12;
}
// A loan as the planner sees it: what's owed, the monthly interest rate and the monthly payment
// A fixed loan is a set number of equal instalments (a phone on a card plan): extra money can't be put onto it, it just runs its course.
export type LoanModel = { id: string, name: string, debt: number, rate: number, interest: string, period: string, planned: boolean, pay: number, fixed?: boolean };
export function simulate(loans: LoanModel[], extra: number, strategy: string) {
  const st = loans.map(l => ({ ...l, bal: l.debt, paidOff: l.debt <= 0 ? 0 : null as number | null, accrued: 0, rolled: 0 }));
  const totals = [st.reduce((s, l) => s + l.bal, 0)];
  let month = 0;
  while (st.some(l => l.bal > .005) && month < 600) {
    month++;
    st.forEach(l => { if (l.bal > 0) { const i = l.bal * l.rate; l.bal += i; l.accrued += i; } });
    let pool = strategy === 'now' ? 0 : extra;
    st.forEach(l => {
      if (l.bal <= 0) { if (strategy !== 'now') pool += l.pay; return; }
      const p = Math.min(l.pay, l.bal); l.bal -= p; if (strategy !== 'now') pool += l.pay - p;
    });
    if (strategy !== 'now' && pool > 0) {
      const order = st.filter(l => l.bal > 0 && !l.fixed).sort(strategy === 'avalanche' ? (a, b) => b.rate - a.rate || a.bal - b.bal : (a, b) => a.bal - b.bal);
      for (const l of order) { const p = Math.min(pool, l.bal); l.bal -= p; l.rolled += p; pool -= p; if (pool <= 0) break; }
    }
    st.forEach(l => { if (l.bal <= .005 && l.paidOff === null) { l.bal = 0; l.paidOff = month; } });
    totals.push(st.reduce((s, l) => s + Math.max(0, l.bal), 0));
    if (st.every(l => l.bal <= .005 || (l.pay <= 0 && strategy === 'now'))) break;
    if (strategy !== 'now' && extra + st.reduce((s, l) => s + l.pay, 0) <= 0) break;
  }
  return { loans: st, months: st.length && st.every(l => l.paidOff !== null) ? Math.max(...st.map(l => l.paidOff!)) : st.length ? null : 0, interest: st.reduce((s, l) => s + l.accrued, 0), totals };
}
// A loan with no payment of its own that only gets paid off because other loans' money rolls onto it
export const rollsOnly = (l: { pay: number, rolled: number, paidOff: number | null }) => l.pay <= 0 && l.rolled > 0 && l.paidOff !== null;
// Loans whose payments come off a credit card are instalment plans unless the user says otherwise (kept on this device, like the rest of the what-if)
export const isFixed = (l: Account, h: { last?: { from: string } | null } | undefined, over: Record<string, boolean>, L: { byId: Record<string, Account> }) =>
  l.id in over ? over[l.id] : !!(h && h.last && L.byId[h.last.from] && isCard(L.byId[h.last.from]));
const shortMonth = (n: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2); };
const monthLabel = (n: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return fmtD(d, { month: 'short', year: 'numeric' }); };
VIEWS.loans = async (r, paint) => {
  const L = await lists();
  const loans = L.own.filter(a => isLiab(a) && a.debt > 0);
  const hist = await loanHistory(L.own.filter(isLiab));
  const plan = LS.get('loanPlan', { pays: {}, extra: 0, strategy: 'snowball', fixed: {} });
  const model: LoanModel[] = loans.map(l => ({ id: l.id, name: l.name, debt: l.debt, rate: monthlyRate(l), interest: l.interest, period: l.interestPeriod, planned: !!(l.plan && l.plan.amount), pay: (hist[l.id] || {}).monthly || 0, fixed: isFixed(l, hist[l.id], plan.fixed || {}, L) }));
  S.loanModel = model;
  const base = simulate(model, 0, 'now'), sim = simulate(model, +plan.extra || 0, plan.strategy);
  // Interest paid so far on every loan (paid-off ones too), and what a little more each month would do
  const paid = L.own.filter(isLiab).reduce((t, a) => t + ((hist[a.id] || {}).interest || 0), 0);
  const plus = simulate(model, (plan.strategy === 'now' ? 0 : +plan.extra || 0) + 100, plan.strategy === 'now' ? 'snowball' : plan.strategy);
  const insight = model.length ? debtPanel(debtInsight(paid, base, sim, plus, 100), sim.totals, base.totals, shortMonth, sim.months === null ? '' : monthLabel(sim.months)) : '';
  const maxM = Math.min(120, Math.max(12, ...sim.loans.map(l => l.paidOff || 120)));
  const rows = htmlList(sim.loans.sort((a, b) => (a.paidOff ?? 9999) - (b.paidOff ?? 9999)).map(l => {
    const b0 = base.loans.find(x => x.id === l.id)!, h = hist[l.id] || {};
    // A loan in another currency: the plan works in the main currency like every total, but the loan's own row shows
    // what is owed in its currency, and its monthly payment is typed (and saved to its notes) in that currency too
    const acc = L.byId[l.id], fc = acc && acc.nat ? acc.currency : '';
    const owes = acc ? acctAmt(acc, (acc.nat || acc).debt, l.debt, money0) : money0(l.debt);
    const payIn = fc ? (acc.nat!.plan && acc.nat!.plan.amount > 0 ? acc.nat!.plan.amount : convertFromPrimary(l.pay, fc) || 0) : l.pay;
    const saved = b0.paidOff !== null && l.paidOff !== null ? b0.paidOff - l.paidOff : null;
    return html`<tr><td><a class="desc" href="#/account/${l.id}" style="text-decoration:none">${l.name}</a><div class="sub-s">${h.last ? 'Last paid ' + money0(h.last.a) + ' on ' + fmtDay(h.last.d) : 'No payments yet'}${num(l.interest) ? ' · ' + num(l.interest) + '% ' + (l.period || 'interest') : ''}</div><div class="sub-s show-s">Owes ${fc ? moneyIn(acc.nat!.debt, fc) + ' (≈ ' + money0(l.debt) + ')' : money0(l.debt)}</div></td><td class="amt hide-s">${owes}</td><td class="r"><input class="inline num" type="number" min="0" step="10" value="${payIn}" data-onchange="App.loanPay('${l.id}', this.value)" aria-label="Monthly payment for ${l.name}${fc ? ' in ' + fc : ''}">${fc ? html`<div class="sub-s">${fc} · ≈ ${money0(l.pay)}</div>` : ''}</td><td class="r">${l.paidOff === null ? html`<span class="neg">Not being paid</span>` : html`<strong>${monthLabel(l.paidOff)}</strong><div class="sub-s">${l.paidOff} month${l.paidOff === 1 ? '' : 's'}${saved !== null && saved > 0 ? html` · <span class="down">${saved} sooner</span>` : ''}</div>${rollsOnly(l) ? html`<div class="sub-s">only if other loans’ payments roll onto it</div>` : ''}`}<div class="sub-s"><button type="button" class="link" data-onclick="App.loanFixed('${l.id}')" title="Instalments of a set size: extra money isn’t put onto this loan">${l.fixed ? 'Fixed instalments: no extra' : 'Can take extra payments'}</button></div></td><td class="hide-s" style="min-width:200px"><div class="track" style="height:10px"><div class="fill good" style="width:${((l.paidOff === null ? maxM : Math.min(l.paidOff, maxM)) / maxM * 100).toFixed(1)}%;${l.paidOff === null ? 'background:var(--spend);opacity:.35' : ''}"></div></div></td></tr>`;
  }));
  const totalDebt = model.reduce((s, l) => s + l.debt, 0), totalPay = model.reduce((s, l) => s + l.pay, 0) + (plan.strategy === 'now' ? 0 : +plan.extra || 0);
  const strat = (v: string, label: string, sub: string) => html`<button type="button" class="${plan.strategy === v ? 'on' : ''}" data-onclick="App.loanSet('strategy', '${v}')" title="${sub}">${label}</button>`;
  paint(html`${head('Loan planner', 'What you owe and how fast it goes away', '')}<div class="kpis">${kpi('Owed', money0(totalDebt), null)}${kpi('Paying per month', money0(totalPay), null)}<div class="kpi"><div class="eyebrow">Debt-free</div><div class="val num ${sim.months === null ? 'neg' : 'pos'}">${sim.months === null ? 'Not yet' : monthLabel(sim.months)}</div><div class="sub-s">${sim.months === null ? 'some loans have no payment' : sim.loans.some(rollsOnly) ? 'depends on payments rolling onto ' + sim.loans.filter(rollsOnly).map(l => l.name).join(', ') + ', which ' + (sim.loans.filter(rollsOnly).length === 1 ? 'has' : 'have') + ' no payment of ' + (sim.loans.filter(rollsOnly).length === 1 ? 'its' : 'their') + ' own' : sim.months + ' months' + (base.months && base.months > sim.months ? ' · ' + (base.months - sim.months) + ' sooner than now' : '')}</div></div>${kpi('Interest to pay', money0(sim.interest), null)}</div>${insight}<section class="panel" style="margin-bottom:20px"><div class="grid2 stack-s" style="align-items:end"><div><div class="eyebrow">When a loan is paid off, put its payment toward…</div><div class="seg" style="margin:8px 0 0">${strat('snowball', 'Smallest balance next', 'Snowball: quick wins first')}${strat('avalanche', 'Highest interest next', 'Avalanche: least interest overall')}${strat('now', 'Nothing — keep payments as they are', 'No rollover')}</div></div><label style="margin:0">Extra each month on top<input type="number" min="0" step="25" value="${+plan.extra || 0}" data-onchange="App.loanSet('extra', this.value)"${plan.strategy === 'now' ? ' disabled' : ''}></label></div></section><section class="panel flush"><table class="tbl"><thead><tr><th>Loan</th><th class="r hide-s">Owed</th><th class="r">Pay / month</th><th class="r">Paid off</th><th class="hide-s">Timeline to ${monthLabel(maxM)}</th></tr></thead><tbody>${rows}</tbody></table></section><p class="sub-s" style="margin-top:16px">Changing a “Pay / month” amount saves it as that loan’s monthly payment in Firefly. Loans without one use what you actually paid recently. Strategy and extra amount are only a what-if and aren’t saved. <button class="link" data-onclick="App.loanReset()">Reset strategy &amp; extra</button></p>`);
};
async function loanPay(id: string, v: string) {
  const L = await lists(), a = L.byId[id]; if (!a) return;
  const p = { ...(a.nat ? a.nat.plan : a.plan), amount: Math.max(0, num(v)) };      // typed in the loan's own currency, and saved as typed
  await withAuth(async () => {
    await api('/accounts/' + id, { method: 'PUT', body: { name: a.name, notes: withPlan(a.notes, p, a.currency) } });
    toast(p.amount > 0 ? 'Saved ' + moneyIn(p.amount, a.currency) + '/month for ' + a.name : 'Monthly payment cleared for ' + a.name); route();
  });
}
function loanFixed(id: string) {
  const p = LS.get('loanPlan', { pays: {}, extra: 0, strategy: 'snowball', fixed: {} }), m = (S.loanModel || []).find((x: LoanModel) => x.id === id);
  p.fixed = { ...p.fixed, [id]: !(m && m.fixed) }; LS.set('loanPlan', p); route();
}
function loanSet(k: string, v: string) { const p = LS.get('loanPlan', { pays: {}, extra: 0, strategy: 'snowball' }); p[k] = k === 'extra' ? Math.max(0, num(v)) : v; LS.set('loanPlan', p); route(); }
function loanReset() { LS.set('loanPlan', { pays: {}, extra: 0, strategy: 'snowball', fixed: (LS.get('loanPlan', { fixed: {} }).fixed) || {} }); route(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  loanPay,
  loanSet,
  loanFixed,
  loanReset,
  loanHistory,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

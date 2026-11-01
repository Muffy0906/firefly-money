import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { withAuth } from '../core/auth';
import { App, fmtD, fmtDay, isoDate, money, money0, num, S, todayIso } from '../core/base';
import { head, toast } from '../core/dom';
import { normGroup } from '../core/feed';
import { LS, daysBetween } from '../core/helpers';
import { type Account, isLiab, lists, withPlan } from '../core/lists';
import { VIEWS, route } from '../core/router';

/* ---------- Loan history (payments into each loan) ---------- */
export async function loanHistory(loans: Account[]) {
  const out: any = {};
  await Promise.all(loans.map(async l => {
    const groups = (await getAll('/accounts/' + l.id + '/transactions').catch(() => [])).map(normGroup);
    const pays: { d: string, a: number, from: string }[] = [];
    let borrowed = Math.abs(l.opening), repaid = 0;
    groups.forEach(g => g.splits.forEach(s => {
      if (s.type === 'opening balance') return;
      if (s.source_id === l.id) borrowed += s.amount;
      else if (s.destination_id === l.id) { repaid += s.amount; pays.push({ d: String(s.date).slice(0, 10), a: s.amount, from: s.source_id }); }
    }));
    pays.sort((a, b) => a.d.localeCompare(b.d));
    const cutoff = isoDate(new Date(Date.now() - 91 * 864e5));
    const recent = pays.filter(p => p.d >= cutoff).reduce((s, p) => s + p.a, 0);
    const last = pays[pays.length - 1] || null;
    // Typical monthly payment: the latest payment if it was recent, otherwise the 3-month average.
    const detected = last && daysBetween(last.d, todayIso()) <= 45 ? Math.round(last.a) : Math.round(recent / 3);
    const monthly = l.plan && l.plan.amount > 0 ? l.plan.amount : detected;   // the loan's own monthly payment, if set
    out[l.id] = { borrowed, repaid, pays, last, monthly,
      pct: borrowed > 0 ? Math.min(100, Math.max(0, repaid / borrowed * 100)) : null };
  }));
  return out;
}

/* ================= Loan payoff planner ================= */
function monthlyRate(l: Account) {
  const r = num(l.interest) / 100; if (!r) return 0;
  return ({ daily: r * 365 / 12, weekly: r * 52 / 12, monthly: r, quarterly: r / 3, 'half-year': r / 6, yearly: r / 12 } as Record<string, number>)[l.interestPeriod || 'yearly'] ?? r / 12;
}
// A loan as the planner sees it: what's owed, the monthly interest rate and the monthly payment
type LoanModel = { id: string, name: string, debt: number, rate: number, interest: string, period: string, planned: boolean, pay: number };
function simulate(loans: LoanModel[], extra: number, strategy: string) {
  const st = loans.map(l => ({ ...l, bal: l.debt, paidOff: l.debt <= 0 ? 0 : null, accrued: 0 }));
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
      const order = st.filter(l => l.bal > 0).sort(strategy === 'avalanche' ? (a, b) => b.rate - a.rate || a.bal - b.bal : (a, b) => a.bal - b.bal);
      for (const l of order) { const p = Math.min(pool, l.bal); l.bal -= p; pool -= p; if (pool <= 0) break; }
    }
    st.forEach(l => { if (l.bal <= .005 && l.paidOff === null) { l.bal = 0; l.paidOff = month; } });
    totals.push(st.reduce((s, l) => s + Math.max(0, l.bal), 0));
    if (st.every(l => l.bal <= .005 || (l.pay <= 0 && strategy === 'now'))) break;
    if (strategy !== 'now' && extra + st.reduce((s, l) => s + l.pay, 0) <= 0) break;
  }
  return { loans: st, months: st.every(l => l.paidOff !== null) ? Math.max(...st.map(l => l.paidOff!)) : null, interest: st.reduce((s, l) => s + l.accrued, 0), totals };
}
const monthLabel = (n: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return fmtD(d, { month: 'short', year: 'numeric' }); };
VIEWS.loans = async (r, paint) => {
  const L = await lists();
  const loans = L.own.filter(a => isLiab(a) && a.debt > 0);
  const hist = await loanHistory(L.own.filter(isLiab));
  const plan = LS.get('loanPlan', { pays: {}, extra: 0, strategy: 'snowball' });
  const model: LoanModel[] = loans.map(l => ({ id: l.id, name: l.name, debt: l.debt, rate: monthlyRate(l), interest: l.interest, period: l.interestPeriod, planned: !!(l.plan && l.plan.amount), pay: (hist[l.id] || {}).monthly || 0 }));
  S.loanModel = model;
  const base = simulate(model, 0, 'now'), sim = simulate(model, +plan.extra || 0, plan.strategy);
  const maxM = Math.min(120, Math.max(12, ...sim.loans.map(l => l.paidOff || 120)));
  const rows = htmlList(sim.loans.sort((a, b) => (a.paidOff ?? 9999) - (b.paidOff ?? 9999)).map(l => {
    const b0 = base.loans.find(x => x.id === l.id)!, h = hist[l.id] || {};
    const saved = b0.paidOff !== null && l.paidOff !== null ? b0.paidOff - l.paidOff : null;
    return html`<tr><td><a class="desc" href="#/account/${l.id}" style="text-decoration:none">${l.name}</a><div class="sub-s">${h.last ? 'Last paid ' + money0(h.last.a) + ' on ' + fmtDay(h.last.d) : 'No payments yet'}${num(l.interest) ? ' · ' + num(l.interest) + '% ' + (l.period || 'interest') : ''}</div><div class="sub-s show-s">Owes ${money0(l.debt)}</div></td><td class="amt hide-s">${money0(l.debt)}</td><td class="r"><input class="inline num" type="number" min="0" step="10" value="${l.pay}" data-onchange="App.loanPay('${l.id}', this.value)" aria-label="Monthly payment for ${l.name}"></td><td class="r">${l.paidOff === null ? html`<span class="neg">Not being paid</span>` : html`<strong>${monthLabel(l.paidOff)}</strong><div class="sub-s">${l.paidOff} month${l.paidOff === 1 ? '' : 's'}${saved !== null && saved > 0 ? html` · <span class="down">${saved} sooner</span>` : ''}</div>`}</td><td class="hide-s" style="min-width:200px"><div class="track" style="height:10px"><div class="fill good" style="width:${((l.paidOff === null ? maxM : Math.min(l.paidOff, maxM)) / maxM * 100).toFixed(1)}%;${l.paidOff === null ? 'background:var(--spend);opacity:.35' : ''}"></div></div></td></tr>`;
  }));
  const totalDebt = model.reduce((s, l) => s + l.debt, 0), totalPay = model.reduce((s, l) => s + l.pay, 0) + (plan.strategy === 'now' ? 0 : +plan.extra || 0);
  const strat = (v: string, label: string, sub: string) => html`<button type="button" class="${plan.strategy === v ? 'on' : ''}" data-onclick="App.loanSet('strategy', '${v}')" title="${sub}">${label}</button>`;
  paint(html`${head('Loan planner', 'See when each loan is paid off, and how to get there sooner', '')}<div class="kpis"><div class="kpi"><div class="eyebrow">Owed</div><div class="val num">${money0(totalDebt)}</div></div><div class="kpi"><div class="eyebrow">Paying per month</div><div class="val num">${money0(totalPay)}</div></div><div class="kpi"><div class="eyebrow">Debt-free</div><div class="val num ${sim.months === null ? 'neg' : 'pos'}">${sim.months === null ? 'Not yet' : monthLabel(sim.months)}</div><div class="sub-s">${sim.months === null ? 'some loans have no payment' : sim.months + ' months' + (base.months && base.months > sim.months ? ' · ' + (base.months - sim.months) + ' sooner than now' : '')}</div></div><div class="kpi"><div class="eyebrow">Interest to pay</div><div class="val num">${money0(sim.interest)}</div></div></div><section class="panel" style="margin-bottom:20px"><div class="grid2 stack-s" style="align-items:end"><div><div class="eyebrow">When a loan is paid off, put its payment toward…</div><div class="seg" style="margin:8px 0 0">${strat('snowball', 'Smallest balance next', 'Snowball: quick wins first')}${strat('avalanche', 'Highest interest next', 'Avalanche: least interest overall')}${strat('now', 'Nothing — keep payments as they are', 'No rollover')}</div></div><label style="margin:0">Extra each month on top<input type="number" min="0" step="25" value="${+plan.extra || 0}" data-onchange="App.loanSet('extra', this.value)"${plan.strategy === 'now' ? ' disabled' : ''}></label></div></section><section class="panel flush"><table class="tbl"><thead><tr><th>Loan</th><th class="r hide-s">Owed</th><th class="r">Pay / month</th><th class="r">Paid off</th><th class="hide-s">Timeline to ${monthLabel(maxM)}</th></tr></thead><tbody>${rows}</tbody></table></section><p class="sub-s" style="margin-top:14px">Changing a “Pay / month” amount saves it as that loan’s monthly payment in Firefly. Loans without one use what you actually paid recently. Strategy and extra amount are only a what-if and aren’t saved. <button class="link" data-onclick="App.loanReset()">Reset strategy &amp; extra</button></p>`);
};
async function loanPay(id: string, v: string) {
  const L = await lists(), a = L.byId[id]; if (!a) return;
  const p = { ...a.plan, amount: Math.max(0, num(v)) };
  await withAuth(async () => {
    await api('/accounts/' + id, { method: 'PUT', body: { name: a.name, notes: withPlan(a.notes, p) } });
    toast(p.amount > 0 ? 'Saved ' + money(p.amount) + '/month for ' + a.name : 'Monthly payment cleared for ' + a.name); route();
  });
}
function loanSet(k: string, v: string) { const p = LS.get('loanPlan', { pays: {}, extra: 0, strategy: 'snowball' }); p[k] = k === 'extra' ? Math.max(0, num(v)) : v; LS.set('loanPlan', p); route(); }
function loanReset() { LS.set('loanPlan', { pays: {}, extra: 0, strategy: 'snowball' }); route(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  loanPay,
  loanSet,
  loanReset,
  loanHistory,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

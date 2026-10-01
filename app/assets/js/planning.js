'use strict';
/* =====================================================================
   Planning features: safe-to-spend forecast, categorize inbox,
   loan payoff planner, installable app.
   ===================================================================== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('money.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('money.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
function bizDay(y, m, day) {            // that day of the month (clamped), moved back to Friday if it's a weekend
  const d = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return isoDate(d);
}
function monthsFrom(from, to) { const out = []; let d = new Date(from + 'T12:00:00'); d.setDate(1); const end = new Date(to + 'T12:00:00'); while (d <= end) { out.push([d.getFullYear(), d.getMonth()]); d.setMonth(d.getMonth() + 1); } return out; }

/* ---------- Loan history (payments into each loan) ---------- */
async function loanHistory(loans) {
  const out = {};
  await Promise.all(loans.map(async l => {
    const groups = (await getAll('/accounts/' + l.id + '/transactions').catch(() => [])).map(normGroup);
    const pays = [];
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

/* ================= Safe-to-spend forecast ================= */
function detectIncome(groups, accIds) {
  const by = {};
  groups.forEach(g => g.splits.forEach(s => {
    if (s.type !== 'deposit' || !accIds.includes(s.destination_id)) return;
    const src = S.lists.byId[s.source_id]; if (src && isLiab(src)) return;          // loan money isn't income
    (by[s.source_id] = by[s.source_id] || { name: s.source_name, list: [] }).list.push({ d: String(s.date).slice(0, 10), a: s.amount, cat: s.category });
  }));
  const out = [];
  Object.values(by).forEach(({ name, list }) => {
    if (list.length < 3) return;
    list.sort((a, b) => a.d.localeCompare(b.d));
    const recent = list.slice(-6), lastAmt = recent[recent.length - 1].a;
    if (recent.filter(x => Math.abs(x.a - lastAmt) / lastAmt < .2).length < 3) return;   // needs a steady amount
    const gaps = recent.slice(1).map((x, i) => daysBetween(recent[i].d, x.d)).sort((a, b) => a - b), gap = gaps[Math.floor(gaps.length / 2)];
    const doms = recent.map(x => +x.d.slice(8, 10));
    let p;
    if (gap >= 12 && gap <= 17) {
      const late = doms.filter(d => d >= 25).length, mid = doms.filter(d => d >= 11 && d <= 18).length;
      p = late && mid && late + mid >= doms.length - 1 ? { kind: 'semimonthly' } : { kind: 'every', n: 14 };
    } else if (gap >= 26 && gap <= 35) { const s = doms.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)]; p = { kind: 'monthly', day: med >= 28 ? 31 : med }; }
    else if (gap >= 6 && gap <= 8) p = { kind: 'every', n: 7 };
    else return;
    const last = recent[recent.length - 1].d;
    if (daysBetween(last, todayIso()) > gap * 1.8) return;                                  // stopped arriving
    out.push({ name, amount: lastAmt, p, last, salary: recent.some(x => /salary|payroll/i.test(x.cat)) });
  });
  return out;
}
function incomeDates(inc, from, to) {
  const out = [], p = inc.p;
  if (p.kind === 'every') { for (let d = addDays(inc.last, p.n); d <= to; d = addDays(d, p.n)) if (d >= from) out.push(d); }
  else monthsFrom(from, to).forEach(([y, m]) => (p.kind === 'semimonthly' ? [15, 31] : [p.day]).forEach(day => { const d = bizDay(y, m, day); if (d > inc.last && d >= from && d <= to) out.push(d); }));
  return out.sort();
}
async function forecastModel(sel, horizon) {
  const L = await lists();
  const banks = L.own.filter(a => isAsset(a) && !isCard(a));
  const from = todayIso(), to = addDays(from, horizon);
  const [deps, recs, bills] = await Promise.all([
    getAll('/transactions', { type: 'deposit', start: addDays(from, -120), end: from }),
    getAll('/recurrences').catch(() => []),
    getAll('/bills', { start: from, end: to }).catch(() => []),
  ]);
  const depGroups = deps.map(normGroup);
  // Default account: the one your salary lands in.
  if (!sel) {
    const guess = detectIncome(depGroups, banks.map(a => a.id)).sort((a, b) => (b.salary - a.salary) || b.amount - a.amount)[0];
    const hit = guess && depGroups.flatMap(g => g.splits).find(s => s.source_name === guess.name);
    sel = hit ? hit.destination_id : (banks[0] || {}).id;
  }
  const accIds = sel === 'all' ? banks.map(a => a.id) : [sel];
  const start = accIds.reduce((s, id) => s + ((L.byId[id] || {}).balance || 0), 0);
  const ev = [];
  const add = (date, label, kind, amount, series) => { if (date >= from && date <= to && amount) ev.push({ date, label, kind, amount, key: kind + ':' + series }); };
  const incomes = detectIncome(depGroups, accIds);
  incomes.forEach(inc => incomeDates(inc, from, to).forEach(d => add(d, inc.name, inc.salary ? 'Payday' : 'Income', inc.amount, inc.name)));
  recs.forEach(r => {
    const at = r.attributes; if (at.active === false) return;
    const t = (at.transactions || [])[0] || {}, occ = (at.repetitions || []).flatMap(x => x.occurrences || []).map(d => String(d).slice(0, 10));
    const sign = accIds.includes(String(t.source_id)) ? -1 : accIds.includes(String(t.destination_id)) ? 1 : 0;
    if (sign) [...new Set(occ)].forEach(d => add(d, at.title, 'Recurring', sign * num(t.amount), 'rec' + r.id));
  });
  const loans = L.own.filter(a => isLiab(a) && a.debt > 0), hist = await loanHistory(loans);
  loans.forEach(l => {
    const h = hist[l.id], p = l.plan;
    if (p && p.amount > 0) {
      const src = p.from ? L.accounts.find(x => sameName(x.name, p.from)) : (h && h.last ? L.byId[h.last.from] : null);
      if (!src || !accIds.includes(src.id)) return;
      const day = p.day || (h && h.last ? +h.last.d.slice(8, 10) : 1);
      let left = l.debt;
      monthsFrom(addDays(from, -31), to).forEach(([y, m]) => {
        const d = isoDate(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12));
        if (left <= 0 || d > to) return;
        if (h && h.last && h.last.d >= addDays(d, -20)) return;           // already paid for this month
        if (d < from && daysBetween(d, from) > 10) return;                // long past: not counted
        const amt = Math.min(p.amount, left); left -= amt;
        add(d < from ? from : d, 'Payment to ' + l.name, 'Loan', -amt, 'loan' + l.id);
      });
      return;
    }
    if (!h || !h.last || daysBetween(h.last.d, from) > 75) return;
    if (!accIds.includes(h.last.from)) return;
    let left = l.debt, day = +h.last.d.slice(8, 10);
    monthsFrom(addDays(h.last.d, 20), to).forEach(([y, m]) => {
      const d = isoDate(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12));
      if (d <= h.last.d || left <= 0) return;
      const amt = Math.min(h.last.a, left); left -= amt;
      add(d < from ? from : d, 'Payment to ' + l.name, 'Loan', -amt, 'loan' + l.id);
    });
  });
  const firstPay = ev.filter(e => e.kind === 'Payday' || e.kind === 'Income').map(e => e.date).sort()[0];
  L.own.filter(a => isCard(a) && a.balance < 0).forEach(c => {
    let d;
    if (c.paymentDate) { const day = +String(c.paymentDate).slice(8, 10); d = monthsFrom(from, to).map(([y, m]) => isoDate(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12))).find(x => x >= from); }
    add(d || firstPay || addDays(from, 7), 'Pay off ' + c.name, 'Card', c.balance, 'card' + c.id);
  });
  bills.forEach(b => {
    const at = b.attributes; if (at.active === false || (at.paid_dates || []).length) return;
    (at.pay_dates || []).map(d => String(d).slice(0, 10)).forEach(d => add(d, at.name, 'Bill', -billAmount(at), 'bill' + b.id));
  });
  const excluded = new Set(LS.get('fcExclude', []));
  ev.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  let bal = start, min = start, minDate = from;
  const byDay = {};
  ev.forEach(e => { e.off = excluded.has(e.key); if (!e.off) bal += e.amount; e.after = bal; byDay[e.date] = bal; if (bal < min) { min = bal; minDate = e.date; } });
  const series = []; let run = start;
  for (let d = from; d <= to; d = addDays(d, 1)) { if (byDay[d] !== undefined) run = byDay[d]; series.push({ d, v: run }); }
  const buffer = +LS.get('fcBuffer', 100);
  const nextPay = ev.find(e => !e.off && (e.kind === 'Payday' || e.kind === 'Income'));
  return { sel, accIds, name: sel === 'all' ? 'all bank accounts' : (L.byId[sel] || {}).name, banks, start, ev, series, min, minDate, buffer,
    safe: Math.max(0, Math.floor(min - buffer)), short: min < 0 ? -min : 0, nextPay, incomes, horizon };
}
function forecastChart(m) {
  const W = 960, H = 220, pt = 14, pb = 26, s = m.series, n = s.length;
  const lo = Math.min(0, ...s.map(x => x.v)), hi = Math.max(...s.map(x => x.v), 1), span = hi - lo || 1;
  const x = i => (W - 8) * i / Math.max(1, n - 1) + 4, y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
  let path = '';
  s.forEach((p, i) => { path += (i ? ' H' + x(i).toFixed(1) + ' V' : 'M' + x(i).toFixed(1) + ' ') + y(p.v).toFixed(1); });
  const area = path + ' V' + y(lo).toFixed(1) + ' H' + x(0).toFixed(1) + ' Z';
  const byDate = {};
  m.ev.filter(e => !e.off).forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dots = Object.entries(byDate).map(([d, list]) => {
    const i = daysBetween(s[0].d, d), last = list[list.length - 1], cx = x(i).toFixed(1), cy = y(last.after).toFixed(1);
    const tip = fmtDate(d) + '\n' + list.map(e => e.label + '  ' + (e.amount > 0 ? '+' : '') + money(e.amount)).join('\n') + '\nBalance after: ' + money(last.after);
    const net = list.reduce((t, e) => t + e.amount, 0);
    return '<g class="pt" data-tip="' + esc(tip) + '"><rect x="' + (+cx - 10) + '" y="' + pt + '" width="20" height="' + (H - pt - pb) + '" fill="transparent"/>' +
      '<circle class="dot" cx="' + cx + '" cy="' + cy + '" r="' + (list.length > 1 ? 5 : 3.5) + '" fill="' + (net > 0 ? 'var(--good)' : 'var(--spend)') + '"/></g>';
  }).join('');
  const ticks = s.filter((p, i) => i % 7 === 0).map(p => { const i = daysBetween(s[0].d, p.d); return '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">' + fmtDay(p.d) + '</text>'; }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Projected balance">' +
    '<defs><linearGradient id="fcg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--good)" stop-opacity=".22"/><stop offset="1" stop-color="var(--good)" stop-opacity="0"/></linearGradient></defs>' +
    (lo < 0 ? '<rect x="0" y="' + y(0) + '" width="' + W + '" height="' + (y(lo) - y(0)) + '" fill="var(--spend)" opacity=".08"/>' : '') +
    '<line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line)" stroke-dasharray="4 4"/>' +
    '<path d="' + area + '" fill="url(#fcg)"/><path d="' + path + '" fill="none" stroke="var(--good)" stroke-width="2.2"/>' + dots + ticks + '</svg>';
}
VIEWS.forecast = async (r, paint) => {
  const sel = r.q.account || LS.get('fcAccount', ''), horizon = +(r.q.days || LS.get('fcDays', 60));
  const m = await forecastModel(sel, horizon);
  const kinds = { Payday: 'good', Income: 'good', Recurring: '', Loan: 'warn', Card: 'warn', Bill: 'bad' };
  const rows = m.ev.map(e => '<tr' + (e.off ? ' style="opacity:.45"' : '') + '><td class="sel"><input type="checkbox"' + (e.off ? '' : ' checked') + ' title="Include in the forecast" data-onchange="App.fcToggle(\'' + esc(e.key) + '\', this.checked)"></td>' +
    '<td class="date">' + fmtDay(e.date) + '</td><td><div class="desc">' + esc(e.label) + '</div><span class="chip ' + (kinds[e.kind] || '') + '">' + e.kind + '</span></td>' +
    '<td class="amt ' + (e.amount > 0 ? 'pos' : 'neg') + '">' + (e.amount > 0 ? '+' : '') + money(e.amount) + '</td><td class="amt ' + (e.after < 0 ? 'neg' : '') + '">' + (e.off ? '—' : money(e.after)) + '</td></tr>').join('');
  const headline = m.short
    ? '<div class="eyebrow">Heads up</div><div class="big num negative" data-count="' + (-m.short) + '">' + money0(-m.short) + '</div><div class="sub-s" style="margin-top:6px">Your balance is projected to go <strong>' + money(m.short) + ' below zero</strong> on ' + fmtDate(m.minDate) + '. Move money in or delay a payment before then.</div>'
    : '<div class="eyebrow">Safe to spend</div><div class="big num" data-count="' + m.safe + '">' + money0(m.safe) + '</div><div class="sub-s" style="margin-top:6px">' +
      (m.nextPay ? 'Until your next ' + (m.nextPay.kind === 'Payday' ? 'payday' : 'deposit') + ' on ' + fmtDate(m.nextPay.date) + ', while still covering everything below' : 'While still covering everything below') + ' and keeping a ' + money0(m.buffer) + ' cushion.</div>';
  paint(head('Forecast', 'Where ' + esc(m.name) + ' is heading over the next ' + m.horizon + ' days',
      '<select data-onchange="App.fcSet(\'account\', this.value)" style="width:auto">' + m.banks.map(a => opt(a.id, a.name, m.sel)).join('') + opt('all', 'All bank accounts', m.sel) + '</select>' +
      '<select data-onchange="App.fcSet(\'days\', this.value)" style="width:auto">' + [30, 60, 90].map(d => opt(d, d + ' days', m.horizon)).join('') + '</select>') +
    '<section class="hero" style="margin-bottom:28px"><div>' + headline + '</div><div class="stats">' +
      '<div class="stat"><div class="eyebrow">Balance now</div><div class="val num">' + money0(m.start) + '</div></div>' +
      '<div class="stat"><div class="eyebrow">Lowest point</div><div class="val num ' + (m.min < 0 ? 'neg' : '') + '">' + money0(m.min) + '</div><div class="sub">' + fmtDay(m.minDate) + '</div></div>' +
      '<div class="stat"><div class="eyebrow">Cushion</div><div class="val num"><input type="number" min="0" step="10" value="' + m.buffer + '" data-onchange="App.fcBuffer(this.value)" style="width:110px;font-size:20px;padding:4px 10px"></div><div class="sub">kept aside, never counted as spendable</div></div>' +
    '</div></section>' +
    '<section class="panel chart" style="margin-bottom:20px"><h2>Projected balance</h2><p class="lead">Each dot is a scheduled payment or deposit · the shaded area is below zero</p>' + forecastChart(m) + '</section>' +
    '<section class="panel flush"><div style="padding:22px 26px 6px"><h2 style="font-size:15px;margin:0 0 3px">What’s coming</h2><p class="lead" style="margin-bottom:8px">Untick anything that won’t happen — the forecast remembers.</p></div>' +
      (rows ? '<table class="tbl"><thead><tr><th class="sel"></th><th>Date</th><th>What</th><th class="r">Amount</th><th class="r">Balance after</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="center-empty">Nothing scheduled in this period.</div>') + '</section>' +
    '<p class="sub-s" style="margin-top:14px">How this works: paydays are spotted from deposits that repeat on a schedule' + (m.incomes.length ? ' (' + m.incomes.map(i => esc(i.name) + ' ' + money0(i.amount) + ' ' + ({ semimonthly: 'twice a month', monthly: 'monthly', every: 'every ' + i.p.n + ' days' }[i.p.kind])).join(', ') + ')' : '') +
      '. It adds your recurring transactions, bills, loan payments that repeat monthly, and assumes each credit card balance is paid in full on its due date — or on your next payday if the card has no due date in Firefly. Day-to-day card spending isn’t predicted: whatever you put on a card also has to come out of this “safe to spend”.</p>');
};
function fcToggle(key, on) {
  const s = new Set(LS.get('fcExclude', [])); on ? s.delete(key) : s.add(key); LS.set('fcExclude', [...s]); route();
}
function fcSet(k, v) { LS.set(k === 'account' ? 'fcAccount' : 'fcDays', v); location.hash = hashWith({ [k]: v }); }
function fcBuffer(v) { LS.set('fcBuffer', Math.max(0, num(v))); route(); }
async function safeCard() {
  try {
    const m = await forecastModel(LS.get('fcAccount', ''), 45);
    return '<section class="panel"><div class="panel-head"><h2>' + (m.short ? 'Heads up' : 'Safe to spend') + '</h2><a class="link" href="#/forecast">Forecast</a></div>' +
      (m.short ? '<div class="total num neg">' + money0(-m.short) + '</div><p class="sub-s" style="margin:0">' + esc(m.name) + ' is projected to dip below zero on ' + fmtDate(m.minDate) + '.</p>'
        : '<div class="total num pos">' + money0(m.safe) + '</div><p class="sub-s" style="margin:0">' + (m.nextPay ? 'Until ' + fmtDay(m.nextPay.date) + ' · ' : '') + 'after upcoming bills, rent, card payoffs and loan payments</p>') + '</section>';
  } catch (e) { return ''; }
}

/* ================= Categorize inbox ================= */
const NOISE = new Set(['SQ', 'TST', 'DD', 'POS', 'ACH', 'WEB', 'PMT', 'PAYMENT', 'PURCHASE', 'IC', 'THE', 'APLPAY', 'PP', 'PAYPAL', 'ZSK', 'IT', 'RAZ', 'DEBIT', 'CARD', 'ONLINE', 'INST', 'XFER']);
function descKey(d) { return String(d || '').toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !NOISE.has(w)).slice(0, 2).join(' '); }
const bump = (o, k, v) => { if (!k) return; const m = o[k] = o[k] || {}; m[v] = (m[v] || 0) + 1; };
async function inboxHistory() {
  if (S.inboxHist && Date.now() - S.inboxHist.t < 600000) return S.inboxHist.v;
  const all = await getAll('/transactions', { type: 'all', start: addDays(todayIso(), -365), end: todayIso() });
  const h = { payee: {}, key: {}, tok: {}, bud: {}, payeeBud: {} };
  all.map(normGroup).forEach(g => g.splits.forEach(s => {
    if (s.type === 'transfer') return;
    const payee = s.type === 'deposit' ? s.source_id : s.destination_id, k = descKey(s.description);
    if (s.category) { bump(h.payee, payee, s.category); bump(h.key, k, s.category); bump(h.tok, k.split(' ')[0], s.category); }
    if (s.budget_id) { bump(h.bud, s.category, s.budget_id); bump(h.payeeBud, payee, s.budget_id); }
  }));
  S.inboxHist = { t: Date.now(), v: h };
  return h;
}
function suggest(s, h) {
  const score = {}, payee = s.type === 'deposit' ? s.source_id : s.destination_id, k = descKey(s.description);
  const addAll = (m, w) => { if (!m) return; const t = Object.values(m).reduce((a, b) => a + b, 0); Object.entries(m).forEach(([c, n]) => { score[c] = (score[c] || 0) + w * n / t; }); };
  const generic = /^(cash|cash account|venmo|zelle|paypal)$/i.test(s.type === 'deposit' ? s.source_name : s.destination_name);
  addAll(generic ? null : h.payee[payee], 3); addAll(h.key[k], 2); addAll(h.tok[k.split(' ')[0]], .7);
  const tot = Object.values(score).reduce((a, b) => a + b, 0) || 1;
  const cats = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => ({ c, pct: Math.round(v / tot * 100) }));
  const pickBud = cat => { const m = (!generic && h.payeeBud[payee]) || h.bud[cat]; if (!m) return ''; return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]; };
  return { cats, pickBud, generic };
}
VIEWS.inbox = async (r, paint) => {
  const L = await lists();
  const q = 'has_no_category:true';
  const [found, h] = await Promise.all([getAll('/search/transactions', { query: q, search: q }), inboxHistory()]);
  const items = [];
  found.map(normGroup).forEach(g => { if (g.type !== 'transfer' && g.splits.some(s => !s.category)) items.push(g); });
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!paint.live) return;
  S.inbox = { items, i: 0, h, done: 0, paint };
  renderInbox();
};
function renderInbox() {
  const I = S.inbox, L = S.lists, g = I.items[I.i];
  if (!g) {
    I.paint(head('Categorize', '', '') + '<section class="panel"><div class="center-empty" style="padding:70px 20px"><div style="font-size:40px">✓</div><h2 style="font-size:18px;margin:10px 0 4px">All caught up</h2>' +
      (I.done ? 'You categorized ' + I.done + ' transaction' + (I.done === 1 ? '' : 's') + '.' : 'Every transaction has a category.') + '</div></section>');
    return;
  }
  const s = g.splits.find(x => !x.category) || g.splits[0], sug = suggest(s, I.h), top = sug.cats[0];
  const payeeName = s.type === 'deposit' ? s.source_name : s.destination_name;
  const payeeId = s.type === 'deposit' ? s.source_id : s.destination_id;
  const similar = sug.generic ? [] : I.items.filter((x, j) => j !== I.i && x.splits.some(y => !y.category && (y.type === 'deposit' ? y.source_id : y.destination_id) === payeeId));
  I.cur = { g, s, payeeName, similar, generic: sug.generic, pickBud: sug.pickBud };
  const bud = top ? sug.pickBud(top.c) : '';
  I.paint(head('Categorize', (I.items.length - I.i) + ' left' + (I.done ? ' · ' + I.done + ' done this session' : ''), '<button class="btn" data-onclick="App.inboxSkip()">Skip <span class="neutral">S</span></button>') +
    '<div class="track" style="margin:-10px 0 24px"><div class="fill good" style="width:' + (I.done / (I.done + I.items.length) * 100).toFixed(1) + '%"></div></div>' +
    '<section class="panel" style="max-width:760px">' +
      '<div class="row" style="align-items:flex-start"><div><div class="eyebrow">' + fmtDate(g.date) + ' · ' + esc(s.type === 'deposit' ? 'Income' : 'Expense') + '</div>' +
        '<div style="font-size:22px;font-weight:600;letter-spacing:-.01em;margin:4px 0">' + esc(s.description) + '</div>' +
        '<div class="sub-s">' + esc(s.source_name) + ' → ' + esc(s.destination_name) + (g.splits.length > 1 ? ' · part of “' + esc(g.title) + '”' : '') + '</div></div>' +
        '<div class="big num ' + (s.type === 'deposit' ? 'pos' : '') + '" style="font-size:34px">' + money(s.amount) + '</div></div>' +
      '<div style="margin:24px 0 6px" class="eyebrow">' + (sug.cats.length ? 'Suggestions' : 'No suggestion yet — pick a category') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">' + sug.cats.map((c, i) => '<button class="btn' + (i === 0 ? ' primary' : '') + '" data-onclick="App.inboxPick(' + i + ')" data-cat="' + esc(c.c) + '"><span class="neutral" style="color:inherit;opacity:.6">' + (i + 1) + '</span> ' + esc(c.c) + ' <span style="opacity:.6">' + c.pct + '%</span></button>').join('') + '</div>' +
      '<form id="inboxForm" data-onsubmit="event.preventDefault();App.inboxSave()"><div class="grid2"><label>Category<input type="text" id="ib-cat" list="ib-dl" value="' + esc(top ? top.c : '') + '" required></label>' +
        (s.type === 'withdrawal' ? '<label>Budget<select id="ib-bud">' + opt('', 'None', bud) + L.budgets.filter(b => b.active).map(b => opt(b.id, b.name, bud)).join('') + '</select></label>' : '<span></span>') + '</div>' +
        '<datalist id="ib-dl">' + L.categories.map(c => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' +
        (similar.length ? '<label class="check"><input type="checkbox" id="ib-similar" checked> Also do the ' + similar.length + ' other uncategorized from ' + esc(payeeName) + '</label>' : '') +
        '<label class="check"><input type="checkbox" id="ib-rule"' + (similar.length >= 1 && !sug.generic ? ' checked' : '') + '> Always do this for ' + (sug.generic ? '“' + esc(descKey(s.description)) + '”' : esc(payeeName)) + ' from now on (creates a rule)</label>' +
        '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn primary" id="ib-save">Save <span style="opacity:.6">↵</span></button><button type="button" class="btn" data-onclick="App.editTx(\'' + g.id + '\')">Open full transaction</button>' +
        (I.i > 0 ? '<button type="button" class="link" data-onclick="App.inboxBack()">← Back</button>' : '') + '</div></form></section>' +
    '<p class="sub-s" style="margin-top:14px">Keys: <strong>1–3</strong> pick a suggestion · <strong>Enter</strong> save · <strong>S</strong> skip. Suggestions come from how you categorized similar transactions over the past year.</p>');
}
function inboxPick(i) { const b = document.querySelectorAll('[data-cat]')[i]; if (!b) return; el('ib-cat').value = b.dataset.cat; const bud = S.inbox.cur.pickBud(b.dataset.cat); if (el('ib-bud') && bud) el('ib-bud').value = bud; }
function inboxSkip() { S.inbox.i++; renderInbox(); }
function inboxBack() { S.inbox.i = Math.max(0, S.inbox.i - 1); renderInbox(); }
async function ensureInboxGroup() {
  const groups = await getAll('/rule-groups');
  const g = groups.find(x => x.attributes.title === '5. Inbox rules');
  if (g) return String(g.id);
  const res = await api('/rule-groups', { method: 'POST', body: { title: '5. Inbox rules', description: 'Created from the Categorize inbox. Runs after your other groups.', active: true } });
  return String(res.data.id);
}
async function inboxSave() {
  const I = S.inbox, { g, s, similar, payeeName, generic } = I.cur, L = S.lists;
  const cat = el('ib-cat').value.trim(); if (!cat) return toast('Pick a category first.');
  const bud = el('ib-bud') ? el('ib-bud').value : '';
  const alsoSimilar = el('ib-similar') && el('ib-similar').checked, makeRule = el('ib-rule') && el('ib-rule').checked;
  const btn = el('ib-save'); btn.disabled = true; btn.textContent = 'Saving…';
  const put = grp => api('/transactions/' + grp.id, { method: 'PUT', body: { apply_rules: false, transactions: grp.splits.filter(x => !x.category).map(x => {
    const o = { transaction_journal_id: x.jid, category_name: cat }; if (bud && x.type === 'withdrawal' && !x.budget_id) o.budget_id = bud; return o; }) } });
  try {
    await put(g);
    let n = 1;
    if (alsoSimilar) await eachLimited(similar, 4, async o => { await put(o); n++; });
    if (makeRule) {
      const gid = await ensureInboxGroup();
      const triggers = generic ? [{ type: 'description_contains', value: descKey(s.description) }] : [{ type: s.type === 'deposit' ? 'source_account_is' : 'destination_account_is', value: payeeName }];
      triggers.push({ type: 'transaction_type', value: s.type });
      const actions = [{ type: 'set_category', value: cat }];
      const budName = bud && (L.budgets.find(b => b.id === bud) || {}).name; if (budName) actions.push({ type: 'set_budget', value: budName });
      await api('/rules', { method: 'POST', body: { title: (generic ? descKey(s.description) : payeeName) + ' → ' + cat, rule_group_id: gid, trigger: 'store-journal', strict: true, stop_processing: false, active: true,
        triggers: triggers.map(t => ({ ...t, active: true, stop_processing: false })), actions: actions.map(a => ({ ...a, active: true, stop_processing: false })) } });
    }
    const doneIds = new Set([g.id, ...(alsoSimilar ? similar.map(x => x.id) : [])]);
    I.items = I.items.filter(x => !doneIds.has(x.id)); I.done += n;
    if (I.i >= I.items.length) I.i = Math.max(0, I.items.length - 1);
    if (I.items.length && I.i > 0 && I.i >= I.items.length) I.i = I.items.length - 1;
    // remember this choice for the next suggestions
    bump(I.h.payee, s.type === 'deposit' ? s.source_id : s.destination_id, cat); bump(I.h.key, descKey(s.description), cat);
    toast('Saved' + (n > 1 ? ' · ' + n + ' transactions' : '') + (makeRule ? ' · rule created' : ''));
    renderInbox();
  } catch (e) { if (e instanceof AuthError) return showLogin(e.message); btn.disabled = false; btn.textContent = 'Save'; toast(e.message); }
}
document.addEventListener('keydown', e => {
  if (parseHash().name !== 'inbox' || !S.inbox || !el('inboxForm')) return;
  if (el('drawer').classList.contains('open') || !el('palette').hidden || el('confirm').open || e.metaKey || e.ctrlKey || e.altKey) return;
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox';
  if (!inField && /^[123]$/.test(e.key)) { e.preventDefault(); inboxPick(+e.key - 1); }
  else if (!inField && (e.key === 's' || e.key === 'S')) { e.preventDefault(); inboxSkip(); }
  else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); inboxSave(); }
});

/* ================= Loan payoff planner ================= */
function monthlyRate(l) {
  const r = num(l.interest) / 100; if (!r) return 0;
  return { daily: r * 365 / 12, weekly: r * 52 / 12, monthly: r, quarterly: r / 3, 'half-year': r / 6, yearly: r / 12 }[l.interestPeriod || 'yearly'] ?? r / 12;
}
function simulate(loans, extra, strategy) {
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
  return { loans: st, months: st.every(l => l.paidOff !== null) ? Math.max(...st.map(l => l.paidOff)) : null, interest: st.reduce((s, l) => s + l.accrued, 0), totals };
}
const monthLabel = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toLocaleString('en-US', { month: 'short', year: 'numeric' }); };
VIEWS.loans = async (r, paint) => {
  const L = await lists();
  const loans = L.own.filter(a => isLiab(a) && a.debt > 0);
  const hist = await loanHistory(L.own.filter(isLiab));
  const plan = LS.get('loanPlan', { pays: {}, extra: 0, strategy: 'snowball' });
  const model = loans.map(l => ({ id: l.id, name: l.name, debt: l.debt, rate: monthlyRate(l), interest: l.interest, period: l.interestPeriod, planned: !!(l.plan && l.plan.amount), pay: (hist[l.id] || {}).monthly || 0 }));
  S.loanModel = model;
  const base = simulate(model, 0, 'now'), sim = simulate(model, +plan.extra || 0, plan.strategy);
  const maxM = Math.min(120, Math.max(12, ...sim.loans.map(l => l.paidOff || 120)));
  const rows = sim.loans.sort((a, b) => (a.paidOff ?? 9999) - (b.paidOff ?? 9999)).map(l => {
    const b0 = base.loans.find(x => x.id === l.id), h = hist[l.id] || {};
    const saved = b0.paidOff !== null && l.paidOff !== null ? b0.paidOff - l.paidOff : null;
    return '<tr><td><a class="desc" href="#/account/' + l.id + '" style="text-decoration:none">' + esc(l.name) + '</a><div class="sub-s">' + (h.last ? 'Last paid ' + money0(h.last.a) + ' on ' + fmtDay(h.last.d) : 'No payments yet') + (num(l.interest) ? ' · ' + num(l.interest) + '% ' + esc(l.period || 'interest') : '') + '</div></td>' +
      '<td class="amt">' + money0(l.debt) + '</td>' +
      '<td class="r"><input class="inline num" type="number" min="0" step="10" value="' + l.pay + '" data-onchange="App.loanPay(\'' + l.id + '\', this.value)" aria-label="Monthly payment for ' + esc(l.name) + '"></td>' +
      '<td class="r">' + (l.paidOff === null ? '<span class="neg">Not being paid</span>' : '<strong>' + monthLabel(l.paidOff) + '</strong><div class="sub-s">' + l.paidOff + ' month' + (l.paidOff === 1 ? '' : 's') + (saved > 0 ? ' · <span class="down">' + saved + ' sooner</span>' : '') + '</div>') + '</td>' +
      '<td style="min-width:200px"><div class="track" style="height:10px"><div class="fill good" style="width:' + ((l.paidOff === null ? maxM : Math.min(l.paidOff, maxM)) / maxM * 100).toFixed(1) + '%;' + (l.paidOff === null ? 'background:var(--spend);opacity:.35' : '') + '"></div></div></td></tr>';
  }).join('');
  const totalDebt = model.reduce((s, l) => s + l.debt, 0), totalPay = model.reduce((s, l) => s + l.pay, 0) + (plan.strategy === 'now' ? 0 : +plan.extra || 0);
  const strat = (v, label, sub) => '<button type="button" class="' + (plan.strategy === v ? 'on' : '') + '" data-onclick="App.loanSet(\'strategy\', \'' + v + '\')" title="' + sub + '">' + label + '</button>';
  paint(head('Loan planner', 'See when each loan is paid off, and how to get there sooner', '') +
    '<div class="kpis"><div class="kpi"><div class="eyebrow">Owed</div><div class="val num">' + money0(totalDebt) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Paying per month</div><div class="val num">' + money0(totalPay) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Debt-free</div><div class="val num ' + (sim.months === null ? 'neg' : 'pos') + '">' + (sim.months === null ? 'Not yet' : monthLabel(sim.months)) + '</div><div class="sub-s">' +
        (sim.months === null ? 'some loans have no payment' : sim.months + ' months' + (base.months && base.months > sim.months ? ' · ' + (base.months - sim.months) + ' sooner than now' : '')) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Interest to pay</div><div class="val num">' + money0(sim.interest) + '</div></div></div>' +
    '<section class="panel" style="margin-bottom:20px"><div class="grid2" style="align-items:end"><div><div class="eyebrow">When a loan is paid off, put its payment toward…</div>' +
      '<div class="seg" style="margin:8px 0 0">' + strat('snowball', 'Smallest balance next', 'Snowball: quick wins first') + strat('avalanche', 'Highest interest next', 'Avalanche: least interest overall') + strat('now', 'Nothing — keep payments as they are', 'No rollover') + '</div></div>' +
      '<label style="margin:0">Extra each month on top<input type="number" min="0" step="25" value="' + (+plan.extra || 0) + '" data-onchange="App.loanSet(\'extra\', this.value)"' + (plan.strategy === 'now' ? ' disabled' : '') + '></label></div></section>' +
    '<section class="panel flush"><table class="tbl"><thead><tr><th>Loan</th><th class="r">Owed</th><th class="r">Pay / month</th><th class="r">Paid off</th><th>Timeline to ' + monthLabel(maxM) + '</th></tr></thead><tbody>' + rows + '</tbody></table></section>' +
    '<p class="sub-s" style="margin-top:14px">Changing a “Pay / month” amount saves it as that loan’s monthly payment in Firefly. Loans without one use what you actually paid recently. Strategy and extra amount are only a what-if and aren’t saved. ' +
      '<button class="link" data-onclick="App.loanReset()">Reset strategy &amp; extra</button></p>');
};
async function loanPay(id, v) {
  const L = await lists(), a = L.byId[id]; if (!a) return;
  const p = { ...(a.plan || {}), amount: Math.max(0, num(v)) };
  await withAuth(async () => {
    await api('/accounts/' + id, { method: 'PUT', body: { name: a.name, notes: withPlan(a.notes, p) } });
    toast(p.amount > 0 ? 'Saved ' + money(p.amount) + '/month for ' + a.name : 'Monthly payment cleared for ' + a.name); route();
  });
}
function loanSet(k, v) { const p = LS.get('loanPlan', { pays: {}, extra: 0, strategy: 'snowball' }); p[k] = k === 'extra' ? Math.max(0, num(v)) : v; LS.set('loanPlan', p); route(); }
function loanReset() { LS.set('loanPlan', { pays: {}, extra: 0, strategy: 'snowball' }); route(); }

/* ================= Installable app ================= */
if ('serviceWorker' in navigator && window.isSecureContext) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  // The app opens from the copy saved on this device; when a newer version was published, offer to load it.
  // The service worker says so with a message, and also leaves a note in case the message came before this page was listening.
  const updateBar = () => {
    if (el('updateBar')) return;
    const b = document.createElement('div'); b.id = 'updateBar'; b.className = 'undo'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>A new version of Money is ready</span><button type="button">Reload</button>';
    b.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(b);
  };
  navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'money-updated') updateBar(); });
  addEventListener('load', () => setTimeout(() => { try { caches.open('money-v1').then(c => c.match('/__money-updated')).then(n => { if (n) updateBar(); }).catch(() => {}); } catch (e) { /* no Cache Storage */ } }, 2500));
}
function netBanner() {
  let b = el('offline');
  if (!b) { b = document.createElement('div'); b.id = 'offline'; b.className = 'offline'; b.textContent = 'You’re offline — showing the last data this device saw. Changes won’t save until you’re back online.'; document.body.appendChild(b); }
  b.hidden = navigator.onLine;
}
addEventListener('online', netBanner); addEventListener('offline', netBanner);
if (!navigator.onLine) addEventListener('DOMContentLoaded', netBanner); setTimeout(netBanner, 0);

Object.assign(window.App, { fcToggle, fcSet, fcBuffer, safeCard, inboxPick, inboxSkip, inboxBack, inboxSave, loanPay, loanSet, loanReset, loanHistory });

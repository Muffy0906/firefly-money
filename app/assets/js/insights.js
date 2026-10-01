'use strict';
/* =====================================================================
   Insight cards: short, auto-generated observations on the Overview.
   Compares this month against the same point in the previous 3 months.
   ===================================================================== */
const INS_ICON = {
  up: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  down: '<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>',
  budget: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
};
async function insightCards({ cur, future, budgets, limits, cards, trend }) {
  if (future) return '';
  const now = new Date(), isCur = cur.y === now.getFullYear() && cur.m === now.getMonth();
  const dim = new Date(cur.y, cur.m + 1, 0).getDate(), N = isCur ? now.getDate() : dim;
  const win = mr => { const d = new Date(mr.y, mr.m + 1, 0).getDate(); return { start: mr.start, end: mr.start.slice(0, 8) + pad(Math.min(N, d)) }; };
  const pull = async w => {
    const [c, u] = await Promise.all([api('/insight/expense/category', { params: w }), api('/insight/expense/no-category', { params: w }).catch(() => [])]);
    const m = new Map(); arr(c).forEach(x => m.set(x.name, { id: x.id, amt: (m.get(x.name) || { amt: 0 }).amt + absDiff(x) }));
    return { cats: m, total: sumDiff(c) + sumDiff(u) };
  };
  const nowW = win(cur), past = [1, 2, 3].map(i => win(monthRange(cur.y, cur.m - i)));
  const [me, ...hist] = await Promise.all([pull(nowW), ...past.map(pull)]);
  const used = hist.filter(h => h.total > 0);
  if (!used.length) return '';
  const byLabel = isCur ? 'by the ' + ordinal(N) : 'in ' + cur.short;
  const out = [];
  const add = (id, tone, ic, title, detail, href, score) => out.push({ id: cur.y + '-' + (cur.m + 1) + ':' + id, tone, ic, title, detail, href, score });

  // 1. Overall pace
  const avg = used.reduce((a, h) => a + h.total, 0) / used.length, pct = avg ? (me.total - avg) / avg : 0;
  if (Math.abs(pct) >= .1) add('pace', pct > 0 ? 'up' : 'down', pct > 0 ? 'up' : 'down',
    'Spending is ' + Math.round(Math.abs(pct) * 100) + '% ' + (pct > 0 ? 'higher' : 'lower') + ' than usual',
    money0(me.total) + ' ' + (isCur ? 'so far' : 'in ' + cur.short) + ' vs. about ' + money0(avg) + ' ' + byLabel + ' in a typical month', '#/transactions?type=withdrawal', 30 + Math.min(40, Math.abs(pct) * 60));
  else add('pace', 'down', 'check', 'Spending is right on track', money0(me.total) + ' ' + (isCur ? 'so far' : 'in ' + cur.short) + ', close to your usual ' + money0(avg) + ' ' + byLabel, '#/reports', 8);

  // 2. Categories that moved the most
  const names = new Set([...me.cats.keys(), ...used.flatMap(h => [...h.cats.keys()])]);
  const moves = [];
  names.forEach(name => {
    const c = me.cats.get(name), amt = c ? c.amt : 0, a = used.reduce((s, h) => s + ((h.cats.get(name) || {}).amt || 0), 0) / used.length;
    const id = (c || used.map(h => h.cats.get(name)).find(Boolean) || {}).id, d = amt - a;
    if (a < 1 && amt >= 100) moves.push({ name, id, amt, a, d, p: Infinity, score: 30 + Math.min(30, amt / 40) });
    else if (a >= 25 && d >= 40 && d / a >= .3) moves.push({ name, id, amt, a, d, p: d / a, score: 25 + Math.min(40, d / a * 30) + Math.min(15, d / 50) });
    else if (a >= 60 && -d >= 50 && -d / a >= .35) moves.push({ name, id, amt, a, d, p: d / a, score: 12 + Math.min(20, -d / 40) });
  });
  const ups = moves.filter(m => m.d > 0).sort((x, y) => y.score - x.score).slice(0, 2), downs = moves.filter(m => m.d < 0).sort((x, y) => y.score - x.score).slice(0, 1);
  [...ups, ...downs].forEach(m => {
    const href = m.id ? '#/transactions?category=' + m.id : '#/transactions';
    if (m.p === Infinity) add('cat:' + m.name, 'up', 'spark', money0(m.amt) + ' on ' + m.name, 'Nothing spent here ' + byLabel + ' in the last 3 months', href, m.score);
    else add('cat:' + m.name, m.d > 0 ? 'up' : 'down', m.d > 0 ? 'up' : 'down', m.name + ' is ' + Math.round(Math.abs(m.p) * 100) + '% ' + (m.d > 0 ? 'above' : 'below') + ' usual',
      money0(m.amt) + ' vs. about ' + money0(m.a) + ' ' + byLabel + ' in a typical month', href, m.score);
  });

  if (isCur) {
    // 3. Budgets on pace to run out before the month ends (ones already near/over the limit show in "Needs attention")
    budgets.filter(b => b.attributes.active !== false).forEach(b => {
      const lim = limits[String(b.id)], spent = Math.abs((b.attributes.spent || []).reduce((s, x) => s + num(x.sum), 0));
      if (!lim || !lim.amount || spent >= lim.amount * .85 || N < 5) return;
      const perDay = spent / N, runDay = perDay > 0 ? Math.ceil(lim.amount / perDay) : Infinity;
      if (runDay >= dim) return;
      add('bud:' + b.id, 'warn', 'budget', b.attributes.name + ' may run out around ' + fmtDay(cur.start.slice(0, 8) + pad(runDay)),
        money0(spent) + ' of ' + money0(lim.amount) + ' used · about ' + money0(perDay) + '/day so far', '#/transactions?budget=' + b.id, 38 + (dim - runDay));
    });
    // 4. Credit card payments coming up
    cards.forEach(a => {
      const owed = Math.max(0, -a.balance), day = +String(a.paymentDate || '').slice(8, 10);
      if (!owed || !day) return;
      let due = new Date(now.getFullYear(), now.getMonth(), Math.min(day, dim), 12);
      if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) due = new Date(now.getFullYear(), now.getMonth() + 1, day, 12);
      const days = Math.round((due - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 864e5);
      if (days > 7) return;
      add('card:' + a.id, 'warn', 'card', a.name + ' payment due ' + (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days'),
        money(owed) + ' owed · due ' + fmtDay(isoDate(due)), '#/account/' + a.id, 55 - days);
    });
  } else if (trend && trend.length >= 2) {
    // 5. Savings rate for a finished month
    const a = trend[trend.length - 1], b = trend[trend.length - 2];
    if (a.income > 0) {
      const r = (a.income - a.spend) / a.income, rb = b.income > 0 ? (b.income - b.spend) / b.income : null;
      add('kept', r >= (rb ?? r) ? 'down' : 'up', 'check', 'You kept ' + Math.round(r * 100) + '% of your income',
        rb === null ? money0(a.income - a.spend) + ' of ' + money0(a.income) : (r >= rb ? 'Up' : 'Down') + ' from ' + Math.round(rb * 100) + '% in ' + b.label, '#/reports', 20);
    }
  }

  const hidden = LS.get('insightsHidden', {});
  const shown = out.filter(x => !hidden[x.id]).sort((a, b) => b.score - a.score).slice(0, 4);
  if (!shown.length) return '';
  return '<div class="insights" id="insights" aria-label="Insights">' + shown.map(x =>
    '<div class="insight t-' + x.tone + '" role="link" tabindex="0" data-ins="' + esc(x.id) + '" data-onclick="App.go(\'' + x.href + '\')" data-onkeydown="App.enterClick(event,this)">' +
      '<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + INS_ICON[x.ic] + '</svg></span>' +
      '<span><div class="t">' + esc(x.title) + '</div><div class="d">' + esc(x.detail) + '</div></span>' +
      '<button class="x" type="button" aria-label="Dismiss" title="Hide this" data-onclick="event.stopPropagation();App.hideInsight(this)">×</button></div>').join('') + '</div>';
}
function hideInsight(btn) {
  const card = btn.closest('.insight'), id = card.dataset.ins, box = el('insights');
  const hidden = LS.get('insightsHidden', {}); hidden[id] = Date.now();
  Object.keys(hidden).forEach(k => { if (Date.now() - hidden[k] > 100 * 864e5) delete hidden[k]; });
  LS.set('insightsHidden', hidden);
  const rest = [...box.children].filter(c => c !== card);
  vt('ins', () => { card.remove(); if (!rest.length) box.remove(); }, () => rest.forEach((c, i) => vtName(c, 'ins' + i)));
}
Object.assign(window.App, { insightCards, hideInsight });

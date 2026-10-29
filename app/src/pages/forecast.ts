import { html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, S, fmtDate, fmtDay, isoDate, money, money0, num, sameName, todayIso, type ApiData } from '../core/base';
import { head, opt } from '../core/dom';
import { type Group, normGroup } from '../core/feed';
import { LS, addDays, bizDay, daysBetween, monthsFrom } from '../core/helpers';
import { isAsset, isCard, isLiab, lists } from '../core/lists';
import { VIEWS, hashWith, route } from '../core/router';
import { billAmount } from './bills';
import { loanHistory } from './loans';

/* ================= Safe-to-spend forecast ================= */
type Income = { name: string, amount: number, p: { kind: 'semimonthly' } | { kind: 'every', n: number } | { kind: 'monthly', day: number }, last: string, salary: boolean };
function detectIncome(groups: Group[], accIds: string[]) {
  const by: Record<string, { name: string, list: { d: string, a: number, cat: string }[] }> = {};
  groups.forEach(g => g.splits.forEach(s => {
    if (s.type !== 'deposit' || !accIds.includes(s.destination_id)) return;
    const src = S.lists!.byId[s.source_id]; if (src && isLiab(src)) return;          // loan money isn't income
    (by[s.source_id] = by[s.source_id] || { name: s.source_name, list: [] }).list.push({ d: String(s.date).slice(0, 10), a: s.amount, cat: s.category });
  }));
  const out: Income[] = [];
  Object.values(by).forEach(({ name, list }) => {
    if (list.length < 3) return;
    list.sort((a, b) => a.d.localeCompare(b.d));
    const recent = list.slice(-6), lastAmt = recent[recent.length - 1].a;
    if (recent.filter(x => Math.abs(x.a - lastAmt) / lastAmt < .2).length < 3) return;   // needs a steady amount
    const gaps = recent.slice(1).map((x, i) => daysBetween(recent[i].d, x.d)).sort((a, b) => a - b), gap = gaps[Math.floor(gaps.length / 2)];
    const doms = recent.map(x => +x.d.slice(8, 10));
    let p: Income['p'];
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
function incomeDates(inc: Income, from: string, to: string) {
  const out: string[] = [], p = inc.p;
  if (p.kind === 'every') { for (let d = addDays(inc.last, p.n); d <= to; d = addDays(d, p.n)) if (d >= from) out.push(d); }
  else monthsFrom(from, to).forEach(([y, m]) => (p.kind === 'semimonthly' ? [15, 31] : [p.day]).forEach(day => { const d = bizDay(y, m, day); if (d > inc.last && d >= from && d <= to) out.push(d); }));
  return out.sort();
}
// A planned purchase, raise or subscription on the Forecast page (money.fcWhatIf)
type WhatIf = { id: string, label: string, amount: number, date: string, repeat: string };
type FcEvent = { date: string, label: string, kind: string, amount: number, key: string, off?: boolean, after?: number };
export async function forecastModel(sel: string, horizon: number, withWhatIfs = false) {
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
    const guess = detectIncome(depGroups, banks.map(a => a.id)).sort((a, b) => (+b.salary - +a.salary) || b.amount - a.amount)[0];
    const hit = guess && depGroups.flatMap(g => g.splits).find(s => s.source_name === guess.name);
    sel = hit ? hit.destination_id : (banks[0] || {}).id;
  }
  const accIds = sel === 'all' ? banks.map(a => a.id) : [sel];
  const start = accIds.reduce((s, id) => s + ((L.byId[id] || {}).balance || 0), 0);
  const ev: FcEvent[] = [];
  const add = (date: string, label: string, kind: string, amount: number, series: string) => { if (date >= from && date <= to && amount) ev.push({ date, label, kind, amount, key: kind + ':' + series }); };
  const incomes = detectIncome(depGroups, accIds);
  incomes.forEach(inc => incomeDates(inc, from, to).forEach(d => add(d, inc.name, inc.salary ? 'Payday' : 'Income', inc.amount, inc.name)));
  recs.forEach(r => {
    const at = r.attributes; if (at.active === false) return;
    const t = (at.transactions || [])[0] || {}, occ: string[] = (at.repetitions || []).flatMap((x: ApiData) => x.occurrences || []).map((d: string) => String(d).slice(0, 10));
    const sign = accIds.includes(String(t.source_id)) ? -1 : accIds.includes(String(t.destination_id)) ? 1 : 0;
    if (sign) recurDates([...new Set(occ)].sort(), to, at.repeat_until ? String(at.repeat_until).slice(0, 10) : '').forEach(d => add(d, at.title, 'Recurring', sign * num(t.amount), 'rec' + r.id));
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
    (at.pay_dates || []).map((d: string) => String(d).slice(0, 10)).forEach((d: string) => add(d, at.name, 'Bill', -billAmount(at), 'bill' + b.id));
  });
  // Your what-ifs: a purchase, a raise, a new subscription... (only on the Forecast page, not in the Overview's card)
  const whatIfs: WhatIf[] = withWhatIfs ? LS.get('fcWhatIf', []) : [];
  whatIfs.forEach(w => whatIfDates(w, from, to).forEach(d => add(d, w.label, 'What if', w.amount, 'whatif' + w.id)));
  const excluded = new Set(LS.get('fcExclude', []));
  ev.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  // base: the same balance without the what-ifs, to show what they change
  let bal = start, min = start, minDate = from, base = start, minBase = start;
  const byDay: any = {}, baseDay: any = {};
  ev.forEach(e => {
    e.off = excluded.has(e.key); if (!e.off) { bal += e.amount; if (e.kind !== 'What if') base += e.amount; }
    e.after = bal; byDay[e.date] = bal; baseDay[e.date] = base; if (bal < min) { min = bal; minDate = e.date; } minBase = Math.min(minBase, base);
  });
  const series: { d: string, v: number, b: number }[] = []; let run = start, runB = start;
  for (let d = from; d <= to; d = addDays(d, 1)) { if (byDay[d] !== undefined) { run = byDay[d]; runB = baseDay[d]; } series.push({ d, v: run, b: runB }); }
  const careful = scenario(start, from, to, ev, 'careful'), hopeful = scenario(start, from, to, ev, 'hopeful');
  const buffer = +LS.get('fcBuffer', 100), whatIfOn = ev.some(e => e.kind === 'What if' && !e.off);
  const nextPay = ev.find(e => !e.off && (e.kind === 'Payday' || e.kind === 'Income'));
  return { sel, accIds, name: sel === 'all' ? 'all bank accounts' : (L.byId[sel] || {}).name, banks, start, ev, series, min, minDate, buffer,
    safe: Math.max(0, Math.floor(min - buffer)), short: min < 0 ? -min : 0, nextPay, incomes, horizon, whatIfs, whatIfOn,
    safeBase: Math.max(0, Math.floor(minBase - buffer)), minBase, careful, hopeful };
}
/* Scenarios around the likely line. Careful: income that isn't a steady paycheck doesn't come, and bills and recurring
   payments run 10% higher. Hopeful: bills and recurring payments come in 10% lower. */
export function scenarioAmount(e: { kind: string, amount: number }, kind: 'careful' | 'hopeful') {
  const flexible = e.amount < 0 && (e.kind === 'Bill' || e.kind === 'Recurring');
  if (kind === 'careful') return e.kind === 'Income' ? 0 : flexible ? e.amount * 1.1 : e.amount;
  return flexible ? e.amount * .9 : e.amount;
}
function scenario(start: number, from: string, to: string, ev: FcEvent[], kind: 'careful' | 'hopeful') {
  const byDay: Record<string, number> = {}; let bal = start, min = start, minDate = from;
  ev.forEach(e => { if (e.off) return; bal += scenarioAmount(e, kind); byDay[e.date] = bal; if (bal < min) { min = bal; minDate = e.date; } });
  const v: number[] = []; let run = start;
  for (let d = from; d <= to; d = addDays(d, 1)) { if (byDay[d] !== undefined) run = byDay[d]; v.push(run); }
  return { v, min, minDate, end: run };
}
/* Firefly lists only the next few dates of a recurring transaction, so a long forecast carries on at the same rhythm:
   monthly on the same day, every n days for weekly-ish gaps, or yearly. */
export function recurDates(occ: string[], to: string, until: string) {
  const out = occ.slice(), end = until && until < to ? until : to;
  if (occ.length >= 2) {
    const gaps = occ.slice(1).map((d, i) => daysBetween(occ[i], d)).sort((a, b) => a - b), gap = gaps[Math.floor(gaps.length / 2)];
    const last = occ[occ.length - 1], day = +last.slice(8, 10);
    if (gap >= 27 && gap <= 32) monthsFrom(addDays(last, 1), end).forEach(([y, m]) => { const d = isoDate(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12)); if (d > last && d <= end) out.push(d); });
    else if (gap >= 360 && gap <= 370) { for (let y = +last.slice(0, 4) + 1, d = y + last.slice(4); d <= end; y++, d = y + last.slice(4)) out.push(d); }
    else if (gap >= 1 && gap <= 92) for (let d = addDays(last, gap); d <= end; d = addDays(d, gap)) out.push(d);
  }
  return out.filter(d => d <= end);
}
// The days a what-if happens between from and to: once, every month on its day, or every two weeks
export function whatIfDates(w: WhatIf, from: string, to: string) {
  if (w.repeat === 'monthly') { const day = +w.date.slice(8, 10); return monthsFrom(w.date, to).map(([y, m]) => isoDate(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12))).filter(d => d >= from && d >= w.date && d <= to); }
  if (w.repeat === 'biweekly') { const out: string[] = []; for (let d = w.date; d <= to; d = addDays(d, 14)) if (d >= from) out.push(d); return out; }
  return w.date >= from && w.date <= to ? [w.date] : [];
}
function forecastChart(m: Awaited<ReturnType<typeof forecastModel>>) {
  const W = innerWidth < 600 ? 420 : 960, H = W < 960 ? 180 : 220, pt = 14, pb = 26, s = m.series, n = s.length;
  const band = LS.get('fcBand', true) ? m : null;
  const lo = Math.min(0, ...s.map(x => x.v), ...s.map(x => x.b), ...(band ? band.careful.v : [])), hi = Math.max(...s.map(x => x.v), ...s.map(x => x.b), ...(band ? band.hopeful.v : []), 1), span = hi - lo || 1;
  const x = (i: number) => (W - 8) * i / Math.max(1, n - 1) + 4, y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / span);
  let path = '';
  s.forEach((p, i) => { path += (i ? ' H' + x(i).toFixed(1) + ' V' : 'M' + x(i).toFixed(1) + ' ') + y(p.v).toFixed(1); });
  const area = path + ' V' + y(lo).toFixed(1) + ' H' + x(0).toFixed(1) + ' Z';
  const step = (v: number[]) => v.map((b, i) => (i ? ' H' + x(i).toFixed(1) + ' V' : 'M' + x(i).toFixed(1) + ' ') + y(b).toFixed(1)).join('');
  // The band between careful and hopeful: along the hopeful line, then back along the careful one
  const bandPath = band ? step(band.hopeful.v) + [...band.careful.v.keys()].reverse().map(i => ' L' + x(i).toFixed(1) + ' ' + y(band.careful.v[i]).toFixed(1)).join('') + ' Z' : '';
  let basePath = '';
  if (m.whatIfOn) s.forEach((p, i) => { basePath += (i ? ' H' + x(i).toFixed(1) + ' V' : 'M' + x(i).toFixed(1) + ' ') + y(p.b).toFixed(1); });
  const byDate: Record<string, FcEvent[]> = {};
  m.ev.filter(e => !e.off).forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dots = htmlList(Object.entries(byDate).map(([d, list]) => {
    const i = daysBetween(s[0].d, d), last = list[list.length - 1], cx = x(i).toFixed(1), cy = y(last.after!).toFixed(1);
    const tip = fmtDate(d) + '\n' + list.map(e => e.label + '  ' + (e.amount > 0 ? '+' : '') + money(e.amount)).join('\n') + '\nBalance after: ' + money(last.after!);
    const net = list.reduce((t, e) => t + e.amount, 0);
    return html`<g class="pt" data-tip="${tip}"><rect x="${+cx - 10}" y="${pt}" width="20" height="${H - pt - pb}" fill="transparent"/><circle class="dot" cx="${cx}" cy="${cy}" r="${list.length > 1 ? 5 : 3.5}" fill="${net > 0 ? 'var(--good)' : 'var(--spend)'}"/></g>`;
  }));
  const every = n > 120 ? Math.ceil(n / (W < 960 ? 5 : 12)) : W < 960 && n > 35 ? 14 : 7, ticks = htmlList(s.filter((p, i) => i % every === 0).map(p => { const i = daysBetween(s[0].d, p.d); return html`<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${fmtDay(p.d)}</text>`; }));
  return html`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected balance"><defs><linearGradient id="fcg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--good)" stop-opacity=".22"/><stop offset="1" stop-color="var(--good)" stop-opacity="0"/></linearGradient></defs>${lo < 0 ? html`<rect x="0" y="${y(0)}" width="${W}" height="${y(lo) - y(0)}" fill="var(--spend)" opacity=".08"/>` : ''}<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-dasharray="4 4"/><path class="soft" d="${area}" fill="url(#fcg)" style="color:var(--good)"/>${bandPath ? html`<path class="band" d="${bandPath}" fill="var(--muted)" opacity=".12"/><path d="${step(band!.careful.v)}" fill="none" stroke="var(--spend)" stroke-width="1.2" stroke-dasharray="2 3" opacity=".8"/>` : ''}${basePath ? html`<path d="${basePath}" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="5 4"/>` : ''}<path d="${path}" fill="none" stroke="var(--good)" stroke-width="2.2"/>${dots}${ticks}</svg>`;
}
VIEWS.forecast = async (r, paint) => {
  const sel = r.q.account || LS.get('fcAccount', ''), horizon = +(r.q.days || LS.get('fcDays', 60));
  const m = await forecastModel(sel, horizon, true);
  if (paint.live && m.sel) { const was = LS.get('fcLog', []), log = logForecast(was, m.sel, todayIso(), m.series.length > 30 ? m.series[30].b : undefined, m.start); if (JSON.stringify(log) !== JSON.stringify(was)) LS.set('fcLog', log); }
  const kinds: Record<string, string> = { Payday: 'good', Income: 'good', Recurring: '', Loan: 'warn', Card: 'warn', Bill: 'bad', 'What if': 'warn' };
  const rows = htmlList(m.ev.map(e => html`<tr${e.off ? html` style="opacity:.45"` : ''}><td class="sel"><input type="checkbox"${e.off ? '' : ' checked'} title="Include in the forecast" data-onchange="App.fcToggle('${e.key}', this.checked)"></td><td class="date hide-s">${fmtDay(e.date)}</td><td><div class="desc">${e.label}</div><span class="chip ${kinds[e.kind] || ''}">${e.kind}</span><span class="sub-s show-s">${fmtDay(e.date)}</span></td><td class="amt ${e.amount > 0 ? 'pos' : 'neg'}">${e.amount > 0 ? '+' : ''}${money(e.amount)}</td><td class="amt ${e.after! < 0 ? 'neg' : ''}">${e.off ? '—' : money(e.after!)}</td></tr>`));
  const headline = m.short
    ? html`<div class="eyebrow">Heads up</div><div class="big num negative" data-count="${-m.short}">${money0(-m.short)}</div><div class="sub-s" style="margin-top:6px">Your balance is projected to go <strong>${money(m.short)} below zero</strong> on ${fmtDate(m.minDate)}. Move money in or delay a payment before then.</div>`
    : html`<div class="eyebrow">Safe to spend</div><div class="big num" data-count="${m.safe}">${money0(m.safe)}</div><div class="sub-s" style="margin-top:6px">${m.nextPay ? 'Until your next ' + (m.nextPay.kind === 'Payday' ? 'payday' : 'deposit') + ' on ' + fmtDate(m.nextPay.date) + ', while still covering everything below' : 'While still covering everything below'} and keeping a ${money0(m.buffer)} cushion.</div>`;
  const whatIfNote = m.whatIfOn ? html`<div class="sub-s" style="margin-top:6px">Without your what-ifs: ${m.minBase < 0 ? html`<span class="neg">${money0(m.minBase)} at the lowest</span>` : money0(m.safeBase) + ' safe to spend'}.</div>` : '';
  const REPEAT: Record<string, string> = { once: 'once', monthly: 'every month', biweekly: 'every 2 weeks' };
  const wiRows = htmlList(m.whatIfs.map(w => html`<div class="row"><span class="name">${w.label} <span class="sub-s">${fmtDay(w.date)} · ${REPEAT[w.repeat] || 'once'}</span></span><span style="display:flex;gap:10px;align-items:center"><span class="num ${w.amount > 0 ? 'pos' : 'neg'}">${w.amount > 0 ? '+' : ''}${money(w.amount)}</span><button type="button" class="round" aria-label="Remove" data-onclick="App.fcWhatIfDel('${w.id}')">×</button></span></div>`));
  const whatIfPanel = html`<section class="panel" style="margin-bottom:20px"><h2>What if…</h2><p class="lead">Try a purchase, a raise or a new subscription and see where the balance goes. The dashed line is the forecast without them.</p>${wiRows ? html`<div class="list" style="margin-bottom:14px">${wiRows}</div>` : ''}<form class="whatif" data-onsubmit="event.preventDefault();App.fcWhatIfAdd(this)"><input type="text" name="label" placeholder="e.g. New laptop" required><select name="sign"><option value="-1">I spend</option><option value="1">I receive</option></select><input type="number" name="amount" step="0.01" min="0.01" placeholder="Amount" required><input type="date" name="date" value="${todayIso()}" required><select name="repeat">${htmlList(Object.entries(REPEAT).map(([k, l]) => opt(k, l, 'once')))}</select><button class="btn">Add</button></form></section>`;
  paint(html`${head('Forecast', 'Where ' + m.name + ' is heading over the next ' + (m.horizon === 365 ? 'year' : m.horizon === 180 ? '6 months' : m.horizon + ' days'),
      html`<select data-onchange="App.fcSet('account', this.value)" style="width:auto">${htmlList(m.banks.map(a => opt(a.id, a.name, m.sel)))}${opt('all', 'All bank accounts', m.sel)}</select><select data-onchange="App.fcSet('days', this.value)" style="width:auto">${htmlList([[30, '30 days'], [60, '60 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']].map(([d, l]) => opt(d, l, m.horizon)))}</select>`)}<section class="hero" style="margin-bottom:28px"><div>${headline}${whatIfNote}</div><div class="stats"><div class="stat"><div class="eyebrow">Balance now</div><div class="val num">${money0(m.start)}</div></div><div class="stat"><div class="eyebrow">Lowest point</div><div class="val num ${m.min < 0 ? 'neg' : ''}">${money0(m.min)}</div><div class="sub">${fmtDay(m.minDate)}</div></div><div class="stat"><div class="eyebrow">Cushion</div><div class="val num"><input type="number" min="0" step="10" value="${m.buffer}" data-onchange="App.fcBuffer(this.value)" style="width:110px;font-size:20px;padding:4px 10px"></div><div class="sub">kept aside, never counted as spendable</div></div></div></section><section class="panel chart" style="margin-bottom:20px"><h2>Projected balance</h2><div class="panel-head"><p class="lead" style="margin:0">Each dot is a scheduled payment or deposit · the shaded area is below zero</p><label class="check" style="margin:0"><input type="checkbox"${LS.get('fcBand', true) ? ' checked' : ''} data-onchange="App.fcBand(this.checked)"> Careful & hopeful</label></div>${forecastChart(m)}${LS.get('fcBand', true) ? html`<p class="sub-s" style="margin:10px 0 0">Shaded band: hopeful (bills and recurring payments 10% lower) to careful (dotted: only steady paychecks arrive and bills run 10% higher). Careful lowest point: <strong class="${m.careful.min < 0 ? 'neg' : ''}">${money0(m.careful.min)}</strong> on ${fmtDay(m.careful.minDate)} · ending ${money0(m.careful.end)} to ${money0(m.hopeful.end)}.</p>` : ''}</section>${accuracyPanel(m)}${whatIfPanel}<section class="panel flush"><div style="padding:22px 26px 6px"><h2 style="font-size:15px;margin:0 0 3px">What’s coming</h2><p class="lead" style="margin-bottom:8px">Untick anything that won’t happen — the forecast remembers.</p></div>${rows ? html`<table class="tbl"><thead><tr><th class="sel"></th><th class="hide-s">Date</th><th>What</th><th class="r">Amount</th><th class="r">Balance after</th></tr></thead><tbody>${rows}</tbody></table>` : html`<div class="center-empty">Nothing scheduled in this period.</div>`}</section><p class="sub-s" style="margin-top:14px">How this works: paydays are spotted from deposits that repeat on a schedule${m.incomes.length ? ' (' + m.incomes.map(i => i.name + ' ' + money0(i.amount) + ' ' + ({ semimonthly: 'twice a month', monthly: 'monthly', every: 'every ' + (i.p as { n?: number }).n + ' days' }[i.p.kind])).join(', ') + ')' : ''}. It adds your recurring transactions, bills, loan payments that repeat monthly, and assumes each credit card balance is paid in full on its due date — or on your next payday if the card has no due date in Firefly. Day-to-day card spending isn’t predicted: whatever you put on a card also has to come out of this “safe to spend”.</p>`);
};
function fcToggle(key: string, on: boolean) {
  const s = new Set(LS.get('fcExclude', [])); on ? s.delete(key) : s.add(key); LS.set('fcExclude', [...s]); route();
}
function fcSet(k: string, v: string) { LS.set(k === 'account' ? 'fcAccount' : 'fcDays', v); location.hash = hashWith({ [k]: v }); }
function fcWhatIfAdd(f: HTMLFormElement) {
  const amount = Math.abs(num(f.amount.value)), label = f.label.value.trim();
  if (!amount || !label || !f.date.value) return;
  LS.set('fcWhatIf', [...LS.get('fcWhatIf', []), { id: Date.now().toString(36), label, amount: amount * +f.sign.value, date: f.date.value, repeat: f.repeat.value }]);
  route();
}
function fcWhatIfDel(id: string) { LS.set('fcWhatIf', LS.get('fcWhatIf', []).filter((w: WhatIf) => w.id !== id)); route(); }
function fcBuffer(v: string) { LS.set('fcBuffer', Math.max(0, num(v))); route(); }
function fcBand(on: boolean) { LS.set('fcBand', !!on); route(); }

/* ---------- How close past forecasts came ----------
   Once a day per account, the forecast notes the balance it expects 30 days out (without what-ifs). When that day
   comes, the balance then is compared with it. Kept with the synced settings, so every device adds to the record. */
export type FcCheck = { acct: string, made: string, for: string, v: number, actual?: number };
export function logForecast(log: FcCheck[], acct: string, today: string, projected: number | undefined, balance: number) {
  let out = log.map(c => ({ ...c }));
  // Settle the ones due: today's balance stands in for a day up to 3 days late (the app wasn't opened on the day)
  out.forEach(c => { if (c.acct === acct && c.actual == null && c.for <= today && daysBetween(c.for, today) <= 3) c.actual = balance; });
  out = out.filter(c => c.actual != null || c.for >= today);
  if (projected != null && !out.some(c => c.acct === acct && c.made === today)) out.push({ acct, made: today, for: addDays(today, 30), v: Math.round(projected) });
  return out.slice(-80);
}
function accuracyPanel(m: Awaited<ReturnType<typeof forecastModel>>) {
  const done = (LS.get('fcLog', []) as FcCheck[]).filter(c => c.acct === m.sel && c.actual != null).sort((a, b) => b.for.localeCompare(a.for));
  const waiting = (LS.get('fcLog', []) as FcCheck[]).filter(c => c.acct === m.sel && c.actual == null).length;
  if (!done.length) return waiting ? html`<p class="sub-s" style="margin:-8px 0 20px">Checking accuracy: ${waiting} forecast${waiting === 1 ? '' : 's'} noted so far. The first comparison shows up 30 days after the first one.</p>` : '';
  const avg = done.reduce((s, c) => s + Math.abs(c.actual! - c.v), 0) / done.length;
  return html`<section class="panel" style="margin-bottom:20px"><div class="panel-head"><h2>How close past forecasts came</h2><span class="neutral">off by ${money0(avg)} on average</span></div><p class="lead">Each one is the balance expected 30 days ahead, next to what it really was.</p><div class="list">${htmlList(done.slice(0, 6).map(c => { const d = c.actual! - c.v; return html`<div class="row"><span class="name">${fmtDay(c.for)} <span class="sub-s">forecast on ${fmtDay(c.made)}</span></span><span class="num">${money0(c.v)} → ${money0(c.actual!)} <span class="${Math.abs(d) < 1 ? 'neutral' : d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${money0(d)}</span></span></div>`; }))}</div></section>`;
}
async function safeCard() {
  try {
    const m = await forecastModel(LS.get('fcAccount', ''), 45);
    return html`<section class="panel"><div class="panel-head"><h2>${m.short ? 'Heads up' : 'Safe to spend'}</h2><a class="link" href="#/forecast">Forecast</a></div>${m.short ? html`<div class="total num neg">${money0(-m.short)}</div><p class="sub-s" style="margin:0">${m.name} is projected to dip below zero on ${fmtDate(m.minDate)}.</p>`
        : html`<div class="total num pos">${money0(m.safe)}</div><p class="sub-s" style="margin:0">${m.nextPay ? 'Until ' + fmtDay(m.nextPay.date) + ' · ' : ''}after upcoming bills, rent, card payoffs and loan payments</p>`}</section>`;
  } catch (e) { return ''; }
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  fcToggle,
  fcSet,
  fcBuffer,
  fcBand,
  fcWhatIfAdd,
  fcWhatIfDel,
  safeCard,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

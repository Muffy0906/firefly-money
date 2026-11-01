import { type Html, html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { App, absDiff, arr, fmtDate, fmtDay, money, money0, monthRange, nowMonth, sumDiff, todayIso, type ApiData } from '../core/base';
import { head, icon } from '../core/dom';
import { normGroup } from '../core/feed';
import { addDays, daysBetween } from '../core/helpers';
import { type Lists, isAsset, isLiab, lists } from '../core/lists';
import { VIEWS } from '../core/router';
import { forecastModel } from './forecast';
import { compareRange, monthSpan } from './reports';
import { insight } from '../features/refunds';

/* ================= Ask: plain questions answered from your Firefly data =================
   No AI: the question is matched against a few kinds Money knows how to answer, and every answer shows how it was
   worked out and links to the transactions behind it. Anything else becomes a transaction search. */
type Range = { start: string, end: string, label: string };
export type Target = { kind: 'category' | 'payee' | 'tag' | 'budget', id: string, name: string };
export type Question = { intent: string, range: Range, target: Target | null, words: string };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// The period a question is about; this month when it doesn't say
export function questionRange(q: string, today: string): Range {
  const s = q.toLowerCase(), [y, m] = nowMonth(), ty = +today.slice(0, 4);
  const mr = (yy: number, mm: number, label?: string) => { const r = monthRange(yy, mm); return { start: r.start, end: r.end, label: label || r.label }; };
  let x;
  if (/\blast month\b/.test(s)) return mr(y, m - 1, 'last month');
  if (/\bthis year\b|\bso far this year\b|\bytd\b/.test(s)) return { start: ty + '-01-01', end: today, label: 'this year' };
  if (/\blast year\b/.test(s)) return { start: (ty - 1) + '-01-01', end: (ty - 1) + '-12-31', label: 'last year' };
  if (/\btoday\b/.test(s)) return { start: today, end: today, label: 'today' };
  if (/\bthis week\b/.test(s)) { const d = new Date(today + 'T12:00:00'), back = (d.getDay() + 6) % 7; return { start: addDays(today, -back), end: today, label: 'this week' }; }
  if (/\blast week\b/.test(s)) { const d = new Date(today + 'T12:00:00'), back = (d.getDay() + 6) % 7 + 7; return { start: addDays(today, -back), end: addDays(today, -back + 6), label: 'last week' }; }
  if ((x = /\b(?:last|past) (\d{1,3}) days\b/.exec(s))) return { start: addDays(today, -(+x[1] - 1)), end: today, label: 'the last ' + x[1] + ' days' };
  if ((x = /\b(?:last|past) (\d{1,2}) months\b/.exec(s))) { const a = monthRange(y, m - +x[1] + 1); return { start: a.start, end: today, label: 'the last ' + x[1] + ' months' }; }
  const mi = MONTHS.findIndex(n => new RegExp('\\b' + n + '\\b|\\b' + n.slice(0, 3) + '\\b').test(s.replace(/\bmay i\b/, '')));
  if (mi >= 0) {
    const yr = /\b(20\d\d)\b/.exec(s), yy = yr ? +yr[1] : (mi > +today.slice(5, 7) - 1 ? ty - 1 : ty);
    return mr(yy, mi);
  }
  return mr(y, m, 'this month');
}
// The category, payee, tag or budget a question names: the longest name found in it
export function questionTarget(q: string, L: Pick<Lists, 'categories' | 'expense' | 'tags' | 'budgets'>): Target | null {
  const s = ' ' + q.toLowerCase().replace(/[?.!,]/g, ' ') + ' ';
  const pool: Target[] = [
    ...L.categories.map(c => ({ kind: 'category' as const, id: c.id, name: c.name })), ...L.budgets.map(b => ({ kind: 'budget' as const, id: b.id, name: b.name })),
    ...L.tags.map(t => ({ kind: 'tag' as const, id: t.id, name: t.name })), ...L.expense.map(a => ({ kind: 'payee' as const, id: a.id, name: a.name })),
  ].filter(t => t.name && t.name.length >= 3);
  const hits = pool.filter(t => s.includes(' ' + t.name.toLowerCase() + ' ') || s.includes(' ' + t.name.toLowerCase() + 's '));
  return hits.sort((a, b) => b.name.length - a.name.length)[0] || null;
}
export function parseQuestion(q: string, L: Pick<Lists, 'categories' | 'expense' | 'tags' | 'budgets'>, today: string): Question {
  const s = q.toLowerCase(), range = questionRange(q, today), target = questionTarget(q, L);
  const words = s.replace(/[?!.]/g, '').trim();
  let intent = 'search';
  if (/\bbills?\b.*\b(before|until|till)\b.*\bpay/.test(s) || /\bdue before\b/.test(s)) intent = 'bills';
  else if (/\bsafe to spend\b|\bcan i (spend|afford)\b|\bhow much (can|do) i have\b/.test(s)) intent = 'safe';
  else if (/\bnet worth\b|\bwhat am i worth\b/.test(s)) intent = 'networth';
  else if (/\bwhy\b|\bwent up\b|\bmore than\b|\bless than\b|\bincrease|\bcompare/.test(s) && /spen[dt]|spending|cost|expens/.test(s)) intent = 'why';
  else if (/\b(biggest|largest|most expensive|top)\b.*\b(expense|purchase|transaction|payment|spend)/.test(s)) intent = 'biggest';
  else if (/\bwhere\b.*\b(money|spend|spent)\b|\btop (categories|payees)\b|\bwhat did i spend (on|most)\b/.test(s)) intent = 'where';
  else if (/\b(earn|earned|income|made|paid me|salary)\b/.test(s)) intent = 'income';
  else if (/spen[dt]|spending|cost|pay(ed)? for|paid/.test(s)) intent = target ? 'spentOn' : 'spent';
  return { intent, range, target, words };
}

type Answer = { title: Html | string, lines?: Html[], how: string, more?: { label: string, href: string } };
const row = (name: Html | string, value: Html | string, href?: string) => href
  ? html`<a class="row" href="${href}"><span class="name">${name}</span><span class="num">${value}</span></a>`
  : html`<div class="row"><span class="name">${name}</span><span class="num">${value}</span></div>`;
const rangeQ = (r: Range) => 'start=' + r.start + '&end=' + r.end;
const linkFor = (t: Target) => t.kind === 'payee' ? '#/account/' + t.id : '#/transactions?' + t.kind + '=' + t.id;
const INSIGHT: Record<string, string> = { category: '/insight/expense/category', payee: '/insight/expense/expense', tag: '/insight/expense/tag', budget: '/insight/expense/budget' };
const sumOf = (res: ApiData, t: Target) => arr(res).filter(x => String(x.id) === t.id || x.name === t.name).reduce((s, x) => s + absDiff(x), 0);
const pctText = (now: number, was: number) => was ? (now >= was ? '+' : '−') + Math.abs(Math.round((now - was) / was * 100)) + '%' : 'new';

async function answer(q: Question, L: Lists): Promise<Answer> {
  const r = q.range, p = { start: r.start, end: r.end };
  if (q.intent === 'spentOn' && q.target) {
    const t = q.target, prevM = monthRange(...nowMonth()).start === r.start ? monthRange(nowMonth()[0], nowMonth()[1] - 1) : null;
    const [now, before] = await Promise.all([api(INSIGHT[t.kind], { params: p }), prevM ? api(INSIGHT[t.kind], { params: { start: prevM.start, end: prevM.end } }).catch(() => null) : null]);
    const v = sumOf(now, t), b = before ? sumOf(before, t) : null;
    return { title: html`You spent <strong>${money(v)}</strong> on ${t.name} ${r.label}.`,
      lines: b != null ? [row('Last month', money(b) + ' (' + pctText(v, b) + ')')] : [],
      how: 'Expenses in the ' + t.kind + ' “' + t.name + '” from ' + fmtDate(r.start) + ' to ' + fmtDate(r.end) + ', summed by Firefly.',
      more: { label: 'See the transactions', href: linkFor(t) } };
  }
  if (q.intent === 'spent' || q.intent === 'income') {
    const kind = q.intent === 'income' ? 'income' : 'expense', res = await insight('/insight/' + kind + '/total', p), v = sumDiff(res);
    const top = await insight(kind === 'income' ? '/insight/income/revenue' : '/insight/expense/category', p).catch(() => []);
    return { title: html`You ${kind === 'income' ? 'earned' : 'spent'} <strong>${money(v)}</strong> ${r.label}.`,
      lines: arr(top).sort((a, b) => absDiff(b) - absDiff(a)).slice(0, 5).map(x => row(x.name, money0(absDiff(x)), kind === 'income' ? '#/account/' + x.id : '#/transactions?category=' + x.id)),
      how: 'All ' + (kind === 'income' ? 'deposits' : 'withdrawals') + ' from ' + fmtDate(r.start) + ' to ' + fmtDate(r.end) + '; transfers between your own accounts don’t count. Biggest ' + (kind === 'income' ? 'sources' : 'categories') + ' below.',
      more: { label: 'Open the report', href: '#/reports?' + rangeQ(r) } };
  }
  if (q.intent === 'why' || q.intent === 'where') {
    // Compare with the month (or the days) just before; for a month still under way, only its days so far against the same days of the one before
    const t = todayIso(), cmp = compareRange(r.start, r.end, 'prev')!, sofar = r.start <= t && r.end > t;
    if (sofar) { const gone = daysBetween(r.start, t); p.end = t; cmp.end = addDays(cmp.start, gone) < cmp.end ? addDays(cmp.start, gone) : cmp.end; }
    const before = cmp, n = daysBetween(p.start, p.end) + 1, againstLabel = monthSpan(r.start, r.end) ? (sofar ? 'the same days last month' : 'the month before') : 'the ' + n + ' days before';
    const [cNow, cWas, tNow, tWas] = await Promise.all([insight('/insight/expense/category', p), insight('/insight/expense/category', before).catch(() => []),
      insight('/insight/expense/total', p), insight('/insight/expense/total', before).catch(() => [])]);
    const now = sumDiff(tNow), was = sumDiff(tWas), names = new Map<string, { id: string, now: number, was: number }>();
    arr(cNow).forEach(x => names.set(x.name, { id: x.id, now: absDiff(x), was: 0 }));
    arr(cWas).forEach(x => { const e = names.get(x.name) || { id: x.id, now: 0, was: 0 }; e.was = absDiff(x); names.set(x.name, e); });
    const list = [...names.entries()].map(([name, e]) => ({ name, ...e, d: e.now - e.was }));
    if (q.intent === 'where') {
      return { title: html`You spent <strong>${money(now)}</strong> ${r.label}. Here’s where it went.`,
        lines: list.sort((a, b) => b.now - a.now).filter(x => x.now > 0).slice(0, 8).map(x => row(x.name, money0(x.now) + (now ? ' · ' + Math.round(x.now / now * 100) + '%' : ''), '#/transactions?category=' + x.id)),
        how: 'Withdrawals by category from ' + fmtDate(r.start) + ' to ' + fmtDate(r.end) + '.', more: { label: 'Open the report', href: '#/reports?' + rangeQ(r) } };
    }
    const up = now >= was, movers = list.sort((a, b) => up ? b.d - a.d : a.d - b.d).filter(x => up ? x.d > 0 : x.d < 0).slice(0, 5);
    const title = Math.abs(now - was) < 1 ? html`You spent about the same ${r.label}${sofar ? ' so far' : ''} as ${againstLabel} (${money0(now)}).`
      : html`You spent <strong>${money0(Math.abs(now - was))} ${up ? 'more' : 'less'}</strong> ${r.label}${sofar ? ' so far' : ''} than ${againstLabel}: ${money0(now)} vs ${money0(was)}.${movers.length ? html` Mostly ${up ? 'from' : 'in'} ${movers.slice(0, 2).map(x => x.name).join(' and ')}.` : ''}`;
    return { title, lines: movers.map(x => row(x.name, html`${money0(x.was)} → ${money0(x.now)} <span class="${x.d > 0 ? 'neg' : 'pos'}">${x.d > 0 ? '+' : '−'}${money0(Math.abs(x.d))}</span>`, '#/transactions?category=' + x.id)),
      how: 'Spending by category ' + fmtDay(p.start) + ' – ' + fmtDay(p.end) + ' compared with ' + fmtDay(before.start) + ' – ' + fmtDay(before.end) + ', biggest changes first.',
      more: { label: 'Compare in Reports', href: '#/reports?' + rangeQ(r) + '&cmp=prev' } };
  }
  if (q.intent === 'biggest') {
    const txs = (await getAll('/transactions', { type: 'withdrawal', ...p })).map(normGroup).sort((a, b) => b.total - a.total).slice(0, 5);
    if (!txs.length) return { title: 'Nothing was spent ' + r.label + '.', how: 'Withdrawals from ' + fmtDate(r.start) + ' to ' + fmtDate(r.end) + '.' };
    return { title: html`Your biggest expense ${r.label} was <strong>${money(txs[0].total)}</strong>: ${txs[0].title || txs[0].splits[0].description} on ${fmtDay(txs[0].date)}.`,
      lines: txs.map(g => html`<button type="button" class="row link" data-onclick="App.editTx('${g.id}')"><span class="name">${g.title || g.splits[0].description} <span class="sub-s">${fmtDay(g.date)}</span></span><span class="num">${money(g.total)}</span></button>`),
      how: 'Every withdrawal from ' + fmtDate(r.start) + ' to ' + fmtDate(r.end) + ', largest first.' };
  }
  if (q.intent === 'bills' || q.intent === 'safe') {
    const m = await forecastModel('', 60);
    if (q.intent === 'safe') return { title: m.short ? html`Careful: ${m.name} is projected to go <strong>${money0(m.short)} below zero</strong> on ${fmtDay(m.minDate)}.` : html`About <strong>${money0(m.safe)}</strong> is safe to spend from ${m.name}${m.nextPay ? ' until ' + fmtDay(m.nextPay.date) : ''}.`,
      how: 'Balance now (' + money0(m.start) + ') through the lowest point in the next 60 days (' + money0(m.min) + '), minus your ' + money0(m.buffer) + ' cushion. Bills, recurring payments, card payoffs and loans are counted.',
      more: { label: 'Open the forecast', href: '#/forecast' } };
    const until = m.nextPay ? m.nextPay.date : addDays(todayIso(), 14), due = m.ev.filter(e => !e.off && e.amount < 0 && e.date < until);
    const total = due.reduce((s, e) => s + e.amount, 0);
    return { title: due.length ? html`${due.length} payment${due.length === 1 ? '' : 's'} totalling <strong>${money0(-total)}</strong> ${due.length === 1 ? 'is' : 'are'} due before ${m.nextPay ? 'your next payday on ' + fmtDay(until) : fmtDay(until)}.` : html`Nothing is due before ${m.nextPay ? 'your next payday on ' + fmtDay(until) : fmtDay(until)}.`,
      lines: due.map(e => row(html`${e.label} <span class="sub-s">${fmtDay(e.date)} · ${e.kind}</span>`, money(e.amount))),
      how: m.nextPay ? 'Payday spotted from deposits that repeat (' + m.nextPay.label + '). Bills, recurring payments, card payoffs and loan payments from ' + m.name + ' before then.' : 'No payday spotted, so this shows the next 14 days.',
      more: { label: 'Open the forecast', href: '#/forecast' } };
  }
  if (q.intent === 'networth') {
    const own = L.accounts.filter(a => a.active && (isAsset(a) || isLiab(a))), assets = own.filter(isAsset).reduce((s, a) => s + a.balance, 0), debts = own.filter(isLiab).reduce((s, a) => s + a.balance, 0);
    return { title: html`Your net worth is <strong>${money0(assets + debts)}</strong>.`, lines: [row('Accounts', money0(assets)), row('Loans & debts', money0(debts))],
      how: 'Today’s balances of your active accounts, cards and loans in ' + 'your main currency, added up.', more: { label: 'Accounts', href: '#/accounts' } };
  }
  return { title: html`I couldn’t read that as a question I know, so here’s a search for it.`, how: 'Try one of the examples below.', more: { label: 'Search transactions for “' + q.words + '”', href: '#/transactions?search=' + encodeURIComponent(q.words) } };
}
const EXAMPLES = ['Why did I spend more this month?', 'Which bills are due before payday?', 'How much can I spend?', 'Where did my money go last month?',
  'How much did I spend on groceries this year?', 'What was my biggest expense last month?', 'How much did I earn this year?', 'What is my net worth?'];
VIEWS.ask = async (r, paint) => {
  const L = await lists(), text = (r.q.q || '').trim();
  let out: Html | string = '';
  if (text) {
    const q = parseQuestion(text, L, todayIso());
    try {
      const a = await answer(q, L);
      out = html`<section class="panel ask-answer"><div class="eyebrow">${text}</div><p class="ask-title">${a.title}</p>${a.lines && a.lines.length ? html`<div class="list">${htmlList(a.lines)}</div>` : ''}<p class="sub-s" style="margin-top:12px"><strong>How this was worked out:</strong> ${a.how}</p>${a.more ? html`<a class="btn small" href="${a.more.href}" style="margin-top:6px">${a.more.label} →</a>` : ''}</section>`;
    } catch (e) { out = html`<section class="panel"><p class="form-err">${(e as Error).message}</p></section>`; }
  }
  paint(html`${head('Ask', 'Plain questions, answered from your Firefly data')}<form class="ask" data-onsubmit="event.preventDefault();App.ask(this.q.value)">${icon('spark')}<input type="text" id="askQ" name="q" value="${text}" placeholder="Ask about your money, e.g. why did I spend more this month?" autocomplete="off" enterkeyhint="go"></form>${out}<div class="ask-examples">${htmlList(EXAMPLES.map(x => html`<button type="button" class="chip" data-onclick="App.ask(this.textContent)">${x}</button>`))}</div>`);
};
function ask(q: string) { const t = String(q || '').trim(); if (t) location.hash = '#/ask?q=' + encodeURIComponent(t); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  ask,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

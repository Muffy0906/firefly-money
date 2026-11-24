import { type Html, html, htmlList } from '../core/html';
import { App, money0, parseIso, S, todayIso, weekdayOf } from '../core/base';
import { PAGES } from '../core/api';
import { ICON_X } from '../core/dom';
import { LS, addDays, daysBetween } from '../core/helpers';
import { route } from '../core/router';

/* ================= Habits: small wins and a short to-do on the Overview =================
   Streaks, this week's two challenges, a few things to do today and one fun fact, all worked out here from the past
   13 weeks of purchases and what the Overview already holds. Nothing is kept and nothing is fetched beyond those
   purchases; Firefly not answering means no card at all (never an old copy). Calm by design: a streak that is at
   zero is simply not shown. The maths is pure and tested in test/habits.test.ts. */
export const HABIT_DAYS = 91;
export type Buy = { date: string, amount: number, category: string };
export type NwPoint = { date: string, net: number };
export type Goal = { name: string, target: number, current: number, active: boolean };
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
export const habitsOn = () => LS.get('habits', true) !== false;
export const habitsHiddenToday = () => LS.get('habitsHide', '') === todayIso();
const mondayOf = (d: string) => addDays(d, -weekdayOf(parseIso(d)));
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export type Habits = {
  from: string,                                    // the first day counted: the first purchase in the window
  categorized: number,                             // days in a row, up to today, with every purchase categorized
  uncategorized: number,                           // purchases in the window with no category
  quietMonth: number, quietWeek: number,           // days with no purchases so far this month / this week (today not counted)
  quietRun: number,                                // the longest run of them in the window
  underWeeks: number,                              // complete weeks in a row at or under the usual week
  usual: number | null,                            // the usual week's spending (the median), once there are four complete weeks
  week: { spent: number, elapsed: number, onTrack: boolean } | null,
  facts: string[],
};
export function habitStats(buys: Buy[], today: string): Habits | null {
  const start = addDays(today, -(HABIT_DAYS - 1)), byDay = new Map<string, { total: number, bare: number }>();
  for (const b of buys) {
    const d = String(b.date).slice(0, 10);
    if (d < start || d > today || !(b.amount > 0)) continue;
    const c = byDay.get(d) || { total: 0, bare: 0 }; c.total += b.amount; if (!b.category) c.bare++; byDay.set(d, c);
  }
  const first = [...byDay.keys()].sort()[0];
  if (!first) return null;
  const from = first;
  // Days with no purchase: only whole days after the first purchase, and not today (it isn't over)
  const quiet = (d: string) => !byDay.has(d);
  let run = 0, quietRun = 0, quietMonth = 0, quietWeek = 0;
  const mon = mondayOf(today), ym = today.slice(0, 7);
  for (let d = from; d < today; d = addDays(d, 1)) {
    if (quiet(d)) { run++; quietRun = Math.max(quietRun, run); if (d.startsWith(ym)) quietMonth++; if (d >= mon) quietWeek++; } else run = 0;
  }
  let categorized = 0;
  for (let d = today; d >= from; d = addDays(d, -1)) { if ((byDay.get(d) || { bare: 0 }).bare) break; categorized++; }
  const uncategorized = [...byDay.values()].reduce((s, c) => s + c.bare, 0);
  // Complete weeks (Monday to Sunday) that start on or after the first purchase
  const weeks: number[] = [];
  for (let ws = mondayOf(addDays(from, 6)); addDays(ws, 6) < mon; ws = addDays(ws, 7)) {
    let t = 0; for (let i = 0; i < 7; i++) t += (byDay.get(addDays(ws, i)) || { total: 0 }).total;
    weeks.push(t);
  }
  const usual = weeks.length >= 4 ? median(weeks) : null;
  let underWeeks = 0;
  if (usual !== null) for (let i = weeks.length - 1; i >= 0 && weeks[i] <= usual; i--) underWeeks++;
  let spent = 0; for (let d = mon; d <= today; d = addDays(d, 1)) spent += (byDay.get(d) || { total: 0 }).total;
  const elapsed = daysBetween(mon, today) + 1;
  const week = usual !== null ? { spent, elapsed, onTrack: spent <= usual * elapsed / 7 } : null;

  // A few fun facts; one shows each day
  const facts: string[] = [];
  const mStart = today.slice(0, 8) + '01', lastEnd = addDays(mStart, -1), lastStart = lastEnd.slice(0, 8) + '01';
  const sum = (a: string, b: string) => { let t = 0; for (let d = a; d <= b; d = addDays(d, 1)) t += (byDay.get(d) || { total: 0 }).total; return t; };
  if (from <= lastStart) {
    const nowAvg = sum(mStart, today) / (daysBetween(mStart, today) + 1), lastAvg = sum(lastStart, lastEnd) / (daysBetween(lastStart, lastEnd) + 1);
    if (nowAvg > 0 && lastAvg > 0) facts.push('An average day this month: ' + money0(nowAvg) + ' so far, ' + money0(lastAvg) + ' last month.');
  }
  if (daysBetween(from, today) >= 28) {
    const tot = Array(7).fill(0), n = Array(7).fill(0);
    for (let d = from; d <= today; d = addDays(d, 1)) { const w = parseIso(d).getDay(); tot[w] += (byDay.get(d) || { total: 0 }).total; n[w]++; }
    const avg = tot.map((t, i) => t / n[i]), lo = avg.indexOf(Math.min(...avg));
    if (avg[lo] > 0) facts.push(WEEKDAYS[lo] + ' are your quietest day: about ' + money0(avg[lo]) + ' on average.');
  }
  if (quietRun >= 2) facts.push('Your longest stretch with no purchases lately: ' + quietRun + ' days.');
  return { from, categorized, uncategorized, quietMonth, quietWeek, quietRun, underWeeks, usual, week, facts };
}

// The nearest round number (1, 2 or 5 times a power of ten) between where net worth stood a month ago and where it is now
export function nwMilestone(pts: NwPoint[] | null | undefined, today: string): number | null {
  if (!pts || pts.length < 2) return null;
  const recent = pts.filter(p => p.date >= addDays(today, -31));
  if (recent.length < 2) return null;
  const a = recent[0].net, b = recent[recent.length - 1].net;
  if (!(b > a) || b < 1000) return null;
  let best: number | null = null;
  for (let p = 1000; p <= b * 10; p *= 10) for (const m of [1, 2, 5]) { const t = m * p; if (t > a && t <= b) best = best === null ? t : Math.max(best, t); }
  return best;
}
// The goal closest to the finish, once it is more than half there
export function nearGoal(goals: Goal[] | null | undefined): { name: string, pct: number } | null {
  const near = (goals || []).filter(g => g.active && g.target > 0 && g.current < g.target && g.current / g.target >= .5)
    .map(g => ({ name: g.name, pct: Math.floor(g.current / g.target * 100) })).sort((x, y) => y.pct - x.pct);
  return near[0] || null;
}

export type Todo = { text: string, done: boolean, href?: string };
export type TodoIn = { uncat: number, billsDue: number | null, atRisk: string[] | null, drafts: number };
export function habitTodo(t: TodoIn): Todo[] {
  const s = (n: number) => n === 1 ? '' : 's';
  const out: Todo[] = [t.uncat ? { text: 'Categorize ' + t.uncat + ' expense' + s(t.uncat), done: false, href: '#/inbox' } : { text: 'Everything is categorized', done: true }];
  if (t.billsDue !== null) out.push(t.billsDue ? { text: t.billsDue + ' bill' + s(t.billsDue) + ' due this week', done: false, href: '#/bills' } : { text: 'No bills due this week', done: true });
  if (t.atRisk !== null) out.push(t.atRisk.length ? { text: t.atRisk.length === 1 ? 'Check the ' + t.atRisk[0] + ' budget' : 'Check ' + t.atRisk.length + ' budgets', done: false, href: '#/budgets' } : { text: 'Budgets are on track', done: true });
  if (t.drafts) out.push({ text: 'Finish ' + t.drafts + ' draft' + s(t.drafts), done: false, href: '#/transactions' });
  return out;
}

export type HabitsIn = { stats: Habits | null, todo: TodoIn, nw?: NwPoint[] | null, goals?: Goal[] | null, today: string };
const check = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>`;
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
function row(r: Todo): Html {
  const body = html`<span class="st-ck" aria-hidden="true">${r.done ? check : ''}</span><span class="hb-t">${r.text}</span>${r.href ? html`<span class="neutral" aria-hidden="true">→</span>` : ''}`;
  return r.href ? html`<li class="${r.done ? 'done' : ''}"><a href="${r.href}">${body}</a></li>` : html`<li class="${r.done ? 'done' : ''}">${body}</li>`;
}
export function habitsPanel({ stats, todo, nw, goals, today }: HabitsIn): Html {
  const stat = (label: string, val: string) => html`<div><dt>${label}</dt><dd class="num">${val}</dd></div>`;
  const chips: Html[] = [];
  if (stats) {
    if (stats.categorized >= 2) chips.push(stat('Everything categorized', plural(stats.categorized, 'day')));
    if (stats.quietMonth >= 1) chips.push(stat('No-spend days', stats.quietMonth + ' this month'));
    if (stats.underWeeks >= 2) chips.push(stat('At or under your usual week', plural(stats.underWeeks, 'week') + ' in a row'));
  }
  const challenges: Todo[] = [];
  if (stats) {
    challenges.push({ text: stats.quietWeek ? 'A no-spend day this week' : 'One no-spend day this week', done: stats.quietWeek > 0 });
    if (stats.week && stats.usual !== null) challenges.push({ text: stats.week.onTrack ? 'On track for a week at or under your usual' : 'Above your usual pace so far this week', done: stats.week.onTrack });
  }
  const m = nwMilestone(nw, today), g = nearGoal(goals);
  const day = daysBetween(today.slice(0, 4) + '-01-01', today);
  const note = m !== null ? 'Net worth passed ' + money0(m) + ' this month.' : g ? g.name + ' is ' + g.pct + '% of the way there.' : stats && stats.facts.length ? stats.facts[day % stats.facts.length] : '';
  const wk = stats && stats.week ? html`<span class="sub-s">${money0(stats.week.spent)} of about ${money0(stats.usual!)} so far</span>` : '';
  return html`<section class="panel habits" id="habits"><div class="panel-head"><div><h2>Habits</h2><p class="lead">Small wins, no pressure</p></div><button type="button" class="round" aria-label="Hide habits for today" title="Hide for today" data-onclick="App.habitsHide()">${ICON_X}</button></div>
${chips.length ? html`<dl class="bi-stats hb-stats">${htmlList(chips)}</dl>` : ''}
<div class="hb-cols">${challenges.length ? html`<div><h3 class="hb-h">This week ${wk}</h3><ul class="st-list hb-list">${htmlList(challenges.map(row))}</ul></div>` : ''}
<div><h3 class="hb-h">To do</h3><ul class="st-list hb-list">${htmlList(habitTodo(todo).map(row))}</ul></div></div>
${note ? html`<p class="sub-s hb-note">${note}</p>` : ''}</section>`;
}

function habitsHide() { LS.set('habitsHide', todayIso()); S.pageKey = ''; PAGES.clear(); route(); }
function toggleHabits(on: boolean) { LS.set('habits', !!on); if (on) LS.set('habitsHide', ''); }
const methods = { habitsHide, toggleHabits };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

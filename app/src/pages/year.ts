import { type Html, html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, absDiff, arr, fmtDate, fmtDay, isoDate, money, money0, sumDiff, todayIso } from '../core/base';
import { toast } from '../core/dom';
import { nameAvatar, normGroup } from '../core/feed';
import { buzz } from '../core/haptics';
import { addDays, daysBetween } from '../core/helpers';
import { lists } from '../core/lists';
import { VIEWS, parseHash } from '../core/router';
import { workHours } from '../core/worklens';
import { insight, refundsIn } from '../features/refunds';
import { netOn } from './recap';

/* ================= Year in Money =================
   A year told as a story, one full-screen card at a time, like Instagram's: what came in and went out, how much of a
   workday paid for your spending, your top category and places, your biggest month and purchase, days you spent
   nothing, and how far your net worth moved. Tap the right side (or swipe left) for the next card, the left side for
   the one before; hold to pause. #/year shows this year so far, #/year?y=2025 another. */
export type YearSplit = { date: string, amount: number, payee: string, description: string };
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
// The numbers the story tells that come from the purchases themselves (start and end: the days the year covers)
export function yearStats(splits: YearSplit[], start: string, end: string) {
  const byPayee = new Map<string, { name: string, n: number, v: number }>(), byDay = new Map<string, number>(), byWd = Array(7).fill(0);
  for (const s of splits) {
    const k = s.payee.trim().toLowerCase(), p = byPayee.get(k) || { name: s.payee.trim(), n: 0, v: 0 };
    p.n++; p.v += s.amount; byPayee.set(k, p);
    const d = s.date.slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + s.amount);
    byWd[new Date(d + 'T12:00:00').getDay()] += s.amount;
  }
  const places = [...byPayee.values()].filter(p => p.name);
  const often = [...places].sort((a, b) => b.n - a.n || b.v - a.v)[0] || null;
  const top = [...places].sort((a, b) => b.v - a.v).slice(0, 5);
  const biggest = splits.reduce<YearSplit | null>((b, s) => !b || s.amount > b.amount ? s : b, null);
  // Days without a single purchase, and the longest run of them
  let free = 0, run = 0, best = 0, bestEnd = '';
  for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) {
    if (byDay.has(d)) { run = 0; continue; }
    free++; run++; if (run > best) { best = run; bestEnd = d; }
  }
  const wd = byWd.indexOf(Math.max(...byWd));
  return { count: splits.length, often, top, biggest, free, streak: best, streakEnd: bestEnd, weekday: splits.length ? WEEKDAYS[wd] : '', days: daysBetween(start, end) + 1 };
}

// A number that counts up when its card comes on screen (see play below)
const count = (v: number, fmt: 'money' | 'int' | 'pct' = 'money') => html`<span class="st-count num" data-v="${v}" data-f="${fmt}">${fmt === 'money' ? money0(v) : fmt === 'pct' ? Math.round(v) + '%' : Math.round(v).toLocaleString('en-US')}</span>`;
const card = (hue: number, body: Html) => html`<section class="st-card" style="--h1:${hue};--h2:${(hue + 48) % 360}">${body}</section>`;
const line = (i: number, body: unknown, cls = '') => html`<div class="st-in ${cls}" style="--d:${i}">${body}</div>`;

VIEWS.year = async (r, paint) => {
  await lists();
  const t = todayIso(), thisY = +t.slice(0, 4), y = Math.min(thisY, Math.max(1990, +r.q.y || thisY));
  const start = y + '-01-01', yearEnd = y + '-12-31', end = yearEnd < t ? yearEnd : t, done = end === yearEnd;
  const months = [...Array(12)].map((_, i) => ({ i, start: y + '-' + String(i + 1).padStart(2, '0') + '-01', end: isoDate(new Date(y, i + 1, 0, 12)) }))
    .map(m => ({ ...m, end: m.end > end ? end : m.end })).filter(m => m.start <= end);
  const rs = refundsIn(start, end), p = { start, end };
  const [inc, exp, cats, noCat, spends, perMonth, nwStart, nwEnd] = await Promise.all([
    insight('/insight/income/total', p, rs).catch(() => []), insight('/insight/expense/total', p, rs).catch(() => []),
    insight('/insight/expense/category', p, rs).catch(() => []), insight('/insight/expense/no-category', p, rs).catch(() => []),
    getAll('/transactions', { start, end, type: 'withdrawal' }).catch(() => []),
    Promise.all(months.map(m => insight('/insight/expense/total', m, rs).then(sumDiff).catch(() => 0))),
    netOn(addDays(start, -1)).catch(() => null), netOn(end).catch(() => null),
  ]);
  const earned = sumDiff(inc), spent = sumDiff(exp), kept = earned - spent;
  const splits: YearSplit[] = spends.map(normGroup).flatMap(g => g.splits.filter(s => s.type === 'withdrawal')
    .map(s => ({ date: s.date, amount: s.amount, payee: s.destination_name || s.description, description: s.description })));
  const st = yearStats(splits, start, end);
  const catRows = arr(cats).map(x => ({ name: x.name as string, v: absDiff(x) })).concat(sumDiff(noCat) ? [{ name: 'Uncategorized', v: sumDiff(noCat) }] : [])
    .filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const span = done ? 'the whole year' : fmtDay(start) + ' – ' + fmtDay(end);

  const cards: Html[] = [];
  const nav = html`<div class="st-years">${y > 1990 ? html`<a class="st-yr" href="#/year?y=${y - 1}">‹ ${y - 1}</a>` : ''}${y < thisY ? html`<a class="st-yr" href="#/year?y=${y + 1}">${y + 1} ›</a>` : ''}</div>`;
  cards.push(card(262, html`${line(0, html`<div class="st-kick">Year in Money</div>`)}${line(1, html`<h1 class="st-big">${y}</h1>`)}${line(2, html`<p class="st-p">${done ? 'Your year, told in a few cards.' : 'Your year so far, ' + span + '.'}</p>`)}${line(3, html`<p class="st-hint">Tap to begin</p>`)}${line(4, nav)}`));
  if (!splits.length && !earned) {
    cards.push(card(210, html`${line(0, html`<h2 class="st-h">Nothing here yet</h2>`)}${line(1, html`<p class="st-p">There are no transactions in ${y}. Try another year.</p>`)}${line(2, nav)}`));
  } else {
    if (earned || spent) cards.push(card(150, html`${line(0, html`<div class="st-kick">In and out</div>`)}${earned ? line(1, html`<p class="st-p">You earned</p><div class="st-num">${count(earned)}</div>`) : ''}${line(2, html`<p class="st-p">and spent</p><div class="st-num">${count(spent)}</div>`)}${earned ? line(3, html`<p class="st-p">${kept >= 0 ? html`You kept <strong>${count(kept / earned * 100, 'pct')}</strong> of it: ${money0(kept)}.` : html`That’s ${money0(-kept)} more than came in.`}</p>`) : ''}`));
    if (earned > 0 && spent > 0) {
      const day = workHours() / 5, share = Math.min(1, spent / earned), hrs = share * day;
      const worked = workHours() * st.days / 7, paid = share * worked;
      cards.push(card(28, html`${line(0, html`<div class="st-kick">Your workday</div>`)}${line(1, html`<p class="st-p">Of every ${Math.round(day * 10) / 10}-hour workday,</p><div class="st-num">${count(Math.round(hrs * 10) / 10, 'int')}<small> hours</small></div><p class="st-p">${share >= 1 ? 'and more went to what you bought.' : 'went to what you bought.'}</p>`)}${line(2, html`<div class="st-day" style="--p:${(share * 100).toFixed(1)}%"><i></i></div>`)}${line(3, html`<p class="st-p">That’s about <strong>${Math.round(paid).toLocaleString('en-US')} hours</strong> of work, at ${workHours()} a week.</p>`)}`));
    }
    if (catRows.length) {
      const c0 = catRows[0], max = c0.v;
      cards.push(card(330, html`${line(0, html`<div class="st-kick">Top category</div>`)}${line(1, html`<h2 class="st-h">${c0.name}</h2><div class="st-num">${count(c0.v)}</div><p class="st-p">${Math.round(c0.v / spent * 100)}% of everything you spent</p>`)}${line(2, html`<div class="st-bars">${htmlList(catRows.slice(0, 5).map((c, i) => html`<div class="st-bar" style="--w:${(c.v / max * 100).toFixed(1)}%;--j:${i}"><span>${c.name}</span><b class="num">${money0(c.v)}</b></div>`))}</div>`)}`));
    }
    if (st.often) cards.push(card(190, html`${line(0, html`<div class="st-kick">Your places</div>`)}${line(1, html`<p class="st-p">You went to</p><h2 class="st-h">${st.often.name}</h2><div class="st-num">${count(st.often.n, 'int')}<small> times</small></div><p class="st-p">${money0(st.often.v)} in all</p>`)}${line(2, html`<div class="st-list">${htmlList(st.top.map(p => html`<div class="st-row">${nameAvatar(p.name, 'sm')}<span>${p.name}</span><b class="num">${money0(p.v)}</b></div>`))}</div>`)}`));
    const full = perMonth.map((v, i) => ({ v, i })).filter(m => m.v > 0);
    if (full.length >= 2) {
      const hi = full.reduce((a, b) => b.v > a.v ? b : a), done12 = full.filter(m => months[m.i].end < end || done), lo = done12.length >= 2 ? done12.reduce((a, b) => b.v < a.v ? b : a) : null;
      const name = (i: number) => new Date(y, i, 1).toLocaleString('en-US', { month: 'long' }), max = hi.v;
      cards.push(card(48, html`${line(0, html`<div class="st-kick">Month by month</div>`)}${line(1, html`<h2 class="st-h">${name(hi.i)}</h2><p class="st-p">was your biggest month: ${money0(hi.v)}</p>`)}${line(2, html`<div class="st-months">${htmlList([...Array(12)].map((_, i) => { const v = perMonth[i] || 0; return html`<div class="${i === hi.i ? 'hi' : ''}${i >= perMonth.length ? ' fut' : ''}" style="--v:${(v / max * 100).toFixed(1)}%;--j:${i}"><i></i><span>${name(i)[0]}</span></div>`; }))}</div>`)}${lo && lo.i !== hi.i ? line(3, html`<p class="st-p">The calmest was ${name(lo.i)}, at ${money0(lo.v)}.</p>`) : ''}`));
    }
    if (st.biggest) cards.push(card(0, html`${line(0, html`<div class="st-kick">Biggest purchase</div>`)}${line(1, html`<div class="st-num">${count(st.biggest.amount)}</div><h2 class="st-h">${st.biggest.description}</h2><p class="st-p">${st.biggest.payee !== st.biggest.description ? st.biggest.payee + ', ' : ''}${fmtDate(st.biggest.date)}</p>`)}${line(2, html`<p class="st-p">One of ${st.count.toLocaleString('en-US')} purchases, ${money(spent / Math.max(1, st.count))} on average.</p>`)}`));
    if (st.count) cards.push(card(120, html`${line(0, html`<div class="st-kick">Days off</div>`)}${line(1, html`<div class="st-num">${count(st.free, 'int')}</div><p class="st-p">days you didn’t buy a thing</p>`)}${st.streak >= 2 ? line(2, html`<p class="st-p">Your longest run was <strong>${st.streak} days</strong>, up to ${fmtDay(st.streakEnd)}.</p>`) : ''}${st.weekday ? line(3, html`<p class="st-p">You spend the most on <strong>${st.weekday}</strong>.</p>`) : ''}`));
    if (nwStart != null && nwEnd != null && (nwStart || nwEnd)) {
      const d = nwEnd - nwStart;
      cards.push(card(d >= 0 ? 140 : 350, html`${line(0, html`<div class="st-kick">Net worth</div>`)}${line(1, html`<p class="st-p">${d >= 0 ? 'Up' : 'Down'}</p><div class="st-num">${d >= 0 ? '+' : '−'}${count(Math.abs(d))}</div>`)}${line(2, html`<p class="st-p">from ${money0(nwStart)} on Jan 1 to ${money0(nwEnd)}${done ? ' at the end of the year' : ' today'}.</p>`)}`));
    }
  }
  cards.push(card(262, html`${line(0, html`<div class="st-kick">${done ? 'That was' : 'So far'}</div>`)}${line(1, html`<h1 class="st-big">${y}</h1>`)}${line(2, html`<div class="st-btns"><button type="button" class="btn" data-onclick="App.yearShare()">Share</button><button type="button" class="btn" data-onclick="App.yearPlay(0)">Watch again</button><button type="button" class="btn primary" data-onclick="App.yearClose()">Done</button></div>`)}${line(3, nav)}`));
  SHARE = [y + ' in Money' + (done ? '' : ' (so far)'), earned ? 'Earned ' + money0(earned) + ', spent ' + money0(spent) + (earned > 0 ? ', kept ' + Math.round(kept / earned * 100) + '%' : '') : 'Spent ' + money0(spent),
    catRows[0] ? 'Top category: ' + catRows[0].name : '', st.often ? 'Most visited: ' + st.often.name + ' (' + st.often.n + ' times)' : '', st.count ? st.free + ' no-spend days' : ''].filter(Boolean).join('\n');
  paint(html`<div class="story" id="story" role="dialog" aria-label="${y} in Money"><div class="st-prog">${htmlList(cards.map(() => html`<i><b></b></i>`))}</div><button type="button" class="st-x" aria-label="Close" data-onclick="App.yearClose()">×</button><div class="st-deck">${htmlList(cards)}</div></div>`);
  play(0);
};

/* ---------- Playing the story ---------- */
let at = 0, SHARE = '', timer: ReturnType<typeof setTimeout> | undefined, raf = 0;
const STEP = 6500, still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const story = () => document.getElementById('story');
function play(i: number) {
  const s = story(); if (!s) return;
  const cs = s.querySelectorAll<HTMLElement>('.st-card'), bars = s.querySelectorAll<HTMLElement>('.st-prog i');
  at = Math.max(0, Math.min(cs.length - 1, i));
  cs.forEach((c, k) => { c.classList.toggle('on', k === at); c.classList.toggle('past', k < at); });
  bars.forEach((b, k) => { b.className = k < at ? 'done' : k === at ? 'run' : ''; });
  s.classList.remove('paused');
  countUp(cs[at]);
  clearTimeout(timer);
  if (at < cs.length - 1) timer = setTimeout(() => play(at + 1), STEP);
  else bars[at].className = 'done';
}
function countUp(c: HTMLElement) {
  cancelAnimationFrame(raf);
  const ns = [...c.querySelectorAll<HTMLElement>('.st-count')]; if (!ns.length || still()) return;
  const t0 = performance.now() + 250, fmt = (n: HTMLElement, v: number) => n.dataset.f === 'money' ? money0(v) : n.dataset.f === 'pct' ? Math.round(v) + '%' : (n.dataset.f === 'int' && +n.dataset.v! % 1 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'));
  const tick = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - t0) / 900)), e = 1 - Math.pow(1 - k, 3);
    ns.forEach(n => { n.textContent = fmt(n, +n.dataset.v! * e); });
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function pause(on: boolean) {
  const s = story(); if (!s) return;
  s.classList.toggle('paused', on);
  if (on) clearTimeout(timer);
  else { const n = s.querySelectorAll('.st-card').length; if (at < n - 1) timer = setTimeout(() => play(at + 1), STEP / 2); }
}
// Tap, swipe and hold, on the deck (not its buttons and links)
let down: { x: number, y: number, t: number } | null = null;
document.addEventListener('pointerdown', e => {
  const t = e.target as HTMLElement; if (!t.closest || !t.closest('#story .st-deck') || t.closest('a, button')) return;
  down = { x: e.clientX, y: e.clientY, t: Date.now() }; pause(true);
});
document.addEventListener('pointerup', e => {
  if (!down || !story()) { down = null; return; }
  const dx = e.clientX - down.x, dy = e.clientY - down.y, held = Date.now() - down.t; down = null;
  if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return yearClose();                  // pull down to close
  if (Math.abs(dx) > 50) { buzz(5); return play(at + (dx < 0 ? 1 : -1)); }
  if (held > 350) return pause(false);                                                // a hold only paused
  buzz(5); play(at + (e.clientX < innerWidth * 0.3 ? -1 : 1));
});
document.addEventListener('pointercancel', () => { if (down) { down = null; pause(false); } });
document.addEventListener('keydown', e => {
  if (!story()) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); play(at + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); play(at - 1); }
  if (e.key === 'Escape') yearClose();
});
document.addEventListener('visibilitychange', () => { if (story()) pause(document.hidden); });
addEventListener('hashchange', () => { if (parseHash().name !== 'year') { clearTimeout(timer); cancelAnimationFrame(raf); } });
// Back to the page you came from, or the Overview when the story was opened straight from a link
function yearClose() { clearTimeout(timer); if ((history.state && history.state.n || 0) > 1) history.back(); else location.hash = '#/'; }
function yearPlay(i: number) { play(i); }
async function yearShare() {
  try {
    if (navigator.share) { await navigator.share({ title: SHARE.split('\n')[0], text: SHARE }); return; }
    await navigator.clipboard.writeText(SHARE); toast('Copied your year');
  } catch (e) { /* closed the share sheet */ }
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = { yearClose, yearPlay, yearShare };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

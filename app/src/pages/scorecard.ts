import { type Html, html, htmlList } from '../core/html';
import { getAll } from '../core/api';
import { App, todayIso } from '../core/base';
import { drawNav, head } from '../core/dom';
import { normGroup } from '../core/feed';
import { LS } from '../core/helpers';
import { isAsset, isCard, isLiab, lists, normAccount } from '../core/lists';
import { VIEWS } from '../core/router';
import { billDays, billsFrom } from './bills';
import { type BillCount, type Grade, type GradeKey, type Score, type ScoreIn, type Tx, TREND_WORD, lastMonths, monthEnd, scorecard } from '../features/scorecard';
import { scoreForShare } from '../features/scoreshare';
import '../features/scoreshare';
import type { Acct } from '../features/moneyhealth';
import { panelHead } from '../core/ui';

/* ================= Money scorecard =================
   Six plain-word ratings, a money personality and a picture to share, worked out on this device from the last 12 months
   (features/scorecard.ts has the maths). Nothing is kept: Firefly not answering means nothing is shown, never an old copy. */
export const scorecardOn = () => LS.get('scorecard', true) !== false;
export const scorecardPageOn = () => LS.get('scorecardPage', true) !== false;

// Everything the maths needs, from Firefly only. null when Firefly can't be reached.
export async function loadScore(): Promise<Score | null> {
  try {
    const L = await lists(), today = todayIso(), months = lastMonths(today);
    const start = months[0] + '-01', curR = { start: months[6] + '-01', end: monthEnd(months[11]) }, prevR = { start: start, end: monthEnd(months[5]) };
    const [wd, dp] = await Promise.all([getAll('/transactions', { start, end: today, type: 'withdrawal' }), getAll('/transactions', { start, end: today, type: 'deposit' })]);
    const optional = <T>(p: Promise<T>) => p.then(v => v, () => null);
    const countBills = (r: { start: string, end: string }): Promise<BillCount | null> => optional(getAll('/bills', { start: billsFrom(r.start), end: r.end }).then(bs => {
      const all = Object.values(billDays(bs, today, r).days).flat();
      return { paid: all.filter(x => x.state === 'paid').length, late: all.filter(x => x.state === 'late').length };
    }));
    const [bc, bp, assetsThen, liabThen] = await Promise.all([countBills(curR), countBills(prevR),
      optional(getAll('/accounts', { type: 'asset', date: prevR.end })), optional(getAll('/accounts', { type: 'liabilities', date: prevR.end }))]);
    const cash = (xs: ReturnType<typeof normAccount>[]): Acct[] => xs.filter(a => a.active && a.netWorth && isAsset(a) && !isCard(a));
    const owed = (xs: ReturnType<typeof normAccount>[]) => xs.filter(a => a.active && a.netWorth && isLiab(a)).reduce((s, a) => s + Math.abs(a.balance), 0);
    const splits = (gs: typeof wd, type: string) => gs.map(normGroup).flatMap(g => g.splits.filter(x => x.type === type));
    const out = splits(wd, 'withdrawal'), inc = splits(dp, 'deposit');
    const tx = (x: (typeof out)[number]): Tx => ({ date: String(x.date).slice(0, 10), amount: x.amount, category: x.category || '', desc: x.description || '', payee: x.destination_name || '' });
    const inp: ScoreIn = {
      today, out: out.map(tx), inc: inc.map(tx),
      charges: out.map(x => ({ date: String(x.date).slice(0, 10), amount: x.amount, payeeId: x.destination_id, payee: x.destination_name || '', billId: x.bill_id || undefined })),
      bills: bc && bp ? { cur: bc, prev: bp } : null,
      cash: { now: cash(L.accounts), ago: assetsThen ? cash(assetsThen.map(normAccount)) : null },
      debt: { now: owed(L.accounts), ago: liabThen ? owed(liabThen.map(normAccount)) : null },
    };
    return scorecard(inp);
  } catch (e) { return null; }
}

const TREND_MARK = { up: '↑', same: '→', down: '↓' };
const pill = (g: Grade) => html`<span class="sc-r r${g.rank}">${g.rating}</span>`;
const trendMark = (g: Grade) => g.trend ? html`<span class="sc-tr" title="${TREND_WORD[g.trend]} against the 6 months before"><span aria-hidden="true">${TREND_MARK[g.trend]}</span> ${TREND_WORD[g.trend]}</span>` : '';

// The Overview cards. The personality card (with Share) is 'scorecard'; each rating is its own small card, added under Customize > Add cards
export const SC_TILES: Record<string, GradeKey> = { scSavings: 'savings', scConsistency: 'consistency', scBills: 'bills', scCushion: 'cushion', scTidiness: 'tidiness', scDebt: 'debt' };
export const SC_KEYS = ['scorecard', ...Object.keys(SC_TILES)];
const SC_NAME: Record<GradeKey, string> = { savings: 'Savings rate', consistency: 'Consistency', bills: 'Bills on time', cushion: 'Cushion', tidiness: 'Tidiness', debt: 'Debt' };
const SC_EMPTY: Record<GradeKey, string> = { savings: 'Needs a few months of income and spending.', consistency: 'Needs a few months with spending.', bills: 'Needs a few bills to look at.', cushion: 'Needs an account with a balance.', tidiness: 'Needs a few more purchases.', debt: 'Nothing owed, so nothing to rate.' };
const quiet = (name: string, why: string) => html`<section class="panel quiet"><h2>${name}</h2><p class="lead">${why}</p></section>`;

// One rating on its own card
export function scoreTile(key: GradeKey, s: Score | null | undefined): Html {
  const name = SC_NAME[key];
  if (!s) return quiet(name, 'Firefly isn’t answering, so nothing is shown.');
  if (s.fresh) return quiet(name, 'Needs about 3 months of history');
  const g = s.grades.find(x => x.key === key);
  if (!g) return quiet(name, SC_EMPTY[key]);
  return html`<section class="panel scorecard sc-one" id="sc-${key}"><div class="panel-head"><div><h2>${g.name}</h2></div>${pill(g)}</div>
<p class="sc-why">${g.reason}</p>${g.trend ? html`<p class="sc-why">${trendMark(g)}</p>` : ''}<a class="sc-go" href="${g.href}">${g.action}<span aria-hidden="true"> →</span></a></section>`;
}

// The personality card: who you are with money, a way to share it and a way in to the whole page
export function scorecardTile(s: Score | null | undefined): Html {
  if (!s) return html`<section class="panel quiet">${panelHead('Money personality', 'Firefly isn’t answering, so nothing is shown.')}</section>`;
  if (s.fresh) return html`<section class="panel scorecard" id="scorecard">${panelHead('Money personality', 'Needs about 3 months of history')}<p class="sub-s sc-note">Your personality appears here once there is a little more to look at.</p></section>`;
  scoreForShare(s);
  return html`<section class="panel scorecard" id="scorecard"><div class="panel-head"><div><h2>Money personality</h2><p class="lead">${s.person.label}</p></div></div>
<p class="sc-why">${s.person.line}</p><div class="sc-acts"><button type="button" class="btn small primary" data-onclick="App.scorePreview()">Share</button><a class="sc-more" href="#/scorecard">See the details</a></div></section>`;
}

function topLine(label: string, g: Grade | null, empty: string) {
  return html`<div><dt>${label}</dt><dd>${g ? html`<a href="${g.href}">${g.name}</a>` : empty}</dd></div>`;
}
export function scorecardPage(s: Score): Html {
  const p = s.person;
  const person = html`<section class="panel sc-person"><p class="eyebrow">Your money personality</p><h2>${p.label}</h2><p class="lead">${p.line}</p>
<ul class="sc-traits">${htmlList(p.traits.map(t => html`<li><span class="sc-tn">${t.name}</span><span class="sc-te">${t.text}</span></li>`))}</ul>
<p class="sc-nudge">${p.nudge} <a href="${p.href}">Take a look</a></p></section>`;
  if (s.fresh) return html`${person}<section class="panel"><div class="center-empty">Your ratings appear after about 3 months of history. Until then, categorize what you buy and let it build.</div></section>`;
  return html`<section class="panel sc-tops"><dl class="bi-stats">${topLine('Biggest improvement', s.improved, 'Nothing has moved up yet')}${topLine('Best habit', s.best, 'Still building')}</dl></section>
${person}
<section class="panel">${panelHead('Your ratings', 'The last 6 months, with the change against the 6 before')}
<ul class="sc-list">${htmlList(s.grades.map(g => html`<li><div class="sc-row"><span class="sc-name">${g.name}</span>${pill(g)}</div>
<p class="sc-why">${g.reason} ${trendMark(g)}</p>${g.detail ? html`<p class="sub-s sc-detail">${g.detail}</p>` : ''}<a class="sc-go" href="${g.href}">${g.action}<span aria-hidden="true"> →</span></a></li>`))}</ul></section>
<p class="sub-s sc-note">Worked out on this device from your last 12 months. Nothing is stored or sent, and the picture you can share leaves out every amount and name.</p>`;
}

VIEWS.scorecard = async (r, paint) => {
  const s = await loadScore();
  if (!s) return paint(html`${head('Money scorecard', 'Where your habits stand')}<section class="panel"><div class="center-empty">Firefly isn’t answering, so nothing is shown.</div></section>`);
  scoreForShare(s);
  const share = s.fresh ? '' : html`<button type="button" class="btn primary" data-onclick="App.scorePreview()">Share</button>`;
  paint(html`${head('Money scorecard', s.fresh ? 'Where your habits stand' : 'Six ratings from the last 6 months', share)}${scorecardPage(s)}`);
};

function toggleScorecard(on: boolean) { LS.set('scorecard', !!on); }
function toggleScorecardPage(on: boolean) { LS.set('scorecardPage', !!on); drawNav('settings'); }
const methods = { toggleScorecard, toggleScorecardPage };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

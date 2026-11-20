import { html, htmlList } from '../core/html';
import { App, S } from '../core/base';
import { LS } from '../core/helpers';
import { ICON_X } from '../core/dom';
import { t } from '../core/spanish';

/* ================= Getting started: a checklist on Overview for a brand-new install =================
   Not a modal, so it never blocks anything. It only appears on a device that had never used Money (boot.ts sets
   MONEY_RETURNING before anything is written), goes away once every step is done, and can be hidden at any time.
   Steps that Firefly's data can answer (a budget, a bill exist) tick themselves; the others tick when pressed. */
const IOS_TAB = /iPhone|iPad/.test(navigator.userAgent) && (navigator as unknown as { standalone?: boolean }).standalone !== true;
type Step = { id: string, title: string, sub: string, act: string, href?: string, btn?: 'add' | 'home', auto?: boolean };
function steps(): Step[] {
  const L = S.lists;
  const s: Step[] = [
    { id: 'look', title: t('Pick your look'), sub: t('Six themes, your own colors, or a photo background.'), act: t('Choose'), href: '#/settings?s=look' },
    { id: 'tx', title: t('Add a transaction'), sub: t('Type it in plain words, like “coffee 4.50 yesterday”.'), act: t('Add'), btn: 'add' },
    { id: 'budget', title: t('Set a budget'), sub: t('A monthly limit for the thing you want to watch.'), act: t('Set up'), href: '#/budgets', auto: !!L && L.budgets.length > 0 },
    { id: 'bill', title: t('Add a bill'), sub: t('Rent, subscriptions, insurance: Money shows what is due next.'), act: t('Add'), href: '#/bills', auto: !!L && L.bills.length > 0 },
  ];
  if (IOS_TAB) s.push({ id: 'home', title: 'Add Money to your Home Screen', sub: 'Tap Share, then Add to Home Screen, for the full-screen app.', act: 'Done', btn: 'home' });
  return s;
}
const done = () => (LS.get('gsDone', []) as string[]);
const isDone = (st: Step) => !!st.auto || done().includes(st.id);
export function gettingStarted() {
  if (window.MONEY_DEMO && !LS.get('gsForce', false)) return '';
  if (LS.get('gsHide', false) || !LS.get('gsStart', 0)) return '';
  const list = steps(), n = list.filter(isDone).length;
  if (n === list.length) return '';
  const check = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>`;
  return html`<section class="panel started" id="started"><div class="panel-head"><div><h2>Get started with Money</h2><p class="lead">${t('{done} of {total} done', { done: n, total: list.length })}</p></div><button type="button" class="round" aria-label="Hide getting started" data-onclick="App.startedHide()">${ICON_X}</button></div>
<div class="track st-track" aria-hidden="true"><div class="fill good" style="width:${Math.round(n / list.length * 100)}%"></div></div>
<ol class="st-list">${htmlList(list.map(st => { const d = isDone(st); return html`<li class="${d ? 'done' : ''}"><span class="st-ck" aria-hidden="true">${d ? check : ''}</span><div class="st-t"><strong>${st.title}</strong><span>${st.sub}</span></div>${d ? '' : st.href ? html`<a class="btn small" href="${st.href}" data-onclick="App.startedDone('${st.id}')">${st.act}</a>` : st.btn === 'add' ? html`<button type="button" class="btn small" data-onclick="App.startedAdd()">${st.act}</button>` : html`<button type="button" class="btn small" data-onclick="App.startedDone('home')">${st.act}</button>`}</li>`; }))}</ol></section>`;
}
// Called once the app is on screen: a device with no earlier Money data is a new install
function startedInit() {
  if (window.MONEY_RETURNING || S.bootStale || window.MONEY_DEMO || LS.get('gsStart', 0)) return;
  LS.set('gsStart', Date.now());
}
function startedDone(id: string) { const d = done(); if (!d.includes(id)) LS.set('gsDone', [...d, id]); }
function startedAdd() { startedDone('tx'); App.quickAdd(); }
function startedHide() { LS.set('gsHide', true); document.getElementById('started')?.remove(); }
const methods = { startedInit, startedDone, startedAdd, startedHide };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

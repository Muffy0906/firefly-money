import { type Html, html, htmlList } from '../core/html';
import { PAGES } from '../core/api';
import { busy } from '../core/auth';
import { App, S, fmtD, fmtNum } from '../core/base';
import { closeDrawer, openDrawer, toast } from '../core/dom';
import { FX, fxEnsure, fxStatus } from '../core/fx';
import { LS } from '../core/helpers';
import { route } from '../core/router';
import { t } from '../core/spanish';

/* ---------- Foreign currencies: the line under a page's title, and what it opens ----------
   Shown only when an account is in another currency. It says the totals are in the main currency and at what rate;
   it turns into a warning when the rates are old (the last fetch failed) or a currency has no rate at all, in which
   case its amounts are left out of totals rather than added as if they were the main currency. */
const when = (t: number) => fmtD(new Date(t), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// "1 USD = 83.9 INR": as many decimals as the size of the rate needs
export const rateText = (code: string, rate: string) => '1 ' + FX.primary + ' = ' + fmtNum(+rate, +rate >= 100 ? 2 : +rate >= 1 ? 3 : 5) + ' ' + code;
export function fxNote(): Html | string {
  const st = fxStatus();
  if (!st.foreign.length) return '';
  let cls = '', text: string;
  if (!st.on) { cls = 'warn'; text = t('{currencies} left out of totals (converting is off)', { currencies: st.foreign.join(', ') }); }
  else if (st.missing.length) { cls = 'bad'; text = t('{currencies} not converted: left out of totals', { currencies: st.missing.join(', ') }); }
  else if (st.stale) { cls = 'warn'; text = t('Totals in {currency} · rates as of {date}', { currency: FX.primary, date: when(st.asOf) }); }
  else text = t('Totals in {currency} · {rates}', { currency: FX.primary, rates: st.rows.length === 1 ? rateText(st.rows[0].code, st.rows[0].rate) : t('{count} exchange rates', { count: st.rows.length }) });
  return html`<button type="button" class="fx-note ${cls}" data-onclick="App.fxInfo()" title="Exchange rates used">${cls ? html`<span aria-hidden="true">⚠</span> ` : ''}${text}<span class="fx-go" aria-hidden="true"> ›</span></button>`;
}
function fxInfo() {
  const st = fxStatus();
  const rows = htmlList(st.rows.map(r => html`<div class="row"><span class="name">${rateText(r.code, r.rate)}<br><span class="sub-s${r.old ? ' up' : ''}">${r.old ? 'Last fetched ' : 'Fetched '}${when(r.at)}${r.src ? ' · ' + r.src : ''}</span></span></div>`));
  const none = htmlList(st.missing.map(c => html`<div class="row"><span class="name">${c}<br><span class="sub-s up">${t('No rate could be fetched. Amounts in {currency} are shown as they are and left out of totals.', { currency: c })}</span></span></div>`));
  openDrawer('Exchange rates',
    html`<p class="sub-s" style="margin-top:0">${st.on ? t('Totals add every account in {currency}, converting other currencies at today’s rate. Each account still shows its own currency.', { currency: FX.primary }) : 'Converting is switched off, so amounts in other currencies are left out of totals. Turn it back on in Settings → Currencies.'}</p><div class="list">${rows}${none}</div>${st.stale ? html`<p class="sub-s up">The last fetch failed, so these are the last rates that were fetched.</p>` : ''}<p class="sub-s">Rates are fetched once an hour for the currencies your accounts use and kept on this device. Nothing is changed in Firefly III.</p>`,
    html`<a class="btn" href="#/settings?s=currencies" data-onclick="App.closeDrawer()">Settings</a><span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Close</button><button class="btn primary" id="fxRefresh" data-onclick="App.fxRefresh(this)">Refresh rates</button>`);
}
// Every balance and total was worked out with the old rates: read the lists and draw the page again
function redraw() { FX.missing.clear(); S.listsAt = 0; PAGES.clear(); S.pageHtml = ''; route(); }
async function fxRefresh(btn?: HTMLButtonElement) {
  const go = async () => {
    await fxEnsure(FX.needed, true);
    const st = fxStatus();
    toast(!st.foreign.length ? 'No accounts in another currency' : st.missing.length || st.stale ? 'Couldn’t fetch new rates' : 'Rates updated');
    if (document.getElementById('fxRefresh')) closeDrawer();
    redraw();
  };
  if (btn) await busy(btn, go); else await go();
}
function fxToggle(on: boolean) { LS.set('fxConvert', !!on); redraw(); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = { fxNote, fxInfo, fxRefresh, fxToggle };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

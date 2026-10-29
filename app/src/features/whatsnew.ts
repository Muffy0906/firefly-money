import { type Html, html, htmlList } from '../core/html';
import { App, S, el } from '../core/base';
import { LS } from '../core/helpers';
import { buzz } from '../core/haptics';

/* ================= What's new: shown once after each update to a new version ================= */
// The version comes from the build stamp (meta money-version), e.g. "v2.1.0 (c78fd51 · 2026-11-02)" for a release image.
// Images built from main between releases, and local builds, have no version in the stamp: they count as the newest
// release in NOTES. Someone who used an older version sees the popup once, on the first open after each update.
// A brand-new install skips it (they have the whole app to discover) and just remembers the version.
// With each release, add its highlights to NOTES (keep them in step with the release notes). A version without
// highlights here still gets the popup, with a short note and a link to its release notes.
const ICONS: Record<string, Html> = {
  glass: html`<path d="M12 3.5c3 3.4 5.5 6.6 5.5 9.8a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.4 5.5-9.8z"/><path d="M9.4 14.2a2.7 2.7 0 0 0 2.4 2.4"/>`,
  bento: html`<rect x="3.5" y="3.5" width="7.5" height="9" rx="2"/><rect x="13" y="3.5" width="7.5" height="5" rx="2"/><rect x="13" y="10.5" width="7.5" height="10" rx="2"/><rect x="3.5" y="14.5" width="7.5" height="6" rx="2"/>`,
  lens: html`<path d="M3 17l5-5 4 3 7-8"/><circle cx="12" cy="15" r="1.6"/><path d="M12 3.5v2M12 18.5V21"/>`,
  list: html`<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 7.5h6M7 16.5h4"/>`,
  phone: html`<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>`,
};
type Notes = { lead: string, items: [string, string, string][] };
const NOTES: Record<string, Notes> = {
  '2.0.0': { lead: 'A new look, a bento Overview you build yourself, and animations that stay smooth on a phone.', items: [
    ['glass', 'Frosted glass', 'A new theme with real backgrounds, or a photo of your own, and pill shapes in every theme.'],
    ['bento', 'A bento Overview', 'Tiles in even rows, new Net worth, Spent and Earned tiles, and Add cards with a preview of each. Drag them where you like.'],
    ['lens', 'New ways to see your money', 'Scrub back through Net worth, see spending as hours of work, and play your Year in Money.'],
    ['list', 'A nicer Transactions page', 'The month at a glance, a card for each day, and swipe left to categorize or delete.'],
    ['phone', 'Smoother on iPhone', 'No more stutter, and the tab bar and title tuck away while you scroll.'],
  ] },
};
const cmpVer = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
// The version this build is: from the stamp when it has one, otherwise the newest release with notes
export function appVersion(stamp: string) {
  const m = /^v?(\d+\.\d+\.\d+)\b/.exec(stamp.trim());
  return m ? m[1] : Object.keys(NOTES).sort(cmpVer).pop()!;
}
const stamp = () => { const m = document.querySelector<HTMLMetaElement>('meta[name="money-version"]'); return m ? m.content : ''; };
const svg = (k: string) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

// Whether this device used Money before this page load: boot.ts looks at localStorage before anything writes to it
function returning() { return !!window.MONEY_RETURNING || !!S.bootStale; }
// Called once the app is on screen (showApp). Settings → About opens it again with force.
function whatsNew(force?: boolean) {
  const ver = appVersion(stamp()), notes = NOTES[ver];
  if (!force) {
    if (LS.get('seenVersion', '') === ver) return;
    if (window.MONEY_NO_WHATSNEW) return;
    if (window.MONEY_DEMO || !returning()) { LS.set('seenVersion', ver); return; }
  }
  // Let the page draw first, and don't cover a form or a confirm box that's already open
  setTimeout(() => {
    const d = el<HTMLDialogElement>('whatsNew');
    if (!d || d.open) return;
    if (!force && (el('drawer').classList.contains('open') || el<HTMLDialogElement>('confirm').open || document.hidden)) return;
    d.innerHTML = String(html`<header><div><div class="eyebrow">What’s new</div><h3 id="wnTitle">Money ${ver}</h3></div><button type="button" class="round wn-x" aria-label="Close" data-onclick="App.whatsNewClose()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></header>
<p class="wn-lead">${notes ? notes.lead : 'This update brings fixes and smaller improvements. The release notes have the details.'}</p>
${notes ? html`<ul class="wn-list">${htmlList(notes.items.map(([ic, t, s]) => html`<li><span class="wn-ic">${svg(ic)}</span><div><strong>${t}</strong><span>${s}</span></div></li>`))}</ul>` : ''}
<div class="btns"><a class="btn" href="https://github.com/Muffy0906/firefly-money/releases/tag/v${ver}" target="_blank" rel="noopener">All the changes</a><button type="button" class="btn primary" data-onclick="App.whatsNewClose()">Got it</button></div>`);
    d.setAttribute('aria-labelledby', 'wnTitle');
    d.onclose = () => LS.set('seenVersion', ver);
    d.onclick = e => { if (e.target === d) whatsNewClose(); };   // a tap on the backdrop
    d.showModal();
    d.querySelector<HTMLElement>('.btn.primary')!.focus({ preventScroll: true });
  }, force ? 0 : 900);
}
function whatsNewClose() { buzz(); el<HTMLDialogElement>('whatsNew').close(); }

const methods = { whatsNew, whatsNewClose };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

import { html, htmlList, raw } from '../core/html';
import { AuthError, PAGES, api, getAll, type ApiError } from '../core/api';
import { withAuth } from '../core/auth';
import { App, S, cycleDay, el, fmtDate, isoDate, monthRange, nowMonth, num, todayIso } from '../core/base';
import { confirmBox, head, opt, toast } from '../core/dom';
import { LS, budgetAlert, saveBlob } from '../core/helpers';
import { buzz, hapticsOn } from '../core/haptics';
import { logosOn } from '../core/logo';
import { THEMES, themeButtons } from '../core/login';
import { type Custom, KEY, PHOTO_KEY, SCENES, applyCustom, isHex, lum, readCustom } from '../core/themevars';
import { type Account, invalidate, isAsset, isLiab, lists, ordinal } from '../core/lists';
import { VIEWS, route } from '../core/router';

/* Settings: one column of named groups, like iOS Settings. Each group is a panel of rows (a label, a short hint, the
   control). Forms you rarely need (adding a rate, a webhook, a card, exports) and the longer explanations sit in
   collapsed sections, which stay open across the page's redraws. */
const OPEN = new Set<string>();
document.addEventListener('toggle', e => {
  const d = e.target;
  if (d instanceof HTMLDetailsElement && d.dataset.k) { if (d.open) OPEN.add(d.dataset.k); else OPEN.delete(d.dataset.k); }
}, true);
const group = (id: string, title: string, body: unknown, foot?: unknown) =>
  html`<section class="set-group" id="set-${id}"><h2 class="set-h">${title}</h2><div class="panel set-panel">${body}</div>${foot ? html`<p class="set-foot">${foot}</p>` : ''}</section>`;
const row = (label: unknown, hint: unknown, ctl: unknown) =>
  html`<div class="set-row"><div class="set-label"><div>${label}</div>${hint ? html`<div class="sub-s">${hint}</div>` : ''}</div>${ctl ? html`<div class="set-ctl">${ctl}</div>` : ''}</div>`;
const more = (k: string, label: unknown, count: unknown, body: unknown, open?: boolean) =>
  html`<details class="set-more" data-k="${k}"${OPEN.has(k) || open ? ' open' : ''}><summary><span>${label}</span><span class="sub-s">${count}</span></summary><div class="set-body">${body}</div></details>`;
// An on/off switch: html`<input ${SWITCH}…>` (the handler stays literal so the smoke test can check it)
const SWITCH = raw('type="checkbox" class="switch" role="switch"');

const EXPORTS = [['transactions', 'Transactions'], ['accounts', 'Accounts'], ['budgets', 'Budgets'], ['categories', 'Categories'], ['tags', 'Tags'],
  ['bills', 'Bills'], ['piggy-banks', 'Piggy banks'], ['recurring', 'Recurring transactions'], ['rules', 'Rules']];
const TRIG = [['STORE_TRANSACTION', 'A transaction is added'], ['UPDATE_TRANSACTION', 'A transaction is changed'], ['DESTROY_TRANSACTION', 'A transaction is deleted']];
VIEWS.settings = async (r, paint) => {
  const L = await lists(true);
  const [about, rates, hooks, ingest] = await Promise.all([
    api('/about').catch(() => ({})), getAll('/exchange-rates').catch(() => null), getAll('/webhooks').catch(() => null), ingestKey(),
  ]);
  const cards = ingest ? await loadCards() : null;
  const enabled = L.currencies.filter(c => c.enabled), disabled = L.currencies.filter(c => !c.enabled);
  S.rates = rates || [];

  const day = cycleDay(), alertPct = budgetAlert(), ex = monthRange(...nowMonth());
  const months = group('months', 'Months & budgets', html`
    ${row('Month starts on', 'Your payday, if you like', html`<select aria-label="Month starts on" data-onchange="App.setCycleDay(this.value)">${htmlList([...Array(28)].map((_, i) => opt(i + 1, 'the ' + ordinal(i + 1), day)))}</select>`)}
    ${row('Budget warning', 'When a budget is this full', html`<select aria-label="Warn when a budget reaches" data-onchange="App.setBudgetAlert(this.value)">${htmlList([50, 60, 70, 75, 80, 85, 90, 95].map(p => opt(p, p + '%', alertPct)))}</select>`)}`,
    'This month runs ' + fmtDate(ex.start) + ' – ' + fmtDate(ex.end) + '. Budgets, the Overview, recaps and reports all use it.' +
      (day > 1 ? ' Firefly’s own pages still use calendar months, and auto-budgets still reset on the 1st.' : ''));

  const privacy = !!LS.get('privacy', false), compact = !!LS.get('compact', false);
  const look = group('look', 'Appearance', html`
    ${row('Theme', '', html`<div class="themes">${themeButtons()}</div>`)}
    ${more('theme-custom', 'Customize colors', html`<span class="tc-name">${themeName()}</span>`, html`<div class="theme-custom">${customizer()}</div>`)}
    ${row('Hide amounts', 'Blur every amount. Press P to switch.', html`<input ${SWITCH} aria-label="Hide amounts" data-pref="privacy"${privacy ? ' checked' : ''} data-onchange="App.togglePrivacy()">`)}
    ${row('Compact view', 'Tighter spacing to fit more in', html`<input ${SWITCH} aria-label="Compact view" data-pref="compact"${compact ? ' checked' : ''} data-onchange="App.toggleDensity()">`)}
    ${row('Logos', 'Payees’ and banks’ logos instead of initials', html`<input ${SWITCH} aria-label="Show logos"${logosOn() ? ' checked' : ''} data-onchange="App.toggleLogos(this.checked)">`)}
    ${row('Haptics', 'A light tap when you save, delete or flip a switch. iPhone needs iOS 18 or later.', html`<input ${SWITCH} aria-label="Haptics"${hapticsOn() ? ' checked' : ''} data-onchange="App.toggleHaptics(this.checked)">`)}
    ${more('logos', 'About logos', '', html`<p class="sub-s">Your Money server fetches each logo from DuckDuckGo’s icon service by the payee’s website (guessed from its name; change it in the account’s settings) and keeps it, so your browser never contacts another site.</p>`)}`,
    'Theme, hide amounts, compact view and haptics are saved on this device only. Your colors for each theme sync like your other settings.');

  const syncOff = !!LS.get('syncOff', false), syncAt = LS.get('syncAt', 0);
  const syncStatus = syncOff ? 'Off: this device keeps its own settings.' : S.syncError ? html`<span class="up">Couldn’t sync: ${S.syncError}</span>`
    : syncAt ? 'Last synced ' + fmtDate(isoDate(new Date(syncAt))) + ' at ' + new Date(syncAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '.' : 'Nothing synced yet.';
  const sync = group('sync', 'Sync', html`
    ${row('Sync between devices', syncStatus, html`<input ${SWITCH} aria-label="Sync this device’s settings"${syncOff ? '' : ' checked'} data-onchange="App.toggleSync(this.checked)">`)}
    ${syncOff ? '' : row('Sync now', '', html`<button class="btn small" type="button" data-onclick="App.syncNow()">Sync now</button>`)}`,
    'Your Overview layout, month start, drafts, saved reports, dismissed insights, forecast, loan plan and subscription choices and theme colors are kept in Firefly III, so they follow you to every device.');

  const showAll = r.q.rates === 'all';
  const rateBody = html`${rates && rates.length ? html`<div class="list">${htmlList(rates.slice(0, showAll ? 500 : 6).map(x => { const a = x.attributes; return html`<div class="row"><span class="name">1 ${a.from_currency_code || a.from} = ${num(a.rate)} ${a.to_currency_code || a.to} <span class="sub-s">on ${fmtDate(a.date)}</span></span><button class="link" data-onclick="App.deleteRate('${x.id}')">Remove</button></div>`; }))}</div>${rates.length > 6 ? html`<p style="margin:10px 0 0"><a class="link" href="#/settings${showAll ? '' : '?rates=all'}">${showAll ? 'Show fewer' : 'Show all ' + rates.length + ' rates'}</a></p>` : ''}` : html`<p class="sub-s" style="margin:0">Used to convert foreign amounts in reports. No rates yet.</p>`}<form style="margin-top:14px" data-onsubmit="event.preventDefault();App.addRate(this)"><div class="grid2"><label>From<select name="f">${htmlList(enabled.map(c => opt(c.code, c.code, S.currency)))}</select></label><label>To<select name="t">${htmlList(enabled.map(c => opt(c.code, c.code, (enabled.find(x => x.code !== S.currency) || {}).code)))}</select></label><label>Rate<input type="number" step="any" min="0" name="r" required></label><label>Date<input type="date" name="d" value="${todayIso()}" required></label></div><button class="btn small">Add rate</button></form>`;
  const cur = group('currencies', 'Currencies', html`
    ${htmlList(enabled.map(c => row(html`${c.code} · ${c.name}${c.code === S.currency ? html` <span class="chip good">Main</span>` : ''}`, '',
      c.code !== S.currency ? html`<button class="link" data-onclick="App.currency('${c.code}','primary')">Make main</button><button class="link" data-onclick="App.currency('${c.code}','disable')">Disable</button>` : '')))}
    ${disabled.length ? more('cur-add', 'Enable another currency', '', html`<form class="set-inline" data-onsubmit="event.preventDefault();App.currency(this.c.value,'enable')"><select name="c" aria-label="Currency">${htmlList(disabled.map(c => opt(c.code, c.code + ' · ' + c.name, '')))}</select><button class="btn small">Enable</button></form>`) : ''}
    ${rates === null ? '' : more('rates', 'Exchange rates', rates.length || '', rateBody, showAll)}`,
    'Enabled currencies can be used for foreign amounts and accounts.');

  const yr = new Date().getFullYear();
  const exp = html`<div class="grid2"><label>From (transactions only)<input type="date" id="ex-start" value="${yr - 1}-01-01"></label><label>To<input type="date" id="ex-end" value="${todayIso()}"></label></div><div style="display:flex;flex-wrap:wrap;gap:8px">${htmlList(EXPORTS.map(([k, l]) => html`<button class="btn small" data-onclick="App.exportData('${k}', this)">${l}</button>`))}</div>`;
  const hookBody = hooks === null ? '' : html`<p class="sub-s" style="margin:0 0 12px">Firefly calls these web addresses when transactions change, for automations like Home Assistant or n8n.</p>${hooks.length ? html`<div class="list">${htmlList(hooks.map(x => { const a = x.attributes, tr = a.trigger || (a.triggers || [])[0];
      return html`<div class="row"><span class="name"><label class="check" style="margin:0;display:inline-flex"><input type="checkbox"${a.active ? ' checked' : ''} data-onchange="App.toggleHook('${x.id}',this.checked)"> ${a.title}</label><br><span class="sub-s">${(TRIG.find(t => t[0] === tr) || [0, tr])[1]} → ${a.url}</span></span><button class="link" data-onclick="App.deleteHook('${x.id}')">Delete</button></div>`; }))}</div>` : ''}<form data-onsubmit="event.preventDefault();App.addHook(this)" style="margin-top:14px"><div class="grid2"><label>Name<input type="text" name="t" required></label><label>When<select name="w">${htmlList(TRIG.map(([v, l]) => opt(v, l, '')))}</select></label></div><label>URL<input type="text" name="u" placeholder="https://…" required></label><div class="grid2"><label>Send<select name="r">${opt('TRANSACTIONS', 'The transaction', '')}${opt('ACCOUNTS', 'The accounts involved', '')}${opt('NONE', 'Nothing (just ping)', '')}</select></label><span></span></div><button class="btn small">Add webhook</button></form>`;
  const data = group('data', 'Data', html`
    ${more('export', 'Export to CSV', '', html`<p class="sub-s" style="margin:0 0 12px">Files you can open in Excel or Numbers.</p>${exp}`)}
    ${hooks === null ? '' : more('hooks', 'Webhooks', hooks.length ? hooks.filter(x => x.attributes.active).length + ' on' : '', hookBody)}
    ${row('Clean up', 'Payees, categories, tags and budgets that nothing uses', html`<a class="btn small" href="#/cleanup">Review</a>`)}
    ${row('Recalculate everything', 'If a total looks wrong: fetch every number fresh from Firefly III. Your data there isn’t changed.', html`<button class="btn small" type="button" data-onclick="App.recalcAll(this)">Recalculate</button>`)}`);

  const ab = (about && about.data) || {};
  const aboutHtml = group('about', 'About', html`
    ${row('Money', '', moneyVersion() || 'Local build')}
    ${row('Firefly III', '', ab.version || '—')}
    ${row('API', '', ab.api_version || '—')}`,
    'Your Firefly profile, password, two-factor login, API tokens and user administration aren’t available through Firefly’s API, so change those in Firefly III itself.');

  const body = html`${months}${look}${sync}${applePayHtml(ingest, cards, L.own.filter(a => isAsset(a) || isLiab(a)))}${cur}${data}${aboutHtml}`, has = String(body);
  const nav = htmlList(SET_SECTIONS.filter(([id]) => has.includes('id="set-' + id + '"')).map(([id, t]) => html`<button type="button" data-k="${id}" data-onclick="App.setJump('${id}')">${t}</button>`));
  paint(html`<div class="set-layout"><nav class="set-nav" id="setNav" aria-label="Settings sections">${nav}</nav><div class="set-main">${head('Settings', '', '')}<div class="settings">${body}</div></div></div>`);
  requestAnimationFrame(setSpy);
};
/* ---------- Wide screens: a list of the sections beside them, marking the ones on screen ---------- */
const SET_SECTIONS: [string, string][] = [['months', 'Months & budgets'], ['look', 'Appearance'], ['sync', 'Sync'], ['applepay', 'Apple Pay'], ['currencies', 'Currencies'], ['data', 'Data'], ['about', 'About']];
function setJump(id: string) {
  const g = el('set-' + id); if (!g) return;
  g.classList.remove('pal-flash'); void g.offsetWidth; g.classList.add('pal-flash');
  g.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
let spyQueued = false;
function setSpy() {
  spyQueued = false;
  const nav = el('setNav'); if (!nav || !nav.offsetParent) return;
  nav.querySelectorAll<HTMLElement>('button').forEach(b => {
    const r = el('set-' + b.dataset.k)?.getBoundingClientRect();
    b.classList.toggle('on', !!r && r.bottom > 80 && r.top < innerHeight - 80);
  });
}
addEventListener('scroll', () => { if (!spyQueued && el('setNav')) { spyQueued = true; requestAnimationFrame(setSpy); } }, { passive: true });
addEventListener('resize', () => { if (el('setNav')) requestAnimationFrame(setSpy); });
/* ---------- Customize colors: your own background, accent and (for the glass themes) light, tint and blur ---------- */
const curTheme = () => document.documentElement.getAttribute('data-theme') || 'auto';
const themeName = () => { const t = THEMES.find(x => x[0] === curTheme()); return t ? t[1] : ''; };
// The colour the theme shows right now (yours, or its own), as #rrggbb for a colour well
function shown(v: string) {
  const x = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  if (isHex(x)) return x.toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(x);
  return m ? '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : '#000000';
}
// Text sits right on the background (titles, the month), so warn when the two get too close
function lowContrast() { const a = lum(shown('--bg')), b = lum(shown('--text')); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 4.5; }
// Frosted glass: what's behind the glass. Swatches hint at each scene's colors.
const SCENE_SW: Record<string, string> = {
  room: 'linear-gradient(135deg,#efe4d6,#b98a64 55%,#8a5a3c)', dunes: 'radial-gradient(circle at 70% 30%,#fff1d6 0 18%,transparent 22%),linear-gradient(180deg,#f3c9b8,#b5654a)',
  garden: 'linear-gradient(135deg,#fffbe6,#a9bf8e 50%,#5f8050)', coast: 'linear-gradient(180deg,#f2f8fb 30%,#3f87a3 52%,#e8d8bd 72%)',
  blossom: 'linear-gradient(135deg,#d47fa8,#fff4f8 50%,#a596e0)', night: 'radial-gradient(circle at 30% 40%,#ff7a3d 0 12%,transparent 15%),radial-gradient(circle at 70% 60%,#2bb3c9 0 10%,transparent 13%),linear-gradient(180deg,#3b2a6b,#120f1c)',
};
function scenePicker(c: Custom) {
  const cur = c.scene || 'room';
  const btns = htmlList(SCENES.map(([k, label]) => html`<button type="button" title="${label}" aria-label="${label} scene" class="${k === cur ? 'on' : ''}" style="background:${SCENE_SW[k]};background-origin:border-box" data-s="${k}" data-onclick="App.themeScene(this.dataset.s)"></button>`));
  const photo = LS.get(PHOTO_KEY, '');
  return html`<div class="themes scenes">${btns}${photo ? html`<button type="button" title="Your photo" aria-label="Your photo" class="${cur === 'photo' ? 'on' : ''}" style="background:center/cover url('${photo}')" data-onclick="App.themeScene('photo')"></button>` : ''}<label class="btn small">${photo ? 'New photo…' : 'Your photo…'}<input type="file" accept="image/*" hidden data-onchange="App.themePhoto(this)"></label></div>`;
}
function customizer() {
  const t = curTheme();
  if (t === 'auto') return html`<p class="sub-s" style="margin:4px 0 0">Calm switches between light and dark with your system, so it can’t take your own colors. Pick Calm light, Calm dark or another theme to customize it.</p>`;
  const c: Custom = readCustom()[t] || {}, num = (v: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0;
  const frost = num('--glass-tint'), blur = num('--glass-blur');
  return html`
    ${row('Background', html`Behind everything<span class="up tc-warn"${lowContrast() ? '' : ' hidden'}>. Text may be hard to read on this color.</span>`,
      html`<input type="color" aria-label="Background color" value="${shown('--bg')}" data-oninput="App.themeVar('bg', this.value)">`)}
    ${row('Accent', 'Buttons, switches and highlights', html`<input type="color" aria-label="Accent color" value="${shown('--accent')}" data-oninput="App.themeVar('accent', this.value)">`)}
    ${t === 'frosted' ? row('Scene', 'What’s behind the glass', scenePicker(c)) : ''}
    ${t === 'glass' || t === 'frosted' ? html`
    ${row(t === 'glass' ? 'Light' : 'Room', t === 'glass' ? 'The three colors glowing behind the glass' : 'The three colors of the room behind the glass', html`<input type="color" aria-label="First light color" value="${shown('--glow1')}" data-oninput="App.themeVar('glow1', this.value)"><input type="color" aria-label="Second light color" value="${shown('--glow2')}" data-oninput="App.themeVar('glow2', this.value)"><input type="color" aria-label="Third light color" value="${shown('--glow3')}" data-oninput="App.themeVar('glow3', this.value)">`)}
    ${row('Glass tint', 'The color of the cards', html`<input type="color" aria-label="Glass tint" value="${shown('--glass-base')}" data-oninput="App.themeVar('tint', this.value)">`)}
    ${row('Frost', 'Clear to solid', html`<input type="range" min="0" max="90" step="1" aria-label="Frost" value="${frost}" data-oninput="App.themeRange('frost', this)"><output>${frost}%</output>`)}
    ${row('Blur', 'How much the light softens behind the cards', html`<input type="range" min="0" max="60" step="1" aria-label="Blur" value="${blur}" data-oninput="App.themeRange('blur', this)"><output>${blur}px</output>`)}
    ${t === 'glass' ? row('Moving light', 'Let the light drift slowly', html`<input ${SWITCH} aria-label="Moving light"${c.motion === false ? '' : ' checked'} data-onchange="App.themeVar('motion', this.checked)">`) : ''}` : ''}
    ${Object.keys(c).length ? row('', '', html`<button class="btn small" type="button" data-onclick="App.resetThemeCustom()">Reset ${themeName()}</button>`) : ''}`;
}
// Redraw after the theme changes (setTheme) or the colors are reset
function drawThemeCustom() {
  document.querySelectorAll('.theme-custom').forEach(e => { e.innerHTML = String(customizer()); });
  document.querySelectorAll('.tc-name').forEach(e => { e.textContent = themeName(); });
}
function saveCustom(k: keyof Custom, v: string | number | boolean) {
  const t = curTheme(), all = readCustom(), had = !!all[t];
  all[t] = { ...all[t], [k]: v };
  LS.set(KEY, all); applyCustom(t);
  if (!had) drawThemeCustom();        // shows the Reset button (the colour well being dragged stays: same value)
}
function themeVar(k: keyof Custom, v: string | boolean) {
  saveCustom(k, v);
  if (k === 'bg' || k === 'accent') document.querySelectorAll<HTMLElement>('.tc-warn').forEach(e => { e.hidden = !lowContrast(); });
}
function themeRange(k: 'frost' | 'blur', input: HTMLInputElement) {
  const v = +input.value, out = input.nextElementSibling;
  if (out) out.textContent = v + (k === 'blur' ? 'px' : '%');
  saveCustom(k, v);
}
// A scene brings its own colors, so picking one drops colors you'd set for the last
function themeScene(k: string) {
  if (k !== 'photo' && !SCENES.some(x => x[0] === k)) return;
  const t = curTheme(), all = readCustom(), c = { ...all[t], scene: k };
  delete c.bg; delete c.glow1; delete c.glow2; delete c.glow3; delete c.accent;
  all[t] = c; LS.set(KEY, all); applyCustom(t); drawThemeCustom(); buzz(8);
}
// Your own photo behind the glass: made smaller (it's blurred anyway) and kept on this device
function themePhoto(input: HTMLInputElement) {
  const f = input.files && input.files[0]; if (!f) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const k = Math.min(1, 1200 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    const data = cv.toDataURL('image/jpeg', .8);
    LS.set(PHOTO_KEY, data);
    if (LS.get(PHOTO_KEY, '') !== data) { toast('That photo is too big to keep. Try a smaller one.'); return; }
    themeScene('photo');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Couldn’t open that photo'); };
  img.src = url;
}
function resetThemeCustom() {
  const all = readCustom();
  delete all[curTheme()];
  LS.set(KEY, all); applyCustom(); drawThemeCustom();
}
// The build stamped into the Docker image by GitHub, e.g. "c78fd51 · 2026-09-30". Empty for a local build or plain files.
function moneyVersion() {
  const m = document.querySelector<HTMLMetaElement>('meta[name="money-version"]'), v = m ? m.content.trim() : '';
  return v && !v.startsWith('$') ? v : '';
}
async function currency(code: string, action: string) {
  if (!code) return;
  await withAuth(async () => {
    try { await api('/currencies/' + code + '/' + action, { method: 'POST' }); }
    catch (e) {
      if (action === 'primary') await api('/currencies/' + code + '/default', { method: 'POST' });
      else if (action === 'disable' && (e as ApiError).status === 409) return disableInUse(code);
      else throw e;
    }
    invalidate(); toast(({ enable: 'Enabled ', disable: 'Disabled ', primary: 'Main currency is now ' } as Record<string, string>)[action] + code); route();
  });
}
// Firefly refuses (409) to disable a currency that anything still uses. Exchange rates are the usual
// culprit (Firefly adds a set of EUR rates itself), so offer to remove those and try again.
async function disableInUse(code: string) {
  const rates = (S.rates || []).filter(x => [x.attributes.from_currency_code || x.attributes.from, x.attributes.to_currency_code || x.attributes.to].includes(code));
  if (!rates.length) {
    return confirmBox(code + ' is still in use', 'Firefly won’t disable ' + code + ' while an account, bill, budget, piggy bank or transaction uses it. Change those to another currency first.', 'OK');
  }
  if (!await confirmBox(code + ' is still in use', code + ' has ' + rates.length + ' exchange rate' + (rates.length === 1 ? '' : 's') + ', which stops Firefly from disabling it. Remove ' +
    (rates.length === 1 ? 'that rate' : 'those rates') + ' and disable ' + code + '?', 'Remove & disable')) return;
  let done = 0;
  for (const x of rates) { try { await api('/exchange-rates/' + x.id, { method: 'DELETE' }); done++; } catch (e) { if (e instanceof AuthError) throw e; } }
  try {
    await api('/currencies/' + code + '/disable', { method: 'POST' });
    toast('Removed ' + done + ' rate' + (done === 1 ? '' : 's') + ' and disabled ' + code);
  } catch (e) {
    if ((e as ApiError).status !== 409) throw e;
    await confirmBox(code + ' is still in use', 'The exchange rates are gone, but something else still uses ' + code + ' — an account, bill, budget, piggy bank or transaction. Change those first.', 'OK');
  }
  invalidate(); route();
}
async function addRate(f: HTMLFormElement) {
  if (f.f.value === f.t.value) return toast('Pick two different currencies.');
  await withAuth(async () => { await api('/exchange-rates', { method: 'POST', body: { from: f.f.value, to: f.t.value, rate: String(num(f.r.value)), date: f.d.value } }); toast('Rate added'); route(); });
}
async function deleteRate(id: string) { await withAuth(async () => { await api('/exchange-rates/' + id, { method: 'DELETE' }); toast('Rate removed'); route(); }); }
async function exportData(kind: string, btn: HTMLButtonElement) {
  btn.disabled = true;
  await withAuth(async () => {
    const params: any = { type: 'csv' };
    if (kind === 'transactions') { params.start = el<HTMLInputElement>('ex-start').value; params.end = el<HTMLInputElement>('ex-end').value; }
    const blob = await api('/data/export/' + kind, { params, as: 'blob' });
    saveBlob(blob, 'firefly-' + kind + '-' + todayIso() + '.csv');
  });
  btn.disabled = false;
}
async function addHook(f: HTMLFormElement) {
  const body = { title: f.t.value.trim(), url: f.u.value.trim(), active: true, trigger: f.w.value, response: f.r.value, delivery: 'JSON',
    triggers: [f.w.value], responses: [f.r.value], deliveries: ['JSON'] };
  if (!/^https?:\/\//.test(body.url)) return toast('The URL must start with http:// or https://');
  await withAuth(async () => { await api('/webhooks', { method: 'POST', body }); toast('Webhook added'); route(); });
}
async function toggleHook(id: string, on: boolean) { await withAuth(async () => { await api('/webhooks/' + id, { method: 'PUT', body: { active: on } }); toast(on ? 'Webhook on' : 'Webhook off'); }); }
async function deleteHook(id: string) {
  if (!await confirmBox('Delete this webhook?', 'Firefly will stop calling that address.')) return;
  await withAuth(async () => { await api('/webhooks/' + id, { method: 'DELETE' }); toast('Webhook deleted'); route(); });
}

// Apple Pay auto-logging (app/ingest.js): the address and key the iPhone Shortcut sends each payment to.
// Null when this server doesn't have it (an older image, or the plain-files setup without nginx).
// The key doesn't change while the server runs, so it's asked for once.
let ingestKeyMemo: string | null = null;
async function ingestKey(): Promise<string | null> {
  if (ingestKeyMemo) return ingestKeyMemo;
  try {
    const r = await fetch('/api/money-ingest', { cache: 'no-store', headers: { 'X-Money': '1' } });
    return ingestKeyMemo = r.ok ? (await r.json()).key || null : null;
  } catch (e) { return null; }
}
// Which account each Wallet card goes to, when its name doesn't say (app/ingest.js reads the same preference).
// unmatched: cards the server couldn't place, so you can pick their account here.
type Cards = { exists: boolean, cards: Record<string, string>, unmatched: string[] };
const CARD_PREF = 'money_cards';
let cardState: Cards = { exists: false, cards: {}, unmatched: [] }, cardNames: string[] = [];
// Kept until the next refresh (S.freshAfter), so redrawing Settings doesn't ask Firefly again; saving updates it.
let cardsMemo: { t: number, v: Cards } | null = null;
async function loadCards(): Promise<Cards> {
  if (cardsMemo && cardsMemo.t >= S.freshAfter) return cardsMemo.v;
  const v = await fetchCards(); cardsMemo = { t: Date.now(), v }; return v;
}
async function fetchCards(): Promise<Cards> {
  try {
    const r = await api('/preferences/' + CARD_PREF, { fresh: true }), d = r && r.data && r.data.attributes ? r.data.attributes.data : null;
    const v = typeof d === 'string' ? JSON.parse(d) : d;
    return { exists: true, cards: (v && v.cards) || {}, unmatched: (v && v.unmatched) || [] };
  } catch (e) { return { exists: false, cards: {}, unmatched: [] }; }
}
async function saveCards() {
  const data = JSON.stringify({ cards: cardState.cards, unmatched: cardState.unmatched });
  await withAuth(async () => {
    if (cardState.exists) await api('/preferences/' + CARD_PREF, { method: 'PUT', body: { data }, keepCache: true });
    else { await api('/preferences', { method: 'POST', body: { name: CARD_PREF, data }, keepCache: true }); cardState.exists = true; }
    cardsMemo = { t: Date.now(), v: cardState };
    toast('Saved');
  });
}
const sameCard = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
async function setCardAccount(i: number, id: string) {
  const name = cardNames[i]; if (name === undefined) return;
  if (id) cardState.cards[name] = id; else delete cardState.cards[name];
  cardState.unmatched = cardState.unmatched.filter(x => !sameCard(x, name));
  await saveCards(); route();
}
async function removeCard(i: number) {
  const name = cardNames[i]; if (name === undefined) return;
  delete cardState.cards[name]; cardState.unmatched = cardState.unmatched.filter(x => !sameCard(x, name));
  await saveCards(); route();
}
async function addCard(f: HTMLFormElement) {
  const name = (f.elements.namedItem('n') as HTMLInputElement).value.trim(), id = (f.elements.namedItem('a') as HTMLSelectElement).value;
  if (!name || !id) return toast('Type the card’s name as Wallet shows it, and pick its account.');
  Object.keys(cardState.cards).forEach(k => { if (sameCard(k, name)) delete cardState.cards[k]; });
  cardState.cards[name] = id; cardState.unmatched = cardState.unmatched.filter(x => !sameCard(x, name));
  await saveCards(); route();
}
function cardsHtml(cards: Cards | null, accounts: Account[]) {
  if (!cards) return '';
  cardState = cards;
  cardNames = Object.keys(cards.cards).concat(cards.unmatched.filter(u => !Object.keys(cards.cards).some(k => sameCard(k, u))));
  const options = (sel: string, none: string) => html`${opt('', none, sel)}${htmlList(accounts.map(a => opt(a.id, a.name, sel)))}`;
  const needs = cardNames.filter(n => !cards.cards[n]).length;
  return more('cards', 'Cards', needs ? html`<span class="chip warn">${needs} need${needs === 1 ? 's' : ''} an account</span>` : cardNames.length || '', html`<p class="sub-s" style="margin:0 0 8px">Money finds the account by the card’s name in Wallet. When the names differ, pick the account here. Cards Money couldn’t place show up here after their first payment.</p>${cardNames.length ? html`<div class="list">${htmlList(cardNames.map((n, i) => { const id = cards.cards[n] || ''; return html`<div class="row" style="flex-wrap:wrap;gap:8px"><span class="name" style="min-width:0">${n}${id ? '' : html` <span class="chip warn">Needs an account</span>`}</span><span style="display:flex;gap:8px;align-items:center;min-width:0;flex:1 1 200px"><select aria-label="Account for this card" data-onchange="App.setCardAccount(${i}, this.value)" style="flex:1;min-width:0">${options(id, 'Pick an account')}</select><button class="link" type="button" data-onclick="App.removeCard(${i})">Remove</button></span></div>`; }))}</div>` : ''}<form style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap" data-onsubmit="event.preventDefault();App.addCard(this)"><input name="n" type="text" placeholder="Card name in Wallet" aria-label="Card name in Wallet" style="flex:1;min-width:140px"><select name="a" aria-label="Account" style="flex:1;min-width:140px">${options('', 'Pick an account')}</select><button class="btn small">Add</button></form>`, needs > 0);
}
function applePayHtml(key: string | null, cards: Cards | null, accounts: Account[]) {
  if (!key) return '';
  const url = location.origin + '/api/money-ingest';
  return group('applepay', 'Apple Pay', html`
    ${row('Address', html`<code class="set-code">${url}</code>`, html`<button class="link" type="button" data-onclick="App.copyText('${url}', 'Address copied')">Copy</button>`)}
    <div class="set-row"><div class="set-label"><div>Key</div><div class="sub-s">Treat it like a password: anyone with it can add expenses.</div></div><div class="set-ctl set-key"><input id="applePayKey" type="password" readonly value="${key}" aria-label="Apple Pay key" autocomplete="off" spellcheck="false" data-onclick="App.selectKey()"><button class="link" type="button" data-onclick="App.showKey(this)">Show</button><button class="link" type="button" data-onclick="App.copyText('${key}', 'Key copied')">Copy</button></div></div>
    ${cardsHtml(cards, accounts)}
    ${more('applepay-how', 'How it works', '', html`<p class="sub-s">An iPhone Shortcut sends the amount, merchant and card here when you pay, and Money adds the expense to the account named like the card, tagged “Apple Pay”, with the category from the last time. Your iPhone must be able to reach this address when you pay, so outside your home network it needs a VPN (like Tailscale) or a reverse proxy. Changing the dashboard password or Firefly token gives a new key.</p>`)}`,
    html`Log purchases the moment you pay. <a class="link" href="https://www.icloud.com/shortcuts/0438843e50e74fb89c7fa20e4eda6ca0" target="_blank" rel="noopener">Add the shortcut ↗</a> (it asks for the address and key) · <a class="link" href="https://github.com/Muffy0906/firefly-money/blob/main/docs/apple-pay.md" target="_blank" rel="noopener">Setup guide ↗</a>`);
}
// The Clipboard API only works over HTTPS (or localhost), and most installs are plain HTTP on a home network,
// so fall back to the older copy command, and if that's blocked too, show the key selected for copying by hand.
async function copyText(text: string, done: string) {
  try {
    if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return toast(done); }
  } catch (e) { /* blocked: try the old way */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.readOnly = true; ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { /* not supported */ }
  ta.remove();
  if (ok) return toast(done);
  const key = document.getElementById('applePayKey') as HTMLInputElement | null;
  if (key && key.value === text) { if (key.type === 'password') showKey(key.parentElement!.querySelector('button')); else selectKey(); return toast('Your browser blocked copying. The key is selected: copy it from there.'); }
  toast('Your browser blocked copying. Select the text and copy it yourself.');
}
function selectKey() { const k = el<HTMLInputElement>('applePayKey'); k.focus(); k.select(); k.setSelectionRange(0, k.value.length); }
function showKey(btn: HTMLElement | null) {
  const k = el<HTMLInputElement>('applePayKey'), hide = k.type === 'text' && btn && btn.textContent === 'Hide';
  k.type = hide ? 'password' : 'text';
  if (btn) btn.textContent = hide ? 'Show' : 'Hide';
  if (!hide) selectKey();
}

function toggleLogos(on: boolean) { LS.set('logos', !!on); toast(on ? 'Logos on' : 'Logos off'); }
function toggleHaptics(on: boolean) { LS.set('haptics', !!on); if (on) buzz(); toast(on ? 'Haptics on' : 'Haptics off'); }
// The month start day: stay on the current month, and redraw every page with the new ranges
function setCycleDay(v: string) { LS.set('cycleDay', Math.min(28, Math.max(1, Math.floor(num(v)) || 1))); S.all = false; [S.y, S.m] = nowMonth(); PAGES.clear(); toast('Months now start on the ' + ordinal(cycleDay())); route(); }
function setBudgetAlert(v: string) { LS.set('budgetAlert', num(v)); PAGES.clear(); toast('Budget warnings at ' + budgetAlert() + '%'); }

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  currency,
  toggleLogos,
  toggleHaptics,
  setCycleDay,
  setBudgetAlert,
  copyText,
  selectKey,
  showKey,
  setCardAccount,
  removeCard,
  addCard,
  addRate,
  deleteRate,
  exportData,
  addHook,
  toggleHook,
  deleteHook,
  themeVar,
  themeRange,
  resetThemeCustom,
  themeScene,
  themePhoto,
  drawThemeCustom,
  setJump,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

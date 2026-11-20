import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { App, el, fmtDay, money, money0, period, todayIso, ALL_START } from '../core/base';
import { head, monthNav, toast } from '../core/dom';
import { t } from '../core/spanish';
import { type Group, avatarHtml, groupUpdate, normGroup, payeeOf, placeFields, unplaceFields } from '../core/feed';
import { LS } from '../core/helpers';
import { lists } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { type Place, type Want, away, candidates, learn, learned, osmOn, parseDescriptor, wantedStores } from '../features/stores';
import type * as Leaflet from 'leaflet';

/* ================= Map: where the money went =================
   Purchases that have a location (the Apple Pay shortcut sends one, see docs/apple-pay.md) as pins, one per payee
   and place, sized by what was spent there. The map is Leaflet, loaded only when this page opens (vendor/leaflet.ts).
   Its pictures are OpenStreetMap's, fetched and kept by this Money server (/tile/ in default.conf.template), so the
   browser only talks to Money. */
export type Spot = { key: string, name: string, lat: number, lng: number, total: number, groups: Group[] };

// One pin per payee and place (about 100 m apart counts as a different place: two branches of a chain)
export function spotsOf(groups: Group[]): Spot[] {
  const by = new Map<string, Spot>();
  for (const g of groups) {
    const s = g.splits.find(x => x.lat != null && x.lng != null);
    if (!s || g.type !== 'withdrawal') continue;
    const name = payeeOf(g).name, key = name + '@' + s.lat!.toFixed(3) + ',' + s.lng!.toFixed(3);
    const p: Spot = by.get(key) || { key, name: name || '', lat: s.lat!, lng: s.lng!, total: 0, groups: [] };
    p.total += g.total; p.groups.push(g); by.set(key, p);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

// Adds leaflet.js and leaflet.css (built next to app.js, with the same ?v= so a new version isn't cached) once
let leaflet: Promise<typeof Leaflet> | null = null;
function loadLeaflet() {
  return leaflet ||= new Promise((resolve, reject) => {
    const app = document.querySelector<HTMLScriptElement>('script[src*="/app.js"]')?.src || '/assets/js/app.js';
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = app.replace('/app.js', '/leaflet.css');
    const js = document.createElement('script');
    js.src = app.replace('/app.js', '/leaflet.js');
    js.onload = () => resolve((window as unknown as { L: typeof Leaflet }).L);
    js.onerror = () => { leaflet = null; reject(new Error('Couldn’t load the map')); };
    document.head.append(css, js);
  });
}

let map: Leaflet.Map | null = null, pins: Leaflet.Marker[] = [], spots: Spot[] = [];
function showSpot(i: number) {
  const s = spots[i]; if (!s) return;
  fix = null;
  pins.forEach((m, j) => { m.getElement()?.classList.toggle('on', i === j); m.setZIndexOffset(i === j ? 1000 : 0); });
  el('mapList').innerHTML = String(spotList(s, i));
}
const spotList = (s: Spot, i: number) => html`<h2 style="margin:0 0 2px">${s.name}</h2><p class="sub-s" style="margin:0 0 10px">${t(s.groups.length === 1 ? '{amount} in {count} purchase' : '{amount} in {count} purchases', { amount: money(s.total), count: s.groups.length })} · <a class="link" href="https://maps.apple.com/?ll=${s.lat},${s.lng}&amp;q=${encodeURIComponent(s.name)}" target="_blank" rel="noopener">Open in Maps ↗</a> · <button type="button" class="link" data-onclick="App.fixSpot(${i})">Correct location</button></p><div class="list">${htmlList(s.groups.map(g => html`<button type="button" class="row" style="width:100%;text-align:left" data-onclick="App.editTx('${g.id}')"><span class="name" style="display:flex;gap:10px;align-items:center">${avatarHtml(g)}<span>${g.splits[0].description}<br><span class="sub-s">${fmtDay(g.date)}</span></span></span><span class="num neg">${money(-g.total)}</span></button>`))}</div>`;

/* ---------- Which store was it? (features/stores.ts) ---------- */
// Purchases without a place whose payee names a chain and a store number ("WAL-MART #3826") get suggested stores,
// from stores you confirmed before, the bundled lists, and (if you turned it on) OpenStreetMap. Nothing is written
// to Firefly until you tap a suggestion.
let wants: Want[] = [], found: Place[][] = [], allGroups: Group[] = [], fix: { i: number, marker: Leaflet.Marker, at: Leaflet.LatLng, key: string, want: Want | null, alts: Place[] } | null = null;
let moved: { groups: Group[], from: { lat: number, lng: number }, key: string, prev: Learned | undefined, name: string } | null = null;
type Learned = ReturnType<typeof learned>[string];
const miles = /^en-(US|LR|MM)\b/i.test(navigator.language || 'en-US');
const awayText = (p: Place) => { const km = away(p); return km == null ? '' : t(' · {distance} from your other pins', { distance: miles ? (km / 1.609).toFixed(km < 16 ? 1 : 0) + ' mi' : km.toFixed(km < 10 ? 1 : 0) + ' km' }); };
const srcText = (p: Place) => p.src === 'learned' ? t('Confirmed before') : p.src === 'dataset' ? t('Store list') : 'OpenStreetMap';
const counted = (n: number, one: string, many: string) => t(n === 1 ? one : many, { count: n });
const purchaseLabel = (n: number) => counted(n, '{count} purchase', '{count} purchases');
const storeLabel = (n: number) => counted(n, '{count} store', '{count} stores');

// Writes the place to every part of these purchases. Firefly keeps latitude/longitude per part.
async function writePlace(groups: Group[], lat: number, lng: number) {
  await Promise.all(groups.map(g => api('/transactions/' + g.id, { method: 'PUT', body: groupUpdate(g, () => placeFields(lat, lng)) })));
}
async function clearPlace(groups: Group[]) {
  await Promise.all(groups.map(g => api('/transactions/' + g.id, { method: 'PUT', body: groupUpdate(g, () => unplaceFields()) })));
}
const keyOf = (gs: Group[]) => { for (const g of gs) { const p = parseDescriptor(g.splits[0]?.description) || parseDescriptor(String(payeeOf(g).name)); if (p) return p; } return null; };

// Bulk pin (To do > Places): tick stores, each pins its chosen candidate (the top one unless you tap another)
const ticked = new Set<string>(), chosen = new Map<string, number>();
type BulkState = { run: { done: number, total: number } | null, failed: { label: string, err: string }[], undo: { w: Want, prev: Learned | undefined }[] };
let bulk: BulkState = { run: null, failed: [], undo: [] };
const BULK_PARALLEL = 3;
const pickOf = (i: number) => Math.min(chosen.get(wants[i].key) ?? 0, found[i].length - 1);

// Also used by the To do > Places page (pages/places.ts): same suggestions, same one-tap pin, its own empty state
export let storeSolo = false;
// Map page "Re-analyze all": every withdrawal ever (not just the month on screen), every store without a place, no cap
export let storeFull = false;
let scanning = false, keepFull = false;
const redraw = () => { keepFull = storeFull; return route({ quiet: true }); };
export async function suggestStores(groups: Group[] = allGroups, solo = storeSolo, full = storeFull) {
  allGroups = groups; storeSolo = solo; storeFull = full;
  const box = document.getElementById('storeList'); if (!box) return;
  wants = wantedStores(allGroups); if (!full) wants = wants.slice(0, 30);
  if (!wants.length) { found = []; ticked.clear(); drawStores(); return; }
  const anchors = spotsOf(allGroups).map(x => ({ lat: x.lat, lng: x.lng }));
  found = await Promise.all(wants.map(w => candidates(w, anchors).catch(() => [])));
  if (!document.body.contains(box)) return;       // moved on to another page meanwhile
  drawStores();
}
function drawStores() {
  const box = document.getElementById('storeList'); if (!box) return;
  const hit = wants.map((w, i) => i).filter(i => found[i].length), miss = wants.length - hit.length, n = hit.reduce((a, i) => a + wants[i].groups.length, 0);
  box.hidden = false;
  for (const k of ticked) if (!hit.some(i => wants[i].key === k)) ticked.delete(k);
  const nTick = ticked.size, nTickBuys = hit.filter(i => ticked.has(wants[i].key)).reduce((a, i) => a + wants[i].groups.length, 0), busy = !!bulk.run;
  const bar = (hit.length > 1 || nTick || bulk.run || bulk.failed.length || bulk.undo.length) ? html`<div class="bulkbar" id="pinBar">${bulk.run ? html`<strong>${t('Pinning {done} of {total}…', { done: bulk.run.done, total: bulk.run.total })}</strong>` : html`<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-onchange="App.pinAll(this.checked)"${nTick === hit.length && hit.length ? ' checked' : ''}${hit.length ? '' : ' disabled'} aria-label="${t('Select all stores')}"> <strong>${nTick ? t('{count} selected', { count: nTick }) : t('Select all')}</strong></label>${nTick ? html`<button type="button" class="btn primary small" data-onclick="App.pinSelected()">${t('Pin')} ${storeLabel(nTick)} · ${purchaseLabel(nTickBuys)}</button>` : ''}`}${bulk.undo.length && !bulk.run ? html`<span class="sub-s">${t(bulk.undo.length === 1 ? 'Pinned {count} store.' : 'Pinned {count} stores.', { count: bulk.undo.length })} <button type="button" class="link" data-onclick="App.pinUndo()">${t('Undo')}</button></span>` : ''}${bulk.failed.length && !bulk.run ? html`<span class="sub-s neg" style="flex-basis:100%">${t('Firefly didn’t accept {count}: {errors}. Still selected; tap Pin to retry.', { count: bulk.failed.length, errors: bulk.failed.map(f => f.label + ' (' + f.err + ')').join(', ') })}</span>` : ''}</div>` : '';
  if (!wants.length && !storeSolo && !storeFull) { box.innerHTML = String(html`${rescan()}<p class="sub-s" style="margin:0">Looks at every purchase ever, not just this month, and lists the stores that still need a pin.</p>`); return; }
  if (!wants.length && storeFull) { box.innerHTML = String(html`${rescan()}<p class="sub-s" style="margin:0">Checked every purchase: none names a store without a place.</p>`); return; }
  if (!wants.length) { box.innerHTML = String(html`<div class="center-empty" style="padding:60px 20px"><div style="font-size:40px">✓</div><h2 style="font-size:18px;margin:10px 0 4px">${t('No places to pin')}</h2>${t('Purchases that name a store but have no location show up here.')}</div>`); return; }
  box.innerHTML = String(html`${storeSolo ? '' : html`<h2 style="margin:0 0 2px">${t(storeFull ? 'All stores found' : 'Stores found')}</h2>`}${rescan()}<p class="sub-s" style="margin:0 0 10px">${hit.length ? t('Purchases needing a place: {count}. Tap the right store to pin them; nothing is saved until you do.', { count: n }) : t('No match yet for {count} stores named in your purchases.', { count: wants.length })}</p>${bar}${htmlList(hit.map(i => { const w = wants[i], pj = pickOf(i), many = found[i].length > 1;
    return html`<div class="list" style="margin-bottom:10px"><p style="margin:0 0 4px;display:flex;gap:8px;align-items:center"><input type="checkbox" data-onchange="App.pinTick(${i},this.checked)"${ticked.has(w.key) ? ' checked' : ''}${busy ? ' disabled' : ''} aria-label="${t('Select {store} #{number}', { store: w.label, number: w.num })}"><span><b>${w.label} #${w.num}</b> <span class="sub-s">· ${purchaseLabel(w.groups.length)} · ${money(w.total)}</span></span></p>${htmlList(found[i].map((p, j) => html`<button type="button" class="row" style="width:100%;text-align:left" data-onclick="App.pinStore(${i},${j})"><span class="name">${p.addr || t('Address not listed')}<br><span class="sub-s">${srcText(p)}${awayText(p)}${many && j === pj ? t(' · used for the selection') : ''}</span></span><span class="link">${t('Pin')}</span></button>${many && j !== pj ? html`<button type="button" class="link sub-s" style="padding:0 0 6px 16px" data-onclick="App.pinChoose(${i},${j})">${t('Use this one when selecting')}</button>` : ''}`))}</div>`; }))}${miss && !osmOn() ? html`<p class="sub-s" style="margin:0">${t('More stores without a match in the bundled lists: {count}.', { count: miss })} <button type="button" class="link" data-onclick="App.storeOsm(true)">${t('Look them up online')}</button> ${t('(sends only the chain and store number, through this server).')}</p>` : osmOn() ? html`<p class="sub-s" style="margin:0">${t('Online lookup is on')}${miss ? t(' · {count} not found', { count: miss }) : ''}. <button type="button" class="link" data-onclick="App.storeOsm(false)">${t('Turn off')}</button></p>` : ''}`);
}
const rescan = () => storeSolo ? '' : html`<p style="margin:0 0 10px"><button type="button" class="btn small" id="reanalyze" data-onclick="App.reanalyzeAll()"${scanning ? ' disabled' : ''}>${t(scanning ? 'Analyzing every purchase…' : storeFull ? 'Re-analyze all again' : 'Re-analyze all purchases')}</button></p>`;
// Rescans every purchase ever recorded and lists pin options for each store still without a place. Always asks Firefly; if it can't answer, nothing is shown.
async function reanalyzeAll() {
  if (scanning) return;
  const box = document.getElementById('storeList'); if (!box) return;
  scanning = true; drawStores();
  try {
    const groups = (await getAll('/transactions', { type: 'withdrawal', start: ALL_START, end: todayIso() }, true)).map(normGroup);
    scanning = false;
    await suggestStores(groups, false, true);
  } catch (e) {
    scanning = false;
    toast(t('Couldn’t reach Firefly: {error}', { error: (e as Error).message || t('try again') }));
    drawStores();
  }
}
function pinTick(i: number, on: boolean) { const w = wants[i]; if (!w) return; if (on) ticked.add(w.key); else ticked.delete(w.key); drawStores(); }
function pinAll(on: boolean) { ticked.clear(); if (on) wants.forEach((w, i) => { if (found[i].length) ticked.add(w.key); }); drawStores(); }
function pinChoose(i: number, j: number) { const w = wants[i]; if (!w || !found[i][j]) return; chosen.set(w.key, j); drawStores(); }
// One confirm: writes every ticked store's chosen place (a few at a time), learns what worked, reports what didn't
async function pinSelected() {
  if (bulk.run) return;
  const todo = wants.map((w, i) => i).filter(i => ticked.has(wants[i].key) && found[i].length); if (!todo.length) return;
  bulk = { run: { done: 0, total: todo.length }, failed: [], undo: [] }; drawStores();
  const next = todo.slice();
  const worker = async () => {
    for (let i = next.shift(); i !== undefined; i = next.shift()) {
      const w = wants[i], p = found[i][pickOf(i)], prev = learned()[w.key];
      try { await writePlace(w.groups, p.lat, p.lng); learn(w.key, p); ticked.delete(w.key); bulk.undo.push({ w, prev }); }
      catch (e) { bulk.failed.push({ label: w.label + ' #' + w.num, err: (e as Error).message || 'try again' }); }
      bulk.run!.done++; drawStores();
    }
  };
  await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, todo.length) }, worker));
  bulk.run = null;
  const n = bulk.undo.reduce((a, u) => a + u.w.groups.length, 0);
  if (bulk.undo.length) toast(t('Pinned {purchases} at {stores}', { purchases: purchaseLabel(n), stores: storeLabel(bulk.undo.length) }));
  drawStores();
  if (bulk.undo.length) await redraw();
}
async function pinUndo() {
  const done = bulk.undo; if (!done.length || bulk.run) return;
  bulk.undo = []; bulk.run = { done: 0, total: done.length }; drawStores();
  const left: typeof done = [];
  for (const u of done) {
    try { await clearPlace(u.w.groups); const all = { ...learned() }; if (u.prev) all[u.w.key] = u.prev; else delete all[u.w.key]; LS.set('stores', all); }
    catch { left.push(u); }
    bulk.run.done++;
  }
  bulk.run = null; bulk.undo = left;
  toast(left.length ? t(left.length === 1 ? 'Couldn’t undo {count} store' : 'Couldn’t undo {count} stores', { count: left.length }) : t('Unpinned'));
  drawStores();
  await redraw();
}
async function pinStore(i: number, j: number) {
  const w = wants[i], p = found[i]?.[j]; if (!w || !p) return;
  try { await writePlace(w.groups, p.lat, p.lng); } catch (e) { toast(t('Firefly didn’t accept it: {error}', { error: (e as Error).message || t('try again') })); return; }
  learn(w.key, p);
  toast(t('Pinned {purchases} at {store}', { purchases: purchaseLabel(w.groups.length), store: w.label + ' #' + w.num }));
  redraw();
}

/* ---------- Correct a pin ---------- */
async function fixSpot(i: number) {
  const s = spots[i], m = pins[i]; if (!s || !m || !map) return;
  const p = keyOf(s.groups), at = m.getLatLng();
  const want: Want | null = p ? { key: p.key, label: p.label, num: p.num, chain: p.chain, osm: p.osm, groups: s.groups, total: s.total } : null;
  pins.forEach((x, j) => { if (j !== i) x.setOpacity(.35); });
  m.dragging?.enable();
  fix = { i, marker: m, at, key: p?.key || '', want, alts: [] };
  drawFix();
  map.on('click', fixTap); m.on('dragend', fixDrag);
  if (want) {                      // other stores with this number to choose from, besides the bundled/learned one
    const anchors = spots.filter((_, j) => j !== i).map(x => ({ lat: x.lat, lng: x.lng }));
    const alts = (await candidates(want, anchors, { skipLearned: true }).catch(() => [])).filter(c => Math.abs(c.lat - at.lat) + Math.abs(c.lng - at.lng) > 1e-4);
    if (fix && fix.i === i) { fix.alts = alts; drawFix(); }
  }
}
const fixTap = (e: Leaflet.LeafletMouseEvent) => { if (!fix) return; fix.marker.setLatLng(e.latlng); fix.at = e.latlng; drawFix(); };
const fixDrag = () => { if (fix) { fix.at = fix.marker.getLatLng(); drawFix(); } };
function drawFix() {
  if (!fix) return;
  const s = spots[fix.i], f = fix, n = s.groups.length;
  el('mapList').innerHTML = String(html`<h2 style="margin:0 0 2px">Correct location</h2><p class="sub-s" style="margin:0 0 10px">Drag the pin or tap the map where ${s.name} really is. Saving moves its ${n} purchase${n === 1 ? '' : 's'} here${f.key ? ' and remembers it for this store' : ''}.</p>${f.alts.length ? html`<div class="list" style="margin-bottom:10px">${htmlList(f.alts.map((p, j) => html`<button type="button" class="row" style="width:100%;text-align:left" data-onclick="App.fixPick(${j})"><span class="name">${p.addr || 'Address not listed'}<br><span class="sub-s">${srcText(p)}${awayText(p)}</span></span><span class="link">Use</span></button>`))}</div>` : ''}<div class="btns" style="display:flex;gap:8px"><button type="button" class="btn" data-onclick="App.fixCancel()">Cancel</button><button type="button" class="btn primary" data-onclick="App.fixSave()">Save location</button></div>`);
}
function fixPick(j: number) {
  const p = fix?.alts[j]; if (!fix || !p || !map) return;
  fix.marker.setLatLng([p.lat, p.lng]); fix.at = fix.marker.getLatLng();
  map.panTo(fix.at); drawFix();
}
function endFix(restore: boolean) {
  if (!fix || !map) return;
  map.off('click', fixTap); fix.marker.off('dragend', fixDrag);
  fix.marker.dragging?.disable();
  const s = spots[fix.i]; if (restore) fix.marker.setLatLng([s.lat, s.lng]);
  pins.forEach(x => x.setOpacity(1));
  const i = fix.i; fix = null; showSpot(i);
}
const fixCancel = () => endFix(true);
async function fixSave() {
  if (!fix) return;
  const f = fix, s = spots[f.i], to = f.at, prev = f.key ? learned()[f.key] : undefined;
  try { await writePlace(s.groups, to.lat, to.lng); } catch (e) { toast(t('Firefly didn’t accept it: {error}', { error: (e as Error).message || t('try again') })); return; }
  if (f.key) learn(f.key, { lat: to.lat, lng: to.lng, addr: '', src: 'learned' });
  moved = { groups: s.groups, from: { lat: s.lat, lng: s.lng }, key: f.key, prev, name: s.name };
  endFix(false);
  await redraw();
  if (moved) { const box = document.getElementById('mapList'); if (box) box.insertAdjacentHTML('afterbegin', String(html`<p class="sub-s" style="margin:0 0 10px">${t(moved.groups.length === 1 ? 'Moved {count} purchase at {name}.' : 'Moved {count} purchases at {name}.', { count: moved.groups.length, name: moved.name })} <button type="button" class="link" data-onclick="App.fixUndo()">Undo</button></p>`)); }
}
async function fixUndo() {
  const m = moved; if (!m) return; moved = null;
  try { await writePlace(m.groups, m.from.lat, m.from.lng); } catch (e) { toast(t('Couldn’t undo: {error}', { error: (e as Error).message || t('try again') })); moved = m; return; }
  if (m.key) { const all = { ...learned() }; if (m.prev) all[m.key] = m.prev; else delete all[m.key]; LS.set('stores', all); }
  toast('Moved back');
  redraw();
}
function storeOsm(on: boolean) { LS.set('storeOsm', on); suggestStores(allGroups, storeSolo); }

const methods = { reanalyzeAll, pinStore, pinTick, pinAll, pinChoose, pinSelected, pinUndo, fixSpot, fixPick, fixCancel, fixSave, fixUndo, storeOsm };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

VIEWS.map = async (r, paint) => {
  await lists();
  const p = period();
  const groups = (await getAll('/transactions', { start: p.start, end: p.end, type: 'withdrawal' })).map(normGroup);
  allGroups = groups; spots = spotsOf(groups); fix = null;
  const again = keepFull; keepFull = false;     // a pin just saved redraws the page: keep the all-purchases list
  const placed = spots.reduce((n, s) => n + s.groups.length, 0), spent = spots.reduce((n, s) => n + s.total, 0);
  const sub = placed
    ? t('{placed} of {total} purchases have a place · {amount}', { placed, total: groups.length, amount: money0(spent) })
    : t('No purchases with a place in {period}', { period: p.label });
  paint(html`${head('Map', sub, monthNav())}<section class="panel" style="padding:0;overflow:hidden"><div id="map" class="map"></div></section><section class="panel" id="mapList">${spots.length ? html`<p class="sub-s" style="margin:0">Tap a pin to see what you bought there. Bigger pins are where you spent more.</p>` : html`<div class="center-empty">Purchases get a place when the Apple Pay shortcut sends your location. See <a class="link" href="https://github.com/Muffy0906/firefly-money/blob/main/docs/apple-pay.md" target="_blank" rel="noopener">Optional extras</a>.</div>`}</section><section class="panel" id="storeList"></section>`);
  const L = await loadLeaflet().catch(() => null), box = document.getElementById('map');
  if (map) { map.remove(); map = null; }
  if (!box) return;
  if (!L) { box.innerHTML = String(html`<div class="center-empty">Couldn’t load the map. Check the connection and open the page again.</div>`); return; }
  map = L.map(box, { maxZoom: 19 });
  L.tileLayer('/tile/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
  const most = Math.max(1, ...spots.map(s => s.total));
  pins = spots.map((s, i) => {
    const size = Math.round(26 + 18 * Math.sqrt(s.total / most));
    return L.marker([s.lat, s.lng], { title: s.name + ': ' + money(s.total), alt: s.name, icon: L.divIcon({ className: 'map-pin', html: String(s.groups.length), iconSize: [size, size] }) })
      .on('click', () => showSpot(i)).addTo(map!);
  });
  if (spots.length) map.fitBounds(L.latLngBounds(spots.map(s => [s.lat, s.lng] as [number, number])), { padding: [40, 40], maxZoom: 16 });
  else map.setView([39.8, -98.6], 3);
  if (again) { storeFull = false; reanalyzeAll(); return; }
  suggestStores(groups, false, false);
};

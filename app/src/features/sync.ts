import { PAGES, api, type ApiError } from '../core/api';
import { App, S } from '../core/base';
import { LS } from '../core/helpers';
import { route } from '../core/router';
import { applyCustom } from '../core/themevars';

/* ---------- Settings that follow you between devices ----------
   The Overview layout and the choices below are kept in one Firefly user preference, so every device signed in to
   the same Firefly sees them. Your colours for each theme follow too; the theme itself, hide amounts and density stay with each device. The latest change wins. */
export const SYNCED = ['dash', 'insightsHidden', 'fcExclude', 'fcBuffer', 'fcDays', 'fcAccount', 'fcWhatIf', 'loanPlan', 'subsHidden', 'nwYears', 'logos', 'logoSites', 'reviewedAt', 'reviewed', 'cycleDay', 'budgetAlert', 'drafts', 'fcLog', 'savedReports', 'xferSkip', 'themeCustom', 'workLens', 'workHours', 'workRate', 'pageOpts', 'locale'];
const PREF = 'money_settings';
let timer: any = 0, applying = false, pulledAt = 0;
const syncOn = () => S.signedIn && !LS.get('syncOff', false);
function snapshot() {
  const keys: Record<string, unknown> = {};
  SYNCED.forEach(k => { const v = LS.get(k, undefined); if (v !== undefined) keys[k] = v; });
  return keys;
}
// LS.set calls this for every setting it saves
function prefChanged(k: string) {
  if (applying || !SYNCED.includes(k)) return;
  LS.set('syncDirty', Date.now());
  clearTimeout(timer); timer = setTimeout(pushPrefs, 1500);
}
async function pushPrefs() {
  if (!syncOn()) return;
  const t = Date.now(), data = JSON.stringify({ t, keys: snapshot() });
  try {
    // keepCache: saving a setting doesn't change any numbers, so the saved responses stay good
    try { await api('/preferences/' + PREF, { method: 'PUT', body: { data }, keepCache: true }); }
    catch (e) { if ((e as ApiError).status === 401) throw e; await api('/preferences', { method: 'POST', body: { name: PREF, data }, keepCache: true }); }
    LS.set('syncAt', t); LS.set('syncDirty', 0); S.syncError = '';
  } catch (e) { S.syncError = (e as Error).message || 'Firefly didn’t accept the settings.'; }
}
// Fetch the saved settings: newer than this device's → use them; this device has unsaved changes → send those
async function syncPrefs() {
  if (!syncOn()) return;
  pulledAt = Date.now();
  let remote: { t: number, keys?: Record<string, unknown> } | null = null;
  try {
    const r = await api('/preferences/' + PREF, { fresh: true }), d = r && r.data && r.data.attributes ? r.data.attributes.data : null;
    remote = typeof d === 'string' ? JSON.parse(d) : d;
  } catch (e) { if ((e as ApiError).status !== 404) { S.syncError = (e as Error).message; return; } }
  S.syncError = '';
  const dirty = LS.get('syncDirty', 0), at = LS.get('syncAt', 0);
  if (remote && remote.keys && +remote.t > Math.max(at, dirty)) return applyPrefs(remote);
  if (dirty || (!remote && Object.keys(snapshot()).length)) return pushPrefs();
}
function applyPrefs(remote: { t: number, keys?: Record<string, unknown> }) {
  let changed = false;
  applying = true;
  try {
    SYNCED.forEach(k => {
      const had = JSON.stringify(LS.get(k, null)), v = remote.keys![k];
      if (JSON.stringify(v === undefined ? null : v) === had) return;
      changed = true;
      if (v === undefined) { try { localStorage.removeItem('money.' + k); } catch (e) { /* storage blocked */ } } else LS.set(k, v);
    });
    LS.set('syncAt', +remote.t); LS.set('syncDirty', 0);
  } finally { applying = false; }
  if (changed) { applyCustom(); S.pageKey = ''; PAGES.clear(); route({ quiet: true }); }
}
function toggleSync(on: boolean) {
  LS.set('syncOff', !on);
  if (on) syncPrefs().then(() => route());
}
async function syncNow() { await pushPrefs(); route(); }
// Coming back to the app after a while picks up changes made on another device
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - pulledAt > 60000) syncPrefs(); });

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  prefChanged,
  syncPrefs,
  toggleSync,
  syncNow,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

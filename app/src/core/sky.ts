/* Interstellar theme: a sky that follows the clock, your location and (if you allow it) the weather. skyAt() is the pure maths;
   syncSky() lays it on <html> as CSS variables once a minute while the theme is on, and builds the scene behind the page.
   No imports: boot.js bundles this file too. Settings talks to it through localStorage and the 'skyprefs' event. */
const H = 60;
export type Wx = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';
export const WX: Wx[] = ['clear', 'cloudy', 'fog', 'rain', 'snow', 'storm'];
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
// Minute of day → [top, middle, horizon], anchored to sunrise and sunset. Every stop stays dark enough for the theme's light text (test/sky.test.ts).
export function keysFor(rise = 6 * H, set = 18 * H): [number, string, string, string][] {
  const mid = (rise + set) / 2, k = [
    [0, '#03050a', '#070b14', '#0c1220'], [rise - H, '#060a14', '#121a2c', '#2a2230'], [rise, '#14223c', '#4a3c52', '#7a4a2a'],
    [rise + 1.5 * H, '#14355f', '#285585', '#345676'], [mid, '#0f3a6e', '#1f5a92', '#2a5a88'], [set - 1.5 * H, '#0f3a6e', '#22567f', '#305878'],
    [set, '#141f3a', '#4a3350', '#7d4727'], [set + 1.5 * H, '#080c1a', '#1a1c30', '#3a2a2c'], [set + 3 * H, '#04060c', '#0a1020', '#10182a'], [1440, '#03050a', '#070b14', '#0c1220'],
  ] as [number, string, string, string][];
  return k.filter((x, i) => i === 0 || x[0] > k[i - 1][0]);
}
export const KEYS = keysFor();
const hex = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
export const mix = (a: string, b: string, t: number) => '#' + [0, 1, 2].map(i => Math.round(hex(a, i) + (hex(b, i) - hex(a, i)) * t).toString(16).padStart(2, '0')).join('');
// Sunrise and sunset in minutes UTC (NOAA's formulas), from a place and a day of the year; null where the sun doesn't rise or set
export function sunUTC(lat: number, lon: number, day: number): [number, number] | null {
  const g = 2 * Math.PI / 365 * (day - 1), rad = Math.PI / 180;
  const eq = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
  const dec = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
  const c = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec);
  if (!(c >= -1 && c <= 1)) return null;
  const ha = Math.acos(c) / rad;
  return [720 - 4 * (lon + ha) - eq, 720 - 4 * (lon - ha) - eq];
}
// Sunrise and sunset today as minutes of the local day (this device's time zone), kept within sensible hours
export function sunToday(lat: number, lon: number, d = new Date()): [number, number] {
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5), u = sunUTC(lat, lon, day);
  if (!u) return [6 * H, 18 * H];
  const m = (x: number) => (((x - d.getTimezoneOffset()) % 1440) + 1440) % 1440, rise = m(u[0]), set = m(u[1]);
  return rise < set ? [clamp(rise, 3 * H, 10 * H), clamp(set, 15 * H, 22.5 * H)] : [6 * H, 18 * H];
}
// WMO weather codes (Open-Meteo) → what the sky shows
export function wxOf(code: number): Wx {
  return code >= 95 ? 'storm' : code >= 85 && code <= 86 ? 'snow' : code >= 71 && code <= 77 ? 'snow' : code >= 80 || (code >= 51 && code <= 67) ? 'rain' : code === 45 || code === 48 ? 'fog' : code === 2 || code === 3 ? 'cloudy' : 'clear';
}
// How each weather changes the sky: grey-over amount, how much of the sun, stars and birds show, and the least cloud
const WXF: Record<Wx, { grey: number, sun: number, stars: number, birds: number, cloud: number, dark: number }> = {
  clear: { grey: 0, sun: 1, stars: 1, birds: 1, cloud: 0, dark: 0 }, cloudy: { grey: .15, sun: .75, stars: .6, birds: 1, cloud: .5, dark: .12 }, fog: { grey: .3, sun: .45, stars: .25, birds: 0, cloud: .45, dark: .1 },
  rain: { grey: .35, sun: .3, stars: .2, birds: 0, cloud: .7, dark: .5 }, snow: { grey: .25, sun: .4, stars: .3, birds: 0, cloud: .6, dark: .15 }, storm: { grey: .5, sun: .2, stars: .1, birds: 0, cloud: .8, dark: .72 },
};
export type Sky = { phase: 'dawn' | 'day' | 'dusk' | 'night', top: string, mid: string, bot: string, sun: { x: number, y: number, o: number, c: string }, moon: { x: number, y: number, o: number }, stars: number, birds: number, cloud: { o: number, c: string } };
const r1 = (n: number) => Math.round(n * 10) / 10;
// Where a body is on its arc: x runs left to right across the sky, y peaks at 11% down and sits on the horizon (36%), high enough to clear most cards at both ends
const arc = (t: number) => ({ x: r1(6 + 88 * t), y: r1(36 - 25 * Math.sin(Math.PI * t)) });
const fade = (t: number) => r1(clamp(Math.min(t, 1 - t) / .06, 0, 1));
export function skyAt(min: number, o: { rise?: number, set?: number, wx?: Wx } = {}): Sky {
  const rise = o.rise ?? 6 * H, set = o.set ?? 18 * H, f = WXF[o.wx || 'clear'], m = ((min % 1440) + 1440) % 1440, K = keysFor(rise, set);
  let i = K.length - 2; while (i > 0 && K[i][0] > m) i--;
  const a = K[i], b = K[i + 1], t = (m - a[0]) / (b[0] - a[0]), grey = (c: string) => f.grey ? mix(c, '#2c3440', f.grey) : c;
  const ts = (m - rise) / (set - rise), len = 1440 - set + rise, tm = ((m - set + 1440) % 1440) / len;    // 0..1 across the day, and across the night
  const up = ts >= 0 && ts <= 1, nightUp = tm <= 1;
  const phase = m >= rise - H && m < rise + H ? 'dawn' : m >= rise + H && m < set - H ? 'day' : m >= set - H && m < set + H ? 'dusk' : 'night';
  const el = up ? Math.sin(Math.PI * ts) : 0;                                                    // sun height: 0 at the horizon, 1 at noon
  const dark = m < rise - 2 * H || m >= set + 2 * H ? 1 : m < rise ? (rise - m) / (2 * H) : m >= set ? (m - set) / (2 * H) : 0;     // 1 at night, ramping through twilight; 0 by day
  return {
    phase, top: grey(mix(a[1], b[1], t)), mid: grey(mix(a[2], b[2], t)), bot: grey(mix(a[3], b[3], t)),
    sun: { ...arc(clamp(ts, 0, 1)), o: up ? r1(fade(ts) * f.sun) : 0, c: mix('#ff8a2a', '#ffe9a8', Math.min(1, el * 2)) },
    moon: { ...arc(Math.min(1, tm)), o: nightUp ? r1(fade(tm) * (.4 + .6 * f.sun)) : 0 },
    birds: r1(Math.min(1, el * 4) * f.birds), cloud: { o: r1(Math.max(.16 + .4 * el, f.cloud)), c: mix(up ? mix('#f0a070', '#e8f0fa', Math.min(1, el * 3)) : '#55627a', '#2a3242', f.dark) },
    stars: r1(dark * f.stars) };
}
const NAMES = ['--sky-top', '--sky-mid', '--sky-bot', '--sun-x', '--sun-y', '--sun-o', '--sun-c', '--moon-x', '--moon-y', '--moon-o', '--star-o', '--bird-o', '--cloud-o', '--cloud-c'];
export function paintSky(min: number, o: { rise?: number, set?: number, wx?: Wx } = {}, d: HTMLElement = document.documentElement) {
  const s = skyAt(min, o), v = [s.top, s.mid, s.bot, s.sun.x, s.sun.y, s.sun.o, s.sun.c, s.moon.x, s.moon.y, s.moon.o, s.stars, s.birds, s.cloud.o, s.cloud.c];
  NAMES.forEach((n, i) => d.style.setProperty(n, String(v[i]))); d.setAttribute('data-sky', s.phase);
  if (o.wx && o.wx !== 'clear') d.setAttribute('data-wx', o.wx); else d.removeAttribute('data-wx');
}
// The scene itself: one fixed layer behind the page (built once, removed when the theme is off). CSS draws and animates it.
const BOLT = '<svg class="sk-bolt b1" viewBox="0 0 60 200"><path d="M38 0L22 70L34 74L14 200L46 96L32 92Z"/></svg><svg class="sk-bolt b2" viewBox="0 0 60 200"><path d="M26 0L40 62L28 66L50 170L20 88L32 84Z"/></svg>';
const SCENE = '<i class="sk-stars"></i><i class="sk-stars b"></i><i class="sk-shoot"></i><i class="sk-moon"></i><i class="sk-sun"></i><i class="sk-over"></i>'
  + [1, 2, 3, 4, 5, 6, 7].map(n => '<i class="sk-cloud c' + n + '"></i>').join('')
  + [1, 2, 3, 4, 5].map(n => '<svg class="sk-bird b' + n + '" viewBox="0 0 24 10"><path d="M1 8Q6 0 12 7Q18 0 23 8"/></svg>').join('')
  + '<i class="sk-fog"></i><i class="sk-fog b"></i><i class="sk-fog c"></i><i class="sk-rain far"></i><i class="sk-rain"></i><i class="sk-rain near"></i><i class="sk-mist"></i>'
  + '<i class="sk-snow far"></i><i class="sk-snow"></i><i class="sk-snow near"></i><i class="sk-flash"></i>' + BOLT;
function scene(on: boolean) {
  let e = document.getElementById('sky');
  if (!on) { if (e) e.remove(); return; }
  if (e || !document.body) return;
  e = document.createElement('div'); e.id = 'sky'; e.setAttribute('aria-hidden', 'true'); e.innerHTML = SCENE; document.body.prepend(e);
}
// What you chose in Settings (kept on this device): a place, rounded to about 10 km, and the weather source
const pref = (k: string): unknown => { try { return JSON.parse(localStorage.getItem('money.' + k) || 'null'); } catch (e) { return null; } };
function place(): [number, number] | null { const p = pref('skyLoc') as { lat?: number, lon?: number } | null; return p && typeof p.lat === 'number' && typeof p.lon === 'number' ? [p.lat, p.lon] : null; }
// With no place chosen, the sun follows this device's time zone: the middle of it for longitude, and a mid latitude so the seasons still show
export const zonePlace = (d = new Date()): [number, number] => [38, clamp(Math.round(-d.getTimezoneOffset() / 4 * 10) / 10, -180, 180)];
let timer = 0, live: Wx | null = null, liveAt = 0, liveFor = '';
// Real weather comes from this server's relay (/wx), never from the browser; when it can't be had, no weather is shown rather than an old one
async function fetchLive(loc: [number, number]) {
  const key = loc.join(',');
  liveAt = Date.now(); liveFor = key;
  try {
    const r = await fetch('/wx/' + loc[0].toFixed(1) + '/' + loc[1].toFixed(1), { credentials: 'same-origin' });
    const j = r.ok ? await r.json() : null, code = j && j.current && j.current.weather_code;
    live = typeof code === 'number' ? wxOf(code) : null;
  } catch (e) { live = null; }
  if (liveFor === key) syncSky(false);
}
export function syncSky(refetch = true) {
  const d = document.documentElement, on = d.getAttribute('data-theme') === 'interstellar';
  clearInterval(timer); timer = 0; scene(on);
  if (!on) { NAMES.forEach(n => d.style.removeProperty(n)); d.removeAttribute('data-sky'); d.removeAttribute('data-wx'); live = null; return; }
  const tick = (fetching = true) => {
    const n = new Date(), loc = place(), w = pref('skyWx') as string | null, zp = loc || zonePlace(n), sun = sunToday(zp[0], zp[1], n);
    let wx: Wx | undefined;
    if (w && (WX as string[]).includes(w)) wx = w as Wx;                                           // a preview you picked
    else if (w === 'live' && loc) { if (fetching && (Date.now() - liveAt > 15 * 60000 || liveFor !== loc.join(','))) fetchLive(loc); wx = live || undefined; }
    paintSky(n.getHours() * H + n.getMinutes(), { rise: sun[0], set: sun[1], wx });
  };
  tick(refetch); timer = window.setInterval(() => { if (!document.hidden) tick(); }, 60000);
}
// Any way the theme changes (picker, palette, boot) goes through the attribute
if (typeof MutationObserver !== 'undefined') new MutationObserver(() => syncSky()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) syncSky(); });   // catch up after the tab slept
window.addEventListener('skyprefs', () => { liveAt = 0; live = null; syncSky(); });                      // Settings changed the place or the weather
document.addEventListener('DOMContentLoaded', () => syncSky());                                         // boot.js runs in <head>, before <body> exists
syncSky();

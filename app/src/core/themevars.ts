/* Your own colours on top of a theme (Settings → Appearance → Customize). Kept per theme in money.themeCustom,
   e.g. { glass: { bg: '#07060f', glow1: '#ff4fd8', blur: 26 } } (Frosted glass takes the same glass fields, but not motion), and laid on <html> as CSS variables, which beat the
   theme's own. boot.ts runs applyCustom before the first paint. No imports: boot.js bundles this file too. */
export type Custom = { bg?: string, accent?: string, glow1?: string, glow2?: string, glow3?: string, tint?: string, frost?: number, blur?: number, motion?: boolean, scene?: string };
// What's behind Frosted glass: a soft-focus scene drawn in CSS, or a photo of yours (kept on this device only, in
// money.bgPhoto, since it's too big to sync)
export const SCENES: [string, string][] = [['room', 'Warm room'], ['dunes', 'Desert dusk'], ['garden', 'Morning garden'], ['coast', 'Coast'], ['blossom', 'Blossom'], ['night', 'Night city']];
export const PHOTO_KEY = 'bgPhoto';
function readPhoto() { try { const v = JSON.parse(localStorage.getItem('money.' + PHOTO_KEY) || 'null'); return typeof v === 'string' && v.startsWith('data:image/') ? v : ''; } catch (e) { return ''; } }
export const KEY = 'themeCustom';
const VARS = ['--bg', '--accent', '--on-accent', '--glow1', '--glow2', '--glow3', '--glass-base', '--glass-tint', '--glass-blur', '--glass-motion', '--photo'];
export const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
export function readCustom(): Record<string, Custom> {
  try { const v = JSON.parse(localStorage.getItem('money.' + KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
// Relative luminance (WCAG) of a #rrggbb colour
export function lum(hex: string) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
// Text on an accent-coloured button: whichever of near-black and white reads better
export const onAccent = (hex: string) => (lum(hex) + .05) / .06 > 1.05 / (lum(hex) + .05) ? '#0b0b0c' : '#ffffff';
export function applyCustom(theme?: string) {
  const d = document.documentElement, t = theme || d.getAttribute('data-theme') || 'auto';
  VARS.forEach(v => d.style.removeProperty(v));
  d.removeAttribute('data-scene');
  const c = t === 'auto' ? null : readCustom()[t];
  if (!c) return;
  if (t === 'frosted' && c.scene === 'photo') { const ph = readPhoto(); if (ph) { d.setAttribute('data-scene', 'photo'); d.style.setProperty('--photo', 'url("' + ph + '")'); } }
  else if (t === 'frosted' && SCENES.some(x => x[0] === c.scene) && c.scene !== 'room') d.setAttribute('data-scene', c.scene!);
  if (isHex(c.bg)) d.style.setProperty('--bg', c.bg);
  if (isHex(c.accent)) { d.style.setProperty('--accent', c.accent); d.style.setProperty('--on-accent', onAccent(c.accent)); }
  if (t !== 'glass' && t !== 'frosted') return;
  (['glow1', 'glow2', 'glow3'] as const).forEach(k => { if (isHex(c[k])) d.style.setProperty('--' + k, c[k]); });
  if (isHex(c.tint)) d.style.setProperty('--glass-base', c.tint);
  if (typeof c.frost === 'number') d.style.setProperty('--glass-tint', Math.max(0, Math.min(95, c.frost)) + '%');
  if (typeof c.blur === 'number') d.style.setProperty('--glass-blur', Math.max(0, Math.min(60, c.blur)) + 'px');
  if (c.motion === false) d.style.setProperty('--glass-motion', 'paused');
}

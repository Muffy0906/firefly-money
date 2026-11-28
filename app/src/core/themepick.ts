import { html, htmlList } from './html';
import { currentTheme } from './themevars';

/* ================= The theme list and its picker (grouped chips with a swatch) ================= */
export const THEMES = [
  ['auto', 'Calm (follows your system)', 'linear-gradient(135deg,#f6f5f1 50%,#1d1e1b 50%)'],
  ['light', 'Calm light', '#f6f5f1'], ['dark', 'Calm dark', '#1d1e1b'],
  ['carbon', 'Carbon neon', 'linear-gradient(135deg,#1f1f23 45%,#39ff9f 45%,#19e3ff)'],
  ['midnight', 'Midnight', 'linear-gradient(135deg,#7c5cff,#38bdf8)'], ['neon', 'Neon', 'linear-gradient(135deg,#ff2e97,#00e0ff)'],
  ['glass', 'Liquid glass neon', 'radial-gradient(circle at 30% 30%,#ffffffcc 0 12%,transparent 13%),linear-gradient(135deg,#37f5ff,#b86bff 50%,#ff4fd8)'],
  ['frosted', 'Frosted glass', 'radial-gradient(circle at 30% 30%,#ffffffd9 0 14%,transparent 15%),linear-gradient(135deg,#efe4d6,#b98a64 55%,#e2552c)'],
  ['spatial', 'Spatial glass', 'radial-gradient(circle at 30% 30%,#ffffff99 0 12%,transparent 13%),linear-gradient(135deg,#5a6678,#343c48 60%,#9ac6ff)'],
  ['matte', 'Matte glass', 'radial-gradient(circle at 30% 30%,#ffffff40 0 12%,transparent 13%),linear-gradient(135deg,#3a3f47 0 45%,#14151a 45% 72%,#ff5f00 72%)'],
  ['polar', 'Polar glass', 'radial-gradient(circle at 30% 30%,#ffffffcc 0 12%,transparent 13%),linear-gradient(135deg,#f5f8fb 0 45%,#b3d3e8 45% 72%,#e4002b 72%)'],
  ['interstellar', 'Interstellar', 'radial-gradient(circle at 68% 34%,#0a0805 0 9%,#c98a3c 10% 13%,transparent 14%),linear-gradient(160deg,#04060a,#1a2b40 62%,#5a3a22)'],
  ['ocean', 'Ocean', 'linear-gradient(135deg,#14b8a6,#3b9eff)'], ['sunrise', 'Sunrise', 'linear-gradient(135deg,#e8452c,#f59e0b)'],
  ['forest', 'Forest', 'linear-gradient(135deg,#15211b 45%,#6fcf97 45%,#f2c94c)'], ['nord', 'Nord', 'linear-gradient(135deg,#2e3440 45%,#88c0d0 45%,#b48ead)'],
  ['rose', 'Rosé', 'linear-gradient(135deg,#d6456e,#9b6bdf)'],
  // Pastels: the page colour, the soft accent and the deeper tone that carries text and buttons
  ['sakura', 'Sakura Milk', 'linear-gradient(135deg,#fff5f7 0 38%,#e8a0b4 38% 68%,#a04b67 68%)'],
  ['mint', 'Mint Cream', 'linear-gradient(135deg,#f2fbf6 0 38%,#8fd3b0 38% 68%,#2f7a57 68%)'],
  ['lavender', 'Lavender Haze', 'linear-gradient(135deg,#f6f3fd 0 38%,#b7a6e8 38% 68%,#6a55b5 68%)'],
  ['peach', 'Peach Fizz', 'linear-gradient(135deg,#fff6ef 0 38%,#f4b393 38% 68%,#a44e27 68%)'],
  ['sky', 'Sky Powder', 'linear-gradient(135deg,#f1f7fd 0 38%,#9cc6ee 38% 68%,#2f6da6 68%)'],
  ['butter', 'Butter & Sage', 'linear-gradient(135deg,#fbfaee 0 38%,#a9c7a0 38% 68%,#4e7044 68%)'],
];
// The picker: a mode row (Auto, Light, Dark and the glass looks), then an accent row for Light or Dark.
// Accents are the old pastel and bold themes; they are still stored as the theme key, so saved choices keep working.
export const MODES: [string, string][] = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['glass', 'Liquid glass'], ['frosted', 'Frosted glass'], ['spatial', 'Spatial glass'], ['matte', 'Matte glass'], ['polar', 'Polar glass'], ['interstellar', 'Interstellar']];
export const ACCENTS: Record<string, [string, string][]> = {
  light: [['light', 'Calm'], ['sakura', 'Sakura Milk'], ['mint', 'Mint Cream'], ['lavender', 'Lavender Haze'], ['peach', 'Peach Fizz'], ['sky', 'Sky Powder'], ['butter', 'Butter & Sage'], ['sunrise', 'Sunrise'], ['rose', 'Rosé']],
  dark: [['dark', 'Calm'], ['carbon', 'Carbon neon'], ['midnight', 'Midnight'], ['neon', 'Neon'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['nord', 'Nord']],
};
// Which mode a theme belongs to (a pastel is Light with an accent)
export const modeOf = (k: string) => ACCENTS.light.some(a => a[0] === k) ? 'light' : ACCENTS.dark.some(a => a[0] === k) ? 'dark' : k;
// The accent you last picked for Light and for Dark, so switching modes and back keeps your look
const ACC_KEY = 'moneyAccent';
const accents = (): Record<string, string> => { try { const v = JSON.parse(localStorage.getItem(ACC_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
export function rememberAccent(k: string) {
  const m = modeOf(k); if (m !== 'light' && m !== 'dark') return;
  try { localStorage.setItem(ACC_KEY, JSON.stringify({ ...accents(), [m]: k })); } catch (e) { /* storage blocked */ }
}
const modeTarget = (m: string) => { const a = accents()[m]; return (m === 'light' || m === 'dark') && a && ACCENTS[m].some(x => x[0] === a) ? a : m; };
// border-box origin: otherwise the gradient tiles under the 2px border and a sliver of the opposite colour shows at the edge
export function themeButtons() {
  const cur = currentTheme(), mode = modeOf(cur), sw = new Map(THEMES.map(t => [t[0], t[2]])), full = new Map(THEMES.map(t => [t[0], t[1]]));
  const chip = (k: string, name: string, on: boolean, to = k) => html`<button type="button" role="radio" class="tp${on ? ' on' : ''}" aria-checked="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}" aria-label="${full.get(k) || name}" data-onclick="App.setTheme('${to}')"><span class="tp-sw" style="background:${sw.get(k) || ''};background-origin:border-box"></span><span class="tp-name">${name}</span></button>`;
  const row = (label: string, items: any) => html`<div class="tp-group" role="radiogroup" aria-label="${label}"><div class="tp-head" aria-hidden="true">${label}</div><div class="tp-grid">${items}</div></div>`;
  const acc = ACCENTS[mode];
  return html`<div class="tpick">${row('Mode', htmlList(MODES.map(([k, name]) => chip(k, name, k === mode, modeTarget(k)))))}${acc ? row('Accent', htmlList(acc.map(([k, name]) => chip(k, name, k === cur)))) : ''}</div>`;
}
// Arrow keys move through each row (modes, accents) as a radio group (and pick the one you land on); Tab leaves the group
document.addEventListener('keydown', e => {
  const t = e.target instanceof Element ? e.target.closest<HTMLElement>('.tpick .tp') : null;
  if (!t || e.altKey || e.ctrlKey || e.metaKey) return;
  const all = [...t.closest('[role=radiogroup]')!.querySelectorAll<HTMLElement>('.tp')], i = all.indexOf(t);
  const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % all.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + all.length - 1) % all.length
    : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault(); all[to].focus(); all[to].click();
});

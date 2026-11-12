import { html, htmlList } from './html';

/* ================= The theme list and its picker (grouped chips with a swatch) ================= */
const currentTheme = () => document.documentElement.getAttribute('data-theme') || 'auto';
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
// How the picker groups them: a heading, then [theme, short name] for each
export const THEME_GROUPS: [string, [string, string][]][] = [
  ['Calm', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]],
  ['Pastel', [['sakura', 'Sakura Milk'], ['mint', 'Mint Cream'], ['lavender', 'Lavender Haze'], ['peach', 'Peach Fizz'], ['sky', 'Sky Powder'], ['butter', 'Butter & Sage']]],
  ['Bold', [['carbon', 'Carbon neon'], ['midnight', 'Midnight'], ['neon', 'Neon'], ['ocean', 'Ocean'], ['sunrise', 'Sunrise'], ['forest', 'Forest'], ['nord', 'Nord'], ['rose', 'Rosé']]],
  ['Glass', [['glass', 'Liquid glass'], ['frosted', 'Frosted glass'], ['spatial', 'Spatial glass'], ['matte', 'Matte glass'], ['polar', 'Polar glass']]],
];
// border-box origin: otherwise the gradient tiles under the 2px border and a sliver of the opposite colour shows at the edge
export function themeButtons() {
  const cur = currentTheme(), sw = new Map(THEMES.map(t => [t[0], t[2]])), full = new Map(THEMES.map(t => [t[0], t[1]]));
  return html`<div class="tpick" role="radiogroup" aria-label="Theme">${htmlList(THEME_GROUPS.map(([g, items]) => html`<div class="tp-group" role="group" aria-label="${g}"><div class="tp-head" aria-hidden="true">${g}</div><div class="tp-grid">${htmlList(items.map(([k, name]) => html`<button type="button" role="radio" class="tp${k === cur ? ' on' : ''}" aria-checked="${k === cur ? 'true' : 'false'}" tabindex="${k === cur ? '0' : '-1'}" aria-label="${full.get(k) || name}" data-onclick="App.setTheme('${k}')"><span class="tp-sw" style="background:${sw.get(k) || ''};background-origin:border-box"></span><span class="tp-name">${name}</span></button>`))}</div></div>`))}</div>`;
}
// Arrow keys move through the themes as one radio group (and pick the one you land on); Tab leaves the group
document.addEventListener('keydown', e => {
  const t = e.target instanceof Element ? e.target.closest<HTMLElement>('.tpick .tp') : null;
  if (!t || e.altKey || e.ctrlKey || e.metaKey) return;
  const all = [...t.closest('.tpick')!.querySelectorAll<HTMLElement>('.tp')], i = all.indexOf(t);
  const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % all.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + all.length - 1) % all.length
    : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault(); all[to].focus(); all[to].click();
});

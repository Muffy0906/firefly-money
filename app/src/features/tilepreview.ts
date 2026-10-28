import { type Html, html, htmlList } from '../core/html';
import { SERIES } from '../core/feed';

/* ---------- What each Overview card looks like, for Customize → Add cards ----------
   A small sketch in the theme's colours (no data: cards that are off aren't fetched), shown when you hover a card
   in the list, and as a thumbnail in it on a touch screen. */
const W = 200, H = 110;
const faint = 'color-mix(in srgb, var(--muted) 30%, transparent)';
const svg = (body: Html | string) => html`<svg class="tpv" viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}</svg>`;
// A grey line standing in for text, and a heading over a card
const text = (x: number, y: number, w: number, c = faint, h = 5) => html`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${c}"/>`;
const head = () => text(12, 12, 54, 'color-mix(in srgb, var(--text) 45%, transparent)', 6);
// The ring chart with a short legend beside it
function donut(parts = [32, 24, 18, 14, 12]) {
  let at = 0;
  const segs = htmlList(parts.map((p, i) => { const s = html`<circle cx="52" cy="64" r="26" fill="none" stroke="${SERIES[i]}" stroke-width="10" pathLength="100" stroke-dasharray="${p - 2} ${102 - p}" stroke-dashoffset="${-at}" transform="rotate(-90 52 64)"/>`; at += p; return s; }));
  const legend = htmlList(parts.slice(0, 4).map((_, i) => html`<circle cx="104" cy="${44 + i * 14}" r="3" fill="${SERIES[i]}"/>${text(112, 42 + i * 14, 50 - i * 6)}${text(176, 42 + i * 14, 12)}`));
  return svg(html`${head()}${segs}${legend}`);
}
// Rows of a list: a name on the left, an amount on the right, an optional bar under the name
const list = (n = 4, bars = false) => svg(html`${head()}${htmlList([...Array(n)].map((_, i) => {
  const y = 32 + i * (bars ? 19 : 18);
  return html`${text(12, y, 70 - i * 9)}${text(160, y, 28)}${bars ? html`<rect x="12" y="${y + 9}" width="176" height="4" rx="2" fill="${faint}"/><rect x="12" y="${y + 9}" width="${150 - i * 34}" height="4" rx="2" fill="${SERIES[i]}"/>` : ''}`;
}))}`);
// Bars by month, in pairs (earned and spent) or one per month
function bars(pairs: boolean) {
  const n = 6, slot = 176 / n, a = [70, 64, 72, 66, 70, 44], b = [18, 22, 30, 20, 18, 34];
  return svg(html`${head()}<line x1="12" x2="188" y1="98" y2="98" stroke="${faint}"/>${htmlList(a.map((v, i) => {
    const x = 12 + slot * i + slot / 2;
    return pairs ? html`<rect x="${x - 9}" y="${98 - v * .9}" width="8" height="${v * .9}" rx="2" fill="var(--good)"/><rect x="${x + 1}" y="${98 - b[i] * .9}" width="8" height="${b[i] * .9}" rx="2" fill="var(--spend)"/>`
      : html`<rect x="${x - 7}" y="${98 - (a[i] - b[i]) * 1.2}" width="14" height="${(a[i] - b[i]) * 1.2}" rx="2" fill="${i === n - 1 ? 'var(--accent)' : faint}"/>`;
  }))}`);
}
// A line over time, or two (this month against last)
function line(two: boolean) {
  const up = 'M12 92 C40 88 60 90 84 80 S130 70 150 54 S176 34 188 30', before = 'M12 96 C50 92 90 84 120 78 S170 66 188 62';
  return svg(html`${head()}${two ? html`<path d="${before}" fill="none" stroke="${faint}" stroke-width="2" stroke-dasharray="4 4"/>` : html`<path d="${up} L188 100 L12 100 Z" fill="var(--good)" fill-opacity=".14"/>`}<path d="${up}" fill="none" stroke="${two ? 'var(--spend)' : 'var(--good)'}" stroke-width="2.5"/>`);
}
// A number with something small under it
const stat = (c: string, pic: Html | string = '') => svg(html`${text(12, 14, 40)}<rect x="12" y="28" width="96" height="16" rx="5" fill="${c}"/>${text(12, 52, 60)}${pic}`);
const ring = (cx: number, cy: number, r: number, p: number, c: string) => html`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${faint}" stroke-width="6"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="${p} 100" transform="rotate(-90 ${cx} ${cy})"/>`;
function calendar() {
  const cells = htmlList([...Array(35)].map((_, i) => { const v = (i * 37 % 11) / 10; return html`<rect x="${12 + (i % 7) * 25}" y="${28 + Math.floor(i / 7) * 16}" width="21" height="12" rx="3" fill="var(--spend)" fill-opacity="${(.12 + v * .7).toFixed(2)}"/>`; }));
  return svg(html`${head()}${cells}`);
}
function flow() {
  const band = (y1: number, y2: number, h: number, c: string) => html`<path d="M40 ${y1} C100 ${y1} 100 ${y2} 160 ${y2} L160 ${y2 + h} C100 ${y2 + h} 100 ${y1 + h} 40 ${y1 + h} Z" fill="${c}" fill-opacity=".45"/>`;
  return svg(html`${head()}<rect x="30" y="30" width="10" height="70" rx="2" fill="var(--good)"/>${band(30, 28, 26, SERIES[0])}${band(56, 60, 20, SERIES[1])}${band(76, 86, 14, SERIES[2])}${band(90, 104 - 4, 6, SERIES[3])}${htmlList([[28, 26], [60, 20], [86, 14]].map(([y, h], i) => html`<rect x="160" y="${y}" width="10" height="${h}" rx="2" fill="${SERIES[i]}"/>`))}`);
}
const cards = (n: number) => svg(htmlList([...Array(n)].map((_, i) => html`<rect x="${12 + i * 62}" y="20" width="56" height="70" rx="8" fill="none" stroke="${faint}"/><rect x="${18 + i * 62}" y="28" width="12" height="12" rx="3" fill="${SERIES[i]}" fill-opacity=".5"/>${text(18 + i * 62, 48, 40, 'color-mix(in srgb, var(--text) 40%, transparent)')}${text(18 + i * 62, 58, 32)}${text(18 + i * 62, 66, 36)}`)));

const PREVIEWS: Record<string, () => Html> = {
  spending: () => donut(), payees: () => donut([28, 22, 20, 16, 14]), income: () => donut([62, 26, 12]),
  budgets: () => svg(html`${head()}${ring(50, 66, 22, 72, 'var(--good)')}${ring(110, 66, 22, 96, 'var(--warn)')}${ring(170, 66, 22, 30, 'var(--good)')}`),
  goals: () => list(3, true), loans: () => list(3, true), trends: () => list(4, true),
  bills: () => list(4), recent: () => list(4), cash: () => list(4), cards: () => list(3), attention: () => list(3),
  cashflow: () => bars(true), savings: () => bars(false), networth: () => line(false), pace: () => line(true),
  heatmap: calendar, flow, insights: () => cards(3),
  spent: () => stat('color-mix(in srgb, var(--text) 50%, transparent)', html`${htmlList([20, 24, 30, 22, 20, 40].map((h, i) => html`<rect x="${120 + i * 12}" y="${100 - h}" width="9" height="${h}" rx="2" fill="${i === 5 ? 'var(--accent)' : faint}"/>`))}`),
  earned: () => stat('color-mix(in srgb, var(--text) 50%, transparent)', ring(160, 72, 22, 45, 'var(--good)')),
  safe: () => stat('color-mix(in srgb, var(--good) 70%, transparent)'),
};
export const tilePreview = (k: string) => PREVIEWS[k] ? PREVIEWS[k]() : '';

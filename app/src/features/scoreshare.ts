import { escape, html, raw } from '../core/html';
import { App } from '../core/base';
import { openDrawer, toast } from '../core/dom';
import { t } from '../core/spanish';
import { type Rating, type Score, TREND_WORD } from './scorecard';

/* ================= The picture you can share =================
   Only words: the personality, each rating with its trend, the best habit and the biggest improvement. No amounts, no
   percentages, no names of accounts, payees or categories, and no dates, so it is safe to post. It is drawn here as an
   SVG, turned into a PNG on this device, and shared with the system share sheet (or saved when the device has none).
   Tested in test/scorecard.test.ts: the picture holds no digits and no currency. */
export const SHARE_W = 1080;
const COLOR: Record<Rating, string> = { Strong: '#2d8a57', Steady: '#3a78b0', Building: '#b9801a', 'Needs attention': '#b8503b' };
const wrap = (text: string, max: number) => {
  const out: string[] = []; let line = '';
  for (const w of text.split(' ')) { if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; }
  if (line) out.push(line);
  return out;
};
export function shareSvg(score: Score): string {
  const M = 80, FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', parts: string[] = [];
  let y = 150;
  const text = (x: number, yy: number, size: number, weight: number, fill: string, v: string, anchor = 'start') =>
    parts.push('<text x="' + x + '" y="' + yy + '" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '" text-anchor="' + anchor + '">' + escape(t(v)) + '</text>');
  text(M, y, 34, 600, '#6b6b6b', 'My money scorecard'); y += 100;
  text(M, y, 82, 700, '#1c1c1c', score.person.label); y += 62;
  for (const l of wrap(t(score.person.line), 46)) { parts.push('<text x="' + M + '" y="' + y + '" font-size="34" fill="#4a4a4a">' + escape(l) + '</text>'); y += 46; }
  y += 30;
  for (const g of score.grades) {
    parts.push('<rect x="' + M + '" y="' + y + '" width="' + (SHARE_W - 2 * M) + '" height="104" rx="22" fill="#f4f1ea"/>');
    text(M + 32, y + 64, 38, 600, '#1c1c1c', g.name);
    if (g.trend) text(SHARE_W - M - 300, y + 62, 28, 500, '#6b6b6b', TREND_WORD[g.trend], 'end');
    parts.push('<rect x="' + (SHARE_W - M - 270) + '" y="' + (y + 24) + '" width="238" height="56" rx="28" fill="' + COLOR[g.rating] + '"/>');
    text(SHARE_W - M - 151, y + 63, 28, 600, '#ffffff', g.rating, 'middle');
    y += 124;
  }
  y += 44;
  const line = (label: string, name: string) => { text(M, y, 30, 500, '#6b6b6b', label); y += 48; text(M, y, 44, 700, '#1c1c1c', name); y += 70; };
  if (score.improved) line('Biggest improvement', score.improved.name);
  if (score.best) line('Best habit', score.best.name);
  y += 10; text(M, y, 28, 500, '#8a8a8a', 'Worked out on my own device'); y += 60;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + SHARE_W + '" height="' + y + '" viewBox="0 0 ' + SHARE_W + ' ' + y + '" font-family="' + FONT + '"><rect width="' + SHARE_W + '" height="' + y + '" fill="#fbf9f4"/>' + parts.join('') + '</svg>';
}

async function toPng(svg: string): Promise<Blob> {
  const img = new Image(), w = SHARE_W, h = +(/height="(\d+)"/.exec(svg) || [])[1] || w;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d')!; cx.drawImage(img, 0, 0, w, h);
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('no image')), 'image/png'));
}

let current: Score | null = null, ready: Promise<File> | null = null;
export const scoreForShare = (s: Score) => { current = s; };
function file(): Promise<File> {
  if (!current) return Promise.reject(new Error('no scorecard'));
  return ready || (ready = toPng(shareSvg(current)).then(b => new File([b], 'money-scorecard.png', { type: 'image/png' })));
}
function scorePreview() {
  if (!current) return;
  ready = null; file().catch(() => {});                                       // drawn while the preview is read, so Share can answer a tap at once
  const canShare = typeof navigator.share === 'function';
  openDrawer(t('Share your scorecard'), html`<p class="sub-s" style="margin:0 0 12px">${t('This is exactly what gets shared. It has no amounts and no names, only ratings.')}</p><div class="sc-prev" role="img" aria-label="${t('Preview of the scorecard picture')}">${raw(shareSvg(current))}</div>`,
    html`<span class="grow"></span><button type="button" class="btn" data-onclick="App.closeDrawer()">${t('Close')}</button><button type="button" class="btn${canShare ? '' : ' primary'}" data-onclick="App.scoreDownload()">${t('Save image')}</button>${canShare ? html`<button type="button" class="btn primary" data-onclick="App.scoreShare()">${t('Share')}</button>` : ''}`);
}
async function scoreShare() {
  try {
    const f = await file(), n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (n.share && (!n.canShare || n.canShare({ files: [f] }))) { await n.share({ files: [f], title: t('My money scorecard') }); return; }
    await scoreDownload();
  } catch (e) { if ((e as Error).name !== 'AbortError') toast('Couldn’t share the picture'); }      // closing the share sheet is not an error
}
async function scoreDownload() {
  try {
    const f = await file(), a = document.createElement('a'), url = URL.createObjectURL(f);
    a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Saved the picture');
  } catch (e) { toast('Couldn’t save the picture'); }
}
const methods = { scorePreview, scoreShare, scoreDownload };
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

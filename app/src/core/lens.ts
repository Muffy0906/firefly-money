/* True liquid glass: on browsers that allow an SVG filter inside backdrop-filter (Chromium: Chrome, Edge, Android) the
   floating glass (tab bar, side bar, sheets, menus) also refracts what's behind it, like a thick glass edge. Safari and
   Firefox ignore url() there, so they never get the attribute and keep the CSS-only look (blur, saturation, rim light).
   Method (kube.io, "Liquid Glass in the Browser"): the edge band ("bezel") has a convex squircle height profile; Snell's law
   (air 1.0 to glass 1.5) turns its slope into how far each pixel is pulled toward the inside; that is baked, per element
   size, into a displacement map (red = x, green = y, grey = none) plus a rim-light image from the surface normal against a
   fixed light. Nothing is fetched: both images are drawn on a canvas on this device. */
const SVG_ID = 'lg-lens', SEL = '.tabbar, .side, .drawer, dialog, .calpop, .pickpop, .palette-box, .bulkbar, .ff-pop';
const N = 127, N1 = 1, N2 = 1.5, THICK = 60, BEZEL = 26, MAXD = 26, LIGHT = [Math.cos(-60 * Math.PI / 180), Math.sin(-60 * Math.PI / 180)];
const squircle = (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 1 / 4);
// How far a ray is pulled sideways crossing the glass at each step into the bezel (0 = the outer edge, 1 = where it goes flat), 0..1 of the largest
export function profile(): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = Math.min(.999, Math.max(.001, i / (N - 1))), d = .001;
    const slope = (squircle(Math.min(1, x + d)) - squircle(Math.max(0, x - d))) / (Math.min(1, x + d) - Math.max(0, x - d));
    const s1 = Math.sin(Math.atan(Math.abs(slope))), t2 = Math.asin(s1 * N1 / N2);   // Snell: n1 sin(a) = n2 sin(b)
    out.push(THICK * Math.tan(Math.atan(Math.abs(slope)) - t2));
  }
  const m = Math.max(...out) || 1;
  return out.map(v => v / m);
}
export const isChromium = () => {
  const n = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  return !!(n.userAgentData && n.userAgentData.brands && n.userAgentData.brands.some(b => b.brand === 'Chromium'));
};
const PROF = profile();
// The two images for one element size: displacement map and rim light (data: URLs)
export function maps(w: number, h: number, radius: number): { disp: string, spec: string } | null {
  const c = document.createElement('canvas'), ctx = c.getContext && c.getContext('2d');
  if (!ctx) return null;
  c.width = w; c.height = h;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2)), bz = Math.min(BEZEL, Math.min(w, h) / 2 - 1);
  const dd = ctx.createImageData(w, h), sd = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + .5 - w / 2, py = y + .5 - h / 2, qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), len = Math.hypot(ox, oy);
    const depth = -(len + Math.min(Math.max(qx, qy), 0) - r);                    // pixels in from the border
    const i = (y * w + x) * 4;
    let nx: number, ny: number;                                                  // outward normal
    if (len > 0) { nx = ox / len * Math.sign(px); ny = oy / len * Math.sign(py); } else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
    let rr = 128, gg = 128;
    if (depth >= 0 && depth < bz) {
      const mag = PROF[Math.min(N - 1, Math.floor(depth / bz * N))];
      rr = 128 - nx * mag * 127; gg = 128 - ny * mag * 127;                       // toward the inside
      const lit = Math.abs(nx * LIGHT[0] + ny * LIGHT[1]) * Math.exp(-depth / 2.2);
      sd.data[i] = sd.data[i + 1] = sd.data[i + 2] = 255; sd.data[i + 3] = Math.round(Math.min(1, lit) * 230);
    }
    dd.data[i] = rr; dd.data[i + 1] = gg; dd.data[i + 2] = 128; dd.data[i + 3] = 255;
  }
  ctx.putImageData(dd, 0, 0); const disp = c.toDataURL('image/png');
  ctx.clearRect(0, 0, w, h); ctx.putImageData(sd, 0, 0);
  return { disp, spec: c.toDataURL('image/png') };
}
const done = new WeakMap<Element, string>();
let uid = 0, host: SVGSVGElement | null = null;
function ensureHost() {
  if (host && host.isConnected) return host;
  document.body.insertAdjacentHTML('beforeend', `<svg id="${SVG_ID}" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;pointer-events:none"></svg>`);
  return host = document.getElementById(SVG_ID) as unknown as SVGSVGElement;
}
function lens(el: HTMLElement) {
  const b = el.getBoundingClientRect(), w = Math.round(b.width), h = Math.round(b.height);
  if (w < 24 || h < 24 || w * h > 1.4e6) return;
  const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, key = w + 'x' + h + 'r' + Math.round(rad);
  if (done.get(el) === key) return;
  const m = maps(w, h, rad); if (!m) return;
  const id = el.getAttribute('data-lg') || 'lg-' + (++uid), s = ensureHost(), old = s.querySelector('#' + id);
  if (old) old.remove();
  s.insertAdjacentHTML('beforeend', `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feImage href="${m.disp}" x="0" y="0" width="${w}" height="${h}" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="${MAXD * 2}" xChannelSelector="R" yChannelSelector="G" result="bent"/>
<feImage href="${m.spec}" x="0" y="0" width="${w}" height="${h}" result="rim"/><feBlend in="rim" in2="bent" mode="normal"/></filter>`);
  el.setAttribute('data-lg', id); el.style.setProperty('--lg-url', `url(#${id})`); el.classList.add('lg-lensed'); done.set(el, key);
}
let ro: ResizeObserver | null = null, raf = 0;
function scan() {
  raf = 0;
  const on = document.documentElement.getAttribute('data-theme') === 'liquid' && isChromium();
  if (!on) return;
  document.querySelectorAll<HTMLElement>(SEL).forEach(el => { ro!.observe(el); lens(el); });
}
const later = () => { if (!raf) raf = requestAnimationFrame(scan); };
export function syncLens() {
  const d = document.documentElement, on = d.getAttribute('data-theme') === 'liquid' && isChromium() && !!document.body;
  if (!on) { d.removeAttribute('data-lens'); return; }
  if (!ro && typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(later);
  d.setAttribute('data-lens', 'svg'); later();
}
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(syncLens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('DOMContentLoaded', () => { syncLens(); new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); });
}

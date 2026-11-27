/* True liquid glass: on browsers that allow an SVG filter inside backdrop-filter (Chromium: Chrome, Edge, Android) the
   floating glass (tab bar, side bar, sheets, menus) also bends what's behind it at the rim, like a lens. Safari and
   Firefox ignore url() there, so they never get the attribute and keep the CSS-only look (blur, saturation, specular edge).
   Nothing is fetched: the displacement map is a small SVG drawn inline. */
const ID = 'lg-lens';
// Red pushes sideways and green pushes up and down; grey (0.5) leaves a pixel alone, so only a band along each edge bends.
const MAP = (ch: 'r' | 'g') => {
  const h = ch === 'r';
  const c = (v: number) => 'rgb(' + (h ? v + ',0,0' : '0,' + v + ',0') + ')';
  const g = (id: string, x2: number, y2: number) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${c(0)}"/><stop offset=".14" stop-color="${c(128)}"/><stop offset=".86" stop-color="${c(128)}"/><stop offset="1" stop-color="${c(255)}"/></linearGradient>`;
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" preserveAspectRatio="none"><defs>${g('a', h ? 1 : 0, h ? 0 : 1)}</defs><rect width="400" height="400" fill="url(#a)"/></svg>`);
};
export const isChromium = () => {
  const n = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  return !!(n.userAgentData && n.userAgentData.brands && n.userAgentData.brands.some(b => b.brand === 'Chromium'));
};
function filterSvg() {
  return `<svg id="${ID}" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;pointer-events:none"><filter id="lg-bend" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feImage href="${MAP('r')}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="mx"/><feImage href="${MAP('g')}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="my"/>
<feComposite in="mx" in2="my" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="44" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`;
}
export function syncLens() {
  const d = document.documentElement, on = d.getAttribute('data-theme') === 'liquid' && isChromium();
  if (on) {
    if (!document.getElementById(ID) && document.body) document.body.insertAdjacentHTML('beforeend', filterSvg());
    if (document.getElementById(ID)) d.setAttribute('data-lens', 'svg');
  } else d.removeAttribute('data-lens');
}
if (typeof MutationObserver !== 'undefined') new MutationObserver(syncLens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.addEventListener('DOMContentLoaded', syncLens);

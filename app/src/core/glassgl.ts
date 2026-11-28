/* True liquid glass, the real thing on the rim: the tab bar and the + circle get a WebGL canvas that refracts a snapshot of
   the page behind them (the way liquid-glass.ybouane.com does), so letters and cards bend and split into colour fringes
   along the glass edge. It works in WebKit: nothing here needs backdrop-filter:url().
   How: html-to-image redraws the page region behind the glass into a canvas; a fragment shader walks a convex squircle
   bezel, turns its slope into a displacement with Snell's law (air 1.0 to glass 1.5), samples the snapshot three times for
   the colour fringe, tints it like the CSS glass, and adds a top-left specular rim. Only the rim band is drawn: the middle stays the live CSS glass.
   The snapshot is only trustworthy while the page is still, so while you scroll the canvas fades out and the CSS glass shows;
   it fades back in once a fresh snapshot is ready. Any failure (no WebGL, a blank capture, a thrown error) switches it off and leaves the CSS glass.
   Shader ideas adapted from @ybouane/liquidglass (MIT). */
import { toCanvas } from 'html-to-image';
import { readCustom } from './themevars';

const MAXPIECES = 40;
const PAD = 32, BEZEL = 24, MAXD = 46;
const VS = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `precision highp float;
uniform sampler2D tex; uniform vec2 size, texSize, texOrigin; uniform float radius, dpr, bezel, maxd; uniform vec4 tint; uniform float dark;
float rr(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + vec2(r); return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r; }
vec3 snap(vec2 px) { return texture2D(tex, px / texSize).rgb; }
void main() {
  vec2 frag = vec2(gl_FragCoord.x, size.y * dpr - gl_FragCoord.y) / dpr, c = frag - size * 0.5, h = size * 0.5;
  float r = min(radius, min(h.x, h.y)), sd = rr(c, h, r);
  if (sd > 0.5) { gl_FragColor = vec4(0.0); return; }
  float inside = max(-sd, 0.0), t = clamp(inside / bezel, 0.002, 1.0);
  vec2 e = vec2(1.0, 0.0);
  vec2 n = normalize(vec2(rr(c + e.xy, h, r) - rr(c - e.xy, h, r), rr(c + e.yx, h, r) - rr(c - e.yx, h, r)) + 1e-5);   // outward
  float slope = pow(1.0 - t, 3.0) * pow(max(1.0 - pow(1.0 - t, 4.0), 1e-4), -0.75);    // convex squircle height profile
  float a1 = atan(slope), a2 = asin(sin(a1) / 1.5);                                       // Snell's law
  float d = min(tan(a1 - a2) * 6.0, 1.0) * maxd * (1.0 - smoothstep(0.8, 1.0, t));
  vec2 px = frag + texOrigin, dir = -n;
  vec3 col = vec3(snap(px + dir * d * 1.06).r, snap(px + dir * d).g, snap(px + dir * d * 0.94).b);
  col += (snap(px + dir * d + vec2(2.0, 0.0)) + snap(px + dir * d - vec2(2.0, 0.0)) + snap(px + dir * d + vec2(0.0, 2.0)) + snap(px + dir * d - vec2(0.0, 2.0))) * 0.25;
  col *= 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.35);
  col = mix(col, tint.rgb, tint.a);                                                      // the same smoked/pale tint as the CSS glass
  vec2 Lt = normalize(vec2(-0.55, -0.83));
  float edge = exp(-inside / 2.4), facing = max(dot(n, Lt), 0.0) * 0.75 + max(dot(n, -Lt), 0.0) * 0.25;
  col += vec3(edge * (0.18 + 0.6 * facing) * (dark > 0.5 ? 0.8 : 1.0));                   // specular rim, brightest top-left
  float alpha = (1.0 - smoothstep(0.65, 1.0, t)) * (1.0 - smoothstep(-0.5, 0.5, sd));
  gl_FragColor = vec4(col * alpha, alpha);
}`;

type Item = { el: HTMLElement, cv: HTMLCanvasElement, gl: WebGLRenderingContext, prog: WebGLProgram, tex: WebGLTexture, loc: Record<string, WebGLUniformLocation | null>, origin: [number, number], ready: boolean };
const items = new Map<HTMLElement, Item>();
let off = false, busy = false, timer = 0, scrolling = 0, warmed = false, took = 0, last = 0;
const DOWN = 'liquid-gl';
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const wanted = () => document.documentElement.getAttribute('data-theme') === 'liquid' && !off && readCustom().liquid?.gl !== false
  && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-transparency: reduce)').matches);

function make(el: HTMLElement): Item | null {
  const cv = document.createElement('canvas'); cv.className = 'lgl'; cv.setAttribute('aria-hidden', 'true');
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pl = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  const loc: Item['loc'] = {};
  for (const n of ['tex', 'size', 'texSize', 'texOrigin', 'radius', 'dpr', 'bezel', 'maxd', 'tint', 'dark']) loc[n] = gl.getUniformLocation(prog, n);
  el.prepend(cv);
  return { el, cv, gl, prog, tex, loc, origin: [0, 0], ready: false };
}

// Redraws the page behind this glass piece (and PAD px around it) into a canvas
async function snapshot(it: Item) {
  const b = it.el.getBoundingClientRect(), x = Math.max(0, b.left - PAD), y = Math.max(0, b.top - PAD);
  const w = Math.min(innerWidth, b.right + PAD) - x, h = Math.min(innerHeight, b.bottom + PAD) - y;
  if (w < 8 || h < 8) return null;
  const scale = Math.min(devicePixelRatio || 1, 2);
  const out = document.createElement('canvas'); out.width = Math.round(w * scale); out.height = Math.round(h * scale);
  const g = out.getContext('2d'); if (!g) return null;
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff'; g.fillRect(0, 0, out.width, out.height);
  // Cloning the whole page costs seconds, and dropping nodes from the clone shifts the layout, so the page is cut into pieces instead:
  // every element over the glass that is small enough is drawn on its own (a card, a row), bigger ones draw just their own box and hand over to their children.
  const skip = (n: HTMLElement) => n === it.el || n.classList.contains('lgl') || n.id === 'tabbar' || n.id === 'fab' || n.id === 'lg-lens' || n.tagName === 'SCRIPT' || n.tagName === 'STYLE';
  const pieces: [HTMLElement, boolean][] = [];
  const walk = (n: HTMLElement) => {
    if (skip(n) || pieces.length > MAXPIECES) return;
    const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
    if (!(r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) || cs.visibility === 'hidden' || cs.display === 'none') return;
    if (n.querySelectorAll('*').length <= 90 || !n.children.length) { pieces.push([n, false]); return; }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0) pieces.push([n, true]);
    for (const c of Array.from(n.children)) if (c instanceof HTMLElement) walk(c);
  };
  walk(document.body);
  if (pieces.length > MAXPIECES) throw new Error('page too busy');
  for (const [n, own] of pieces) {
    const r = n.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const c = await toCanvas(n, { width: Math.ceil(r.width), height: Math.ceil(r.height), pixelRatio: scale, cacheBust: false, skipFonts: true, imagePlaceholder: PLACEHOLDER,
      style: { margin: '0', transform: 'none', opacity: '1' }, filter: f => !own || f === n });
    g.drawImage(c, (r.left - x) * scale, (r.top - y) * scale);
  }
  return { cv: out, x, y, w, h, b };
}
function blank(cv: HTMLCanvasElement) {
  const c = cv.getContext('2d'); if (!c) return false;
  const d = c.getImageData(0, 0, cv.width, cv.height).data; let seen = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0) seen++;
  return seen === 0;
}
function draw(it: Item, s: NonNullable<Awaited<ReturnType<typeof snapshot>>>) {
  const { gl, cv, el } = it, dpr = Math.min(devicePixelRatio || 1, 3), r = el.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); gl.viewport(0, 0, cv.width, cv.height);
  gl.bindTexture(gl.TEXTURE_2D, it.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.cv);
  const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark') && !getComputedStyle(document.documentElement).colorScheme.includes('light');
  const base = getComputedStyle(document.documentElement).getPropertyValue('--glass-base').trim() || '#fafafa';
  const m = /^#([0-9a-f]{6})$/i.exec(base), rgb = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255) : [.98, .98, .98];
  const set = it.loc, u = (n: string) => set[n];
  gl.uniform1i(u('tex'), 0); gl.uniform2f(u('size'), r.width, r.height); gl.uniform2f(u('texSize'), s.w, s.h);
  gl.uniform2f(u('texOrigin'), s.x - r.left, s.y - r.top);
  gl.uniform1f(u('radius'), parseFloat(getComputedStyle(el).borderTopLeftRadius) || r.height / 2); gl.uniform1f(u('dpr'), dpr);
  gl.uniform1f(u('bezel'), BEZEL); gl.uniform1f(u('maxd'), MAXD); gl.uniform4f(u('tint'), rgb[0], rgb[1], rgb[2], 0.0); gl.uniform1f(u('dark'), dark ? 1 : 0);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  it.ready = true;
}
function turnOff() {
  off = true; document.documentElement.removeAttribute('data-gl');
  items.forEach(it => it.cv.remove()); items.clear();
}
async function refresh() {
  timer = 0;
  if (busy) { later(); return; }
  if (!wanted()) { document.documentElement.removeAttribute('data-gl'); items.forEach(it => { it.cv.style.opacity = '0'; }); return; }
  const wait = last + Math.max(1500, took * 2) - Date.now();      // a busy page keeps changing: never spend more than a third of the time capturing
  if (wait > 0) { later(wait); return; }
  busy = true; const t0 = Date.now();
  try {
    for (const el of document.querySelectorAll<HTMLElement>('#tabbar, #fab.on')) {
      if (!items.has(el)) { const it = make(el); if (!it) { turnOff(); return; } items.set(el, it); }
    }
    if (!warmed) { warmed = true; try { await snapshot([...items.values()][0]); } catch (e) { /* Safari's first capture can come back empty; the next one is the real one */ } }
    for (const [el, it] of items) {
      if (!el.isConnected || !el.getBoundingClientRect().width || getComputedStyle(el).visibility === 'hidden') { it.cv.style.opacity = '0'; continue; }
      const s = await snapshot(it);
      if (!s) { it.cv.style.opacity = '0'; continue; }
      if (blank(s.cv)) { turnOff(); return; }
      draw(it, s);
    }
    if (!scrolling) { document.documentElement.setAttribute('data-gl', '1'); items.forEach(it => { it.cv.style.opacity = it.ready ? '1' : '0'; }); }
  } catch (e) { turnOff(); } finally { busy = false; took = Date.now() - t0; last = Date.now(); }
}
function later(ms = 220) { clearTimeout(timer); timer = window.setTimeout(refresh, ms); }
function stale() { items.forEach(it => { it.cv.style.opacity = '0'; }); }

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const hush = () => { stale(); document.documentElement.classList.remove(DOWN); clearTimeout(scrolling); scrolling = window.setTimeout(() => { scrolling = 0; later(60); }, 180); };
  addEventListener('scroll', () => { if (items.size) hush(); }, { passive: true });
  addEventListener('resize', () => { if (items.size) { stale(); later(300); } });
  new MutationObserver(() => { if (wanted()) later(260); else if (items.size) { stale(); document.documentElement.removeAttribute('data-gl'); } })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(m => { if (wanted() && m.some(r => !(r.target as Element).closest?.('.lgl, #toast, .toast, .undo'))) later(450); })
      .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    if (wanted()) later(900);
  });
}

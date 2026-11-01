import { Html, html, htmlList, raw } from '../core/html';
import { getAll } from '../core/api';
import { absDiff, type ApiData, App, fmtDay, leadDays, money, money0, pad, type Period, todayIso, weekOrder } from '../core/base';
import { SERIES, normGroup, signed, type Group } from '../core/feed';
import { addDays } from '../core/helpers';
import type { Account } from '../core/lists';

/* ---------- Shapes the charts share: smooth lines, donuts and progress rings ---------- */
// A smooth line through the points. Monotone (as d3's curveMonotoneX), so it never bulges past a peak or dips
// below a flat stretch the way a plain spline would.
export function smoothPath(pts: [number, number][]) {
  const n = pts.length, f = (v: number) => v.toFixed(1);
  if (n < 3) return pts.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join(' ');
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]), m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (dx[i] || 1));
  const t = pts.map((_, i) => {
    if (i === 0) return m[0];
    if (i === n - 1) return m[n - 2];
    const a = m[i - 1], b = m[i];
    if (a * b <= 0) return 0;
    const p = (a * dx[i] + b * dx[i - 1]) / (dx[i - 1] + dx[i]);
    return Math.sign(a) * Math.min(Math.abs(a), Math.abs(b), Math.abs(p) / 2) * 2;
  });
  let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ' C' + f(pts[i][0] + h) + ' ' + f(pts[i][1] + t[i] * h) + ' ' + f(pts[i + 1][0] - h) + ' ' + f(pts[i + 1][1] - t[i + 1] * h) + ' ' + f(pts[i + 1][0]) + ' ' + f(pts[i + 1][1]);
  }
  return d;
}
export { SERIES };
export type Part = { name: string, v: number, color?: string };
// A ring split into parts, with something (the total) in the middle. Each slice is a dashed circle, so it can sweep
// in (see .anim in money.css): --at is when it starts, as a share of the sweep.
export function donut(parts: Part[], middle: Html | string, label: string) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1, gap = parts.length > 1 ? .9 : 0;
  let at = 0;
  const segs = htmlList(parts.map((p, i) => {
    const len = Math.max(0, p.v / total * 100 - gap), off = at; at += p.v / total * 100;
    return html`<circle class="seg" cx="60" cy="60" r="48" pathLength="100" stroke="${p.color || SERIES[i % SERIES.length]}" stroke-dasharray="${len.toFixed(2)} ${(100 - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" style="--at:${(off / 100).toFixed(3)}" data-tip="${p.name + ' · ' + money0(p.v) + ' · ' + Math.round(p.v / total * 100) + '%'}" data-i="${i}"></circle>`;
  }));
  return html`<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="${label}"><circle class="base" cx="60" cy="60" r="48"/>${segs}</svg><div class="mid">${middle}</div></div>`;
}
// A breakdown of a whole (spending by category, payees, income sources): a donut with the total in the middle, then
// a row for each part with its colour, a bar and its share. The biggest six get colours and their own slice; the rest
// are grey and share one slice. limit: rows listed (the others are summed into one); ring false: the rows only.
export type Share = { name: string, v: number, href?: string, sub?: Html | string };
export function shareChart(rows: Share[], middle: Html | string, label: string, o: { limit?: number, ring?: boolean, other?: string } = {}) {
  rows = rows.filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  if (!rows.length) return '';
  const limit = o.limit || 6, total = rows.reduce((s, r) => s + r.v, 0), shown: (Share & { c: string })[] = rows.slice(0, limit).map((r, i) => ({ ...r, c: i < 6 ? SERIES[i] : 'var(--muted)' }));
  const rest = rows.slice(limit);
  if (rest.length === 1) shown.push({ ...rest[0], c: 'var(--muted)' });
  else if (rest.length) shown.push({ name: o.other || 'Everything else', v: rest.reduce((s, r) => s + r.v, 0), c: 'var(--muted)', sub: rest.length + ' more' });
  const slices: Part[] = shown.slice(0, 6).map(r => ({ name: r.name, v: r.v, color: r.c })), grey = shown.slice(6).reduce((s, r) => s + r.v, 0);
  if (grey) slices.push({ name: shown.length > 7 ? 'Everything else' : shown[6].name, v: grey, color: 'var(--muted)' });
  const most = Math.max(1, ...shown.map(r => r.v));
  const list = html`<div class="parts">${htmlList(shown.map(r => html`<div class="part"><i style="background:${r.c}"></i><span class="name">${r.href ? html`<a href="${r.href}">${r.name}</a>` : r.name}${r.sub ? html`<span class="sub-s">${r.sub}</span>` : ''}</span><span class="track"><span class="fill" style="width:${(r.v / most * 100).toFixed(1)}%;background:${r.c}"></span></span><span class="num">${(r.v / total * 100).toFixed(0)}%</span></div>`))}</div>`;
  return o.ring === false ? list : html`<div class="share">${donut(slices, middle, label)}${list}</div>`;
}
// A small trend line with a soft fill under it, stretched to its box (a number tile's picture)
export function miniLine(vals: number[], color: string, label: string) {
  const W = 300, H = 60, n = vals.length;
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; }
  const line = smoothPath(vals.map((v, i) => [W * i / Math.max(1, n - 1), 4 + (H - 8) * (1 - (v - lo) / (hi - lo))]));
  return html`<svg class="mini-line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${label}"><path d="${line} L${W} ${H} L0 ${H} Z" fill="${color}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}
// How far along something is (a goal, a loan), as a ring with the percentage (or `mid`) in the middle
export function ring(pct: number, cls = '', sub = '', mid = '') {
  const p = Math.max(0, Math.min(100, pct));
  return html`<div class="ring ${cls}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="base" cx="60" cy="60" r="50"/><circle class="seg" cx="60" cy="60" r="50" pathLength="100" stroke-dasharray="${p.toFixed(2)} ${(100 - p).toFixed(2)}" style="--at:0"/></svg><div class="mid"><strong class="num">${mid || p.toFixed(0) + '%'}</strong>${sub ? html`<span>${sub}</span>` : ''}</div></div>`;
}

// Two amounts over time (earned and spent) as smooth lines, the first with a soft fill under it
export type LinePoint = { label: string, a: number, b: number };
const short$ = (v: number) => v >= 1e6 ? '$' + +(v / 1e6).toFixed(1) + 'm' : v >= 1e3 ? '$' + +(v / 1e3).toFixed(1) + 'k' : '$' + Math.round(v);
function niceMax(v: number) { const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
// The hover/tap strip around one point, a step wide but kept inside the plot (the first and last would stick out half a step)
const hitBox = (cx: number, step: number, lo: number, hi: number) => { const a = Math.max(lo, cx - step / 2), b = Math.min(hi, cx + step / 2); return raw(`x="${a.toFixed(1)}" width="${(b - a).toFixed(1)}"`); };
export function twoLines(pts: LinePoint[], names: [string, string], colors: [string, string], label: string, size?: { w: number, h: number }) {
  const W = size ? size.w : innerWidth < 600 ? 360 : 640, H = size ? size.h : innerWidth < 600 ? 220 : 280, pl = 46, pr = 8, pt = 10, pb = 26, n = pts.length, base = H - pb;
  const max = niceMax(Math.max(1, ...pts.flatMap(p => [p.a, p.b])) / 4) * 4;     // four even steps
  const x = (i: number) => pl + (W - pl - pr) * (n < 2 ? .5 : i / (n - 1)), y = (v: number) => pt + (base - pt) * (1 - v / max);
  const la = smoothPath(pts.map((p, i) => [x(i), y(p.a)])), lb = smoothPath(pts.map((p, i) => [x(i), y(p.b)]));
  const area = la + ' L' + x(n - 1).toFixed(1) + ' ' + base + ' L' + x(0).toFixed(1) + ' ' + base + ' Z';
  const grid = htmlList([0, 1, 2, 3, 4].map(k => { const v = max * k / 4, yy = y(v).toFixed(1); return html`<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${pl - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${short$(v)}</text>`; }));
  const every = Math.max(1, Math.ceil(n / 6)), ticks = htmlList(pts.map((p, i) => (i % every || x(n - 1) - x(i) < 50) && i !== n - 1 ? '' : html`<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${p.label}</text>`));
  const hits = htmlList(pts.map((p, i) => html`<rect ${hitBox(x(i), (W - pl - pr) / Math.max(1, n - 1), pl, W - pr)} y="0" height="${base}" fill="transparent" data-tip="${p.label + '\n' + names[0] + ' ' + money0(p.a) + '\n' + names[1] + ' ' + money0(p.b)}"/>`));
  return html`<svg class="lines" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><defs><linearGradient id="lg-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors[0]}" stop-opacity=".32"/><stop offset="1" stop-color="${colors[0]}" stop-opacity="0"/></linearGradient></defs><g class="grid">${grid}</g><path class="area" d="${area}" fill="url(#lg-a)" style="color:${colors[0]}"/><path class="draw" pathLength="1" d="${la}" fill="none" stroke="${colors[0]}" stroke-width="2.6" stroke-linecap="round"/><path class="draw late" pathLength="1" d="${lb}" fill="none" stroke="${colors[1]}" stroke-width="2.2" stroke-linecap="round"/>${ticks}${hits}</svg><div class="legend"><span><i style="background:${colors[0]}"></i>${names[0]}</span><span><i style="background:${colors[1]}"></i>${names[1]}</span></div>`;
}

/* ---------- Spending pace: this month's running total against last month's, day by day ---------- */
// days: this month's spending on each day so far (index 0 = the 1st); before: last month's, every day of it
export function paceChart(days: number[], before: number[], dim: number, label: [string, string]) {
  const W = innerWidth < 600 ? 360 : 640, H = innerWidth < 600 ? 210 : 250, pl = 46, pr = 10, pt = 12, pb = 26, base = H - pb;
  const run = (v: number[]) => { let t = 0; return v.map(x => (t += x)); };
  const a = run(days), b = run(before), n = Math.max(dim, b.length);
  const max = niceMax(Math.max(1, ...a, ...b) / 4) * 4;
  const x = (i: number) => pl + (W - pl - pr) * (n < 2 ? .5 : i / (n - 1)), y = (v: number) => pt + (base - pt) * (1 - v / max);
  const la = a.length > 1 ? smoothPath(a.map((v, i) => [x(i), y(v)])) : '', lb = b.length > 1 ? smoothPath(b.map((v, i) => [x(i), y(v)])) : '';
  const area = la && la + ' L' + x(a.length - 1).toFixed(1) + ' ' + base + ' L' + x(0).toFixed(1) + ' ' + base + ' Z';
  const grid = htmlList([0, 1, 2, 3, 4].map(k => { const v = max * k / 4, yy = y(v).toFixed(1); return html`<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${pl - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${short$(v)}</text>`; }));
  const ticks = htmlList([1, 8, 15, 22, n].filter((d, i, l) => d <= n && l.indexOf(d) === i).map(d => html`<text x="${x(d - 1).toFixed(1)}" y="${H - 6}" text-anchor="${d === 1 ? 'start' : d === n ? 'end' : 'middle'}">${d}</text>`));
  const i = a.length - 1, dot = i >= 0 ? html`<circle class="pace-dot" cx="${x(i).toFixed(1)}" cy="${y(a[i]).toFixed(1)}" r="4.5" fill="var(--accent)"/>` : '';
  const hits = htmlList([...Array(n)].map((_, d) => html`<rect ${hitBox(x(d), (W - pl - pr) / Math.max(1, n - 1), pl, W - pr)} y="0" height="${base}" fill="transparent" data-tip="${'Day ' + (d + 1) + (d < a.length ? '\n' + label[0] + ' ' + money0(a[d]) : '') + (d < b.length ? '\n' + label[1] + ' ' + money0(b[d]) : '')}"/>`));
  return html`<svg class="lines" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending this month against last month"><defs><linearGradient id="lg-pace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><g class="grid">${grid}</g>${lb ? html`<path class="draw" pathLength="1" d="${lb}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="1" stroke-linecap="round" opacity=".7"/>` : ''}${area ? html`<path class="area" d="${area}" fill="url(#lg-pace)" style="color:var(--accent)"/>` : ''}${la ? html`<path class="draw late" pathLength="1" d="${la}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>` : ''}${dot}${ticks}${hits}</svg><div class="legend"><span><i style="background:var(--accent)"></i>${label[0]}</span><span><i style="background:var(--muted)"></i>${label[1]}</span></div>`;
}

/* ---------- Bars: one value a month (the savings rate), below the line when negative ---------- */
// size: a narrower drawing for a small card (its text then stays readable when the card scales it down)
export function barChart(pts: { label: string, v: number | null, go?: string }[], fmt: (v: number) => string, label: string, size?: { w: number, h: number }) {
  const W = size ? size.w : innerWidth < 600 ? 360 : 640, H = size ? size.h : 200, pt = 18, n = pts.length, vals = pts.map(p => p.v || 0);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals), rng = hi - lo || 1, pb = lo < 0 ? 42 : 26;     // room under a bar below zero for its amount
  const y = (v: number) => pt + (H - pb - pt) * (hi - v) / rng, zero = y(0), slot = W / n, bw = Math.min(38, slot * .5);
  const bars = htmlList(pts.map((p, i) => {
    const cx = slot * i + slot / 2, v = p.v, top = v == null ? zero : Math.min(y(v), zero), h = v == null ? 0 : Math.max(2, Math.abs(y(v) - zero));
    return html`<g${p.go ? html` data-go="${p.go}" style="cursor:pointer"` : ''}><rect x="${slot * i}" y="0" width="${slot}" height="${H}" fill="transparent" data-tip="${p.label + ' · ' + (v == null ? 'no income' : fmt(v))}"></rect>${v == null ? '' : html`<rect class="bar${v < 0 ? ' neg' : ''}" style="--j:${i};transform-origin:50% ${v < 0 ? '0' : '100'}%" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(8, bw / 3).toFixed(1)}"></rect><text class="bv" x="${cx.toFixed(1)}" y="${(v < 0 ? top + h + 13 : top - 6).toFixed(1)}" text-anchor="middle">${fmt(v)}</text>`}<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.label}</text></g>`;
  }));
  return html`<svg class="barchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><line x1="0" x2="${W}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}" stroke="var(--line)"/>${bars}</svg>`;
}

/* ---------- Pairs of bars: two amounts side by side in each slot (earned and spent by month, budgeted and spent) ---------- */
// Labels thin out so they never run into each other; every slot keeps its tip (full name and both amounts).
export function pairBars(pts: (LinePoint & { tip?: string })[], names: [string, string], colors: [string, string], label: string) {
  const W = innerWidth < 600 ? 360 : 640, H = innerWidth < 600 ? 220 : 260, pl = 46, pr = 4, pt = 10, pb = 26, n = pts.length, base = H - pb;
  const max = niceMax(Math.max(1, ...pts.flatMap(p => [p.a, p.b])) / 4) * 4, slot = (W - pl - pr) / Math.max(1, n), bw = Math.max(3, Math.min(26, slot * .32));
  const y = (v: number) => pt + (base - pt) * (1 - v / max), every = Math.max(1, Math.ceil(n / Math.floor((W - pl) / 58)));
  const grid = htmlList([0, 1, 2, 3, 4].map(k => { const v = max * k / 4, yy = y(v).toFixed(1); return html`<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${pl - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${short$(v)}</text>`; }));
  const bars = htmlList(pts.map((p, i) => {
    const cx = pl + slot * i + slot / 2, gap = Math.min(3, bw / 4), bar = (v: number, x: number, c: string, j: number) => html`<rect class="bar" style="--j:${i}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(v > 0 ? 1.5 : 0, base - y(v)).toFixed(1)}" rx="${Math.min(6, bw / 3).toFixed(1)}" fill="${c}"${j ? raw(' opacity=".85"') : ''}/>`;
    const lab = p.label.length > 10 ? p.label.slice(0, 9) + '…' : p.label;
    return html`<g><rect x="${(pl + slot * i).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${base}" fill="transparent" data-tip="${(p.tip || p.label) + '\n' + names[0] + ' ' + money0(p.a) + '\n' + names[1] + ' ' + money0(p.b)}"/>${bar(p.a, cx - bw - gap, colors[0], 0)}${bar(p.b, cx + gap, colors[1], 1)}${i % every ? '' : html`<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${lab}</text>`}</g>`;
  }));
  return html`<svg class="lines pairbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><g class="grid">${grid}</g><line x1="${pl}" x2="${W - pr}" y1="${base}" y2="${base}" stroke="var(--line)"/>${bars}</svg><div class="legend"><span><i style="background:${colors[0]}"></i>${names[0]}</span><span><i style="background:${colors[1]}"></i>${names[1]}</span></div>`;
}

/* ---------- Change bars: how much each part moved against before, out from a middle line (less to the left) ---------- */
export type Change = { name: string, now: number, prev: number, href?: string };
export function changeBars(rows: Change[], limit = 8) {
  const moved = rows.map(r => ({ ...r, d: r.now - r.prev })).filter(r => Math.abs(r.d) >= 1).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, limit);
  if (!moved.length) return '';
  const most = Math.max(...moved.map(r => Math.abs(r.d)));
  return html`<div class="chg">${htmlList(moved.map(r => html`<div class="chg-row" data-tip="${r.name + '\nNow ' + money0(r.now) + '\nBefore ' + money0(r.prev)}"><span class="name">${r.href ? html`<a href="${r.href}">${r.name}</a>` : r.name}</span><span class="chg-bar"><i class="${r.d > 0 ? 'chg-up' : 'chg-dn'}" style="width:${(Math.abs(r.d) / most * 50).toFixed(1)}%"></i></span><span class="num ${r.d > 0 ? 'up' : 'down'}">${r.d > 0 ? '+' : '−'}${money0(Math.abs(r.d))}</span></div>`))}</div><div class="legend"><span><i style="background:var(--good)"></i>Less than before</span><span><i style="background:var(--spend)"></i>More than before</span></div>`;
}

/* ---------- Little bars in a row: one category's months, the last one (now) in the accent; tips name each month ---------- */
export function sparkBars(vals: number[], max: number, tips?: string[]) {
  const W = 84, H = 26, n = vals.length, gap = 3, bw = (W - gap * (n - 1)) / n;
  return html`<svg class="sbars" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none" aria-hidden="true">${htmlList(vals.map((v, i) => {
    const h = Math.max(v ? 2 : 1, H * v / (max || 1)), x = i * (bw + gap);
    const bar = html`<rect class="bar${i === n - 1 ? ' now' : ''}" style="--j:${i}" x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"></rect>`;
    // The whole column (gaps included) answers the pointer, so a short bar is as easy to hit as a tall one
    return tips ? html`<g data-tip="${tips[i]}"><rect x="${(x - gap / 2).toFixed(1)}" y="0" width="${(bw + gap).toFixed(1)}" height="${H}" fill="transparent"></rect>${bar}</g>` : bar;
  }))}</svg>`;
}

/* ---------- Sparklines: last 30 days of each account's balance ---------- */
async function balanceSparks(accounts: Account[]) {
  const start = addDays(todayIso(), -30), end = todayIso(), out: Record<string, number[]> = {};
  const gs = (await getAll('/transactions', { start, end, type: 'all' })).map(normGroup);     // one request for every account
  accounts.forEach(a => {
    const byDay: Record<string, number> = {}; gs.forEach(g => { const v = signed(g, a.id); if (v) { const d = String(g.date).slice(0, 10); byDay[d] = (byDay[d] || 0) + v; } });
    let bal = a.balance; const vals: number[] = [];
    for (let i = 0; i <= 30; i++) { const d = addDays(end, -i); vals.push(bal); bal -= byDay[d] || 0; }
    out[a.id] = vals.reverse();
  });
  return out;
}
function sparkline(vals: number[], owed: boolean) {
  const v = owed ? vals.map(x => Math.max(0, -x)) : vals, W = 64, H = 20;
  const lo = Math.min(...v), hi = Math.max(...v), rng = hi - lo || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * W, H - 2 - ((y - lo) / rng) * (H - 4)]);
  const up = v[v.length - 1] >= v[0], good = owed ? !up : up;
  const tip = (owed ? 'Owed ' : 'Balance ') + money0(v[0]) + ' → ' + money0(v[v.length - 1]) + ' over 30 days';
  return html`<svg class="spark ${hi === lo ? 'flat' : good ? 'good' : 'bad'}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-tip="${tip}" aria-hidden="true"><polyline points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2"/></svg>`;
}

/* ---------- Daily spending heatmap ---------- */
function heatmapPanel(cur: Period, groups: Group[]) {
  const by: Record<string, number> = {}, cnt: Record<string, number> = {};
  groups.forEach(g => { const d = String(g.date).slice(0, 10); by[d] = (by[d] || 0) + g.total; cnt[d] = (cnt[d] || 0) + 1; });
  const dim = new Date(cur.y!, cur.m! + 1, 0).getDate(), lead = leadDays(new Date(cur.y!, cur.m!, 1)), t = todayIso();
  const max = Math.max(1, ...Object.values(by)), days = Object.keys(by).length;
  let cells: Html | string = '';
  for (let i = 0; i < lead; i++) cells = html`${cells}<span class="hm-cell pad"></span>`;
  for (let d = 1; d <= dim; d++) {
    const iso = cur.start.slice(0, 8) + pad(d), v = by[iso] || 0, fut = iso > t;
    const pct = v ? Math.round(18 + 82 * Math.sqrt(v / max)) : 0;
    cells = html`${cells}<button type="button" class="hm-cell${fut ? ' fut' : ''}${iso === t ? ' today' : ''}"${v ? html` style="--p:${pct}%"` : ''} data-tip="${fmtDay(iso) + (v ? ' · ' + money(v) + ' · ' + cnt[iso] + ' purchase' + (cnt[iso] === 1 ? '' : 's') : fut ? '' : ' · nothing spent')}"${v ? html` data-onclick="App.go('#/transactions?search=date_on:${iso}')"` : ' disabled'}><span>${d}</span></button>`;
  }
  // Every month gets six week rows, so the calendar (and the card) is the same height whichever month it shows
  for (let i = lead + dim; i < 42; i++) cells = html`${cells}<span class="hm-cell pad"></span>`;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const passed = cur.start.slice(0, 7) === t.slice(0, 7) ? +t.slice(8, 10) : dim, free = Math.max(0, passed - days);
  return html`<section class="panel"><h2>Daily spending</h2><p class="lead">Darker days cost more · tap one to see it</p><div class="hm"><div class="hm-dow">${htmlList(weekOrder(['S', 'M', 'T', 'W', 'T', 'F', 'S']).map(x => html`<span>${x}</span>`))}</div><div class="hm-grid">${cells}</div></div><div class="hm-foot"><span>${top ? html`Biggest day: <strong class="num">${money0(top[1])}</strong> on ${fmtDay(top[0])}` : 'No spending yet'}</span><span>${free} no-spend day${free === 1 ? '' : 's'}</span></div></section>`;
}

/* ---------- Money flow (income → spending categories + kept) ---------- */
// The chart is laid out at the width it is shown at (one SVG unit = one pixel), so the labels keep their real
// font size and spacing instead of being scaled up on a wide screen or down on a phone. On a narrow card (a phone)
// the bars sit at the edges and the labels go inside, over the bands, so the chart gets the card's whole width.
type FlowNode = { name: string, v: number, id?: string, kind?: string };
type LaidNode = FlowNode & { h: number, slot: number, x: number, y: number, ly: number };
type Flow = { left: FlowNode[], right: FlowNode[], inc: number, spend: number };
function sankeyPanel(sources: ApiData[], income: number, cats: { name: string, amt: number, id?: string }[], cur: Period) {
  let left: FlowNode[] = sources.map(x => ({ name: x.name, v: absDiff(x), id: x.id ? String(x.id) : undefined })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (!left.length && income > 0) left = [{ name: 'Income', v: income }];
  if (left.length > 4) { const rest = left.slice(3); left = left.slice(0, 3); left.push({ name: rest.length + ' other sources', v: rest.reduce((s, x) => s + x.v, 0) }); }
  let right: FlowNode[] = cats.map(c => ({ name: c.name, v: c.amt, id: c.id })).sort((a, b) => b.v - a.v);
  if (right.length > 7) { const rest = right.slice(6); right = right.slice(0, 6); right.push({ name: rest.length + ' other categories', v: rest.reduce((s, x) => s + x.v, 0) }); }
  const inc = left.reduce((s, x) => s + x.v, 0), spend = right.reduce((s, x) => s + x.v, 0);
  if (!inc && !spend) return '';
  left.forEach(x => { x.kind = 'in'; });
  right.forEach(x => { x.kind = 'out'; });
  if (spend > inc) left.push({ name: 'From savings', v: spend - inc, kind: 'save' });
  if (inc > spend) right.push({ name: 'Kept', v: inc - spend, kind: 'kept' });
  const d: Flow = { left, right, inc, spend };
  return html`<section class="panel chart sankey" data-sk="${JSON.stringify(d)}"><h2>Money flow</h2><p class="lead">Where ${cur.all ? 'all your' : cur.label + '’s'} income went · ${matchMedia?.('(hover: none)').matches ? 'tap a band to see its transactions' : 'hover a band for details'}</p><div class="sk-box">${sankeySvg(d, innerWidth < 900 ? innerWidth - 72 : 900)}</div></section>`;
}
// Shorten a label with … until it fits in px at the chart's label font
let skCtx: CanvasRenderingContext2D | null = null;
function fitText(t: string, px: number, weight = 500) {
  if (!skCtx) skCtx = document.createElement('canvas').getContext('2d')!;
  skCtx.font = weight + ' 12.5px ' + getComputedStyle(document.body).fontFamily;
  if (skCtx.measureText(t).width <= px) return t;
  let n = t.length;
  while (n > 1 && skCtx.measureText(t.slice(0, n).trimEnd() + '…').width > px) n--;
  return t.slice(0, n).trimEnd() + '…';
}
// The most rows a side can have: six categories, one for the rest, and Kept (sankeyPanel caps them)
const SK_ROWS = 8;
// minRows: lay the chart out as if it had at least this many rows, so a bento card is as tall in a month with
// three categories as in one with eight
function sankeySvg(d: Flow, W: number, fill = 0, minRows = 0) {
  const { inc, spend } = d;
  // Copies, so laying the nodes out leaves the chart's data as it was
  const left = d.left.map(n => ({ ...n }) as LaidNode), right = d.right.map(n => ({ ...n }) as LaidNode);
  W = Math.max(280, Math.round(W));
  // On a very wide card the bands would stretch thin, so the chart keeps to 1100px in the middle of it
  const CW = Math.min(W, 1100), ox = (W - CW) / 2;
  const total = Math.max(inc, spend), narrow = CW < 560, rows = Math.max(left.length, right.length);
  const NW = 12, GAP = 10, LINE = 34, PAD = 7, LW = narrow ? 0 : Math.min(230, Math.max(160, Math.round(CW * .2)));
  const H0 = Math.max(220, (LINE + 8) * Math.max(rows, minRows) + 24, Math.round(fill));     // fill: the height a bento card has for it
  // Each side node gets at least a label's height of room, so its label can sit right beside it. When small nodes'
  // labels would push a side past the chart's height, the bands get thinner rather than the chart taller.
  const need = (ns: LaidNode[], k: number) => ns.reduce((s, n) => s + Math.max(Math.max(2, n.v * k) + GAP, LINE), 0) - GAP;
  const over = (k: number) => Math.max(need(left, k), need(right, k)) > H0 - 20;
  let k = (H0 - 20 - GAP * (rows - 1)) / total;
  if (over(k) && !over(0)) { let lo = 0, hi = k; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (over(m)) hi = m; else lo = m; } k = lo; }
  left.concat(right).forEach(n => { n.h = Math.max(2, n.v * k); n.slot = Math.max(n.h + GAP, LINE); });
  const tall = (nodes: LaidNode[]) => nodes.reduce((s, n) => s + n.slot, 0) - GAP;
  const H = Math.max(H0, Math.ceil(Math.max(tall(left), tall(right))) + 20);
  const stack = (nodes: LaidNode[], x: number) => { let y = (H - tall(nodes)) / 2; nodes.forEach(n => { n.x = x; n.y = y + (n.slot - GAP - n.h) / 2; y += n.slot; }); };
  const xl = ox + LW, xm = W / 2 - NW / 2, xr = ox + CW - LW - NW;
  stack(left, xl); stack(right, xr);
  const mh = total * k, my = (H - mh) / 2;
  const col = (n: LaidNode) => ({ in: 'var(--income)', save: 'var(--warn)', out: 'var(--spend)', kept: 'var(--good)' } as Record<string, string>)[n.kind!];
  const band = (x0: number, y0: number, x1: number, y1: number, h: number) => { const c = (x0 + x1) / 2; return 'M' + x0 + ',' + y0 + 'C' + c + ',' + y0 + ' ' + c + ',' + y1 + ' ' + x1 + ',' + y1 + 'L' + x1 + ',' + (y1 + h) + 'C' + c + ',' + (y1 + h) + ' ' + c + ',' + (y0 + h) + ' ' + x0 + ',' + (y0 + h) + 'Z'; };
  let links: Html | string = '', nodes: Html | string = '', my1 = my, my2 = my;
  const share = (n: LaidNode, of: number) => of ? ' (' + Math.round(n.v / of * 100) + '%)' : '';
  // Where a band (and its bar) goes when clicked: an income source opens its account, a category its transactions,
  // the grouped rows the month's Income or Expenses list, and Kept / From savings the accounts the money sits in
  const href = (n: LaidNode) => n.kind === 'in' ? (n.id ? '#/account/' + n.id : '#/transactions?type=deposit')
    : n.kind === 'out' ? (n.id ? '#/transactions?category=' + n.id : '#/transactions?type=withdrawal') : '#/accounts';
  const tip = (n: LaidNode) => n.kind === 'in' ? n.name + ' → ' + money0(n.v) + share(n, total)
    : n.name + ' · ' + money0(n.v) + share(n, n.kind === 'kept' ? inc : spend) + (n.kind === 'kept' ? ' of income' : ' of spending');
  const act = (n: LaidNode) => html` data-tip="${tip(n)}" data-onclick="App.go('${href(n)}')"`;
  left.forEach(n => { links = html`${links}<path class="lk" d="${band(xl + NW, n.y, xm, my1, n.h)}" fill="${col(n)}"${act(n)}/>`; my1 += n.h; });
  right.forEach(n => { links = html`${links}<path class="lk" d="${band(xm + NW, my2, xr, n.y, n.h)}" fill="${col(n)}"${act(n)}/>`; my2 += n.h; });
  // Room for a label: beside the chart on a wide card; inside, between its bar and the middle one, on a narrow one
  const room = narrow ? xm - (xl + NW) - 2 * PAD : LW - 14;
  const label = (n: LaidNode, anchor: string, x: number, nm = fitText(n.name, room, narrow ? 600 : 500)) => html`<text x="${x}" y="${n.ly - 2}" text-anchor="${anchor}" class="sk-name">${nm !== n.name ? html`<title>${n.name}</title>` : ''}${nm}</text><text x="${x}" y="${n.ly + 12}" text-anchor="${anchor}" class="sk-amt amtx">${money0(n.v)}</text>`;
  // Keep two-line labels apart and inside the chart: centre each on its node, push it below the one above,
  // pull any that run off the bottom back up, then make sure the first one still clears the top edge
  const TOP = 14, BOT = H - 18;
  const spread = (col2: LaidNode[]) => {
    let prev = -Infinity; col2.forEach(n => { n.ly = Math.max(n.y + n.h / 2, prev + LINE, TOP); prev = n.ly; });
    let next = Infinity; [...col2].reverse().forEach(n => { n.ly = Math.min(n.ly, next - LINE, BOT); next = n.ly; });
    prev = -Infinity; col2.forEach(n => { n.ly = Math.max(n.ly, prev + LINE, TOP); prev = n.ly; });
  };
  spread(left); spread(right);
  let labels: Html | string = '';
  left.forEach(n => { nodes = html`${nodes}<rect class="sk-node" x="${n.x}" y="${n.y}" width="${NW}" height="${n.h}" rx="3" fill="${col(n)}"${act(n)}/>`; labels = html`${labels}${narrow ? label(n, 'start', xl + NW + PAD) : label(n, 'end', xl - 8)}`; });
  right.forEach(n => { nodes = html`${nodes}<rect class="sk-node" x="${n.x}" y="${n.y}" width="${NW}" height="${n.h}" rx="3" fill="${col(n)}"${act(n)}/>`; labels = html`${labels}${narrow ? label(n, 'end', xr - PAD) : label(n, 'start', xr + NW + 8)}`; });
  nodes = html`${nodes}<rect x="${xm}" y="${my}" width="${NW}" height="${mh}" rx="3" fill="var(--text)" opacity=".75"/>`;
  return html`<svg viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${Math.round(fill)}" class="${narrow ? 'sk-in' : ''}" role="img" aria-label="Income flowing into spending categories">${links}${nodes}${labels}</svg>`;
}
// Redraw each money-flow chart at the width its card actually has, now and whenever the card changes size
const skSeen = new WeakSet();
const skObs = 'ResizeObserver' in window ? new ResizeObserver(es => es.forEach(e => fitSankey1(e.target as HTMLElement))) : null;
// In a bento card the chart also grows to the card's height: its box keeps the chart's own height as a minimum (so the
// chart never makes its row taller than it needs) and the chart is redrawn to fill whatever the row gives it.
function fitSankey1(sec: HTMLElement) {
  const svg = sec.querySelector('svg'), box = sec.querySelector<HTMLElement>('.sk-box'), w = Math.round(sec.clientWidth - parseFloat(getComputedStyle(sec).paddingLeft) - parseFloat(getComputedStyle(sec).paddingRight));
  if (!svg || !box || !sec.isConnected || w <= 0) return;
  try {
    const tall = !!sec.closest('.cards.bento');
    const d = JSON.parse(sec.dataset.sk!), own = sankeySvg(d, w, 0, tall ? SK_ROWS : 0), ownH = Number(/viewBox="0 0 \d+ (\d+)"/.exec(String(own))![1]);
    if (tall) box.style.setProperty('--sk-h', ownH + 'px');
    const h = tall ? Math.round(box.clientHeight) : 0, fill = h > ownH + 4 ? h : 0;
    if (Math.abs(w - Number(svg.dataset.w)) < 2 && Math.abs(fill - Number(svg.dataset.h || 0)) < 2) return;
    svg.outerHTML = String(fill ? sankeySvg(d, w, fill) : own);
  } catch (e) { /* keep the chart as drawn */ }
}
export function fitSankey() {
  document.querySelectorAll<HTMLElement>('#view .sankey[data-sk]').forEach(sec => {
    fitSankey1(sec);
    if (skObs && !skSeen.has(sec)) { skSeen.add(sec); skObs.observe(sec); }
  });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  balanceSparks,
  sparkline,
  heatmapPanel,
  sankeyPanel,
  fitSankey,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

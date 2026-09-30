'use strict';
/* =====================================================================
   Modern UI, part 2: privacy & density, haptics, pull-to-refresh,
   bottom sheets, inline edits, keyboard navigation, infinite scroll,
   customizable dashboard, sparklines, heatmap, flow chart,
   natural-language quick add.
   ===================================================================== */
const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ } };

/* ---------- Privacy mode & density ---------- */
function applyPrefs() {
  const r = document.documentElement;
  r.classList.toggle('privacy', !!LS.get('privacy', false));
  r.classList.toggle('compact', !!LS.get('compact', false));
  drawToggles();
}
function drawToggles() {
  const p = !!LS.get('privacy', false), c = !!LS.get('compact', false);
  document.querySelectorAll('[data-tg=privacy]').forEach(b => { b.classList.toggle('on', p); b.innerHTML = icon(p ? 'eyeoff' : 'eye') + '<span>' + (p ? 'Show amounts' : 'Hide amounts') + '</span>'; b.title = 'Hide or show amounts (P)'; });
  document.querySelectorAll('[data-tg=compact]').forEach(b => { b.classList.toggle('on', c); b.innerHTML = icon('density') + '<span>' + (c ? 'Comfortable view' : 'Compact view') + '</span>'; });
}
function togglePrivacy() {
  const on = !LS.get('privacy', false); LS.set('privacy', on);
  vt('prefs', applyPrefs); buzz(8);
  toast(on ? 'Amounts hidden · press P or hover to peek' : 'Amounts visible');
}
function toggleDensity() { LS.set('compact', !LS.get('compact', false)); vt('prefs', applyPrefs); buzz(8); }
applyPrefs();

/* ---------- While scrolling: lets CSS pause expensive effects (the glass theme's moving light) ---------- */
(function scrollFlag() {
  const root = document.documentElement; let t = 0;
  addEventListener('scroll', () => { if (!t) root.classList.add('scrolling'); clearTimeout(t); t = setTimeout(() => { root.classList.remove('scrolling'); t = 0; }, 160); }, { passive: true, capture: true });
})();

/* ---------- Pull to refresh (phones) ---------- */
(function pullToRefresh() {
  if (!('ontouchstart' in window)) return;
  const ind = el('ptr'); let y0 = null, d = 0, busyNow = false;
  const blocked = () => scrollY > 0 || el('app').hidden || el('drawer').classList.contains('open') || !el('palette').hidden || busyNow;
  addEventListener('touchstart', e => { y0 = blocked() ? null : e.touches[0].clientY; d = 0; }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 === null) return;
    d = Math.max(0, Math.min(120, (e.touches[0].clientY - y0) * .5));
    if (scrollY > 0) d = 0;
    ind.style.transform = 'translate(-50%, ' + (d - 50) + 'px) rotate(' + d * 3 + 'deg)';
    ind.style.opacity = Math.min(1, d / 60);
    const armed = d >= 70;
    if (armed !== ind.classList.contains('armed')) { ind.classList.toggle('armed', armed); if (armed) buzz(10); }
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 === null) return; y0 = null;
    if (!ind.classList.contains('armed')) { ind.style.transform = ''; ind.style.opacity = ''; return; }
    ind.classList.remove('armed'); ind.classList.add('busy'); busyNow = true;
    ind.style.transform = 'translate(-50%, 24px)';
    try { await refreshAll({ visible: true }); } catch (e) { /* route shows its own errors */ }
    ind.classList.remove('busy'); ind.style.transform = ''; ind.style.opacity = ''; busyNow = false;
  });
})();

/* ---------- Bottom sheet: drag the handle down to dismiss (phones) ---------- */
(function sheetDrag() {
  const d = el('drawer'); let sy = null, sd = 0, t0 = 0;
  d.addEventListener('touchstart', e => {
    if (innerWidth > 900 || !e.target.closest('.grab, header') || e.target.closest('button')) return;
    sy = e.touches[0].clientY; sd = 0; t0 = Date.now(); d.classList.add('dragging');
  }, { passive: true });
  d.addEventListener('touchmove', e => {
    if (sy === null) return;
    sd = Math.max(0, e.touches[0].clientY - sy);
    d.style.transform = 'translateY(' + sd + 'px)'; el('scrim').style.opacity = String(1 - Math.min(1, sd / 500));
  }, { passive: true });
  d.addEventListener('touchend', () => {
    if (sy === null) return; sy = null; d.classList.remove('dragging'); el('scrim').style.opacity = '';
    const v = sd / Math.max(1, Date.now() - t0);
    if (sd > 120 || (v > .5 && sd > 40)) { S.drawerHero = null; buzz(6); closeDrawer(); }
    d.style.transform = '';
  });
})();

/* ---------- Inline category / budget picker ---------- */
let pickCtx = null;
function pick(node) {
  const tr = node.closest('tr[data-gid]'), meta = tr && S.txMeta[tr.dataset.gid], L = S.lists;
  if (!meta || !L) return;
  const k = node.dataset.k, sp = meta.g.splits[0];
  const items = k === 'category'
    ? [{ v: '', l: 'No category' }, ...L.categories.map(c => ({ v: c.name, l: c.name }))]
    : [{ v: '', l: 'No budget' }, ...L.budgets.filter(b => b.active || b.id === sp.budget_id).map(b => ({ v: b.id, l: b.name }))];
  pickCtx = { tr, meta, k, items, cur: k === 'category' ? sp.category : sp.budget_id, idx: 0, q: '' };
  const box = el('pickpop');
  box.innerHTML = '<input type="text" id="pkq" autocomplete="off" placeholder="' + (k === 'category' ? 'Find or create a category' : 'Find a budget') + '" oninput="App.pickFilter(this.value)" onkeydown="App.pickKey(event)"><div class="pk-list" id="pkList"></div>';
  box.hidden = false;
  const r = node.getBoundingClientRect(), w = Math.min(280, innerWidth - 24);
  box.style.width = w + 'px';
  box.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
  pickFilter('');
  const h = box.offsetHeight;
  box.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(12, r.top - h - 6) : r.bottom + 6) + 'px';
  el('pkq').focus();
}
function pickList() {
  const c = pickCtx, q = c.q.trim().toLowerCase();
  let list = c.items.filter(x => !q || x.l.toLowerCase().includes(q));
  list.sort((a, b) => (b.l.toLowerCase().startsWith(q) ? 1 : 0) - (a.l.toLowerCase().startsWith(q) ? 1 : 0));
  if (c.k === 'category' && q && !c.items.some(x => x.l.toLowerCase() === q)) list = [...list, { v: c.q.trim(), l: 'Create “' + c.q.trim() + '”', create: true }];
  return list;
}
function pickFilter(q) { pickCtx.q = q; pickCtx.idx = q ? 0 : Math.max(0, pickList().findIndex(x => String(x.v) === String(pickCtx.cur || ''))); drawPick(); }
function drawPick() {
  const c = pickCtx, list = pickList();
  el('pkList').innerHTML = list.map((x, i) => '<div class="pal-item' + (i === c.idx ? ' on' : '') + '" onmouseenter="App.pickHover(' + i + ')" onmousedown="event.preventDefault();App.pickChoose(' + i + ')">' +
    '<span>' + esc(x.l) + '</span>' + (String(x.v) === String(c.cur) && !x.create ? '<span class="k">✓</span>' : '') + '</div>').join('') || '<div class="empty" style="padding:10px 14px">Nothing matches.</div>';
  const on = el('pkList').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function pickHover(i) { if (pickCtx && i !== pickCtx.idx) { pickCtx.idx = i; drawPick(); } }
function pickKey(e) {
  const n = pickList().length;
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) e.stopPropagation();
  if (e.key === 'ArrowDown') { e.preventDefault(); pickCtx.idx = (pickCtx.idx + 1) % n; drawPick(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pickCtx.idx = (pickCtx.idx - 1 + n) % n; drawPick(); }
  else if (e.key === 'Enter') { e.preventDefault(); pickChoose(pickCtx.idx); }
  else if (e.key === 'Escape') { e.preventDefault(); closePick(); }
}
function closePick() { const a = document.activeElement; if (a && a.id === 'pkq') a.blur(); el('pickpop').hidden = true; const c = pickCtx; pickCtx = null; return c; }
document.addEventListener('mousedown', e => { if (!el('pickpop').hidden && !e.target.closest('#pickpop')) closePick(); });
document.addEventListener('scroll', e => { if (!el('pickpop').hidden && !(e.target.closest && e.target.closest('#pickpop'))) closePick(); }, true);
function rowFor(g, opts) {
  const t = document.createElement('template'); t.innerHTML = txRows([g], opts);
  return t.content.querySelector('tr[data-gid]');
}
function swapRow(tr, g, opts) {
  const nr = rowFor(g, opts), cb = tr.querySelector('input[data-sel]');
  if (cb && cb.checked) nr.querySelector('input[data-sel]').checked = true;
  if (tr.classList.contains('kfocus')) nr.classList.add('kfocus');
  tr.replaceWith(nr); bindSwipe(); return nr;
}
async function pickChoose(i) {
  const item = pickList()[i], c = closePick(); if (!item || !c) return;
  const { meta, k } = c, g = meta.g, sp = g.splits[0];
  if (String(item.v) === String(c.cur) && !item.create) return;
  const before = { category: sp.category, budget_id: sp.budget_id, budget_name: sp.budget_name };
  if (k === 'category') sp.category = item.v; else { sp.budget_id = item.v; sp.budget_name = item.v ? item.l : ''; }
  let row = c.tr.isConnected ? swapRow(c.tr, g, meta.opts) : null;          // optimistic: show it now
  if (row) row.classList.add('saving');
  buzz(8);
  try {
    const t = { transaction_journal_id: sp.jid };
    if (k === 'category') t.category_name = item.v; else t.budget_id = item.v || '0';
    await api('/transactions/' + g.id, { method: 'PUT', body: { apply_rules: false, fire_webhooks: true, transactions: [t] } });
    invalidate(); if (item.create) S.listsAt = 0;
    if (row && row.isConnected) { row.classList.remove('saving'); row.classList.add('saved'); setTimeout(() => row.classList.remove('saved'), 900); }
    toast((k === 'category' ? 'Category' : 'Budget') + (item.v ? ' set to ' + (item.create ? item.v : item.l) : ' removed'));
  } catch (e) {
    Object.assign(sp, before);
    row = document.querySelector('#view tr[data-gid="' + g.id + '"]'); if (row) swapRow(row, g, meta.opts);
    if (e instanceof AuthError) return showLogin(e.message);
    toast('Couldn’t save: ' + e.message);
  }
}

/* ---------- Keyboard: j/k to move, Enter to open, c/b to recategorize, x to select, p for privacy, ? for help ---------- */
function kRows() { return [...document.querySelectorAll('#view tr[data-gid]')]; }
function kMark(i) {
  const rows = kRows(); if (!rows.length) return;
  S.kIdx = Math.max(0, Math.min(rows.length - 1, i));
  rows.forEach((r, j) => r.classList.toggle('kfocus', j === S.kIdx));
  rows[S.kIdx].scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
}
document.addEventListener('keydown', e => {
  if (el('app').hidden || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (el('drawer').classList.contains('open') || !el('palette').hidden || el('confirm').open || !el('pickpop').hidden) return;
  const k = e.key;
  if (k === 'p' || k === 'P') { e.preventDefault(); return togglePrivacy(); }
  if (k === '?') { e.preventDefault(); return shortcutsSheet(); }
  if (k === 'j' || k === 'ArrowDown' && S.kIdx >= 0) { e.preventDefault(); return kMark((S.kIdx ?? -1) + 1); }
  if (k === 'k' || k === 'ArrowUp' && S.kIdx >= 0) { e.preventDefault(); return kMark(Math.max(0, (S.kIdx ?? 0) - 1)); }
  const tr = S.kIdx >= 0 && kRows()[S.kIdx]; if (!tr) return;
  if (k === 'Enter' || k === 'o') { e.preventDefault(); editTx(tr.dataset.gid); }
  else if (k === 'c' || k === 'b') { const n = [...tr.querySelectorAll('[data-k="' + (k === 'c' ? 'category' : 'budget') + '"]')].find(x => x.offsetParent !== null); if (n) { e.preventDefault(); pick(n); } }
  else if (k === 'x') { const cb = tr.querySelector('input[data-sel]'); if (cb) { cb.checked = !cb.checked; selChanged(); } }
  else if (k === 'Escape') { S.kIdx = -1; kRows().forEach(r => r.classList.remove('kfocus')); }
});
function shortcutsSheet() {
  const rows = [['N', 'New transaction'], ['⌘/Ctrl K', 'Search everything'], ['/', 'Search transactions'], ['J / K', 'Next / previous transaction'], ['Enter', 'Open the selected transaction'],
    ['C', 'Change its category'], ['B', 'Change its budget'], ['X', 'Select it for bulk edit'], ['P', 'Hide or show amounts'], ['Esc', 'Close / clear']];
  openDrawer('Keyboard shortcuts', '<div class="list">' + rows.map(([a, b]) => '<div class="row"><span class="name">' + b + '</span><kbd>' + a + '</kbd></div>').join('') + '</div>');
}

/* ---------- Infinite scroll for transaction lists ---------- */
function bindFeed() {
  const m = el('feedMore'), f = S.feed; if (!m || !f) return;
  const io = new IntersectionObserver(async ents => {
    if (!ents.some(x => x.isIntersecting) || f.busy) return;
    if (S.feed !== f || !m.isConnected) return io.disconnect();
    f.busy = true;
    try {
      const gs = await f.more(f.next);
      if (S.feed !== f || !m.isConnected) return;
      f.next++; appendRows(gs, f.opts);
      if (f.next > f.pages || !gs.length) { io.disconnect(); m.remove(); } else { io.unobserve(m); io.observe(m); }
    } catch (e) { m.textContent = 'Couldn’t load more: ' + e.message; io.disconnect(); }
    finally { f.busy = false; }
  }, { rootMargin: '700px 0px' });
  io.observe(m);
}
function dayNet(tbody) {
  return [...tbody.querySelectorAll('tr[data-gid]')].reduce((s, tr) => { const m = S.txMeta[tr.dataset.gid]; return s + (m ? signed(m.g, m.accountId) : 0); }, 0);
}
function appendRows(gs, opts) {
  const table = document.querySelector('#view table.feed'); if (!table || !gs.length) return;
  const t = document.createElement('template'); t.innerHTML = txRows(gs, opts);
  const bodies = [...t.content.querySelectorAll('tbody.day')], last = table.querySelector('tbody.day:last-of-type');
  if (bodies.length && last && bodies[0].querySelector('.dayhead').dataset.day === last.querySelector('.dayhead').dataset.day) {
    bodies.shift().querySelectorAll('tr[data-gid]').forEach(r => last.appendChild(r));
    const net = dayNet(last), span = last.querySelector('.dayhead .num') || document.createElement('span');
    span.className = 'num ' + (net < 0 ? '' : 'pos'); span.textContent = (net > 0 ? '+' : '') + money(net);
    if (!span.isConnected) last.querySelector('.dayhead div').appendChild(span);
  }
  bodies.forEach(b => table.appendChild(b));
  bindSwipe();
  const all = document.querySelector('.selall input'); if (all && all.checked) selAll(true);
}

/* ---------- Customizable dashboard ---------- */
const DASH_WIDE = ['flow', 'cashflow', 'recent'];
const DASH_NAMES = { safe: 'Safe to spend', attention: 'Needs attention', spending: 'Where it went', budgets: 'Budgets', cash: 'Cash & savings', cards: 'Credit cards',
  loans: 'Loans', bills: 'Coming up', heatmap: 'Daily spending', flow: 'Money flow', cashflow: 'Cash flow', recent: 'Recent transactions' };
const dashLayout = () => ({ order: [], hidden: [], wide: null, ...LS.get('dash', {}) });
function dashButton() { return S.dashEdit ? '' : '<button class="btn small" onclick="App.dashEdit(true)" title="Reorder, resize or hide cards">Customize</button>'; }
function dashboard(W) {
  const L = dashLayout(), keys = W.map(w => w[0]), map = Object.fromEntries(W), wide = L.wide || DASH_WIDE, edit = !!S.dashEdit;
  const order = [...L.order.filter(k => keys.includes(k)), ...keys.filter(k => !L.order.includes(k))];
  const card = k => {
    const html = map[k]; if (!html) return '';
    const off = L.hidden.includes(k); if (off && !edit) return '';
    return '<div class="w' + (wide.includes(k) ? ' wide' : '') + (off ? ' off' : '') + '" data-w="' + k + '"' + (edit ? ' draggable="true"' : '') + '>' +
      (edit ? '<div class="wctl"><span class="grip" title="Drag to move">⠿</span><strong>' + esc(DASH_NAMES[k] || k) + '</strong><span class="grow"></span>' +
        '<button type="button" onclick="App.dashMove(\'' + k + '\',-1)" aria-label="Move up">↑</button><button type="button" onclick="App.dashMove(\'' + k + '\',1)" aria-label="Move down">↓</button>' +
        '<button type="button" onclick="App.dashWide(\'' + k + '\')">' + (wide.includes(k) ? 'Narrow' : 'Wide') + '</button>' +
        '<button type="button" onclick="App.dashHide(\'' + k + '\')">' + (off ? 'Show' : 'Hide') + '</button></div>' : '') + html + '</div>';
  };
  return (edit ? '<div class="dash-bar"><span>Drag cards (or use the arrows) to reorder. Wide cards span the full width.</span><span class="grow"></span>' +
      '<button class="link" onclick="App.dashReset()">Reset</button><button class="btn small primary" onclick="App.dashEdit(false)">Done</button></div>' : '') +
    '<div class="cards' + (edit ? ' editing' : '') + '" id="dash">' + order.map(card).join('') + '</div>';
}
function dashSave(mut) {
  const L = dashLayout(), d = el('dash');
  if (d) L.order = [...d.querySelectorAll(':scope > .w')].map(w => w.dataset.w).concat(L.order.filter(k => !d.querySelector('[data-w="' + k + '"]')));
  if (!L.wide) L.wide = DASH_WIDE.slice();
  if (mut) mut(L);
  LS.set('dash', L); return L;
}
function dashAnimate(fn) {
  const ws = [...document.querySelectorAll('#dash > .w')];
  vt('dash', fn, () => ws.forEach((w, i) => vtName(w, 'dw-' + w.dataset.w)));
}
function dashEdit(on) { S.dashEdit = on; S.pageKey = ''; PAGES.clear(); route(); }
function dashMove(k, dir) {
  const w = document.querySelector('#dash > [data-w="' + k + '"]'); if (!w) return;
  const sib = dir < 0 ? w.previousElementSibling : w.nextElementSibling; if (!sib) return;
  dashAnimate(() => { dir < 0 ? sib.before(w) : sib.after(w); dashSave(); });
}
function dashWide(k) {
  const L = dashSave(x => { x.wide = x.wide.includes(k) ? x.wide.filter(y => y !== k) : [...x.wide, k]; });
  const w = document.querySelector('#dash > [data-w="' + k + '"]');
  dashAnimate(() => { w.classList.toggle('wide', L.wide.includes(k)); w.querySelector('.wctl button:nth-of-type(3)').textContent = L.wide.includes(k) ? 'Narrow' : 'Wide'; });
}
function dashHide(k) {
  const L = dashSave(x => { x.hidden = x.hidden.includes(k) ? x.hidden.filter(y => y !== k) : [...x.hidden, k]; });
  const w = document.querySelector('#dash > [data-w="' + k + '"]'), off = L.hidden.includes(k);
  w.classList.toggle('off', off); w.querySelector('.wctl button:nth-of-type(4)').textContent = off ? 'Show' : 'Hide';
}
function dashReset() { LS.set('dash', {}); S.pageKey = ''; PAGES.clear(); route(); }
function bindDash() {
  const d = el('dash'); if (!d || !d.classList.contains('editing')) return;
  let drag = null;
  d.addEventListener('dragstart', e => { drag = e.target.closest('.w'); if (!drag) return; drag.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag.dataset.w); });
  d.addEventListener('dragover', e => {
    if (!drag) return; e.preventDefault();
    const over = e.target.closest('.w'); if (!over || over === drag) return;
    const r = over.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    if (after ? over.nextElementSibling !== drag : over.previousElementSibling !== drag) after ? over.after(drag) : over.before(drag);
  });
  d.addEventListener('dragend', () => { if (drag) drag.classList.remove('dragging'); drag = null; dashSave(); });
}

/* ---------- Sparklines: last 30 days of each account's balance ---------- */
async function balanceSparks(accounts) {
  const start = addDays(todayIso(), -30), end = todayIso(), out = {};
  const gs = (await getAll('/transactions', { start, end, type: 'all' })).map(normGroup);     // one request for every account
  accounts.forEach(a => {
    const byDay = {}; gs.forEach(g => { const v = signed(g, a.id); if (v) { const d = String(g.date).slice(0, 10); byDay[d] = (byDay[d] || 0) + v; } });
    let bal = a.balance; const vals = [];
    for (let i = 0; i <= 30; i++) { const d = addDays(end, -i); vals.push(bal); bal -= byDay[d] || 0; }
    out[a.id] = vals.reverse();
  });
  return out;
}
function sparkline(vals, owed) {
  const v = owed ? vals.map(x => Math.max(0, -x)) : vals, W = 64, H = 20;
  const lo = Math.min(...v), hi = Math.max(...v), rng = hi - lo || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * W, H - 2 - ((y - lo) / rng) * (H - 4)]);
  const up = v[v.length - 1] >= v[0], good = owed ? !up : up;
  const tip = (owed ? 'Owed ' : 'Balance ') + money0(v[0]) + ' → ' + money0(v[v.length - 1]) + ' over 30 days';
  return '<svg class="spark ' + (hi === lo ? 'flat' : good ? 'good' : 'bad') + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" data-tip="' + esc(tip) + '" aria-hidden="true">' +
    '<polyline points="' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/><circle cx="' + pts[pts.length - 1][0] + '" cy="' + pts[pts.length - 1][1].toFixed(1) + '" r="2"/></svg>';
}

/* ---------- Daily spending heatmap ---------- */
function heatmapPanel(cur, groups) {
  const by = {}, cnt = {};
  groups.forEach(g => { const d = String(g.date).slice(0, 10); by[d] = (by[d] || 0) + g.total; cnt[d] = (cnt[d] || 0) + 1; });
  const dim = new Date(cur.y, cur.m + 1, 0).getDate(), lead = new Date(cur.y, cur.m, 1).getDay(), t = todayIso();
  const max = Math.max(1, ...Object.values(by)), days = Object.keys(by).length;
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="hm-cell pad"></span>';
  for (let d = 1; d <= dim; d++) {
    const iso = cur.start.slice(0, 8) + pad(d), v = by[iso] || 0, fut = iso > t;
    const pct = v ? Math.round(18 + 82 * Math.sqrt(v / max)) : 0;
    cells += '<button type="button" class="hm-cell' + (fut ? ' fut' : '') + (iso === t ? ' today' : '') + '"' + (v ? ' style="--p:' + pct + '%"' : '') +
      ' data-tip="' + esc(fmtDay(iso) + (v ? ' · ' + money(v) + ' · ' + cnt[iso] + ' purchase' + (cnt[iso] === 1 ? '' : 's') : fut ? '' : ' · nothing spent')) + '"' +
      (v ? ' onclick="location.hash=\'#/transactions?search=date_on:' + iso + '\'"' : ' disabled') + '><span>' + d + '</span></button>';
  }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const passed = cur.start.slice(0, 7) === t.slice(0, 7) ? +t.slice(8, 10) : dim, free = Math.max(0, passed - days);
  return '<section class="panel"><h2>Daily spending</h2><p class="lead">Darker days cost more · tap one to see it</p>' +
    '<div class="hm"><div class="hm-dow">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => '<span>' + x + '</span>').join('') + '</div><div class="hm-grid">' + cells + '</div></div>' +
    '<div class="hm-foot"><span>' + (top ? 'Biggest day: <strong class="num">' + money0(top[1]) + '</strong> on ' + fmtDay(top[0]) : 'No spending yet') + '</span><span>' + free + ' no-spend day' + (free === 1 ? '' : 's') + '</span></div></section>';
}

/* ---------- Money flow (income → spending categories + kept) ---------- */
function sankeyPanel(sources, income, cats, cur) {
  let left = sources.map(x => ({ name: x.name, v: absDiff(x) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (!left.length && income > 0) left = [{ name: 'Income', v: income }];
  if (left.length > 4) { const rest = left.slice(3); left = left.slice(0, 3); left.push({ name: rest.length + ' other sources', v: rest.reduce((s, x) => s + x.v, 0) }); }
  let right = cats.map(c => ({ name: c.name, v: c.amt, id: c.id })).sort((a, b) => b.v - a.v);
  if (right.length > 7) { const rest = right.slice(6); right = right.slice(0, 6); right.push({ name: rest.length + ' other categories', v: rest.reduce((s, x) => s + x.v, 0) }); }
  const inc = left.reduce((s, x) => s + x.v, 0), spend = right.reduce((s, x) => s + x.v, 0);
  if (!inc && !spend) return '';
  left.forEach(x => { x.kind = 'in'; });
  right.forEach(x => { x.kind = 'out'; });
  if (spend > inc) left.push({ name: 'From savings', v: spend - inc, kind: 'save' });
  if (inc > spend) right.push({ name: 'Kept', v: inc - spend, kind: 'kept' });
  const total = Math.max(inc, spend), narrow = innerWidth < 640;
  const W = narrow ? 460 : 900, LW = narrow ? 118 : 190, NW = 12, GAP = 10, H = Math.max(220, 36 * Math.max(left.length, right.length) + 24);
  const k = (H - 20 - GAP * (Math.max(left.length, right.length) - 1)) / total;
  const stack = (nodes, x) => { const hh = nodes.reduce((s, n) => s + n.v * k, 0) + GAP * (nodes.length - 1); let y = (H - hh) / 2; nodes.forEach(n => { n.x = x; n.y = y; n.h = Math.max(2, n.v * k); y += n.h + GAP; }); };
  const xl = LW, xm = W / 2 - NW / 2, xr = W - LW - NW;
  stack(left, xl); stack(right, xr);
  const mh = total * k, my = (H - mh) / 2;
  const col = n => ({ in: 'var(--income)', save: 'var(--warn)', out: 'var(--spend)', kept: 'var(--good)' })[n.kind];
  const band = (x0, y0, x1, y1, h) => { const c = (x0 + x1) / 2; return 'M' + x0 + ',' + y0 + 'C' + c + ',' + y0 + ' ' + c + ',' + y1 + ' ' + x1 + ',' + y1 + 'L' + x1 + ',' + (y1 + h) + 'C' + c + ',' + (y1 + h) + ' ' + c + ',' + (y0 + h) + ' ' + x0 + ',' + (y0 + h) + 'Z'; };
  let links = '', nodes = '', my1 = my, my2 = my;
  const share = (n, of) => of ? ' (' + Math.round(n.v / of * 100) + '%)' : '';
  left.forEach(n => { links += '<path class="lk" d="' + band(xl + NW, n.y, xm, my1, n.h) + '" fill="' + col(n) + '" data-tip="' + esc(n.name + ' → ' + money0(n.v) + share(n, total)) + '"/>'; my1 += n.h; });
  right.forEach(n => { links += '<path class="lk" d="' + band(xm + NW, my2, xr, n.y, n.h) + '" fill="' + col(n) + '" data-tip="' + esc(n.name + ' · ' + money0(n.v) + share(n, n.kind === 'kept' ? inc : spend) + (n.kind === 'kept' ? ' of income' : n.kind === 'out' ? ' of spending' : '')) + '"' +
    (n.id ? ' style="cursor:pointer" onclick="location.hash=\'#/transactions?category=' + n.id + '\'"' : '') + '/>'; my2 += n.h; });
  const label = (n, anchor, x) => '<text x="' + x + '" y="' + (n.ly - 2) + '" text-anchor="' + anchor + '" class="sk-name">' + esc(n.name.length > (narrow ? 14 : 24) ? n.name.slice(0, narrow ? 13 : 23) + '…' : n.name) + '</text>' +
    '<text x="' + x + '" y="' + (n.ly + 12) + '" text-anchor="' + anchor + '" class="sk-amt amtx">' + money0(n.v) + '</text>';
  // Keep two-line labels from colliding: push each label down past the previous one, then pull the column back up if it overflows
  const spread = nodes2 => { let prev = -Infinity; nodes2.forEach(n => { n.ly = Math.max(n.y + n.h / 2, prev + 30); prev = n.ly; });
    const over = prev + 16 - H; if (over > 0) { let next = Infinity; [...nodes2].reverse().forEach(n => { n.ly = Math.min(n.ly - over, next - 30); next = n.ly; }); } };
  spread(left); spread(right);
  left.forEach(n => { nodes += '<rect x="' + n.x + '" y="' + n.y + '" width="' + NW + '" height="' + n.h + '" rx="3" fill="' + col(n) + '"/>' + label(n, 'end', xl - 8); });
  right.forEach(n => { nodes += '<rect x="' + n.x + '" y="' + n.y + '" width="' + NW + '" height="' + n.h + '" rx="3" fill="' + col(n) + '"/>' + label(n, 'start', xr + NW + 8); });
  nodes += '<rect x="' + xm + '" y="' + my + '" width="' + NW + '" height="' + mh + '" rx="3" fill="var(--text)" opacity=".75"/>';
  return '<section class="panel chart sankey"><h2>Money flow</h2><p class="lead">Where ' + esc(cur.label) + '’s income went · hover a band for details</p>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Income flowing into spending categories">' + links + nodes + '</svg></section>';
}

/* ---------- Natural-language quick add ---------- */
const WDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FILLER = new Set(['on', 'with', 'via', 'using', 'at', 'for', 'to', 'from', 'paid', 'spent', 'bought', 'got', 'and', 'the', 'a', 'my', 'in']);
const GENERIC = new Set(['card', 'checking', 'savings', 'saving', 'account', 'bank', 'credit', 'debit', 'loan', 'gold', 'the']);
function nlDate(ws, i) {
  const w = ws[i].toLowerCase().replace(/[,.]$/, ''), t = new Date(); t.setHours(12, 0, 0, 0);
  const iso = d => isoDate(d);
  if (w === 'today') return [iso(t), 1];
  if (w === 'yesterday') { t.setDate(t.getDate() - 1); return [iso(t), 1]; }
  if (w === 'tomorrow') { t.setDate(t.getDate() + 1); return [iso(t), 1]; }
  if (/^\d{1,2}$/.test(w) && /^days?$/i.test(ws[i + 1] || '') && /^ago$/i.test(ws[i + 2] || '')) { t.setDate(t.getDate() - +w); return [iso(t), 3]; }
  const wd = WDAYS.findIndex(d => w.length >= 3 && d.startsWith(w) && (w.length >= 3 && (w === d || w === d.slice(0, 3) || w === d.slice(0, 4))));
  if (wd >= 0) { let back = (t.getDay() - wd + 7) % 7; if (back === 0 && /^last$/i.test(ws[i - 1] || '')) back = 7; t.setDate(t.getDate() - back); return [iso(t), 1]; }
  let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(w);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : t.getFullYear(); const d = new Date(y, +m[1] - 1, +m[2], 12); if (!m[3] && d > t) d.setFullYear(y - 1); return [iso(d), 1]; }
  const mi = MONS.findIndex(x => w.startsWith(x) && w.length <= 9);
  if (mi >= 0 && /^\d{1,2}(st|nd|rd|th)?,?$/i.test(ws[i + 1] || '')) { const d = new Date(t.getFullYear(), mi, parseInt(ws[i + 1], 10), 12); if (d > t) d.setFullYear(d.getFullYear() - 1); return [iso(d), 2]; }
  return null;
}
function nlAccount(tok) {
  const L = S.lists, w = tok.toLowerCase(); if (w.length < 3) return null;
  const pool = L.own.filter(a => isAsset(a) || isLiab(a));
  const full = pool.filter(a => a.name.toLowerCase() === w); if (full.length) return full[0];
  const hits = pool.filter(a => a.name.toLowerCase().split(/[\s\-–]+/).some(x => x.startsWith(w) && (!GENERIC.has(w) || x === w)));
  return hits.length === 1 ? hits[0] : hits.find(a => a.name.toLowerCase().startsWith(w)) || null;
}
function nlParse(text, submit) {
  const f = S.form; if (!f || f.id) return;
  collectTx();
  if (!f.nlBase) { const s0 = f.splits[0]; f.nlBase = { type: f.type, date: f.date, main: f.main, src: f.src, dst: f.dst, split: { amount: s0.amount, description: s0.description, counter: s0.counter, category: s0.category } }; }
  const base = f.nlBase, L = S.lists, ws = text.trim().split(/\s+/).filter(Boolean), used = new Set(), out = {};
  // dates first (so "sep 12" isn't read as an amount of 12)
  for (let i = 0; i < ws.length; i++) { if (used.has(i) || out.date) continue; const r = nlDate(ws, i); if (r) { out.date = r[0]; for (let j = 0; j < r[1]; j++) used.add(i + j); if (/^last$/i.test(ws[i - 1] || '')) used.add(i - 1); } }
  ws.forEach((w, i) => { if (!used.has(i) && out.amount == null && /^\$?\d+(?:[.,]\d{1,2})?\$?$/.test(w)) { out.amount = w.replace(/\$/g, '').replace(',', '.'); used.add(i); } });
  ws.forEach((w, i) => {
    const lw = w.toLowerCase();
    if (used.has(i)) return;
    if (/^(income|salary|paycheck|payday|refund|received|deposit|earned)$/.test(lw)) { out.type = 'deposit'; used.add(i); if (!/^(received|earned)$/.test(lw)) out.kw = lw[0].toUpperCase() + lw.slice(1); if (/^(salary|paycheck)$/.test(lw)) out.catHint = 'Salary'; }
    else if (/^(transfer|transferred|moved|move)$/.test(lw)) { out.type = 'transfer'; used.add(i); }
    else if (lw[0] === '#' && lw.length > 1) { const c = L.categories.find(c => c.name.toLowerCase().startsWith(lw.slice(1))); out.category = c ? c.name : w.slice(1); used.add(i); }
  });
  const accs = [];
  ws.forEach((w, i) => { if (used.has(i) || FILLER.has(w.toLowerCase())) return; const a = nlAccount(w.replace(/[,.]$/, '')); if (a && !accs.some(x => x.a.id === a.id)) { accs.push({ a, i, from: /^from$/i.test(ws[i - 1] || ''), to: /^to$/i.test(ws[i - 1] || '') }); used.add(i); } });
  // "for groceries" → category if it names one
  ws.forEach((w, i) => { if (!used.has(i) && /^for$/i.test(ws[i - 1] || '') && !out.category) { const c = L.categories.find(c => c.name.toLowerCase().startsWith(w.toLowerCase())); if (c && w.length >= 3) { out.category = c.name; used.add(i); } } });
  if (accs.length >= 2 && !out.type) out.type = 'transfer';
  const payeeWords = ws.filter((w, i) => !used.has(i) && !FILLER.has(w.toLowerCase()));
  let payee = payeeWords.join(' ').replace(/[,.]$/, '');
  const type = out.type || base.type;
  if (payee) {
    const pool = type === 'deposit' ? L.revenue : L.expense, q = payee.toLowerCase();
    const hit = pool.find(a => a.name.toLowerCase() === q) || pool.find(a => a.name.toLowerCase().startsWith(q)) || pool.find(a => a.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q.replace(/[^a-z0-9]/g, '')) && q.length >= 4);
    payee = hit ? hit.name : payee.replace(/\b\w/g, c => c.toUpperCase());
  }
  // rebuild the form from the base + what was understood
  f.type = type; f.date = out.date || base.date;
  const sp = f.splits[0];
  Object.assign(sp, base.split);
  if (out.amount) sp.amount = out.amount;
  if (payee) { sp.description = payee; if (type !== 'transfer') sp.counter = payee; }
  else if (out.kw) sp.description = out.kw;
  if (out.category || out.catHint) sp.category = out.category || out.catHint;
  f.main = base.main; f.src = base.src; f.dst = base.dst;
  if (type === 'transfer') {
    const from = accs.find(x => x.from) || accs.find(x => !x.to) || accs[0], to = accs.find(x => x !== from);
    if (from) f.src = from.a.id; if (to) f.dst = to.a.id;
    if (!payee && from && to) sp.description = 'Transfer to ' + to.a.name;
  } else if (accs[0]) f.main = accs[0].a.id;
  const chip = (l, v) => '<span class="nlchip"><em>' + l + '</em>' + esc(v) + '</span>';
  f.nl = text;
  f.nlChips = text.trim() ? [
    type !== base.type ? chip('Type', { deposit: 'Income', transfer: 'Transfer', withdrawal: 'Expense' }[type]) : '',
    out.amount ? chip('Amount', money(num(out.amount))) : '',
    out.date ? chip('Date', dayLabel(out.date)) : '',
    type === 'transfer' ? (accs.length ? chip('From', (L.byId[f.src] || {}).name || '?') + (f.dst ? chip('To', (L.byId[f.dst] || {}).name || '?') : '') : '') : accs[0] ? chip('Account', accs[0].a.name) : '',
    payee && type !== 'transfer' ? chip(type === 'deposit' ? 'From' : 'Payee', payee) : '',
    sp.category && (out.category || out.catHint) ? chip('Category', sp.category) : '',
  ].join('') : '';
  const caret = el('nlq') ? el('nlq').selectionStart : text.length;
  renderTxForm();
  const q = el('nlq'); if (q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
  if (payee && type !== 'transfer' && !out.category && !out.catHint) payeeFill(0, payee);
  if (submit) {
    if (num(sp.amount) > 0 && sp.description.trim()) el('txForm').requestSubmit();
    else { const miss = el('drawerBody').querySelector(num(sp.amount) > 0 ? '[data-k=description]' : '[data-k=amount]'); if (miss) miss.focus(); toast(num(sp.amount) > 0 ? 'Add a description' : 'Add an amount'); }
  }
}

/* ---------- After each page paint ---------- */
function afterPaint2(r) {
  bindFeed(); bindDash(); drawToggles();
  S.kIdx = -1;
}
Object.assign(window.App, {
  buzz, togglePrivacy, toggleDensity, drawToggles, pick, pickFilter, pickKey, pickHover, pickChoose, afterPaint2, balanceSparks, sparkline, heatmapPanel, sankeyPanel,
  dashboard, dashButton, dashEdit, dashMove, dashWide, dashHide, dashReset, nlParse, shortcutsSheet,
});

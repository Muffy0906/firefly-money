'use strict';
/* =====================================================================
   Polish: prefetch, quick add, payee memory, undo, charts, count-up,
   phone tab bar + swipe, date picker, command palette.
   ===================================================================== */
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Prefetch a page's data when hovering its link ---------- */
const prefetched = {};
function prefetch(name) {
  if (!VIEWS[name] || name === (parseHash().name) || Date.now() - (prefetched[name] || 0) < 30000) return;
  prefetched[name] = Date.now();
  Promise.resolve().then(() => VIEWS[name]({ name, id: '', q: {} }, () => {})).catch(() => {});
}

/* ---------- After every page paint ---------- */
function afterPaint(r, o = {}) {
  if (!o.quiet) countUp();
  bindChart();
  bindSwipe();
  if (App.afterPaint2) App.afterPaint2(r);
}
function countUp() {
  if (reduceMotion) return;
  document.querySelectorAll('#view [data-count]').forEach(node => {
    const target = parseFloat(node.dataset.count); if (!isFinite(target) || Math.abs(target) < 1) return;
    const t0 = performance.now(), dur = 520;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      node.textContent = money0(target * e);
      if (p < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
function bindChart() {
  document.querySelectorAll('#view svg.flowchart').forEach(svg => {
    const data = S.chartData || [];
    svg.addEventListener('mousemove', e => {
      const hit = e.target.closest && e.target.closest('[data-i]'); const tip = el('tip');
      if (!hit) { tip.hidden = true; return; }
      const d = (S.chartData || [])[+hit.dataset.i]; if (!d) return;
      tip.innerHTML = '<strong>' + esc(d.label) + '</strong><br>Earned ' + money0(d.income) + '<br>Spent ' + money0(d.spend) + '<br>Kept ' + money0(d.income - d.spend);
      tip.hidden = false; tip.style.left = Math.min(innerWidth - 170, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    });
    svg.addEventListener('mouseleave', () => { el('tip').hidden = true; });
    svg.addEventListener('click', e => {
      const hit = e.target.closest && e.target.closest('[data-i]'); const d = hit && (S.chartData || [])[+hit.dataset.i];
      if (!d || !d.go) return;
      el('tip').hidden = true;
      const [kind, a, b] = d.go.split(':');
      if (kind === 'month') { S.y = +a; S.m = +b; route(); }
      if (kind === 'report') location.hash = '#/reports?start=' + a + '&end=' + b;
    });
  });
}

/* ---------- Hover tooltips for chart points ---------- */
document.addEventListener('mousemove', e => {
  const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null, tip = el('tip');
  if (!t) { if (tip.dataset.src === 'pt') { tip.hidden = true; tip.dataset.src = ''; } return; }
  tip.textContent = t.getAttribute('data-tip'); tip.dataset.src = 'pt'; tip.hidden = false;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px';
  tip.style.top = (e.clientY + hgt + 20 > innerHeight ? e.clientY - hgt - 12 : e.clientY + 14) + 'px';
});
document.addEventListener('scroll', () => { const tip = el('tip'); if (tip.dataset.src === 'pt') tip.hidden = true; }, true);

/* ---------- Quick add + keyboard shortcuts ---------- */
async function quickAdd() { await lists(); const r = parseHash(); newTx(r.name === 'account' && r.id ? { account: r.id } : {}); }
const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!el('app').hidden) openPalette(); return; }
  if (el('app').hidden || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (el('drawer').classList.contains('open') || !el('palette').hidden || el('confirm').open) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickAdd(); }
  if (e.key === '/') { const s = document.querySelector('#view .search input'); if (s) { e.preventDefault(); s.focus(); } }
});

/* ---------- Payee memory: fill category/budget from the last time ---------- */
async function payeeFill(i, name) {
  const f = S.form; if (!f || !name || !name.trim()) return;
  const L = S.lists, pool = f.type === 'withdrawal' ? L.expense : L.revenue;
  const acc = pool.find(a => sameName(a.name, name)); if (!acc) return;
  try {
    const res = await api('/accounts/' + acc.id + '/transactions', { params: { limit: 25, page: 1 } });
    const mine = arr(res).map(normGroup).flatMap(g => g.splits).filter(x => x.source_id === acc.id || x.destination_id === acc.id);
    const s = mine.find(x => x.category) || mine[0];       // most recent one that was categorized
    if (!s || !S.form || S.form !== f) return;
    const card = document.querySelector('#txForm .split[data-i="' + i + '"]'); if (!card) return;
    const set = (k, v) => { const inp = card.querySelector('[data-k="' + k + '"]'); if (inp && !inp.value && v) { inp.value = v; inp.classList.add('filled'); f.splits[i][k] = v; } };
    set('category', s.category);
    if (f.type === 'withdrawal') set('budget', s.budget_id);
    if (!card.querySelector('[data-k="description"]').value) set('description', s.description);
  } catch (e) { /* suggestions are optional */ }
}

/* ---------- Undo for deleting transactions ---------- */
S.pendingDel = new Set();
function softDeleteTx(ids) {
  ids.forEach(id => S.pendingDel.add(id));
  document.querySelectorAll('#view tr[data-gid]').forEach(tr => { if (ids.includes(tr.dataset.gid)) tr.remove(); });
  tidyDays();
  S.sel = new Set(); if (el('bulkbar')) el('bulkbar').hidden = true;
  const box = el('undo'); clearTimeout(S.undoT);
  let undone = false;
  const commit = async () => {
    box.hidden = true;
    if (undone) return;
    let failed = 0;
    await eachLimited(ids, 4, async id => { try { await api('/transactions/' + id, { method: 'DELETE' }); } catch (e) { failed++; } S.pendingDel.delete(id); });
    if (failed) toast(failed + ' couldn’t be deleted');
    if (['', 'transactions', 'account'].includes(parseHash().name)) route();
  };
  if (S.undoCommit) S.undoCommit();              // finish any earlier pending delete first
  S.undoCommit = () => { clearTimeout(S.undoT); S.undoCommit = null; commit(); };
  box.innerHTML = '<span>' + (ids.length === 1 ? 'Transaction deleted' : ids.length + ' transactions deleted') + '</span><button type="button">Undo</button><span class="bar"></span>';
  box.hidden = false;
  box.querySelector('button').onclick = () => {
    undone = true; clearTimeout(S.undoT); S.undoCommit = null; box.hidden = true;
    ids.forEach(id => S.pendingDel.delete(id)); toast('Restored'); route();
  };
  S.undoT = setTimeout(() => S.undoCommit && S.undoCommit(), 5000);
}
window.addEventListener('beforeunload', () => { if (S.undoCommit) S.undoCommit(); });

/* ---------- Rules: instant filter while typing ---------- */
function liveRuleFilter(q) {
  q = q.trim().toLowerCase();
  document.querySelectorAll('.rulegroup').forEach(g => {
    let shown = 0;
    g.querySelectorAll('td[data-text]').forEach(td => { const ok = !q || td.dataset.text.includes(q); td.parentElement.hidden = !ok; if (ok) shown++; });
    g.hidden = q && !shown && !g.querySelector('summary').textContent.toLowerCase().includes(q);
    if (q && shown) g.open = true;
  });
}

/* ---------- Phone: tab bar, More sheet, swipe to delete ---------- */
function drawTabbar(active) {
  const tb = el('tabbar'); tb.hidden = false;
  const t = (r, label, ic) => '<a href="#/' + r + '" class="' + (r === active ? 'on' : '') + '">' + icon(ic) + '<span>' + label + '</span></a>';
  tb.innerHTML = t('', 'Home', 'overview') + t('transactions', 'Activity', 'transactions') + '<button type="button" class="plus" data-onclick="App.quickAdd()" aria-label="Add transaction"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>' +
    t('budgets', 'Budgets', 'budgets') + '<button type="button" data-onclick="App.moreSheet()">' + icon('categories') + '<span>More</span></button>';
}
function moreSheet() {
  openDrawer('Menu', '<div class="list">' + NAV.map(([r, label, ic]) => '<a class="row" href="#/' + r + '" data-onclick="App.closeDrawer()" style="padding:14px 0;align-items:center"><span class="name" style="display:flex;gap:12px;align-items:center">' +
    '<span style="width:20px;display:inline-flex">' + icon(ic) + '</span>' + label + '</span><span class="neutral">›</span></a>').join('') + '</div>' +
    '<div class="eyebrow" style="margin-top:22px">Theme</div><div class="themes" id="themes2" style="padding:6px 0 0"></div>' +
    '<div class="toggles sheet"><button type="button" class="btn" data-tg="privacy" data-onclick="App.togglePrivacy()"></button><button type="button" class="btn" data-tg="compact" data-onclick="App.toggleDensity()"></button></div>' +
    '<div style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-onclick="App.openPalette()">Search everything</button>' +
    (el('ffLink').hidden ? '' : '<a class="btn" href="' + el('ffLink').getAttribute('href') + '" target="_blank" rel="noopener">Open Firefly III ↗</a>') +
    (window.MONEY_NATIVE ? '<button class="btn" data-onclick="App.nativeSettings()">App settings</button>' : '') +
    '<button class="btn" data-onclick="App.signOut()">Sign out</button></div>');
  el('themes2').innerHTML = el('themes').innerHTML; if (App.drawToggles) App.drawToggles();
  el('themes2').querySelectorAll('button').forEach(b => b.style.cssText += ';width:34px;height:34px;border-radius:50%;border:2px solid var(--line);display:inline-block;padding:0');
}
function bindSwipe() {
  if (!('ontouchstart' in window)) return;
  document.querySelectorAll('#view tr[data-gid]:not([data-sw])').forEach(tr => {
    tr.dataset.sw = '1';
    let x0 = 0, y0 = 0, dx = 0, active = false;
    tr.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; active = true; }, { passive: true });
    tr.addEventListener('touchmove', e => {
      if (!active) return;
      dx = e.touches[0].clientX - x0; const dy = e.touches[0].clientY - y0;
      if (Math.abs(dy) > Math.abs(dx)) { active = false; tr.style.transform = ''; return; }
      if (dx < 0) { tr.classList.add('swiping'); tr.style.transform = 'translateX(' + Math.max(dx, -120) + 'px)'; if ((dx < -80) !== tr.classList.contains('swipe-del') && App.buzz) App.buzz(6); tr.classList.toggle('swipe-del', dx < -80); }
    }, { passive: true });
    tr.addEventListener('touchend', () => {
      tr.classList.remove('swiping'); tr.style.transform = '';
      if (active && dx < -80) { tr.removeAttribute('data-onclick'); softDeleteTx([tr.dataset.gid]); }
      tr.classList.remove('swipe-del'); active = false;
    });
  });
}

/* ---------- Date picker ---------- */
let calInput = null, calView = null;
function openCal(input) {
  calInput = input;
  const v = input.value || todayIso(), d = new Date(v + 'T12:00:00');
  calView = { y: d.getFullYear(), m: d.getMonth() };
  drawCal();
  const box = el('calpop'), r = input.getBoundingClientRect();
  box.hidden = false;
  const top = r.bottom + 6 + box.offsetHeight > innerHeight ? r.top - box.offsetHeight - 6 : r.bottom + 6;
  box.style.top = Math.max(8, top) + 'px'; box.style.left = Math.min(innerWidth - box.offsetWidth - 8, Math.max(8, r.left)) + 'px';
}
function drawCal() {
  const { y, m } = calView, first = new Date(y, m, 1), startDow = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  const sel = calInput.value, tIso = todayIso();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - startDow + i, 12), iso = isoDate(d);
    if (i >= 35 && d.getMonth() !== m) break;
    cells += '<button type="button" class="d' + (d.getMonth() !== m ? ' out' : '') + (iso === tIso ? ' today' : '') + (iso === sel ? ' sel' : '') + '" data-d="' + iso + '">' + d.getDate() + '</button>';
  }
  el('calpop').innerHTML = '<div class="ch"><button type="button" data-nav="-1" aria-label="Previous month">‹</button><span>' + first.toLocaleString('en-US', { month: 'long', year: 'numeric' }) +
    '</span><button type="button" data-nav="1" aria-label="Next month">›</button></div><div class="grid7">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(x => '<span class="dow">' + x + '</span>').join('') + cells + '</div>' +
    '<div class="cf"><button type="button" class="link" data-d="' + tIso + '">Today</button>' + (calInput.required ? '' : '<button type="button" class="link" data-d="">Clear</button>') + '</div>';
}
function closeCal() { el('calpop').hidden = true; calInput = null; }
el('calpop').addEventListener('mousedown', e => e.preventDefault());
el('calpop').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !calInput) return;
  if (b.dataset.nav) { calView.m += +b.dataset.nav; const d = new Date(calView.y, calView.m, 1); calView = { y: d.getFullYear(), m: d.getMonth() }; drawCal(); return; }
  if (b.dataset.d !== undefined) {
    calInput.value = b.dataset.d;
    calInput.dispatchEvent(new Event('input', { bubbles: true })); calInput.dispatchEvent(new Event('change', { bubbles: true }));
    closeCal();
  }
});
document.addEventListener('click', e => {
  const t = e.target;
  if (t && t.matches && t.matches('input[type=date]') && !('ontouchstart' in window)) {
    e.preventDefault();
    if (calInput === t && !el('calpop').hidden) closeCal(); else openCal(t);
    return;
  }
  if (!el('calpop').hidden && !el('calpop').contains(t)) closeCal();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el('calpop').hidden) { e.stopPropagation(); closeCal(); } }, true);
window.addEventListener('scroll', () => { if (!el('calpop').hidden) closeCal(); }, true);

/* ---------- Command palette ---------- */
let palItems = [], palShown = [], palIdx = 0;
async function openPalette() {
  closeDrawer();
  el('palette').hidden = false; el('palQ').value = ''; el('palQ').focus();
  const L = await lists().catch(() => null);
  const items = NAV.map(([r, label, ic]) => ({ label, kind: 'Page', go: '#/' + r }));
  items.push({ label: 'New transaction', kind: 'Action', run: quickAdd }, { label: 'New rule', kind: 'Action', run: () => { location.hash = '#/rules'; setTimeout(() => App.ruleForm(), 400); } },
    { label: 'New recurring transaction', kind: 'Action', run: () => { location.hash = '#/recurring'; setTimeout(() => App.recurForm(), 400); } },
    { label: 'Reconcile an account', kind: 'Action', go: '#/accounts' });
  THEMES.forEach(([k, label]) => items.push({ label: 'Theme: ' + label, kind: 'Theme', run: () => setTheme(k) }));
  if (L) {
    L.accounts.filter(a => a.active && (isAsset(a) || isLiab(a))).forEach(a => items.push({ label: a.name, kind: isCard(a) ? 'Credit card' : isLiab(a) ? 'Loan' : 'Account', go: '#/account/' + a.id }));
    L.budgets.filter(b => b.active).forEach(b => items.push({ label: b.name, kind: 'Budget', go: '#/transactions?budget=' + b.id }));
    L.categories.forEach(c => items.push({ label: c.name, kind: 'Category', go: '#/transactions?category=' + c.id }));
    L.tags.forEach(t => items.push({ label: t.name, kind: 'Tag', go: '#/transactions?tag=' + t.id }));
    L.bills.forEach(b => items.push({ label: b.name, kind: 'Bill', go: '#/transactions?bill=' + b.id }));
    L.expense.forEach(a => items.push({ label: a.name, kind: 'Payee', go: '#/account/' + a.id, low: true }));
  }
  if (S.rules) Object.entries(S.rules).forEach(([id, r]) => items.push({ label: r.title, kind: 'Rule', run: () => { location.hash = '#/rules'; setTimeout(() => App.ruleForm(id), 500); }, low: true }));
  palItems = items; palFilter();
}
function score(label, q) {
  const l = label.toLowerCase();
  if (!q) return 1;
  if (l.startsWith(q)) return 100 - l.length / 100;
  const i = l.indexOf(q); if (i >= 0) return 60 - i;
  let j = 0; for (const ch of l) if (ch === q[j]) j++;   // letters in order, e.g. "cc" → "Capital one Credit card"
  return j === q.length ? 20 : 0;
}
function palFilter() {
  const q = el('palQ').value.trim().toLowerCase();
  palShown = palItems.map(it => ({ it, s: score(it.label, q) - (it.low && q.length < 2 ? 50 : 0) })).filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.it);
  if (q) palShown.push({ label: 'Search transactions for “' + el('palQ').value.trim() + '”', kind: 'Search', go: '#/transactions?search=' + encodeURIComponent(el('palQ').value.trim()) });
  palIdx = 0; drawPal();
}
function drawPal() {
  el('palList').innerHTML = palShown.length ? palShown.map((it, i) => '<div class="pal-item' + (i === palIdx ? ' on' : '') + '" data-i="' + i + '" data-onmousemove="App.palHover(' + i + ')" data-onclick="App.palRun(' + i + ')"><span>' + esc(it.label) + '</span><span class="k">' + esc(it.kind) + '</span></div>').join('')
    : '<div class="pal-item"><span class="neutral">No matches</span></div>';
  const on = el('palList').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function palHover(i) { if (i !== palIdx) { palIdx = i; drawPal(); } }
function palKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palShown.length - 1, palIdx + 1); drawPal(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(0, palIdx - 1); drawPal(); }
  else if (e.key === 'Enter') { e.preventDefault(); palRun(palIdx); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
}
function palRun(i) {
  const it = palShown[i]; if (!it) return;
  closePalette();
  if (it.go) location.hash = it.go; else if (it.run) it.run();
}
function closePalette() { el('palette').hidden = true; }

Object.assign(window.App, {
  prefetch, afterPaint, quickAdd, payeeFill, softDeleteTx, liveRuleFilter, drawTabbar, moreSheet,
  openPalette, closePalette, palFilter, palKey, palRun, palHover,
});

import { html, htmlList } from '../core/html';
import { App, el } from '../core/base';
import { BUZZ_DELETE, buzz } from '../core/haptics';
import { NAV_GROUPS, icon, navItem, openDrawer } from '../core/dom';

/* ---------- Phone: tab bar, More sheet, swipe to delete ---------- */
function drawTabbar(active: string) {
  const tb = el('tabbar'); tb.hidden = false;
  // Drawn once, then only the current tab changes, so the pill behind it (Frosted glass) can slide across
  if (tb.querySelector('.tab-pill')) {
    tb.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + active));
    return movePill();
  }
  const t = (r: string, label: string, ic: string) => html`<a href="#/${r}" class="${r === active ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`;
  tb.innerHTML = String(html`<i class="tab-pill" aria-hidden="true"></i>${t('', 'Home', 'overview')}${t('transactions', 'Activity', 'transactions')}<button type="button" class="plus" data-onclick="App.quickAdd()" aria-label="Add transaction"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>${t('budgets', 'Budgets', 'budgets')}<button type="button" data-onclick="App.moreSheet()">${icon('categories')}<span>More</span></button>`);
  movePill();
  tapThrough(tb); tapThrough(el('fab'));
  requestAnimationFrame(() => tb.classList.add('pill-ready'));     // no slide in from the edge the first time
}
// While the page is still gliding from a flick, iOS spends the first tap on stopping it and sends no click, so you'd
// have to tap twice. The tab bar and the corner + answer the touch themselves: a short tap that didn't move clicks
// at once (and the browser's own click is cancelled, so it never counts twice).
function tapThrough(node: HTMLElement) {
  let x = 0, y = 0, t = 0;
  node.addEventListener('touchstart', e => { const p = e.touches[0]; x = p.clientX; y = p.clientY; t = Date.now(); }, { passive: true });
  node.addEventListener('touchend', e => {
    const p = e.changedTouches[0], hit = (e.target as Element).closest<HTMLElement>('a, button');
    if (!hit || !node.contains(hit) || e.touches.length || Math.hypot(p.clientX - x, p.clientY - y) > 10 || Date.now() - t > 600) return;
    e.preventDefault(); hit.click();
  });
}
function movePill() {
  const tb = el('tabbar'), on = tb.querySelector<HTMLElement>('a.on'), pill = tb.querySelector<HTMLElement>('.tab-pill');
  if (!pill) return;
  pill.classList.toggle('off', !on || !on.offsetWidth);
  if (on && on.offsetWidth) { pill.style.width = on.offsetWidth + 'px'; pill.style.transform = 'translateX(' + on.offsetLeft + 'px)'; }
}
addEventListener('resize', movePill);
/* Scrolling down the page folds the tab bar away into the + button at the bottom right (#fab); scrolling back up,
   or reaching the top, opens it again */
(function foldOnScroll() {
  let last = scrollY, folded = false;
  const fold = (on: boolean) => {
    const tb = el('tabbar');
    if (on && (tb.hidden || !tb.offsetWidth)) on = false;     // desktop, or the native app's own tabs
    if (on === folded) return;
    folded = on; tb.classList.toggle('mini', on); el('fab').classList.toggle('on', on);
  };
  addEventListener('scroll', () => {
    const y = scrollY, dy = y - last;
    if (y < 60) fold(false);
    else if (dy > 6) fold(true);
    else if (dy < -6) fold(false);
    else return;     // small jitters (rubber banding, momentum ends) keep the last position as the reference
    last = y;
  }, { passive: true });
  addEventListener('hashchange', () => { last = 0; fold(false); });
})();
export function moreSheet() {
  const link = (r: string) => { const [, label, ic] = navItem(r); return html`<a class="row" href="#/${r}" data-onclick="App.closeDrawer()"><span class="name"><span class="ic">${icon(ic)}</span>${label}</span><span class="neutral">›</span></a>`; };
  // the tab bar already has Home, Activity and Budgets
  const groups = NAV_GROUPS.concat([['', ['settings']]]).map(([t, rs]) => [t, rs.filter(r => !['', 'transactions', 'budgets'].includes(r))] as const).filter(g => g[1].length);
  openDrawer('Menu', html`<button type="button" class="sheet-search" data-onclick="App.openPalette()">${icon('search')}<span>Search everything</span></button>${htmlList(groups.map(([t, rs]) => html`${t ? html`<div class="eyebrow menu-h">${t}</div>` : ''}<div class="list menu">${htmlList(rs.map(link))}</div>`))}<div class="toggles sheet"><button type="button" class="btn" data-tg="privacy" data-onclick="App.togglePrivacy()"></button></div><div style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-onclick="App.closeDrawer();App.recalcAll()">Recalculate everything</button>${el('ffLink').hidden ? '' : html`<a class="btn" href="${el('ffLink').getAttribute('href')}" target="_blank" rel="noopener">Open Firefly III ↗</a>`}${window.MONEY_NATIVE ? html`<button class="btn" data-onclick="App.nativeSettings()">App settings</button>` : ''}<button class="btn" data-onclick="App.signOut()">Sign out</button></div>`);
  if (App.drawToggles) App.drawToggles();
}
// Swipe a row left to show Categorize and Delete behind it, as in Mail; tap anywhere else to put it back
const ACTS = 150;          // how far an open row slides, the width of its two buttons
let openRow: HTMLElement | null = null, swallowTo = 0;
function closeRow(tr = openRow) {
  if (!tr) return;
  tr.classList.remove('swopen'); tr.style.setProperty('--sx', '0px');
  if (openRow === tr) openRow = null;
}
const TAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>';
const BIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';
// The buttons behind a row, added the first time it's swiped
function swipeActions(tr: HTMLElement) {
  if (tr.querySelector('.swacts')) return;
  const td = document.createElement('td'), gid = tr.dataset.gid!;
  td.className = 'swacts';
  const btn = (cls: string, svg: string, label: string, go: () => void) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.innerHTML = svg + '<span>' + label + '</span>';
    b.addEventListener('click', e => { e.stopPropagation(); go(); });
    td.appendChild(b);
  };
  btn('sw-cat', TAG_SVG, 'Categorize', () => {
    closeRow(tr);
    const c = tr.querySelector<HTMLElement>('.cat-s.inl');      // a split transaction has no one category: open it instead
    if (c) App.pick(c); else App.editTx(gid);
  });
  btn('sw-del', BIN_SVG, 'Delete', () => { buzz(BUZZ_DELETE); closeRow(tr); tr.removeAttribute('data-onclick'); App.softDeleteTx([gid]); });
  tr.appendChild(td);
}
export function bindSwipe() {
  if (!('ontouchstart' in window)) return;
  if (!document.documentElement.dataset.swipe) {
    document.documentElement.dataset.swipe = '1';
    // A touch anywhere but the open row closes it, and a tap on another row only closes it (doesn't open that row)
    document.addEventListener('touchstart', e => {
      if (!openRow || openRow.contains(e.target as Node)) return;
      closeRow(); swallowTo = Date.now() + 600;
    }, { passive: true, capture: true });
    document.addEventListener('click', e => {
      if (Date.now() < swallowTo && (e.target as Element).closest('#view tr[data-gid]')) { e.stopPropagation(); e.preventDefault(); }
      swallowTo = 0;
    }, true);
  }
  document.querySelectorAll<HTMLElement>('#view tr[data-gid]:not([data-sw])').forEach(tr => {
    tr.dataset.sw = '1';
    let x0 = 0, y0 = 0, dx = 0, from = 0, dir = 0;      // dir: 0 not yet known, 1 sideways, 2 scrolling
    tr.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; dir = 0; from = tr.classList.contains('swopen') ? -ACTS : 0; }, { passive: true });
    tr.addEventListener('touchmove', e => {
      if (dir === 2) return;
      dx = e.touches[0].clientX - x0; const dy = e.touches[0].clientY - y0;
      if (!dir) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        dir = Math.abs(dy) > Math.abs(dx) ? 2 : 1;
        if (dir === 2) return;
        swipeActions(tr); tr.classList.add('swiping');
      }
      let x = from + dx;
      if (x > 0) x = 0;
      else if (x < -ACTS) x = -ACTS - Math.sqrt(-ACTS - x) * 4;     // past the buttons it gives a little, then resists
      tr.style.setProperty('--sx', x.toFixed(1) + 'px');
    }, { passive: true });
    tr.addEventListener('touchend', () => {
      if (dir !== 1) return;
      tr.classList.remove('swiping');
      if (from + dx < (from ? -ACTS + 40 : -60)) { if (!from) buzz(6); tr.classList.add('swopen'); tr.style.setProperty('--sx', -ACTS + 'px'); openRow = tr; }
      else closeRow(tr);
    });
    // A tap on an open row closes it instead of opening the transaction
    tr.addEventListener('click', e => {
      if (!tr.classList.contains('swopen') || (e.target as Element).closest('.swacts')) return;
      e.stopPropagation(); e.preventDefault(); closeRow(tr);
    }, true);
  });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  drawTabbar,
  moreSheet,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

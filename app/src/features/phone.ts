import { html, htmlList, raw } from '../core/html';
import { App, el } from '../core/base';
import { LS } from '../core/helpers';
import { BUZZ_DELETE, buzz } from '../core/haptics';
import { icon, navGroups, navItem, openDrawer } from '../core/dom';

/* ---------- Phone: tab bar, More sheet, swipe to delete ---------- */
function drawTabbar(active: string) {
  const tb = el('tabbar'); tb.hidden = false;
  const moreOn = !['', 'transactions', 'budgets'].includes(active);      // on a page behind More, More is the lit tab
  // Drawn once, then only the current tab changes, so the pill behind it (Frosted glass) can slide across
  if (tb.querySelector('.tab-pill')) {
    tb.querySelectorAll('a').forEach(a => { const on = a.getAttribute('href') === '#/' + active; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const mb = tb.querySelector('button.more'); if (mb) { mb.classList.toggle('on', moreOn); if (moreOn) mb.setAttribute('aria-current', 'page'); else mb.removeAttribute('aria-current'); }
    return movePill();
  }
  const t = (r: string, label: string, ic: string) => html`<a href="#/${r}" class="${r === active ? 'on' : ''}"${r === active ? raw(' aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a>`;
  tb.innerHTML = String(html`<i class="tab-pill" aria-hidden="true"></i>${t('', 'Overview', 'overview')}${t('transactions', 'Activity', 'transactions')}<button type="button" class="plus" data-onclick="App.quickAdd()" aria-label="Add transaction"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>${t('budgets', 'Budgets', 'budgets')}<button type="button" class="more${moreOn ? ' on' : ''}"${moreOn ? raw(' aria-current="page"') : ''} data-onclick="App.moreSheet()">${icon('more')}<span>More</span></button>`);
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
  const tb = el('tabbar'), on = tb.querySelector<HTMLElement>('a.on, button.more.on'), pill = tb.querySelector<HTMLElement>('.tab-pill');
  if (!pill) return;
  pill.classList.toggle('off', !on || !on.offsetWidth);
  if (on && on.offsetWidth) { pill.style.width = on.offsetWidth + 'px'; pill.style.transform = 'translateX(' + on.offsetLeft + 'px)'; }
}
addEventListener('resize', movePill);
/* Scrolling down the page folds the tab bar away into the + button at the bottom right (#fab) and slides the title bar
   and search button up out of sight (html.scroll-down, phones only in CSS); scrolling back up, or reaching the top, brings them back */
(function foldOnScroll() {
  let last = scrollY, folded = false, lockUntil = 0;
  const phone = matchMedia('(max-width: 600px)');
  /* The page title shrinks to a slim bar on a phone (html.head-slim, money.css). Its height is the one thing that changes, once per fold
     and not per scroll frame: it is measured here and eased, so the page below glides up instead of jumping. */
  const slim = (on: boolean) => {
    const h = document.querySelector<HTMLElement>('#view > .head'), root = document.documentElement;
    if (!h || !phone.matches) { root.classList.remove('head-slim'); if (h) h.style.height = ''; return; }
    const from = h.offsetHeight;
    h.style.height = ''; root.classList.toggle('head-slim', on);
    const to = h.offsetHeight;
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    h.style.overflow = 'hidden'; h.style.height = from + 'px'; void h.offsetHeight; h.style.height = to + 'px';
    h.addEventListener('transitionend', () => { h.style.height = ''; h.style.overflow = ''; }, { once: true });
  };
  const fold = (on: boolean) => {
    if (on === folded) return;
    folded = on; document.documentElement.classList.toggle('scroll-down', on);
    const tb = el('tabbar'), mini = on && !tb.hidden && !!tb.offsetWidth;     // not on desktop, or with the native app's own tabs
    tb.classList.toggle('mini', mini); el('fab').classList.toggle('on', mini);
    slim(on);
    lockUntil = performance.now() + 400;     // the page's height changes under the finger: its scroll events for the next moment are not the user's
  };
  addEventListener('scroll', () => {
    const y = scrollY, dy = y - last;
    if (performance.now() < lockUntil) { last = y; return; }
    if (y < 60) fold(false);
    else if (dy > 6) {
      // only fold when the page stays scrollable afterwards, or it would unfold at once and flicker
      const pg = document.querySelector<HTMLElement>('#view > .pg'), room = pg ? pg.scrollHeight - pg.clientHeight : 1e9;
      if (!phone.matches || room > y + 160) fold(true); else return;
    }
    else if (dy < -6) fold(false);
    else return;     // small jitters (rubber banding, momentum ends) keep the last position as the reference
    last = y;
  }, { passive: true });
  addEventListener('hashchange', () => { last = 0; fold(false); });
})();
export function moreSheet() {
  const link = (r: string) => { const [, label, ic] = navItem(r); return html`<a class="row" href="#/${r}" data-onclick="App.closeDrawer()"><span class="name"><span class="ic">${icon(ic)}</span>${label}</span><span class="neutral">›</span></a>`; };
  // the tab bar already has Home, Activity and Budgets
  const groups = navGroups().concat([['', ['settings']]]).map(([t, rs]) => [t, rs.filter(r => !['', 'transactions', 'budgets'].includes(r))] as const).filter(g => g[1].length);
  openDrawer('More', html`${App.ffPill ? App.ffPill(true) : ''}<button type="button" class="sheet-search" data-onclick="App.openPalette()">${icon('search')}<span>Search everything</span></button>${htmlList(groups.map(([t, rs]) => html`${t ? html`<div class="eyebrow menu-h">${t}</div>` : ''}<div class="list menu">${htmlList(rs.map(link))}</div>`))}<div class="toggles sheet"><button type="button" class="btn" data-tg="privacy" data-onclick="App.togglePrivacy()"></button><button class="btn" data-onclick="App.closeDrawer();App.recalcAll()">Recalculate everything</button>${el('ffLink').hidden ? '' : html`<a class="btn" href="${el('ffLink').getAttribute('href')}" target="_blank" rel="noopener">Open Firefly III ↗</a>`}${window.MONEY_NATIVE ? html`<button class="btn" data-onclick="App.nativeSettings()">App settings</button>` : ''}<button class="btn" data-onclick="App.signOut()">Sign out</button></div>`);
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
  LS.set('swipeHint', true); document.querySelector('.swipe-hint')?.remove();
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
  // Nothing on a row shows that it slides, so say so once, until it is dismissed or the first swipe
  const feed = document.querySelector('#view table.feed');
  if (feed && !LS.get('swipeHint', false) && !document.querySelector('.swipe-hint')) {
    const p = document.createElement('p'); p.className = 'sub-s swipe-hint'; p.textContent = 'Swipe a row left for Categorize and Delete. ';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = 'Got it';
    b.onclick = () => { LS.set('swipeHint', true); p.remove(); };
    p.appendChild(b); feed.before(p);
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

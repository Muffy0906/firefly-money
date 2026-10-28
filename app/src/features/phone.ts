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
  requestAnimationFrame(() => tb.classList.add('pill-ready'));     // no slide in from the edge the first time
}
function movePill() {
  const tb = el('tabbar'), on = tb.querySelector<HTMLElement>('a.on'), pill = tb.querySelector<HTMLElement>('.tab-pill');
  if (!pill) return;
  pill.classList.toggle('off', !on || !on.offsetWidth);
  if (on && on.offsetWidth) { pill.style.width = on.offsetWidth + 'px'; pill.style.transform = 'translateX(' + on.offsetLeft + 'px)'; }
}
addEventListener('resize', movePill);
export function moreSheet() {
  const link = (r: string) => { const [, label, ic] = navItem(r); return html`<a class="row" href="#/${r}" data-onclick="App.closeDrawer()"><span class="name"><span class="ic">${icon(ic)}</span>${label}</span><span class="neutral">›</span></a>`; };
  // the tab bar already has Home, Activity and Budgets
  const groups = NAV_GROUPS.concat([['', ['settings']]]).map(([t, rs]) => [t, rs.filter(r => !['', 'transactions', 'budgets'].includes(r))] as const).filter(g => g[1].length);
  openDrawer('Menu', html`<button type="button" class="sheet-search" data-onclick="App.openPalette()">${icon('search')}<span>Search everything</span></button>${htmlList(groups.map(([t, rs]) => html`${t ? html`<div class="eyebrow menu-h">${t}</div>` : ''}<div class="list menu">${htmlList(rs.map(link))}</div>`))}<div class="toggles sheet"><button type="button" class="btn" data-tg="privacy" data-onclick="App.togglePrivacy()"></button></div><div style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-onclick="App.closeDrawer();App.recalcAll()">Recalculate everything</button>${el('ffLink').hidden ? '' : html`<a class="btn" href="${el('ffLink').getAttribute('href')}" target="_blank" rel="noopener">Open Firefly III ↗</a>`}${window.MONEY_NATIVE ? html`<button class="btn" data-onclick="App.nativeSettings()">App settings</button>` : ''}<button class="btn" data-onclick="App.signOut()">Sign out</button></div>`);
  if (App.drawToggles) App.drawToggles();
}
export function bindSwipe() {
  if (!('ontouchstart' in window)) return;
  document.querySelectorAll<HTMLElement>('#view tr[data-gid]:not([data-sw])').forEach(tr => {
    tr.dataset.sw = '1';
    let x0 = 0, y0 = 0, dx = 0, active = false;
    tr.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; active = true; }, { passive: true });
    tr.addEventListener('touchmove', e => {
      if (!active) return;
      dx = e.touches[0].clientX - x0; const dy = e.touches[0].clientY - y0;
      if (Math.abs(dy) > Math.abs(dx)) { active = false; tr.style.transform = ''; return; }
      if (dx < 0) { tr.classList.add('swiping'); tr.style.transform = 'translateX(' + Math.max(dx, -120) + 'px)'; if ((dx < -80) !== tr.classList.contains('swipe-del')) buzz(6); tr.classList.toggle('swipe-del', dx < -80); }
    }, { passive: true });
    tr.addEventListener('touchend', () => {
      tr.classList.remove('swiping'); tr.style.transform = '';
      if (active && dx < -80) { buzz(BUZZ_DELETE); tr.removeAttribute('data-onclick'); App.softDeleteTx([tr.dataset.gid!]); }
      tr.classList.remove('swipe-del'); active = false;
    });
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

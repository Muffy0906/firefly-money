import { S, el, money } from '../core/base';
import { closeDrawer } from '../core/dom';
import { type Group, type TxRowsOpts, signed, txRows } from '../core/feed';
import { buzz } from '../core/haptics';
import { refreshAll } from '../core/router';
import { selAll } from './bulk';
import { bindSwipe } from './phone';

/* ---------- Pull to refresh (phones) ---------- */
(function pullToRefresh() {
  if (!('ontouchstart' in window)) return;
  const ind = el('ptr'); let y0: number | null = null, d = 0, busyNow = false;
  const blocked = () => scrollY > 0 || el('app').hidden || el('drawer').classList.contains('open') || !el('palette').hidden || busyNow;
  addEventListener('touchstart', e => { y0 = blocked() || (e.target as HTMLElement).closest('#dash .grip') ? null : e.touches[0].clientY; d = 0; }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 === null) return;
    d = Math.max(0, Math.min(120, (e.touches[0].clientY - y0) * .5));
    if (scrollY > 0) d = 0;
    ind.style.transform = 'translate(-50%, ' + (d - 50) + 'px) rotate(' + d * 3 + 'deg)';
    ind.style.opacity = String(Math.min(1, d / 60));
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
  const d = el('drawer'); let sy: number | null = null, sd = 0, t0 = 0;
  d.addEventListener('touchstart', e => {
    if (innerWidth > 900 || !(e.target as HTMLElement).closest('.grab, header') || (e.target as HTMLElement).closest('button')) return;
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

/* ---------- Infinite scroll for transaction lists ---------- */
export function bindFeed() {
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
    } catch (e) { m.textContent = 'Couldn’t load more: ' + (e as Error).message; io.disconnect(); }
    finally { f.busy = false; }
  }, { rootMargin: '700px 0px' });
  io.observe(m);
}
function dayNet(tbody: Element) {
  return [...tbody.querySelectorAll<HTMLElement>('tr[data-gid]')].reduce((s, tr) => { const m = S.txMeta[tr.dataset.gid!]; return s + (m ? signed(m.g, m.accountId) : 0); }, 0);
}
function appendRows(gs: Group[], opts: TxRowsOpts) {
  const table = document.querySelector<HTMLElement>('#view table.feed'); if (!table || !gs.length) return;
  const t = document.createElement('template'); t.innerHTML = String(txRows(gs, opts));
  const bodies = [...t.content.querySelectorAll('tbody.day')], last = table.querySelector('tbody.day:last-of-type');
  if (bodies.length && last && bodies[0].querySelector<HTMLElement>('.dayhead')!.dataset.day === last.querySelector<HTMLElement>('.dayhead')!.dataset.day) {
    bodies.shift()!.querySelectorAll('tr[data-gid]').forEach(r => last.appendChild(r));
    const net = dayNet(last), span = last.querySelector('.dayhead .num') || document.createElement('span');
    span.className = 'num ' + (net < 0 ? '' : 'pos'); span.textContent = (net > 0 ? '+' : '') + money(net);
    if (!span.isConnected) last.querySelector('.dayhead div')!.appendChild(span);
  }
  bodies.forEach(b => table.appendChild(b));
  bindSwipe();
  const all = document.querySelector<HTMLInputElement>('.selall input'); if (all && all.checked) selAll(true);
}

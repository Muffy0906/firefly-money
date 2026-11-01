import { App, type Feed, S, el, money } from '../core/base';
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
  // Drags that belong to something else: panning or pinching the map, moving or resizing a tile, Year in Money.
  const own = '.leaflet-container, #dash .grip, .rsz, .story';
  const reset = () => { y0 = null; ind.classList.remove('armed'); ind.style.transform = ''; ind.style.opacity = ''; };
  addEventListener('touchstart', e => { y0 = blocked() || e.touches.length > 1 || (e.target as HTMLElement).closest(own) ? null : e.touches[0].clientY; d = 0; }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 === null) return;
    if (e.touches.length > 1) { reset(); return; }
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

/* ---------- Bottom sheet: drag it down to dismiss (phones) ---------- */
/* The sheet follows your finger 1:1 from the handle or header, or from its body once that's scrolled to the top.
   Pulled up past where it sits, it stretches less and less (rubber band). Let go and it either closes, at the
   speed you flung it, or springs back. Whether it closes looks at where a flick would carry it, not only how far
   you dragged. */
(function sheetDrag() {
  const d = el('drawer');
  let sy: number | null = null, sd = 0, armed = false, fromBody = false, frame = 0, h = 0, crossed = false;
  let pts: [number, number][] = [];
  const band = (x: number) => { const r = 90; return -r * (1 - 1 / (1 + x / r * .55)); };   // up: x px of finger, a little sheet
  const shown = () => sd >= 0 ? sd : band(-sd);
  const draw = () => {
    frame = 0;
    d.style.transform = 'translateY(' + Math.round(shown() * devicePixelRatio) / devicePixelRatio + 'px)';
    el('scrim').style.opacity = String(1 - Math.min(1, Math.max(0, sd) / Math.max(1, h)));
  };
  const speed = () => {                 // px per ms over the last 100 ms, downward positive
    const now = performance.now(), recent = pts.filter(p => now - p[0] < 100);
    if (recent.length < 2) return 0;
    const [t0, y0] = recent[0], [t1, y1] = recent[recent.length - 1];
    return (y1 - y0) / Math.max(1, t1 - t0);
  };
  d.addEventListener('touchstart', e => {
    const t = e.target as HTMLElement;
    if (innerWidth > 900 || !d.classList.contains('open') || t.closest('header button, input[type=range], [data-noswipe]')) return;
    const body = t.closest<HTMLElement>('.body');
    if (!t.closest('.grab, header') && !(body && body.scrollTop <= 0)) return;
    fromBody = !!body; armed = !fromBody; sy = e.touches[0].clientY; sd = 0; h = d.offsetHeight; crossed = false;
    pts = [[performance.now(), sy]];
    if (armed) d.classList.add('dragging');
  }, { passive: true });
  d.addEventListener('touchmove', e => {
    if (sy === null) return;
    const y = e.touches[0].clientY, dy = y - sy;
    if (!armed) {                        // from the body: only a pull down at the top drags the sheet; anything else scrolls
      if (Math.abs(dy) < 6) return;
      if (dy < 0) { sy = null; return; }
      armed = true; sy = y; d.classList.add('dragging');
    }
    if (e.cancelable) e.preventDefault();
    sd = y - sy; pts.push([performance.now(), y]); if (pts.length > 12) pts.shift();
    const past = sd > h * .35;
    if (past !== crossed) { crossed = past; buzz(4); }
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive: false });
  const end = () => {
    if (sy === null) return;
    sy = null; cancelAnimationFrame(frame); frame = 0;
    if (!armed) return;
    armed = false;
    const v = speed(), reach = sd + Math.max(0, v) * 160;            // where a flick would carry it
    d.classList.remove('dragging'); el('scrim').style.opacity = '';
    if (sd > 10 && (reach > h * .35 || (v > .5 && sd > 30))) {
      // close at the speed of the flick: the time the rest of the way would take at that speed, within reason
      const ms = Math.round(Math.max(140, Math.min(320, (h - sd) / Math.max(.8, v))));
      d.style.transition = 'transform ' + ms + 'ms cubic-bezier(.2, .7, .3, 1)';
      S.drawerHero = null; buzz(6); closeDrawer();
      d.style.transform = '';
      setTimeout(() => { d.style.transition = ''; }, ms + 40);
    } else {
      d.style.transition = 'transform .42s cubic-bezier(.32, .72, 0, 1)';   // spring back
      d.style.transform = '';
      setTimeout(() => { d.style.transition = ''; }, 460);
    }
    sd = 0;
  };
  d.addEventListener('touchend', end); d.addEventListener('touchcancel', end);
})();

/* ---------- Infinite scroll for transaction lists ---------- */
export function bindFeed() {
  const m = el('feedMore'), f = S.feed; if (!m || !f) return;
  const io = new IntersectionObserver(async ents => {
    if (!ents.some(x => x.isIntersecting)) return;
    if (S.feed !== f || !m.isConnected) return io.disconnect();
    if (await nextPage(f, m)) { io.unobserve(m); io.observe(m); } else io.disconnect();
  }, { rootMargin: '700px 0px' });
  io.observe(m);
}
// Adds the feed's next page; true while there are more after it. Scrolling and a jump to a day (App.feedMore) share one load.
function nextPage(f: Feed, m: HTMLElement): Promise<boolean> {
  if (f.busy) return f.busy;
  if (f.next > f.pages) return Promise.resolve(false);
  return f.busy = (async () => {
    try {
      const gs = await f.more(f.next);
      if (S.feed !== f || !m.isConnected) return false;
      f.next++; appendRows(gs, f.opts);
      if (f.next > f.pages || !gs.length) { m.remove(); return false; }
      return true;
    } catch (e) { m.textContent = 'Couldn’t load more: ' + (e as Error).message; f.next = f.pages + 1; return false; }
    finally { f.busy = null; }
  })();
}
async function feedMore() {
  const m = el('feedMore'), f = S.feed;
  return !!m && !!f && nextPage(f, m);
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

// The methods other modules call (pages load before this one), added to App and to its type
const methods = {
  feedMore,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }

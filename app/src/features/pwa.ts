import { el } from '../core/base';

/* ================= Installable app ================= */
if ('serviceWorker' in navigator && window.isSecureContext) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  // The app opens from the copy saved on this device; when a newer version was published, offer to load it.
  // The service worker says so with a message, and also leaves a note in case the message came before this page was listening.
  const updateBar = () => {
    if (el('updateBar')) return;
    const b = document.createElement('div'); b.id = 'updateBar'; b.className = 'undo'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>A new version of Money is ready</span><button type="button">Reload</button>';
    b.querySelector('button')!.onclick = () => location.reload();
    document.body.appendChild(b);
  };
  navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'money-updated') updateBar(); });
  addEventListener('load', () => setTimeout(() => { try { caches.open('money-v1').then(c => c.match('/__money-updated')).then(n => { if (n) updateBar(); }).catch(() => {}); } catch (e) { /* no Cache Storage */ } }, 2500));
}
// Offline: features/ffstatus.ts shows its "can’t reach" screen (Money keeps no copy of your data to show instead)

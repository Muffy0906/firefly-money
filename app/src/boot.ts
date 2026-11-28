import { applyCustom } from './core/themevars';
import './core/sky';
import './core/lens';

/* Runs in <head>, before the stylesheet applies, so the first paint already has the right shell and theme. */
// Inside the iPhone app (or installed to the Home Screen): use the app-style shell.
(function () {
  var d = document.documentElement, native = !!window.MONEY_NATIVE;
  var standalone = (navigator as any).standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (native || standalone) d.classList.add('shell');
  // Home Screen app on iPhone/iPad (navigator.standalone is Safari-only): iOS blurs a band under the status bar, see --edge in money.css
  if ((navigator as any).standalone === true && !native) d.classList.add('ios-web');
  if (native) { d.classList.add('native'); if (window.MONEY_NATIVE_TABS) d.classList.add('native-tabs');
    var m = document.querySelector<HTMLMetaElement>('meta[name=viewport]'); if (m) m.content += ', maximum-scale=1, user-scalable=no'; }
})();
// Each translation is a separate script, added only when that language is picked (before app.js runs, so the first screen is already translated).
// A fixed relative path (the page is always at the site's root, which the online demo has under /firefly-money/); no version
// stamp, so the browser checks with the server each time (nginx sends no-cache for unversioned assets)
(function () { try {
  var lang = JSON.parse(localStorage.getItem('money.lang') || '""');
  if (lang === 'es') document.write('<script src="assets/js/es.js"></script>');
  else if (lang === 'de') document.write('<script src="assets/js/de.js"></script>');
} catch (e) {} })();
// Used Money on this device before? Checked before anything writes, so What's new can tell an update from a new install
(function () { try { window.MONEY_RETURNING = Object.keys(localStorage).some(function (k) { return k.indexOf('money') === 0; }); } catch (e) {} })();
// The sidebar folded down to its icons (Collapse sidebar), before the first paint so the page doesn't jump
(function () { try { if (localStorage.getItem('money.sideMini') === 'true') document.documentElement.classList.add('side-mini'); } catch (e) {} })();
(function () { try { var t = localStorage.getItem('moneyTheme'); if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t); applyCustom(); } catch (e) {} })();

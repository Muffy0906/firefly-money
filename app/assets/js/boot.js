'use strict';
/* Runs in <head>, before the stylesheet applies, so the first paint already has the right shell and theme. */
// Inside the iPhone app (or installed to the Home Screen): use the app-style shell.
(function () {
  var d = document.documentElement, native = !!window.MONEY_NATIVE;
  var standalone = window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (native || standalone) d.classList.add('shell');
  if (native) { d.classList.add('native'); if (window.MONEY_NATIVE_TABS) d.classList.add('native-tabs');
    var m = document.querySelector('meta[name=viewport]'); if (m) m.content += ', maximum-scale=1, user-scalable=no'; }
})();
(function () { try { var t = localStorage.getItem('moneyTheme'); if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t); } catch (e) {} })();

// Globals the page shares with the iPhone app and the smoke test
interface Window {
  App: import("./core/base").AppApi;
  MONEY_NATIVE?: boolean;
  MONEY_CHECK_HTML?: boolean;
  MONEY_NATIVE_TABS?: boolean;
  MONEY_RETURNING?: boolean;   // boot.ts: this device had used Money before this page load (What's new)
  MONEY_DEMO?: boolean;
  MONEY_NO_WHATSNEW?: boolean; // the smoke test's screenshots
  webkit?: any;
  parseHandler?: (src: string) => any[];
}

// Stylesheets imported for esbuild to bundle (vendor/leaflet.ts)
declare module "*.css";

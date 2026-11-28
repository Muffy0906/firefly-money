// Types for app/pages.js (plain JavaScript run by nginx's njs), so the tests can import it.
// r is the njs request object nginx hands each handler.
declare const pages: {
  endpoint(r: unknown): void,
  PAGES: string[],
};
export default pages;

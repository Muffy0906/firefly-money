/* HTML templates that escape by default.
   html`<b>${name}</b>` escapes name. Nested html`` results (and arrays of them) go in as HTML, and so does raw(s) for
   markup that is already safe (constant SVG icons, or text built from html`` pieces). null, undefined and false
   become nothing. The result works anywhere a string does (innerHTML, String()) through toString(), but don't join
   it with + : the result is a plain string, which the next html`` escapes. */
export class Html {
  constructor(readonly html: string) {}
  toString() { return this.html; }
  // + asks for the 'default' hint; innerHTML, String() and template literals ask for 'string'
  [Symbol.toPrimitive](hint: string) {
    if (hint === 'default' && window.MONEY_CHECK_HTML) console.error('Html joined with +: ' + this.html.slice(0, 120));
    return this.html;
  }
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s: string) => s.replace(/[&<>"']/g, c => ESC[c]);
// While testing (the smoke test sets MONEY_CHECK_HTML), report text that looks like markup (a tag, an entity or an
// attribute) but gets escaped: that's usually a helper still returning a plain string where it should return html``.
const LOOKS_LIKE_HTML = /<\/?[a-z][a-z0-9-]*[\s/>]|&(?:[a-z]+|#\d+);|[\w-]="/i;
function part(v: unknown): string {
  if (v == null || v === false) return '';
  if (v instanceof Html) return v.html;
  if (Array.isArray(v)) return v.map(part).join('');
  const s = String(v);
  if (window.MONEY_CHECK_HTML && LOOKS_LIKE_HTML.test(s)) console.error('Escaped HTML-looking text: ' + s.slice(0, 120));
  return escape(s);
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Html(out);
}
export const raw = (s: string | Html) => s instanceof Html ? s : new Html(String(s ?? ''));
// Join html`` pieces with a separator (escaped like any value unless it is html`` itself)
export const joinHtml = (xs: unknown[], sep: unknown) => new Html(xs.map(part).join(part(sep)));
// A list of html`` items: nothing ('', so `list || fallback` still works) when the list is empty
export const htmlList = (xs: unknown[]): Html | '' => xs.length ? new Html(xs.map(part).join('')) : '';

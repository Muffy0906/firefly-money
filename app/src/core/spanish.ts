// The catalog arrives as its own script (locales/es.ts, de.ts) when that language is picked; English never loads it
const catalog = (): Record<string, string> => (globalThis as unknown as Record<string, Record<string, string> | undefined>)['MONEY_' + langPref().toUpperCase()] || {};
type PhraseTemplate = { re: RegExp, names: string[], translated: string, prefix: string, strong: boolean };
type PatternIndex<T> = { byPrefix: Map<string, T[]>, withoutPrefix: T[], order: Map<T, number> };
// A placeholder stands for one piece of text: it never spans a line break or a " · " divider
const HOLE = '(?:(?! · )[^\\n])*?';
// An {amount} or {pct} is a number ("$1,234.50", "−12%", "EUR 5"): it never swallows a name like "Everyday Checking"
const NUMBER_HOLE = '(?:[A-Z]{3} ?)?[^\\p{L}\\n]{1,40}(?: ?[A-Z]{3})?';
const holeFor = (name: string) => /^(amount\d*|pct)$/.test(name) ? NUMBER_HOLE : HOLE;
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const literalLength = (s: string) => s.replace(PLACEHOLDER, '').length;   // more fixed text = more specific
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasPlaceholder = (s: string) => /\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(s);
// The lookup tables (thousands of regular expressions) are built the first time a translation is needed, so English never pays for them
const lazy = <T>(build: () => T) => { let v: T | undefined; return () => v ??= build(); };
// What the catalog already says in the target language. An entry that equals its English text ("Budget {amount}" in German)
// says nothing about the translation having happened, and would make English text with that shape look translated.
const translatedValues = () => Object.entries(catalog()).filter(([source, value]) => source !== value).map(([, value]) => value);
const exactSet = lazy(() => new Set(translatedValues().filter(value => !hasPlaceholder(value))));
const translatedPhrases = lazy(() => [...new Set(translatedValues())].flatMap(value => {
  const matches = [...value.matchAll(PLACEHOLDER)];
  // A value that is mostly placeholders ("{count} {unit}") would match any text and make it look already translated
  if (!matches.length || value.replace(PLACEHOLDER, '').replace(/[^\p{L}]/gu, '').length < 4) return [];
  let pattern = '^', offset = 0;
  for (const match of matches) {
    const at = match.index!;
    pattern += escapeRe(value.slice(offset, at)) + HOLE;
    offset = at + match[0].length;
  }
  pattern += escapeRe(value.slice(offset)) + '$';
  return [{ re: new RegExp(pattern), prefix: value.slice(0, matches[0].index!) }];
}).sort((a, b) => b.re.source.length - a.re.source.length));
function patternIndex<T>(items: T[], prefixOf: (item: T) => string): PatternIndex<T> {
  const byPrefix = new Map<string, T[]>(), withoutPrefix: T[] = [], order = new Map<T, number>();
  for (const item of items) {
    order.set(item, order.size);
    const prefix = prefixOf(item), indexKey = prefix.slice(0, 3);
    if (!indexKey) { withoutPrefix.push(item); continue; }
    const bucket = byPrefix.get(indexKey) || [];
    bucket.push(item); byPrefix.set(indexKey, bucket);
  }
  return { byPrefix, withoutPrefix, order };
}
const translatedPhraseIndex = lazy(() => patternIndex(translatedPhrases(), phrase => phrase.prefix));
function matchingPatterns<T>(index: PatternIndex<T>, key: string): T[] {
  const out = [...index.withoutPrefix];
  for (let size = Math.min(3, key.length); size > 0; size--) {
    const bucket = index.byPrefix.get(key.slice(0, size));
    if (bucket) out.push(...bucket);
  }
  // Most specific (longest) pattern first, so a loose "{a} {b}" never beats "Monthly payment for {name}"
  return out.sort((a, b) => index.order.get(a)! - index.order.get(b)!);
}
// Dynamic phrases match the complete text node or attribute. This translates UI copy
// assembled with names, dates, and amounts while leaving surrounding user content alone.
const phrases = lazy((): PhraseTemplate[] => Object.entries(catalog()).flatMap(([source, translated]) => {
  const matches = [...source.matchAll(PLACEHOLDER)];
  if (!matches.length || !/\p{L}/u.test(source.replace(PLACEHOLDER, ''))) return [];   // "{a} {b}" matches any text and says nothing
  let pattern = '^', offset = 0;
  const names: string[] = [];
  for (const match of matches) {
    const at = match.index!;
    pattern += escapeRe(source.slice(offset, at)) + '(' + holeFor(match[1]) + ')';
    names.push(match[1]); offset = at + match[0].length;
  }
  pattern += escapeRe(source.slice(offset)) + '$';
  return [{ re: new RegExp(pattern, 'u'), names, translated, source, strong: literalLength(source) >= 10, prefix: source.slice(0, matches[0].index!) }];
}).sort((a, b) => literalLength(b.source) - literalLength(a.source) || b.names.length - a.names.length).map(({ source, ...phrase }) => phrase));
const phraseIndex = lazy(() => patternIndex(phrases(), phrase => phrase.prefix));

// Text built from several pieces ("$102 left · 86% used", tooltips with one fact per line) is translated piece by piece
const SEPARATORS = /(\n| · | ·$|^· |, (?=(?:In|Out|Balance|Chance below zero|Tightest day|Below zero)\b)|(?<=[.!?]) (?=[A-Z“]))/;
function bySegment(key: string): string | undefined {
  const bits = key.split(SEPARATORS);
  if (bits.length < 3) return undefined;
  let hit = false;
  const out = bits.map((bit, i) => {
    if (i % 2) return bit;
    const core = bit.trim(), done = core ? translation(core, true) : undefined;
    if (done == null || done === core) return bit;
    hit = true;
    return bit.slice(0, bit.indexOf(core)) + done + bit.slice(bit.indexOf(core) + core.length);
  });
  return hit ? out.join('') : undefined;
}
const translation = (key: string, piece = false): string | undefined => {
  const exact = catalog()[key];
  if (exact != null) return exact;
  // t() and interpolated templates can already contain Spanish when the DOM observer sees them.
  // Don't feed that output back through a loose source pattern (e.g. "{amount} total" → "{amount} en total").
  if (exactSet().has(key) || matchingPatterns(translatedPhraseIndex(), key).some(phrase => phrase.re.test(key))) return undefined;
  const candidates = matchingPatterns(phraseIndex(), key);
  const fill = (phrase: PhraseTemplate): string | undefined => {
    const match = phrase.re.exec(key);
    if (!match) return undefined;
    const values: Record<string, string> = {};
    let consistent = true;
    phrase.names.forEach((name, i) => {
      if (name in values && values[name] !== match[i + 1]) consistent = false;
      values[name] = match[i + 1];
    });
    if (!consistent) return undefined;
    // The pieces plugged in can be UI text too ("Fetching transactions (page 2 of 3)", "3 days"): translate them as well
    return phrase.translated.replace(PLACEHOLDER, (token, name: string) => { const v = values[name]; return v == null ? token : (/\p{L}{2}/u.test(v) ? translation(v, true) : undefined) ?? v; });
  };
  // Phrases with plenty of fixed text first, then splitting at " · " and line breaks, and only then the loose ones
  // ("{count} of {total}") that would otherwise swallow a whole sentence
  for (const phrase of candidates) if (phrase.strong) { const done = fill(phrase); if (done != null) return done; }
  const split = piece ? undefined : bySegment(key);
  if (split != null) return split;
  for (const phrase of candidates) if (!phrase.strong) { const done = fill(phrase); if (done != null) return done; }
  return undefined;
};
export const t = (key: string, values: Record<string, string | number> = {}) =>
  ((langPref() !== 'en' ? translation(key) : undefined) ?? key).replace(PLACEHOLDER, (match, name: string) => String(values[name] ?? match));

const ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip'];
function translate(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    translateText(node);
  }
  if (root instanceof Element) {
    for (const attr of ATTRS) {
      const value = root.getAttribute(attr);
      if (value && translation(value) && translation(value) !== value) root.setAttribute(attr, translation(value)!);
    }
  }
  root.querySelectorAll?.('*').forEach(el => {
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (value && translation(value) && translation(value) !== value) el.setAttribute(attr, translation(value)!);
    }
  });
}
function translateText(node: Node) {
  const owner = node.parentElement;
  if (owner?.closest('.nm,.name,.acct,.desc,.payee,.merchant,.cat,.tag,[data-user-content]')) return;
  const value = node.nodeValue || '', trimmed = value.trim(), translated = translation(trimmed);
  if (translated && translated !== trimmed) node.nodeValue = value.slice(0, value.indexOf(trimmed)) + translated + value.slice(value.indexOf(trimmed) + trimmed.length);
}

/* The interface is English unless another language is picked in Settings → Appearance → Language (stored as money.lang).
   It is applied by translating the rendered DOM against that language's catalog (es.json, de.json), so English stays the source text. */
export const LANG_KEY = 'money.lang';
export const LANGS: [string, string][] = [['en', 'English'], ['es', 'Español'], ['de', 'Deutsch']];
export function langPref(): string {
  try { const raw = localStorage.getItem(LANG_KEY); const v = raw && JSON.parse(raw); return LANGS.some(([code]) => code === v) ? v : 'en'; } catch (e) { return 'en'; }
}
let observer: MutationObserver | null = null;
export function startSpanish() {
  if (observer || langPref() === 'en') return;
  document.documentElement.lang = langPref();
  translate(document);
  observer = new MutationObserver(records => records.forEach(record => {
    if (record.type === 'attributes') {
      const el = record.target as Element, name = record.attributeName!, value = el.getAttribute(name), done = value ? translation(value) : undefined;
      if (done && done !== value) el.setAttribute(name, done);
      return;
    }
    if (record.type === 'characterData') translateText(record.target);
    record.addedNodes.forEach(node => {
      if (node instanceof Element) translate(node);
      else if (node.nodeType === Node.TEXT_NODE) translateText(node);
    });
  }));
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
export function stopSpanish() { observer?.disconnect(); observer = null; document.documentElement.lang = 'en'; }
startSpanish();
// True when Spanish text exists for this English string (used by the catalog tests)
export const hasSpanish = (key: string) => translation(key) != null;

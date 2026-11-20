import esCatalog from '../locales/es.json';

const ES: Record<string, string> = esCatalog;
type PhraseTemplate = { re: RegExp, names: string[], translated: string, prefix: string };
type PatternIndex<T> = { byPrefix: Map<string, T[]>, withoutPrefix: T[] };
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasPlaceholder = (s: string) => /\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(s);
const TRANSLATED_EXACT = new Set(Object.values(ES).filter(value => !hasPlaceholder(value)));
const TRANSLATED_PHRASES = [...new Set(Object.values(ES))].flatMap(value => {
  const matches = [...value.matchAll(PLACEHOLDER)];
  if (!matches.length) return [];
  let pattern = '^', offset = 0;
  for (const match of matches) {
    const at = match.index!;
    pattern += escapeRe(value.slice(offset, at)) + '[\\s\\S]*?';
    offset = at + match[0].length;
  }
  pattern += escapeRe(value.slice(offset)) + '$';
  return [{ re: new RegExp(pattern), prefix: value.slice(0, matches[0].index!) }];
}).sort((a, b) => b.re.source.length - a.re.source.length);
function patternIndex<T>(items: T[], prefixOf: (item: T) => string): PatternIndex<T> {
  const byPrefix = new Map<string, T[]>(), withoutPrefix: T[] = [];
  for (const item of items) {
    const prefix = prefixOf(item), indexKey = prefix.slice(0, 3);
    if (!indexKey) { withoutPrefix.push(item); continue; }
    const bucket = byPrefix.get(indexKey) || [];
    bucket.push(item); byPrefix.set(indexKey, bucket);
  }
  return { byPrefix, withoutPrefix };
}
const translatedPhraseIndex = patternIndex(TRANSLATED_PHRASES, phrase => phrase.prefix);
function matchingPatterns<T>(index: PatternIndex<T>, key: string): T[] {
  const out = [...index.withoutPrefix];
  for (let size = Math.min(3, key.length); size > 0; size--) {
    const bucket = index.byPrefix.get(key.slice(0, size));
    if (bucket) out.push(...bucket);
  }
  return out;
}
// Dynamic phrases match the complete text node or attribute. This translates UI copy
// assembled with names, dates, and amounts while leaving surrounding user content alone.
const PHRASES: PhraseTemplate[] = Object.entries(ES).flatMap(([source, translated]) => {
  const matches = [...source.matchAll(PLACEHOLDER)];
  if (!matches.length) return [];
  let pattern = '^', offset = 0;
  const names: string[] = [];
  for (const match of matches) {
    const at = match.index!;
    pattern += escapeRe(source.slice(offset, at)) + '([\\s\\S]*?)';
    names.push(match[1]); offset = at + match[0].length;
  }
  pattern += escapeRe(source.slice(offset)) + '$';
  return [{ re: new RegExp(pattern), names, translated, prefix: source.slice(0, matches[0].index!) }];
}).sort((a, b) => b.re.source.length - a.re.source.length);
const phraseIndex = patternIndex(PHRASES, phrase => phrase.prefix);

const translation = (key: string) => {
  const exact = ES[key];
  if (exact != null) return exact;
  // t() and interpolated templates can already contain Spanish when the DOM observer sees them.
  // Don't feed that output back through a loose source pattern (e.g. "{amount} total" → "{amount} en total").
  if (TRANSLATED_EXACT.has(key) || matchingPatterns(translatedPhraseIndex, key).some(phrase => phrase.re.test(key))) return undefined;
  for (const phrase of matchingPatterns(phraseIndex, key)) {
    const match = phrase.re.exec(key);
    if (!match) continue;
    const values: Record<string, string> = {};
    let consistent = true;
    phrase.names.forEach((name, i) => {
      if (name in values && values[name] !== match[i + 1]) consistent = false;
      values[name] = match[i + 1];
    });
    if (!consistent) continue;
    return phrase.translated.replace(PLACEHOLDER, (token, name: string) => values[name] ?? token);
  }
  return undefined;
};
export const t = (key: string, values: Record<string, string | number> = {}) =>
  (translation(key) ?? key).replace(PLACEHOLDER, (match, name: string) => String(values[name] ?? match));

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

document.documentElement.lang = 'es';
translate(document);
new MutationObserver(records => records.forEach(record => {
  if (record.type === 'characterData') {
    translateText(record.target);
  }
  record.addedNodes.forEach(node => {
    if (node instanceof Element) translate(node);
    else if (node.nodeType === Node.TEXT_NODE) translateText(node);
  });
})).observe(document.documentElement, { subtree: true, childList: true, characterData: true });

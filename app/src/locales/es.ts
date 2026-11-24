// The Spanish catalog as a script of its own (assets/js/es.js). boot.ts adds it to the page only when Spanish is picked,
// so English never downloads or parses it.
import es from './es.json';
(globalThis as { MONEY_ES?: Record<string, string> }).MONEY_ES = es;

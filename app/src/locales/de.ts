// The German catalog as a script of its own (assets/js/de.js). boot.ts adds it to the page only when German is picked,
// so English never downloads or parses it.
import de from './de.json';
(globalThis as { MONEY_DE?: Record<string, string> }).MONEY_DE = de;

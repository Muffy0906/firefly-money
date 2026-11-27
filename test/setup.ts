// Each translation is its own script in the app (locales/es.ts, de.ts); tests load the catalogs up front
import es from '../app/src/locales/es.json';
import de from '../app/src/locales/de.json';
(globalThis as { MONEY_ES?: Record<string, string> }).MONEY_ES = es;
(globalThis as { MONEY_DE?: Record<string, string> }).MONEY_DE = de;

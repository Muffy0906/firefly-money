// Spanish is its own script in the app (locales/es.ts); tests load the catalog up front
import es from '../app/src/locales/es.json';
(globalThis as { MONEY_ES?: Record<string, string> }).MONEY_ES = es;

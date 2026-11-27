import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../app/src/locales/es.json';
import de from '../app/src/locales/de.json';

const load = async () => { vi.resetModules(); return import('../app/src/core/spanish'); };
beforeEach(() => { document.body.innerHTML = '<nav><a id="a">Overview</a></nav><button id="b" title="Add transaction (N)">Cancel</button>'; document.documentElement.lang = 'en'; });
afterEach(async () => { localStorage.removeItem('money.lang'); (await load()).stopSpanish(); });

describe('interface language', () => {
  it('stays English by default and leaves the page alone', async () => {
    const m = await load();
    expect(m.langPref()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.getElementById('a')!.textContent).toBe('Overview');
    expect(m.t('Starting')).toBe('Starting');
    expect(m.t('Showing the latest {count}.', { count: 5 })).toBe('Showing the latest 5.');
  });
  it('ignores anything but a language in the list', async () => {
    localStorage.setItem('money.lang', JSON.stringify('fr'));
    expect((await load()).langPref()).toBe('en');
    localStorage.setItem('money.lang', '{oops');
    expect((await load()).langPref()).toBe('en');
  });
  it('translates the page and what is added later once Spanish is picked', async () => {
    localStorage.setItem('money.lang', JSON.stringify('es'));
    const m = await load();
    expect(m.langPref()).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(document.getElementById('a')!.textContent).toBe(es.Overview);
    expect(document.getElementById('b')!.textContent).toBe(es.Cancel);
    const late = document.createElement('span'); late.textContent = 'Overview'; document.body.append(late);
    await Promise.resolve();
    expect(late.textContent).toBe(es.Overview);
    expect(m.t('Starting')).toBe(es.Starting);
  });
  it('translates the page into German once German is picked', async () => {
    localStorage.setItem('money.lang', JSON.stringify('de'));
    const m = await load();
    expect(m.langPref()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(document.getElementById('a')!.textContent).toBe(de.Overview);
    expect(document.getElementById('b')!.textContent).toBe(de.Cancel);
    expect(m.t('Starting')).toBe(de.Starting);
    expect(m.t('Showing the latest {count}.', { count: 5 })).toBe(de['Showing the latest {count}.'].replace('{count}', '5'));
  });
  it('only uses placeholders the English text has', () => {
    const names = (s: string) => new Set(s.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) || []);
    for (const catalog of [es, de]) {
      const bad = Object.entries(catalog as Record<string, string>).filter(([k, v]) => [...names(v)].some(n => !names(k).has(n)));
      expect(bad).toEqual([]);
    }
  });
  it('has a German text for every key the Spanish catalog has, and the other way round', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(es).sort());
    expect(Object.entries(de as Record<string, string>).filter(([, v]) => !v.trim())).toEqual([]);
  });
});

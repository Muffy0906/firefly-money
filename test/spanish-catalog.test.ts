import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import es from '../app/src/locales/es.json';
import de from '../app/src/locales/de.json';

const CATALOG = es as Record<string, string>;
const names = (s: string) => [...new Set(s.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) || [])].sort();
const load = async () => { vi.resetModules(); return import('../app/src/core/spanish'); };
beforeEach(() => { localStorage.setItem('money.lang', JSON.stringify('es')); });
afterEach(async () => { (await load()).stopSpanish(); localStorage.removeItem('money.lang'); });

describe('Spanish catalog', () => {
  it('has a Spanish text for every English one, and no placeholder the English lacks', () => {
    const empty = Object.entries(CATALOG).filter(([, v]) => !v.trim()).map(([k]) => k);
    const mismatched = Object.entries(CATALOG).filter(([k, v]) => names(v).some(n => !names(k).includes(n))).map(([k, v]) => k + ' → ' + v);
    expect(empty).toEqual([]);
    expect(mismatched).toEqual([]);
  });
  it('leaves nothing in English that was translated before (strings seen in the demo, every page)', async () => {
    const m = await load();
    const lines = [
      'Budget for Food', 'Pay Rewards Card now', 'Monthly payment for Car loan', 'Zoom in',
      '$102.56 left · 86% used · 86% used with 9 days to go', '$647.44 spent ·', '$131 over with 9 days to go.',
      'Day 3\nNov $117\nUsual $31', 'Sun, Nov 1\n$2,214.47 spent · 4 purchases', 'Fri, Nov 6: nothing spent',
      'Dec 11\nBalance  -$230.72\nChance below zero  72%', 'Dec 1, In  +$2,850.00, Out  -$2,118.00, Balance  $1,174.58, Chance below zero  under 1%',
      'Loading, 71 percent. Fetching transactions (page 2 of 3)', 'Loading, 92 percent. Sending request to Firefly',
      '1 unused · Who paid you, with no transactions', 'Add money to Summer trip', 'Health was', '$673 above', '$11 · 9 days left',
      'Bills due in the next 45 days', 'Spending is 12% higher than last month', 'Firefly III didn’t respond (502). It may be busy or restarting. Try again in a moment.',
      'Couldn’t refresh: timeout', 'Remove all 3 amounts?', 'Ends Mar 1', 'Tap again to open', 'Breakdowns', 'Merchants', 'Choose…',
    ];
    const missing = lines.filter(l => !m.hasSpanish(l));
    expect(missing).toEqual([]);
  });
  it('does not turn a name into text: "Everyday Checking" is not "Everyday {amount}"', async () => {
    const m = await load();
    expect(m.t('Everyday Checking → Fuel Stop')).toBe('Everyday Checking → Fuel Stop');
    expect(m.t('Income Tax')).toBe('Income Tax');
    expect(m.t('Everyday $2,408')).toBe('Cotidianos $2,408');
  });
  it('picks the most specific phrase, and translates the pieces plugged into it', async () => {
    const m = await load();
    expect(m.t('Budget for Food')).toBe('Presupuesto de Food');
    expect(m.t('Loading, 71 percent. Sending request to Firefly')).toBe('Cargando, 71 por ciento. Enviando solicitud a Firefly');
    expect(m.t('$102.56 left · 86% used')).toBe('Quedan $102.56 · 86% usado');
  });
  it('formats dates in Spanish once Spanish is picked, and not in English', async () => {
    const base = await import('../app/src/core/base');
    expect(base.fmtDate('2026-11-01')).toMatch(/nov/i);
    expect(base.fmtDate('2026-11-01')).not.toBe('Nov 1, 2026');
    expect(base.money(1234.5)).toBe('$1,234.50');
    localStorage.removeItem('money.lang');
    expect(base.fmtDate('2026-11-01')).toBe('Nov 1, 2026');
  });
});

describe('German catalog', () => {
  const DE = de as Record<string, string>;
  afterEach(async () => { (await load()).stopSpanish(); localStorage.removeItem('money.lang'); });
  it('keeps every placeholder of the English text, none added', () => {
    const mismatched = Object.entries(DE).filter(([k, v]) => names(v).join() !== names(k).join()).map(([k, v]) => k + ' → ' + v);
    expect(mismatched).toEqual([]);
  });
  it('picks the most specific phrase and translates the pieces plugged into it', async () => {
    localStorage.setItem('money.lang', JSON.stringify('de'));
    const m = await load();
    expect(m.t('Everyday Checking → Fuel Stop')).toBe('Everyday Checking → Fuel Stop');
    expect(m.hasSpanish('Budget for Food')).toBe(true);
    expect(m.t('Budget for Food')).not.toBe('Budget for Food');
    expect(m.t('Budget for Food')).toContain('Food');
  });
  it('formats dates the German way once German is picked, and not in English', async () => {
    localStorage.setItem('money.lang', JSON.stringify('de'));
    const base = await import('../app/src/core/base');
    expect(base.fmtDate('2026-11-01')).toMatch(/nov/i);
    expect(base.fmtDate('2026-11-01')).not.toBe('Nov 1, 2026');
    expect(base.money(1234.5)).toMatch(/1\.234,50/);
    localStorage.removeItem('money.lang');
    expect(base.fmtDate('2026-11-01')).toBe('Nov 1, 2026');
  });
});

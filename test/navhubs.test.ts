import { describe, it, expect } from 'vitest';
import { HUBS, NAV, NAV_GROUPS, hubOf, hubTabs, navItem } from '../app/src/core/dom';

const top = NAV_GROUPS.flatMap(g => g[1]);

describe('Sidebar hubs', () => {
  it('has ten menu items plus Settings', () => {
    expect(top.length).toBe(10);
  });
  it('keeps every page reachable: a menu item, or a tab of one', () => {
    const tabs = Object.values(HUBS).flat().map(([r]) => r);
    for (const [r] of NAV) if (r !== 'settings') expect([...top, ...tabs]).toContain(r);
  });
  it('every menu item is a page, and a hub opens on its first tab', () => {
    for (const r of top) expect(NAV.some(n => n[0] === r)).toBe(true);
    for (const [h, tabs] of Object.entries(HUBS)) { expect(tabs[0][0]).toBe(h); expect(top).toContain(h); }
  });
  it('lights the hub menu item for each of its pages', () => {
    expect(hubOf('piggy')).toBe('budgets');
    expect(hubOf('recurring')).toBe('bills');
    expect(hubOf('loans')).toBe('forecast');
    expect(hubOf('year')).toBe('reports');
    expect(hubOf('map')).toBe('unusual');
    expect(hubOf('rules')).toBe('categories');
    expect(hubOf('inbox')).toBe('review');
    expect(hubOf('account')).toBe('accounts');
  });
  it('draws tabs on a hub page, none elsewhere', () => {
    expect(String(hubTabs('piggy'))).toMatch(/<a href="#\/piggy" role="tab" class="on" aria-selected="true">Piggy banks<\/a>/);
    expect(String(hubTabs('piggy'))).toMatch(/href="#\/budgets" role="tab" class=""/);
    expect(String(hubTabs('transactions'))).toBe('');
  });
  it('names Insights and the merged items in the menu', () => {
    expect(navItem('unusual')[1]).toBe('Insights');
    expect(navItem('bills')[1]).toBe('Bills & recurring');
    expect(navItem('categories')[1]).toBe('Categories & rules');
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backLink, todoTabs } from '../app/src/core/dom';

const css = readFileSync('app/assets/money.css', 'utf8');
const src = (f: string) => readFileSync('app/src/' + f, 'utf8');
const pages = readdirSync('app/src/pages').map(f => [f, src('pages/' + f)]);

describe('one navigation pattern', () => {
  it('the To do tabs are drawn like every other tab strip (tablist, tabs, aria-selected)', () => {
    const h = String(todoTabs('inbox'));
    expect(h).toMatch(/class="tabs" role="tablist"/);
    expect(h).toMatch(/href="#\/inbox" role="tab" class="on" aria-selected="true"/);
    expect(h).toMatch(/href="#\/review" role="tab" class="" aria-selected="false"/);
  });
  it('back links are one button above the title, on every page that has one', () => {
    expect(String(backLink('#/accounts', 'Accounts'))).toMatch(/<a class="back" href="#\/accounts">.*<span>Accounts<\/span><\/a>/);
    for (const [f, s] of pages) expect(s, f).not.toMatch(/<a class="link" href="[^"]*">← /);
    for (const f of ['accounts.ts', 'cleanup.ts', 'reconcile.ts']) expect(src('pages/' + f)).toContain('backLink(');
    expect(css).toMatch(/\.back \{[^}]*min-height: 44px/);
  });
  it('touch targets on a phone: tabs, drawer Close, year Close and arrows are at least 44px', () => {
    expect(css).toMatch(/\.tabs a \{ min-height: 44px/);
    expect(css).toMatch(/\.drawer header \.round \{ width: 44px; height: 44px; \}/);
    expect(css).toMatch(/\.st-x \{[^}]*width: 44px; height: 44px/);
  });
});

describe('every gesture has a button', () => {
  it('Year in Money: Previous and Next buttons beside Close', () => {
    const y = src('pages/year.ts');
    expect(y).toMatch(/aria-label="Previous card" data-onclick="App.yearStep\(-1\)"/);
    expect(y).toMatch(/aria-label="Next card" data-onclick="App.yearStep\(1\)"/);
    expect(y).toMatch(/aria-label="Close" data-onclick="App.yearClose\(\)"/);
  });
  it('Categorize: Accept, Skip and Previous are buttons; the swipe is only a shortcut', () => {
    const i = src('pages/inbox.ts');
    expect(i).toContain('App.inboxQuick()');
    expect(i).toContain('App.inboxSkip()');
    expect(i).toMatch(/class="btn" data-onclick="App.inboxBack\(\)">Previous</);
    expect(i).toMatch(/you can also swipe/);
  });
  it('pull to refresh has a Refresh button in the More sheet', () => {
    expect(src('features/phone.ts')).toMatch(/data-onclick="App.refreshPage\(\)">Refresh</);
  });
  it('the bottom sheet always has an explicit Close button', () => {
    expect(src('core/dom.ts')).toMatch(/data-onclick="App.closeDrawerAsk\(\)" aria-label="Close"/);
  });
  it('row swipe is a shortcut; the transaction sheet has Delete and the category', () => {
    expect(src('features/phone.ts')).toMatch(/Shortcut: swipe a row left/);
    expect(src('features/txform.ts')).toContain('App.deleteTx()');
  });
});

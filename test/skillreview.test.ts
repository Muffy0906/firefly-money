import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/assets/money.css', 'utf8');
const src = (f: string) => readFileSync('app/src/' + f, 'utf8');
const touch = css.slice(css.indexOf('/* ---------- Touch targets'));

describe('Skill review: touch, keyboard and announcements', () => {
  it('gives the 36px-and-under controls a 44px hit area on touch without changing their look', () => {
    for (const sel of ['.editor-row .x::after', '.whatsnew .wn-x::after', '.head .actions .month :is(.btn, .round)::after', ]) expect(touch).toContain(sel);
    expect(touch).toMatch(/:is\(\.tagcloud \.chip, \.saved-reports \.chip\) button::after \{ content: ""; position: absolute; inset: -12px -6px; \}/);
  });
  it('shows the add-budget chip to a keyboard user and drops the invalid dashed shadow', () => {
    expect(css).toContain('.tbl.feed tr:focus-visible .chip.ghost');
    expect(css).not.toContain('inset 0 0 0 1px dashed');
  });
  it('hides keyboard hints on touch screens but keeps the swipe hint', () => {
    expect(css).toContain('@media (hover: none) { .chip.ghost { display: none; } .kbd-hint { display: none; } }');
    const inbox = src('pages/inbox.ts');
    expect(inbox).toContain('<span class="neutral kbd-hint">S</span>');
    expect(inbox).toContain('skip. </span>On a phone you can also swipe');
  });
  it('announces a failure at once and lets a caller say it is one', () => {
    const dom = src('core/dom.ts');
    expect(dom).toContain("export function toast(msg: string, failed = FAILED.test(msg))");
    expect(dom).toContain("setAttribute('role', failed ? 'alert' : 'status')");
    expect(dom).toContain("setAttribute('aria-live', failed ? 'assertive' : 'polite')");
    expect(src('core/auth.ts')).toContain('toast(errText(e), true)');
  });
  it('moves focus into the drawer on a phone', () => {
    const dom = src('core/dom.ts');
    expect(dom).toContain("head.tabIndex = -1; head.focus({ preventScroll: true })");
    expect(dom).toContain("f && innerWidth > 900");
  });
  it('asks before Esc or the backdrop throws away an edited form in any drawer', () => {
    expect(src('core/dom.ts')).toContain("closest('#drawer form') && !t.closest('#txForm')");
    expect(src('core/dom.ts')).toContain("d.removeAttribute('data-dirty');\n  const row");
    expect(src('features/txform.ts')).toContain("drawerDirty() && !await confirmBox('Discard your changes?'");
  });
  it('puts a rule or webhook switch back when the server refuses the change', () => {
    expect(src('pages/rules.ts')).toContain('(row as HTMLInputElement).checked = !on');
    expect(src('pages/settings.ts')).toContain('if (box) box.checked = !on; throw e;');
  });
  it('lets a failed page of transactions be retried, in plain words', () => {
    const g = src('features/gestures.ts');
    expect(g).toContain("'Couldn’t load more. '");
    expect(g).toContain("b.textContent = 'Try again'");
    expect(g).not.toContain("(e as Error).message; f.next = f.pages + 1");
  });
  it('keeps Space for the Close and Share buttons in the year story', () => {
    expect(src('pages/year.ts')).toContain("e.key === ' ' && !(e.target as Element).closest('button, a, input')");
  });
  it('marks the current tab in the phone tab bar', () => {
    const p = src('features/phone.ts');
    expect(p).toContain("a.setAttribute('aria-current', 'page')");
    expect(p).toContain('aria-current="page"');
  });
});

describe('Skill review: honest numbers and order', () => {
  it('lists the urgent items in Needs attention before routine ones', () => {
    const o = src('pages/overview.ts');
    expect(o).toContain('items.sort((a, b) => rank(a) - rank(b));');
    expect(o.indexOf('items.sort(')).toBeLessThan(o.indexOf('const more = items.length - 2'));
  });
  it('does not call a zero budget limit a limit, or an overpaid card paid off', () => {
    expect(src('pages/overview.ts')).toContain('const sub = lim && lim.amount ? pct > 100');
    expect(src('pages/accounts.ts')).toContain('<span class="pos">Credit ${ownAmt(');
  });
  it('explains a minus sign in the amount, and Clean up has a way back', () => {
    expect(src('features/txform.ts')).toContain('Enter the amount without a minus sign.');
    expect(src('pages/cleanup.ts')).toContain("backLink('#/settings?s=data', 'Data')");
  });
});

describe('Skill review decisions: navigation, forms, bulk, tokens', () => {
  it('lights the phone More tab and titles its sheet More', () => {
    const p = src('features/phone.ts');
    expect(p).toContain('button.more');
    expect(p).toContain('moreOn');
    expect(p).toContain('swipe-hint');
  });
  it('puts less-used add-form fields under More details, and keeps a phone footer menu', () => {
    const t = src('features/txform.ts');
    expect(t).toContain('tx-more');
    expect(t).toContain('foot-more');
    expect(t).toContain('closeDrawerAsk');
  });
  it('asks before a bulk edit over 25 rows, with copy that translates', () => {
    const b = src('features/bulk.ts');
    expect(b).toContain('bk-set');
    expect(b).toContain('groups.length > 25');
    expect(b).not.toContain("' on every one of them.'");
  });
  it('lets keyboard users activate inline pills and move dashboard tiles', () => {
    expect(src('core/feed.ts')).toContain('role="button" tabindex="0"');
    expect(src('features/a11y.ts')).toContain('.inl');
    expect(src('features/dashboard.ts')).toContain('App.dashMove(');
  });
  it('can pause the year story and caps long lists', () => {
    expect(src('pages/year.ts')).toContain('yearPause');
    expect(src('pages/overview.ts')).toContain('more');
    expect(src('pages/accounts.ts')).toContain('Show all ${ranked.length}');
    expect(src('features/ffstatus.ts')).toContain('ff-details');
  });
  it('uses type tokens and a single eyebrow rule', () => {
    expect(css).toContain('--fs-2xs');
    expect(css.match(/^\.eyebrow \{/gm)?.length).toBe(1);
  });
  it('has Spanish for the new strings', () => {
    const es = JSON.parse(readFileSync('app/src/locales/es.json', 'utf8')) as Record<string, string>;
    for (const k of ['More details', 'Discard your changes?', 'Show all {n}', 'Change {n} transactions?', 'Pause', 'Credit']) expect(es[k]).toBeTruthy();
  });
});

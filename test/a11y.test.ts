import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const index = readFileSync('app/index.html', 'utf8');
const css = readFileSync('app/assets/money.css', 'utf8');
const src = (f: string) => readFileSync('app/src/' + f, 'utf8');

describe('keyboard and screen reader basics', () => {
  it('a chart table never goes inside a donut or ring (it would push the centre text off the ring)', () => {
    const a = src('features/a11y.ts');
    expect(a).toContain("svg.closest('.share, .donut, .ring')");
    expect(a).toContain("at.insertAdjacentElement('afterend', d)");
    expect(a).not.toContain("svg.insertAdjacentElement('afterend', d)");
    expect(css).toMatch(/\.donut, \.ring \{ position: relative; display: grid; place-items: center; \}/);
  });
  it('has a skip link to the page, and the page can take focus', () => {
    expect(index).toContain('<a href="#view" class="skip">Skip to content</a>');
    expect(index).toContain('<main id="view" tabindex="-1">');
    expect(src('features/a11y.ts')).toContain("closest('a.skip')");     // handled in script: a #view link would be a route
    expect(css).toMatch(/\.skip:focus \{ top:/);
  });
  it('accounts and recurring rows are reachable and open from the keyboard', () => {
    expect(src('pages/accounts.ts')).toContain('<tr class="click" tabindex="0" role="link"');
    expect(src('pages/recurring.ts')).toContain('<tr class="click" tabindex="0" role="button"');
    expect(src('features/a11y.ts')).toContain("tr.click[tabindex]:not([data-gid])");
  });
  it('the current page, tab and segment are announced', () => {
    const a = src('features/a11y.ts');
    expect(a).toContain("'.nav a, .tabbar a, .tabs a'");
    expect(a).toContain("setAttribute('aria-current', 'page')");
    expect(a).toContain("setAttribute('aria-pressed'");
  });
  it('the search is a combobox that follows the highlighted result and gives focus back', () => {
    expect(index).toMatch(/id="palQ"[^>]*role="combobox"[^>]*aria-expanded="true"[^>]*aria-controls="palList"/);
    const p = src('features/palette.ts');
    expect(p).toContain('aria-selected="${i === palIdx');
    expect(p).toContain("setAttribute('aria-activedescendant'");
    expect(p).toContain('palOpener.focus(');
    expect(css).toMatch(/data-theme="glass"\] \.palette-box \{ background: var\(--glass\), rgba\(14, 11, 30, \.94\)/);
  });
  it('page headings do not skip a level', () => {
    expect(src('features/pageopts.ts')).not.toContain('<h3 class="set-h">');
    expect(src('core/dom.ts')).not.toMatch(/es-ic[^\n]*<h3>/);
  });
  it('the delete undo lasts 10 s, pauses while hovered or focused, and error toasts scale with length', () => {
    const d = src('features/polish.ts');
    expect(d).toContain('const UNDO_MS = 10000');
    expect(d).toContain("addEventListener('focusin', hold)");
    expect(css).toContain('animation: drain 10s linear forwards');
    expect(css).toContain('.undo.held .bar { animation-play-state: paused; }');
    expect(src('core/dom.ts')).toContain('2600 + msg.length * 60');
  });
  it('a failed page shows the server message, not JavaScript error text, and is announced', () => {
    const r = src('core/router.ts');
    expect(r).toContain('role="alert"><strong>Couldn’t load this page.');
    expect(src('core/dom.ts')).toContain("'Something went wrong while showing this page.'");
    expect(r).not.toContain('${(e as Error).message}<br>');
  });
  it('the Menu sheet closes when the page changes (Back)', () => {
    expect(src('features/a11y.ts')).toMatch(/hashchange[\s\S]*sheet-search[\s\S]*closeDrawer/);
  });
});

describe('review follow-ups', () => {
  const css2 = readFileSync('app/assets/money.css', 'utf8');
  it('a missing account id goes back to the list instead of an error screen', () => {
    expect(src('pages/reconcile.ts')).toContain("if (!r.id) { location.replace('#/accounts'); return; }");
    expect(src('pages/accounts.ts')).toContain("if (!r.id) { location.replace('#/accounts'); return; }");
  });
  it('an insight off a tiny base shows dollars, not a huge percentage', () => {
    expect(src('features/insights.ts')).toContain('Math.abs(m.p) >= 5 ? money0(Math.abs(m.d))');
  });
  it('destructive confirms use the danger style', () => {
    expect(src('core/dom.ts')).toContain("btn primary${/^(Delete|Remove|Unlink|Discard)$/.test(okLabel) ? ' danger' : ''}");
  });
  it('required-field errors are inline, announced, and cleared on input', () => {
    const a = src('features/a11y.ts');
    expect(a).toContain("addEventListener('invalid'");
    expect(a).toContain('}, true);      // capture: invalid doesn\'t bubble');
    expect(a).toContain("m.setAttribute('role', 'alert')");
    expect(a).toContain("'Choose one'");
    expect(css2).toContain('.field-err');
  });
  it('one-letter shortcuts can be switched off in Settings', () => {
    expect(src('pages/settings.ts')).toContain('App.toggleKeys(this.checked)');
    expect(src('features/keyboard.ts')).toContain("LS.get('keys', true) === false");
  });
  it('on touch the row pills are not targets and small links get a 44px hit area', () => {
    expect(css2).toContain('.tbl.feed .meta :is(.cat-s, .bud-s).inl { pointer-events: none; }');
    expect(css2).toContain('.link, a.go-num { padding-block: 13px; margin-block: -13px; }');
  });
});

describe('review follow-ups 2', () => {
  const c = readFileSync('app/assets/money.css', 'utf8');
  it('a failure toast waits to be dismissed (button, tap target, Esc); status toasts fade', () => {
    const d = src('core/dom.ts');
    expect(d).toContain('const FAILED = /couldn’t|could not');
    expect(d).toContain("b.className = 'toast-x'");
    expect(d).toContain("e.key === 'Escape'");
    expect(c).toContain('.toast.sticky { pointer-events: auto;');
  });
  it('charts get a "Show as table" with the hover text, up to 60 points', () => {
    const a = src('features/a11y.ts');
    expect(a).toContain("svg[role=\"img\"][aria-label]");
    expect(a).toContain("tips.length > 60");
    expect(a).toContain('Show as table');
  });
  it('touch: day bars and timeline links reach 44px', () => {
    expect(c).toContain('.tl-go { padding-block: 12px; margin-block: -12px; }');
    expect(c).toContain('.dbars .db { min-height: 44px; }');
  });
  it('the + button steps aside from any control it covers, sampled across its whole face', () => {
    const f = src('features/fabdodge.ts');
    expect(f).toContain("e.matches('a[href], button, [data-onclick]')");
    expect(f).toContain('[.05, .275, .5, .725, .95]');
  });
  it('the sidebar leaves room for all its rows on a 800px-tall window', () => {
    expect(c).toContain('--row: clamp(24px, calc((100vh - 275px) / 22), 36px)');
  });
});

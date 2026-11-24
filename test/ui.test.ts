import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { html } from '../app/src/core/html';
import { doneState, emptyNote, kpi, panel, panelHead } from '../app/src/core/ui';

const str = (h: unknown) => String(h);

// The markup these helpers return is what the pages used to write by hand, so any change here changes every page that uses them.
describe('ui helpers', () => {
  it('panelHead: a heading and a lead, with an optional link beside the heading', () => {
    expect(str(panelHead('Top payees', 'Who you paid'))).toBe('<h2>Top payees</h2><p class="lead">Who you paid</p>');
    expect(str(panelHead('Loans', 'Balance', { href: '#/loans', label: 'Plan payoff' })))
      .toBe('<div class="panel-head"><h2>Loans</h2><a class="link" href="#/loans">Plan payoff</a></div><p class="lead">Balance</p>');
    expect(str(panelHead('Bills'))).toBe('<h2>Bills</h2>');
  });
  it('panelHead escapes text and keeps html``', () => {
    expect(str(panelHead('<b>', html`<i>${'<x>'}</i>`))).toBe('<h2>&lt;b&gt;</h2><p class="lead"><i>&lt;x&gt;</i></p>');
  });
  it('panel wraps a body in the section', () => {
    expect(str(panel('A', 'b', html`<p>c</p>`))).toBe('<section class="panel"><h2>A</h2><p class="lead">b</p><p>c</p></section>');
    expect(str(panel('A', 'b', '', { cls: 'chart', style: 'margin-bottom:20px' })))
      .toBe('<section class="panel chart" style="margin-bottom:20px"><h2>A</h2><p class="lead">b</p></section>');
  });
  it('emptyNote and doneState', () => {
    expect(str(emptyNote('No files.'))).toBe('<p class="empty">No files.</p>');
    expect(str(doneState('All tidy', 'Nothing left.', 50)))
      .toBe('<div class="center-empty" style="padding:50px 20px"><div style="font-size:40px">✓</div><h2 style="font-size:18px;margin:12px 0 4px">All tidy</h2>Nothing left.</div>');
    expect(str(doneState('x', 'y'))).toContain('padding:60px 20px');
  });
  it('kpi leaves out an absent sub but keeps an empty one', () => {
    expect(str(kpi('Paid', '$5', null, 'pos'))).toBe('<div class="kpi"><div class="eyebrow">Paid</div><div class="val num pos">$5</div></div>');
    expect(str(kpi('Paid', '$5', 'so far'))).toBe('<div class="kpi"><div class="eyebrow">Paid</div><div class="val num ">$5</div><div class="sub-s">so far</div></div>');
    expect(str(kpi('Paid', '$5', ''))).toContain('<div class="sub-s"></div>');
  });
});

// Pages use the helpers instead of writing these patterns again
describe('shared patterns stay shared', () => {
  const files = ['core', 'features', 'pages'].flatMap(d => readdirSync('app/src/' + d).filter(f => f.endsWith('.ts')).map(f => d + '/' + f)).filter(f => f !== 'core/ui.ts');
  const hits = (re: RegExp) => files.filter(f => re.test(readFileSync('app/src/' + f, 'utf8')));
  it('no hand-written KPI card', () => expect(hits(/<div class="kpi"><div class="eyebrow">[^<]*<\/div><div class="val num[^"]*">[^<]*<\/div><\/div>/)).toEqual([]));
  it('no hand-written done state', () => expect(hits(/font-size:40px">✓/)).toEqual([]));
  it('no hand-written empty note', () => expect(hits(/<p class="empty">/)).toEqual([]));
  it('no hand-written panel heading with a lead', () => expect(hits(/(?<!<div>)<h2>[^<$]*<\/h2><p class="lead">/)).toEqual([]));
});

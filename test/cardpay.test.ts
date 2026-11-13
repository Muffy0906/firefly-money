import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { payRow } from '../app/src/pages/overview';

const acct = (id: string, name: string) => ({ id, name } as any);
const bills = readFileSync('app/src/pages/bills.ts', 'utf8');

describe('Pay now on credit cards works like Pay now on bills', () => {
  it('shows the button only when money is owed', () => {
    const owed = String(payRow(acct('9', 'Travel Card'), 120, true));
    expect(owed).toContain('data-onclick="App.cardPay(\'9\')"');
    expect(owed).toContain('btn small primary');
    expect(owed).not.toContain('target="_blank"');
    expect(String(payRow(acct('9', 'Travel Card'), 0, true))).not.toContain('Pay now');
    expect(String(payRow(acct('9', 'Checking'), 120, false))).not.toContain('Pay now');
  });
  it('does not nest a link in a link, and the button cannot push the amount out at 320', () => {
    expect(String(payRow(acct('1', 'Citi'), 5, true))).toMatch(/<div class="row payrow"><a class="rowmain"[^>]*>.*<\/a><button/);
    const css = readFileSync('app/assets/money.css', 'utf8');
    expect(css).toMatch(/\.row\.payrow \.btn \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.row\.payrow \.rowmain \{[^}]*min-width: 0/);
  });
  it('opens a transfer into the card for what is owed, saving nothing', () => {
    const f = bills.slice(bills.indexOf('async function cardPay'), bills.indexOf('\n}\n', bills.indexOf('async function cardPay')));
    expect(f).toMatch(/type: 'transfer'/);
    expect(f).toMatch(/Math\.max\(0, -a\.balance\)/);
    expect(f).toMatch(/dest: String\(a\.id\)/);
    expect(f).not.toMatch(/api\(/);
    expect(bills).toMatch(/const methods = \{[^}]*cardPay/);
  });
});

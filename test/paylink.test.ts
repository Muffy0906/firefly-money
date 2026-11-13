import { beforeEach, describe, expect, it } from 'vitest';
import { issuerUrl, payUrl, safeUrl, setPayUrl } from '../app/src/core/paylink';
import { payRow } from '../app/src/pages/overview';
import { readFileSync } from 'node:fs';

const acct = (id: string, name: string) => ({ id, name } as any);

describe('Pay now on credit cards', () => {
  beforeEach(() => localStorage.clear());
  it('knows the big issuers by account name', () => {
    for (const n of ['Chase Sapphire', 'Citi Double Cash', 'Capital One Venture', 'Amex Gold', 'Discover it', 'Apple Card']) expect(issuerUrl(n)).toMatch(/^https:\/\//);
    expect(issuerUrl('Mom’s card')).toBe('');
  });
  it('only accepts https links', () => {
    expect(safeUrl('mybank.com/pay')).toBe('https://mybank.com/pay');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('http://mybank.com')).toBe('');
    expect(safeUrl('')).toBe('');
  });
  it('lets a card’s own link win, and clearing it goes back to the issuer', () => {
    expect(payUrl('7', 'Chase Sapphire')).toContain('chase.com');
    setPayUrl('7', 'mybank.com/pay');
    expect(payUrl('7', 'Chase Sapphire')).toBe('https://mybank.com/pay');
    setPayUrl('7', '');
    expect(payUrl('7', 'Chase Sapphire')).toContain('chase.com');
    expect(payUrl('8', 'Mom’s card')).toBe('');
    setPayUrl('8', 'mom.example.com');
    expect(payUrl('8', 'Mom’s card')).toBe('https://mom.example.com/');
  });
  it('shows the button only when money is owed, opening a new tab safely', () => {
    const owed = String(payRow(acct('1', 'Citi Double Cash'), 120, true));
    expect(owed).toContain('Pay now');
    expect(owed).toContain('target="_blank"');
    expect(owed).toContain('rel="noopener noreferrer"');
    expect(String(payRow(acct('1', 'Citi Double Cash'), 0, true))).not.toContain('Pay now');
    expect(String(payRow(acct('2', 'Mom’s card'), 50, true))).not.toContain('Pay now');
    expect(String(payRow(acct('1', 'Citi Double Cash'), 120, false))).not.toContain('Pay now');
  });
  it('does not nest a link in a link, and the button can’t push the amount out at 320', () => {
    expect(String(payRow(acct('1', 'Citi'), 5, true))).toMatch(/<div class="row payrow"><a class="rowmain"[^>]*>.*<\/a><a class="paynow"/);
    const css = readFileSync('app/assets/money.css', 'utf8');
    expect(css).toMatch(/\.paynow \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.row\.payrow \.rowmain \{[^}]*min-width: 0/);
  });
});

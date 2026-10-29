import { describe, expect, it } from 'vitest';
import { appVersion } from '../app/src/features/whatsnew';

describe('appVersion', () => {
  it('reads the version from a release image stamp', () => {
    expect(appVersion('v2.0.0 (c78fd51 · 2026-10-29)')).toBe('2.0.0');
    expect(appVersion('v2.1.3 (abc1234 · 2026-12-01)')).toBe('2.1.3');
    expect(appVersion('v2.2.0-beta.1 (abc1234 · 2026-12-01)')).toBe('2.2.0');
  });
  it('falls back to the newest release with notes for main and local builds', () => {
    expect(appVersion('c78fd51 · 2026-10-29')).toBe('2.0.0');
    expect(appVersion('${MONEY_VERSION}')).toBe('2.0.0');
    expect(appVersion('')).toBe('2.0.0');
  });
});

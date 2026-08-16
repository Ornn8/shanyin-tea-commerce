import { describe, expect, it } from 'vitest';
import { CURRENCY, cnySymbol, formatCny } from '@/i18n/format';
import { LOCALE_IDS } from '@/i18n/registry';

describe('CNY currency formatting', () => {
  it('formats the same underlying amount for every locale without altering it', () => {
    const cents = 128000;
    const digits = (formatted: string) => formatted.replace(/\D/g, '');
    const presentations = new Set<string>();
    for (const locale of LOCALE_IDS) {
      const formatted = formatCny(cents, locale);
      expect(formatted.length).toBeGreaterThan(0);
      expect(digits(formatted)).toBe('128000');
      presentations.add(formatted);
    }
    // Presentation genuinely varies per locale…
    expect(presentations.size).toBe(LOCALE_IDS.length);
    // …while the amount stays CNY for every locale.
    expect(CURRENCY).toBe('CNY');
    expect(formatCny(cents, 'zh-CN')).toContain(cnySymbol('zh-CN'));
  });

  it('keeps the input amount intact (pure function)', () => {
    const cents = 96000;
    formatCny(cents, 'en');
    expect(cents).toBe(96000);
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatCny(12.5, 'en')).toThrow(/safe integer/);
  });

  it('is deterministic per locale', () => {
    expect(formatCny(88000, 'ja')).toBe(formatCny(88000, 'ja'));
    expect(formatCny(168000, 'en')).toBe('CN¥1,680.00');
  });
});

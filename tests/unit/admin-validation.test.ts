/**
 * Admin validation unit tests (Issue #3 acceptance: no duplicate SKUs,
 * negative stock, floating-point prices, or locale-specific inventory).
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeProductInput,
  parseInteger,
  parsePriceToCents,
  validateInventory,
  validateLocalizedCopy,
  validatePriceCents,
  validateSku,
  validateSlug,
} from '@/lib/admin/validation';
import { AdminError } from '@/lib/admin/errors';

function expectRejected(run: () => unknown, code: string) {
  try {
    run();
    throw new Error(`expected AdminError ${code}, but no error was thrown`);
  } catch (error) {
    if (error instanceof AdminError) {
      expect(error.code).toBe(code);
      return;
    }
    throw error;
  }
}

describe('parsePriceToCents (yuan string → integer cents, no floats)', () => {
  it('parses whole yuan and two-decimal yuan into integer cents', () => {
    expect(parsePriceToCents('1280')).toBe(128000);
    expect(parsePriceToCents('1280.5')).toBe(128050);
    expect(parsePriceToCents('1280.50')).toBe(128050);
    expect(parsePriceToCents('0.01')).toBe(1);
    expect(parsePriceToCents('0')).toBe(0);
    expect(parsePriceToCents(' 42.30 ')).toBe(4230);
  });

  it('rejects floats, negatives, over-precision, and non-numeric input', () => {
    expectRejected(() => parsePriceToCents('1.234'), 'invalid-price');
    expectRejected(() => parsePriceToCents('-5'), 'invalid-price');
    expectRejected(() => parsePriceToCents('-5.5'), 'invalid-price');
    expectRejected(() => parsePriceToCents('abc'), 'invalid-price');
    expectRejected(() => parsePriceToCents('1,280'), 'invalid-price');
    expectRejected(() => parsePriceToCents(''), 'invalid-price');
    expectRejected(() => parsePriceToCents('100000000'), 'invalid-price'); // over ¥1,000,000.00
    expectRejected(() => parsePriceToCents(NaN), 'invalid-price');
  });
});

describe('validatePriceCents / validateInventory / parseInteger', () => {
  it('accepts safe integers only', () => {
    expect(validatePriceCents(0)).toBe(0);
    expect(validatePriceCents(88050)).toBe(88050);
    expect(validatePriceCents('100')).toBe(100);
    expect(validateInventory(0)).toBe(0);
    expect(validateInventory(42)).toBe(42);
    expect(parseInteger('007', 'x', 'x')).toBe(7);
  });

  it('rejects non-integers, floats, and negative stock', () => {
    expectRejected(() => validatePriceCents(10.5), 'invalid-price');
    expectRejected(() => validatePriceCents(-1), 'invalid-price');
    expectRejected(() => validateInventory(-1), 'invalid-inventory');
    expectRejected(() => validateInventory(1.5), 'invalid-inventory');
    expectRejected(() => validateInventory('many'), 'invalid-inventory');
    expectRejected(() => validatePriceCents(Number.MAX_SAFE_INTEGER), 'invalid-price');
  });
});

describe('validateSlug / validateSku', () => {
  it('accepts canonical slugs and SKUs', () => {
    expect(validateSlug('spring-longjing')).toBe('spring-longjing');
    expect(validateSlug('  Spring-Longjing ')).toBe('spring-longjing');
    expect(validateSku('SHY-G-001')).toBe('SHY-G-001');
    expect(validateSku('sku_1.x-2')).toBe('sku_1.x-2');
  });

  it('rejects invalid slugs and SKUs', () => {
    expectRejected(() => validateSlug('Spring Longjing'), 'invalid-slug');
    expectRejected(() => validateSlug('--double'), 'invalid-slug');
    expectRejected(() => validateSlug('trailing-'), 'invalid-slug');
    expectRejected(() => validateSlug(''), 'invalid-slug');
    expectRejected(() => validateSku(''), 'invalid-sku');
    expectRejected(() => validateSku('sku with spaces'), 'invalid-sku');
    expectRejected(() => validateSku('-leading'), 'invalid-sku');
  });
});

describe('validateLocalizedCopy', () => {
  it('requires a title; description and notes may stay empty (English fallback)', () => {
    const copy = validateLocalizedCopy('ja', {
      name: '管理者デモ茶',
      description: '',
      tastingNotes: '',
    });
    expect(copy.name).toBe('管理者デモ茶');
    expect(copy.description).toBe('');
    expect(copy.brewingNotes).toBeUndefined();

    expectRejected(() => validateLocalizedCopy('ja', { name: '', description: 'd', tastingNotes: 't' }), 'invalid-input');
  });

  it('rejects unknown locale ids', () => {
    expectRejected(
      () => validateLocalizedCopy('xx-XX', { name: 'X', description: 'd', tastingNotes: 't' }),
      'invalid-locale',
    );
  });
});

describe('normalizeProductInput', () => {
  const valid = {
    slug: 'it-unit-demo',
    origin: 'Demo origin',
    form: 'LOOSE',
    caffeine: 'MEDIUM',
    categoryId: 'cat-1',
    variants: [{ sku: 'IT-UNIT-001', name: 'Standard', priceCents: 1000, inventory: 5 }],
    localizations: { en: { name: 'Demo', description: 'Desc', tastingNotes: 'Notes' } },
  };

  it('normalizes a valid payload', () => {
    const input = normalizeProductInput(valid);
    expect(input.slug).toBe('it-unit-demo');
    expect(input.variants[0].priceCents).toBe(1000);
    expect(input.localizations.en?.name).toBe('Demo');
  });

  it('rejects duplicate SKUs in the payload', () => {
    expectRejected(
      () =>
        normalizeProductInput({
          ...valid,
          variants: [
            { sku: 'IT-UNIT-001', name: 'A', priceCents: 1, inventory: 1 },
            { sku: 'IT-UNIT-001', name: 'B', priceCents: 2, inventory: 2 },
          ],
        }),
      'duplicate-sku',
    );
  });

  it('rejects float prices and negative inventory inside a payload', () => {
    expectRejected(
      () => normalizeProductInput({ ...valid, variants: [{ sku: 'IT-UNIT-002', name: 'A', priceCents: 9.99, inventory: 1 }] }),
      'invalid-price',
    );
    expectRejected(
      () => normalizeProductInput({ ...valid, variants: [{ sku: 'IT-UNIT-003', name: 'A', priceCents: 100, inventory: -2 }] }),
      'invalid-inventory',
    );
  });

  it('rejects empty variant lists and unknown locales', () => {
    expectRejected(() => normalizeProductInput({ ...valid, variants: [] }), 'invalid-variants');
    expectRejected(
      () =>
        normalizeProductInput({
          ...valid,
          localizations: { 'xx-XX': { name: 'N', description: 'D', tastingNotes: 'T' } },
        }),
      'invalid-locale',
    );
  });
});

/**
 * Server-side checkout field validation unit tests (Issue #6, ADR-0008).
 */
import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_FIELDS,
  validateCheckoutFields,
  type CheckoutFieldErrors,
} from '@/lib/checkout-validation';

const VALID = {
  email: 'shopper@example.com',
  recipientName: 'Test Shopper',
  addressLine1: '1 Tea Lane',
  city: 'Hangzhou',
  region: 'Zhejiang',
  postalCode: '310000',
  countryCode: 'cn',
};

describe('validateCheckoutFields (minimum documented contact + shipping)', () => {
  it('accepts a fully valid submission and normalizes it', () => {
    const result = validateCheckoutFields(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.email).toBe('shopper@example.com');
      expect(result.values.countryCode).toBe('CN'); // trimmed + uppercased
      expect(result.values.recipientName).toBe('Test Shopper');
    }
  });

  it('rejects each missing field with a required code', () => {
    for (const key of CHECKOUT_FIELDS) {
      const input = { ...VALID, [key]: '' };
      const result = validateCheckoutFields(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[key]).toBe('required');
      }
    }
  });

  it('rejects a whitespace-only value as required', () => {
    const result = validateCheckoutFields({ ...VALID, email: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBe('required');
  });

  it('rejects an invalid email', () => {
    for (const bad of ['nope', 'a@b', '@x.com', 'a b@c.com', 'a@']) {
      const result = validateCheckoutFields({ ...VALID, email: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.email).toBe('invalidEmail');
    }
  });

  it('rejects a non-2-letter country code', () => {
    for (const bad of ['CHN', 'C', 'CN1']) {
      const result = validateCheckoutFields({ ...VALID, countryCode: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.countryCode).toBe('invalidCountry');
    }
    expect(validateCheckoutFields({ ...VALID, countryCode: 'jp' }).ok).toBe(true);
  });

  it('rejects over-long values', () => {
    const result = validateCheckoutFields({ ...VALID, city: 'x'.repeat(101) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.city).toBe('tooLong');
  });

  it('reports multiple field errors at once and never trusts non-string input', () => {
    const result = validateCheckoutFields({ ...VALID, email: 42 as unknown as string, region: null as unknown as string });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const errors = result.errors as CheckoutFieldErrors;
      expect(errors.email).toBe('required');
      expect(errors.region).toBe('required');
    }
  });
});

/**
 * Order identity/cryptography unit tests (Issue #6, ADR-0008).
 */
import { describe, expect, it } from 'vitest';
import {
  generateLookupCredential,
  generateOrderNumber,
  hashLookupCredential,
  newProviderIntentId,
  normalizeLookupCredential,
} from '@/lib/order-credentials';

describe('lookup credentials (high-entropy, hash-only persistence)', () => {
  it('generates a 256-bit base64url credential', () => {
    const credential = generateLookupCredential();
    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → 43 base64url chars
    expect(Buffer.from(credential, 'base64url').length).toBe(32);
    // Distinct draws are (astronomically) distinct.
    expect(generateLookupCredential()).not.toBe(credential);
  });

  it('hashes deterministically and never stores the plaintext', () => {
    const credential = generateLookupCredential();
    const a = hashLookupCredential(credential);
    const b = hashLookupCredential(credential);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    // The hash cannot be inverted to the credential by any cheap transform.
    expect(a).not.toContain(credential);
  });

  it('normalizes only well-formed credentials', () => {
    const credential = generateLookupCredential();
    expect(normalizeLookupCredential(`  ${credential}  `)).toBe(credential);
    expect(normalizeLookupCredential('x'.repeat(65))).toBeNull();
    expect(normalizeLookupCredential('bad credential!')).toBeNull();
    expect(normalizeLookupCredential(42)).toBeNull();
    expect(normalizeLookupCredential('')).toBeNull();
  });
});

describe('order numbers (non-sequential, unambiguous)', () => {
  it('generates a SHY- prefixed readable number', () => {
    const number = generateOrderNumber();
    expect(number).toMatch(/^SHY-[A-HJKMNP-TV-Z2-9]{10}$/);
  });

  it('produces distinct numbers', () => {
    expect(generateOrderNumber()).not.toBe(generateOrderNumber());
  });
});

describe('provider intent ids', () => {
  it('are namespaced per gateway and unique', () => {
    expect(newProviderIntentId('simulated')).toMatch(/^sim_/);
    expect(newProviderIntentId('stripe-test')).toMatch(/^pi_/);
    expect(newProviderIntentId()).not.toBe(newProviderIntentId());
  });
});

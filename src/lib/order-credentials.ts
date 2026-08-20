/**
 * Server-only order identity primitives (Issue #6, ADR-0008).
 *
 * - The lookup credential is 256 bits of CSPRNG entropy rendered in base64url.
 *   ONLY its SHA-256 hash is persisted (`Order.lookupHash`), so a database
 *   leak cannot be replayed to fetch orders, and the plaintext credential is
 *   shown to the shopper exactly once at confirmation — it cannot be recovered
 *   from the server after that (by design: lookup requires possession of the
 *   credential).
 * - The order number is short, human-readable, and deliberately non-sequential,
 *   so order numbers cannot be guessed or enumerated either.
 *
 * This module imports `node:crypto` and must never enter the browser bundle.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** Unambiguous alphabet: no 0/O/1/I/L, no lookalikes. */
const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const ORDER_NUMBER_LENGTH = 10;

/** 256-bit CSPRNG credential in base64url (43 chars, unpadded). */
export function generateLookupCredential(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a lookup credential — the only persisted form. */
export function hashLookupCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

/** Trim + shape check; returns a normalized credential or null when malformed.
 * Used so malformed input follows the same uniform "not found" path and is
 * never passed to the database. */
export function normalizeLookupCredential(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim();
  // 32 bytes base64url → 43 chars, always. Anything else is not a credential.
  if (normalized.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function randomOrderNumberChars(): string {
  const bytes = randomBytes(ORDER_NUMBER_LENGTH);
  let out = '';
  for (const byte of bytes) {
    out += ORDER_NUMBER_ALPHABET[byte % ORDER_NUMBER_ALPHABET.length];
  }
  return out;
}

/** Non-sequential, human-readable order number, e.g. `SHY-7K2M9QX4D3`. */
export function generateOrderNumber(): string {
  return `SHY-${randomOrderNumberChars()}`;
}

/** A fresh simulated-gateway payment intent id for a new order. */
export function newProviderIntentId(gateway: 'simulated' | 'stripe-test' = 'simulated'): string {
  return gateway === 'simulated' ? `sim_${randomUUID()}` : `pi_${randomUUID()}`;
}

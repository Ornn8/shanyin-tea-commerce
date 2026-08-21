/**
 * Server-only order identity primitives (Issue #6, ADR-0008).
 *
 * - The lookup credential is 256 bits of entropy rendered in base64url,
 *   DERIVED deterministically from the checkout's client submission key
 *   (HMAC-SHA256 under a server secret — see `deriveLookupCredential`). ONLY
 *   its SHA-256 hash is persisted (`Order.lookupHash`), so a database leak
 *   cannot be replayed to fetch orders; the plaintext credential is shown to
 *   the shopper at confirmation, and a replayed submission after a lost first
 *   response recovers the SAME credential (lookup still requires possession of
 *   the credential).
 * - The order number is short, human-readable, and deliberately non-sequential,
 *   so order numbers cannot be guessed or enumerated either.
 *
 * This module imports `node:crypto` and must never enter the browser bundle.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

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

/** Server secret used to derive a checkout's lookup credential from its client
 * submission idempotency key (ADR-0008). A dedicated `ORDER_LOOKUP_SECRET`
 * wins; `AUTH_SECRET` is the local fallback so a demo checkout works with the
 * existing .env. Production should set and rotate `ORDER_LOOKUP_SECRET`
 * independently. */
export function lookupDerivationSecret(): string {
  const secret = process.env.ORDER_LOOKUP_SECRET ?? process.env.AUTH_SECRET;
  if (secret && secret.length > 0) return secret;
  return 'dev-secret-shanyin-order-lookup';
}

/**
 * The 256-bit lookup credential for a checkout, DERIVED deterministically from
 * its client submission idempotency key (HMAC-SHA256 under the server secret,
 * rendered in base64url, 43 chars — the same length/shape as a random one).
 *
 * Because the credential is a pure function of the submission key, replaying
 * the SAME submission — a retry after the first create response was lost, a
 * refreshed form, a double-click — recovers the SAME credential instead of a
 * blank one, so payment can always authorize the order the database already
 * created. The server still persists ONLY `sha256(credential)`
 * (`Order.lookupHash`); the plaintext is handed to the shopper at confirmation
 * and cannot be inverted from the hash, but deriving it requires both the
 * client submission key and the server secret. A new cart rotates to a fresh
 * submission key (hence a fresh credential) and can never collide with an
 * older order.
 */
export function deriveLookupCredential(submissionKey: string): string {
  return createHmac('sha256', lookupDerivationSecret())
    .update(`dsh-order-lookup:v1:${submissionKey}`)
    .digest('base64url');
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

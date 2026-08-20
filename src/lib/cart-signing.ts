/**
 * Cart cookie signing & verification (Issue #5, ADR-0007).
 *
 * SERVER-ONLY. This module owns the HMAC-SHA256 signing boundary and imports
 * `node:crypto`, so it MUST never be imported from a client component or any
 * module that enters the browser bundle graph. The browser-safe core
 * (constants, types, the canonical form, display parsing, and the pure cart
 * operations) lives in `src/lib/cart.ts`; this module layers the two wire
 * entry points that actually SIGN and VERIFY the cookie value, plus the
 * legacy header reader.
 *
 * `src/lib/cart-actions.ts` (server actions), `src/app/[locale]/cart/page.tsx`
 * (server component), the unit tests, and the Playwright spec (which runs
 * under Node.js) import `serializeCart` / `parseCart` from here. Client
 * components must import only from `src/lib/cart.ts`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CART_COOKIE,
  CART_MAX_AGE_SECONDS,
  CART_PAYLOAD_VERSION,
  EMPTY_CART,
  canonical,
  isCartItem,
  type CartItem,
  type CartPayload,
  type CartState,
} from '@/lib/cart';

// ---------------------------------------------------------------------------
// Secrets and signing
// ---------------------------------------------------------------------------

/** Key used to sign the cart payload. CART_SECRET wins; AUTH_SECRET is the
 * local fallback so a demo checkout works with the existing .env. */
export function cartSecret(): string {
  return process.env.CART_SECRET ?? process.env.AUTH_SECRET ?? 'dev-secret-shanyin-cart';
}

function signPayload(payload: CartPayload): string {
  return createHmac('sha256', cartSecret()).update(canonical(payload)).digest('base64url');
}

function verifyPayload(payload: CartPayload, signature: string): boolean {
  const expected = createHmac('sha256', cartSecret()).update(canonical(payload)).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

// ---------------------------------------------------------------------------
// Signed wire serialization (server side only)
// ---------------------------------------------------------------------------

/**
 * Serialize cart items into the signed cookie VALUE (raw JSON — not
 * percent-encoded). Next.js `cookies().set()` percent-encodes the value when
 * writing `Set-Cookie` and decodes it again on read, so pre-encoding here
 * would double-encode and break parsing: the raw JSON is the canonical wire
 * format. Client scripts read the encoded value from `document.cookie` and
 * decode it via `parseCartForDisplay`.
 */
export function serializeCart(items: CartItem[], now: number = Date.now()): string {
  const payload: CartPayload = {
    v: CART_PAYLOAD_VERSION,
    items: items.map((item) => ({ ...item })),
    exp: Math.floor(now / 1000) + CART_MAX_AGE_SECONDS,
  };
  const body = JSON.stringify({ ...payload, sig: signPayload(payload) });
  return body;
}

/**
 * Server-side read: verify the signature and expiry, sanitize items, and
 * classify the cart. An unreadable, unsigned, tampered, or expired cookie
 * returns `expired` (the cart page communicates and clears it); a missing
 * cookie returns `empty`. Next.js percent-decodes cookie values before this.
 */
export function parseCart(value: string | null | undefined, now: number = Date.now()): CartState {
  if (!value) return EMPTY_CART;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { status: 'expired', items: [] };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 'expired', items: [] };
  }
  const body = parsed as Record<string, unknown>;
  if (
    body.v !== CART_PAYLOAD_VERSION ||
    !Array.isArray(body.items) ||
    typeof body.exp !== 'number' ||
    typeof body.sig !== 'string'
  ) {
    return { status: 'expired', items: [] };
  }
  const payload: CartPayload = { v: CART_PAYLOAD_VERSION, items: body.items, exp: body.exp };
  if (!verifyPayload(payload, body.sig)) {
    return { status: 'expired', items: [] };
  }
  const items = payload.items.filter(isCartItem);
  if (payload.exp <= Math.floor(now / 1000)) {
    return { status: 'expired', items: [] };
  }
  return items.length > 0 ? { status: 'ok', items } : EMPTY_CART;
}

/** Read the cart from a raw `Cookie` request header (legacy signature kept
 * for compatibility; Next.js callers already receive decoded values). */
export function readCartCookie(cookieHeader: string | null | undefined): CartState {
  if (!cookieHeader) return EMPTY_CART;
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CART_COOKIE}=`));
  if (!match) return EMPTY_CART;
  const raw = match.slice(CART_COOKIE.length + 1);
  try {
    return parseCart(decodeURIComponent(raw));
  } catch {
    return { status: 'expired', items: [] };
  }
}

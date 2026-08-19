/**
 * Durable anonymous cart (Issue #5, ADR-0007).
 *
 * The cart persists in ONE `shanyin_cart` cookie that holds only
 * language-neutral data: SKU, quantity, a display price snapshot (integer CNY
 * cents), and the item's add timestamp. No translated strings ever enter the
 * payload (ADR-0003), so switching locale is purely presentation: the server
 * re-resolves every line with the active locale's copy and never duplicates
 * or drops lines.
 *
 * Security model
 * --------------
 * The payload is HMAC-SHA256 signed with `CART_SECRET` (falling back to
 * `AUTH_SECRET` for local development). Verification is the server's trust
 * boundary: an unsigned, tampered, or expired cookie reads back as `expired`
 * and the storefront clears it with a localized notice — a forged or stale
 * cart is never displayed. The cookie value stays readable by client
 * JavaScript so the header badge can show a count, but the server never
 * trusts an unverified payload.
 *
 * Revalidation (server-side, every render of the cart)
 * ----------------------------------------------------
 * Quantity bounds are enforced server-side: 1..CART_MAX_QTY per line, additive
 * merges capped by the current shared inventory, and quantities never exceed
 * the current stock (`src/lib/cart-service.ts`, `resolveCartItems` in
 * `src/lib/products.ts`). Clients can never set a price: the display snapshot
 * is captured from the variant row at add/update time, and any later price
 * change is reported as a localized `price-changed` issue against the current
 * price. The demo has no checkout, so there is no inventory reservation;
 * "atomic" here means one server round trip that re-validates and applies the
 * whole cart state (no client-side arithmetic is trusted).
 *
 * This module is pure (no Next.js or database imports) and unit-testable.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CART_COOKIE = 'shanyin_cart';

/** 30 days — the cart expires with its cookie and is communicated locally. */
export const CART_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Hard upper bound per line; a quantity above this is never accepted. */
export const CART_MAX_QTY = 99;

const CART_PAYLOAD_VERSION = 1 as const;

export interface CartItem {
  /** Language-neutral SKU of the exact variant added. */
  sku: string;
  /** Positive integer quantity (1..CART_MAX_QTY). */
  qty: number;
  /** Display price snapshot in integer CNY cents captured at add time. */
  priceCents: number;
  /** Epoch milliseconds when the line was first added (stable identity). */
  addedAt: number;
}

interface CartPayload {
  v: typeof CART_PAYLOAD_VERSION;
  items: CartItem[];
  /** Epoch seconds at which the cart expires. */
  exp: number;
}

export type CartReadStatus = 'empty' | 'ok' | 'expired';

export interface CartState {
  status: CartReadStatus;
  items: CartItem[];
}

export const EMPTY_CART: CartState = { status: 'empty', items: [] };

// ---------------------------------------------------------------------------
// Secrets and signing
// ---------------------------------------------------------------------------

/** Key used to sign the cart payload. CART_SECRET wins; AUTH_SECRET is the
 * local fallback so a demo checkout works with the existing .env. */
export function cartSecret(): string {
  return process.env.CART_SECRET ?? process.env.AUTH_SECRET ?? 'dev-secret-shanyin-cart';
}

/** Deterministic canonical form of the payload (stable field order, no raw
 * newlines): the JSON text of the items array plus version and expiry. */
function canonical(payload: CartPayload): string {
  return `v=${payload.v}|exp=${payload.exp}|items=${JSON.stringify(payload.items)}`;
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
// Serialization
// ---------------------------------------------------------------------------

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.sku === 'string' &&
    item.sku.length > 0 &&
    Number.isSafeInteger(item.qty) &&
    (item.qty as number) >= 1 &&
    (item.qty as number) <= CART_MAX_QTY &&
    Number.isSafeInteger(item.priceCents) &&
    (item.priceCents as number) >= 0 &&
    typeof item.addedAt === 'number' &&
    Number.isFinite(item.addedAt)
  );
}

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

/**
 * Client-side display read for the header badge: extracts the `shanyin_cart`
 * value from the full `document.cookie` string and parses it WITHOUT signature
 * verification — the count is presentation only and the server is
 * authoritative. Decoding is lenient: an already-raw (unencoded) value passes
 * through unchanged.
 */
export function readCartForDisplay(documentCookie: string): CartItem[] {
  const part = documentCookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${CART_COOKIE}=`));
  if (!part) return [];
  return parseCartForDisplay(part.slice(CART_COOKIE.length + 1));
}

/**
 * Decode and parse a raw (percent-encoded) cart cookie VALUE. The signature is
 * NOT verified here — the count is for display only.
 */
export function parseCartForDisplay(rawEncoded: string | undefined | null): CartItem[] {
  if (!rawEncoded) return [];
  let body: unknown = null;
  try {
    body = JSON.parse(decodeURIComponent(rawEncoded));
  } catch {
    return [];
  }
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { items?: unknown }).items)) {
    return [];
  }
  const items = (body as { items: unknown[] }).items;
  return items.filter(isCartItem);
}

// ---------------------------------------------------------------------------
// Pure cart operations (bounds enforced here; DB revalidation happens in the
// service layer against current inventory before these are applied).
// ---------------------------------------------------------------------------

export function totalQuantity(state: CartState): number {
  return state.items.reduce((sum, item) => sum + item.qty, 0);
}

/** Add `qty` of `sku` (qty is already server-validated 1..CART_MAX_QTY and
 * capped by inventory). An existing line's snapshot and addedAt are kept so
 * `price-changed` detection compares against the price the visitor first
 * saw; a new line stores the current variant price as its snapshot. */
export function addItem(state: CartState, sku: string, qty: number, priceCents: number): CartState {
  const clean = state.status === 'ok' ? state.items : [];
  const existing = clean.find((item) => item.sku === sku);
  const items = existing
    ? clean.map((item) =>
        item.sku === sku
          ? { ...item, qty: Math.min(item.qty + qty, CART_MAX_QTY) }
          : item,
      )
    : [...clean, { sku, qty: Math.min(qty, CART_MAX_QTY), priceCents, addedAt: Date.now() }];
  return items.length > 0 ? { status: 'ok', items } : EMPTY_CART;
}

/** Replace a line's quantity (server-validated 1..CART_MAX_QTY); a qty <= 0
 * removes the line. Unknown SKUs are a no-op. */
export function setItemQuantity(state: CartState, sku: string, qty: number): CartState {
  if (!Number.isSafeInteger(qty) || qty > CART_MAX_QTY) return state;
  const clean = state.status === 'ok' ? state.items : [];
  if (qty <= 0) {
    return removeItem(state, sku);
  }
  const items = clean.map((item) => (item.sku === sku ? { ...item, qty } : item));
  return items.length > 0 ? { status: 'ok', items } : EMPTY_CART;
}

/** Remove a line (unknown SKU is a no-op). */
export function removeItem(state: CartState, sku: string): CartState {
  const clean = state.status === 'ok' ? state.items : [];
  const items = clean.filter((item) => item.sku !== sku);
  return items.length > 0 ? { status: 'ok', items } : EMPTY_CART;
}
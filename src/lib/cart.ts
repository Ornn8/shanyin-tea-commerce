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
 * THIS MODULE IS BROWSER-SAFE AND IS SAFE TO IMPORT ANYWHERE: it carries no
 * Node.js, Next.js, or database imports, so client components (the badge and
 * the cart shell), server components, and unit tests all share it. The HMAC
 * signing/verification boundary lives in `src/lib/cart-signing.ts` (server
 * only — it imports `node:crypto`), which provides the signed wire functions
 * `serializeCart` / `parseCart`. That module must never be imported from the
 * browser graph.
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
 */

export const CART_COOKIE = 'shanyin_cart';

/** 30 days — the cart expires with its cookie and is communicated locally. */
export const CART_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Hard upper bound per line; a quantity above this is never accepted. */
export const CART_MAX_QTY = 99;

export const CART_PAYLOAD_VERSION = 1 as const;

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

/** Wire payload shape. Exported for the server-only signing module. */
export interface CartPayload {
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

/** Deterministic canonical form of the payload (stable field order, no raw
 * newlines): the JSON text of the items array plus version and expiry. The
 * server-only signing module HMACs this exact form, so it must stay stable
 * across serialize/parse. Exported for `src/lib/cart-signing.ts`. */
export function canonical(payload: CartPayload): string {
  return `v=${payload.v}|exp=${payload.exp}|items=${JSON.stringify(payload.items)}`;
}

/** Sanity filter for deserialized lines; shared by the server-only signing
 * module and the display-only parsers. */
export function isCartItem(value: unknown): value is CartItem {
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

// ---------------------------------------------------------------------------
// Display-only client parsing (header badge)
// ---------------------------------------------------------------------------
//
// The badge reads the signed cookie WITHOUT verifying it — presentation only,
// and the server is authoritative on every cart render and mutation. These
// functions are the only ones client components import from this module, so
// the browser bundle never references `node:crypto`.

/**
 * Client-side display read for the header badge: extracts the `shanyin_cart`
 * value from the full `document.cookie` string and parses it WITHOUT signature
 * verification — the count is presentation only and the server is
 * authoritative. Decoding is lenient: an already-raw (unencoded) value passes
 * through unchanged.
 *
 * The badge must never contradict the storefront's state: a cookie the server
 * classifies as expired or void (missing version, signature, or expiry) is
 * treated as empty here too, so an expired cart being reported as cleared on
 * the cart page is not shown as a stale count elsewhere on every reload.
 */
export function readCartForDisplay(documentCookie: string, now: number = Date.now()): CartItem[] {
  const part = documentCookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${CART_COOKIE}=`));
  if (!part) return [];
  return parseCartForDisplay(part.slice(CART_COOKIE.length + 1), now);
}

/**
 * Decode and parse a raw (percent-encoded) cart cookie VALUE for the header
 * badge. The signature is NOT verified here — the count is display-only and
 * the server is authoritative. But the readable envelope (version, presence
 * of a signature, and the expiry) IS honored, so an expired or void payload
 * reads as empty rather than as a stale count (a signed, unexpired payload
 * always carries those fields).
 */
export function parseCartForDisplay(
  rawEncoded: string | undefined | null,
  now: number = Date.now(),
): CartItem[] {
  if (!rawEncoded) return [];
  let body: unknown = null;
  try {
    body = JSON.parse(decodeURIComponent(rawEncoded));
  } catch {
    return [];
  }
  if (typeof body !== 'object' || body === null) return [];
  const record = body as { v?: unknown; sig?: unknown; exp?: unknown; items?: unknown };
  if (
    record.v !== CART_PAYLOAD_VERSION ||
    typeof record.sig !== 'string' ||
    record.sig.length === 0 ||
    typeof record.exp !== 'number' ||
    !Array.isArray(record.items)
  ) {
    return [];
  }
  // A payload the server would classify as expired must not count either.
  if (record.exp <= Math.floor(now / 1000)) return [];
  return record.items.filter(isCartItem);
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

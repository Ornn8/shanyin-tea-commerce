/**
 * Cart mutation service (Issue #5, ADR-0007).
 *
 * Every mutation is one server round trip that re-reads the live variant row
 * (publication state, price, shared inventory) before touching the cart, so:
 *
 * - unknown or unpublished SKUs are rejected (`unavailable`) or dropped;
 * - quantities are bounded 1..CART_MAX_QTY and never exceed the CURRENT
 *   inventory, so no mutation can describe more stock than exists;
 * - the display price snapshot always comes from the variant row at write
 *   time — client-supplied prices are ignored;
 * - additive merges are capped by remaining inventory.
 *
 * There is no checkout in this demo, hence no inventory reservation; the
 * guarantee is that the cart state itself never exceeds the shared facts at
 * the moment of each validated write. This module is database-bound but free
 * of Next.js imports so it is integration-testable directly.
 */
import { prisma } from '@/lib/prisma';
import {
  CART_MAX_QTY,
  EMPTY_CART,
  type CartItem,
  type CartState,
  addItem,
  removeItem,
  setItemQuantity,
} from '@/lib/cart';

export type CartMutationCode = 'unavailable' | 'insufficient-stock' | 'invalid-input';

export type CartMutationResult =
  | { ok: true; state: CartState }
  | { ok: false; code: CartMutationCode; message: string };

interface LiveVariant {
  sku: string;
  priceCents: number;
  inventory: number;
  published: boolean;
}

async function findLiveVariant(sku: string): Promise<LiveVariant | null> {
  if (!sku) return null;
  const variant = await prisma.productVariant.findUnique({
    where: { sku },
    select: {
      sku: true,
      priceCents: true,
      inventory: true,
      product: { select: { published: true } },
    },
  });
  if (!variant) return null;
  return {
    sku: variant.sku,
    priceCents: variant.priceCents,
    inventory: variant.inventory,
    published: variant.product.published,
  };
}

function sanitizeSku(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeQuantity(value: unknown): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const qty = value as number;
  if (qty < 1 || qty > CART_MAX_QTY) return null;
  return qty;
}

/** Cap an add by remaining inventory and the hard bound (never above stock). */
function capByStock(requested: number, inventory: number): number {
  return Math.max(0, Math.min(requested, inventory, CART_MAX_QTY));
}

/** Add `qty` of a live, published, in-stock variant to the cart. The running
 * quantity (existing + added) is capped by the CURRENT inventory and the hard
 * bound, so a merge can never describe more stock than exists; when stock has
 * dropped below what is already in the cart, the line is clamped instead. */
export async function addToCartService(
  state: CartState,
  rawSku: unknown,
  rawQty: unknown,
): Promise<CartMutationResult> {
  const sku = sanitizeSku(rawSku);
  const requested = sanitizeQuantity(rawQty);
  if (!sku || requested === null) {
    return { ok: false, code: 'invalid-input', message: 'A valid SKU and quantity are required.' };
  }
  const live = await findLiveVariant(sku);
  if (!live || !live.published) {
    return { ok: false, code: 'unavailable', message: `Variant "${sku}" is not available.` };
  }
  if (live.inventory <= 0) {
    return { ok: false, code: 'insufficient-stock', message: `Variant "${sku}" is out of stock.` };
  }
  const currentLine = state.status === 'ok' ? state.items.find((item) => item.sku === sku) : undefined;
  const current = currentLine?.qty ?? 0;
  const resultQty = Math.min(current + requested, live.inventory, CART_MAX_QTY);
  if (resultQty <= current) {
    // Everything is already in the cart (or stock dropped below it): keep the
    // line but clamp to the current inventory.
    return { ok: true, state: setItemQuantity(state, sku, resultQty) };
  }
  return { ok: true, state: addItem(state, sku, resultQty - current, live.priceCents) };
}

/** Replace a line's quantity. Quantity 0 (or below) removes the line; an
 * unknown/unpublished SKU is treated as stale and dropped. The quantity is
 * clamped to the current inventory so the cart can never claim more stock
 * than exists. */
export async function setCartItemQuantityService(
  state: CartState,
  rawSku: unknown,
  rawQty: unknown,
): Promise<CartMutationResult> {
  const sku = sanitizeSku(rawSku);
  if (!sku || !Number.isSafeInteger(rawQty)) {
    return { ok: false, code: 'invalid-input', message: 'A valid SKU and quantity are required.' };
  }
  const requested = rawQty as number;
  const current = state.status === 'ok' ? state.items.find((item) => item.sku === sku) : undefined;
  if (!current) {
    // Nothing to update; a vanished line is a no-op the page re-resolves.
    return { ok: true, state };
  }
  if (requested <= 0) {
    return { ok: true, state: removeItem(state, sku) };
  }
  if (requested > CART_MAX_QTY) {
    return { ok: false, code: 'invalid-input', message: `Quantity exceeds the per-line limit of ${CART_MAX_QTY}.` };
  }
  const live = await findLiveVariant(sku);
  if (!live || !live.published) {
    // The line is stale (product unpublished/removed): drop it.
    return { ok: true, state: removeItem(state, sku) };
  }
  const bounded = capByStock(requested, live.inventory);
  return { ok: true, state: setItemQuantity(state, sku, bounded) };
}

/** Remove a line. */
export async function removeCartItemService(state: CartState, rawSku: unknown): Promise<CartMutationResult> {
  const sku = sanitizeSku(rawSku);
  if (!sku) {
    return { ok: false, code: 'invalid-input', message: 'A valid SKU is required.' };
  }
  return { ok: true, state: removeItem(state, sku) };
}

/** Drop every line. */
export async function emptyCartService(): Promise<CartMutationResult> {
  return { ok: true, state: { status: 'empty', items: [] } };
}

/**
 * Drop lines whose variant is unknown or whose product is unpublished, so a
 * stale SKU cannot keep counting in the badge or reappear after a cart
 * mutation. Runs the same publication rule as every storefront read.
 */
export async function pruneStaleState(state: CartState): Promise<CartState> {
  if (state.status !== 'ok' || state.items.length === 0) return state;
  const skus = state.items.map((item) => item.sku);
  const rows = await prisma.productVariant.findMany({
    where: { sku: { in: skus }, product: { published: true } },
    select: { sku: true },
  });
  const live = new Set(rows.map((row) => row.sku));
  const items = state.items.filter((item) => live.has(item.sku));
  return items.length > 0 ? { status: 'ok', items } : { status: 'empty', items: [] };
}

/**
 * The durable cart state the storefront should PERSIST after a read, so the
 * signed cookie never retains what the cart page has already declared
 * cleared or revalidated (ADR-0007):
 *
 *  - an expired, void, or empty cart reconciles to the empty cart (cleared);
 *  - lines whose product is unpublished or whose SKU is unknown are dropped,
 *    so they cannot reappear if the product is later re-published;
 *  - each remaining line's quantity is clamped to the CURRENT shared
 *    inventory, so a stock shortage the page reported never silently jumps
 *    back when stock is restored — the cart converges to a valid state;
 *  - a line whose variant is out of stock (inventory 0) cannot honestly hold
 *    any quantity, so it is dropped rather than stored as a claim of stock
 *    that does not exist.
 *
 * Order of surviving lines follows the cookie and sku/priceCents/addedAt
 * identity is preserved. This module is database-bound but Next.js-free so it
 * is integration-testable directly.
 */
export async function reconcileCartState(state: CartState): Promise<CartState> {
  if (state.status !== 'ok' || state.items.length === 0) return EMPTY_CART;
  const skus = state.items.map((item) => item.sku);
  // One query: published-only variants with their live inventory.
  const rows = await prisma.productVariant.findMany({
    where: { sku: { in: skus }, product: { published: true } },
    select: { sku: true, inventory: true },
  });
  const live = new Map(rows.map((row) => [row.sku, row.inventory]));
  const items: CartItem[] = [];
  for (const item of state.items) {
    const stock = live.get(item.sku);
    // Unpublished, unknown, or out-of-stock (0) variants cannot persist.
    if (stock === undefined || stock <= 0) continue;
    const qty = Math.min(item.qty, stock);
    items.push({ sku: item.sku, qty, priceCents: item.priceCents, addedAt: item.addedAt });
  }
  return items.length > 0 ? { status: 'ok', items } : EMPTY_CART;
}
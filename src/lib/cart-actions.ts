'use server';

/**
 * Cart server actions (Issue #5, ADR-0007).
 *
 * Thin wrappers over the cart service that own the signed cookie write. Each
 * action re-validates against the live variant row (publication state, price,
 * inventory) in the same round trip, then persists the whole cart state to
 * the `shanyin_cart` cookie. Errors return plain codes the client maps onto
 * localized copy — the server never formats translated strings.
 */
import { cookies } from 'next/headers';
import {
  CART_COOKIE,
  CART_MAX_AGE_SECONDS,
  type CartItem,
  type CartState,
} from '@/lib/cart';
import { parseCart, serializeCart } from '@/lib/cart-signing';
import {
  addToCartService,
  emptyCartService,
  pruneStaleState,
  reconcileCartState,
  removeCartItemService,
  setCartItemQuantityService,
  type CartMutationResult,
} from '@/lib/cart-service';

/** True when every field of two item lists is identical (order matters). */
function sameItems(a: CartItem[], b: CartItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].sku !== b[i].sku ||
      a[i].qty !== b[i].qty ||
      a[i].priceCents !== b[i].priceCents ||
      a[i].addedAt !== b[i].addedAt
    ) {
      return false;
    }
  }
  return true;
}

export type CartActionResult = CartMutationResult;

async function readCurrentState(): Promise<CartState> {
  const store = await cookies();
  const value = store.get(CART_COOKIE)?.value;
  // Next.js percent-decodes cookie values before exposing them; prune lines
  // whose product was unpublished/removed so a stale SKU is written back only
  // as long as it remains valid.
  return pruneStaleState(parseCart(value));
}

async function writeState(state: CartState): Promise<void> {
  const store = await cookies();
  const items: CartItem[] = state.status === 'ok' ? state.items : [];
  store.set(CART_COOKIE, serializeCart(items), {
    path: '/',
    maxAge: CART_MAX_AGE_SECONDS,
    sameSite: 'lax',
  });
}

export async function addToCartAction(rawSku: unknown, rawQty: unknown): Promise<CartActionResult> {
  const state = await readCurrentState();
  const result = await addToCartService(state, rawSku, rawQty);
  if (result.ok) {
    await writeState(result.state);
  }
  return result;
}

export async function setCartItemQuantityAction(
  rawSku: unknown,
  rawQty: unknown,
): Promise<CartActionResult> {
  const state = await readCurrentState();
  const result = await setCartItemQuantityService(state, rawSku, rawQty);
  if (result.ok) {
    await writeState(result.state);
  }
  return result;
}

export async function removeCartItemAction(rawSku: unknown): Promise<CartActionResult> {
  const state = await readCurrentState();
  const result = await removeCartItemService(state, rawSku);
  if (result.ok) {
    await writeState(result.state);
  }
  return result;
}

export async function emptyCartAction(): Promise<CartActionResult> {
  const result = await emptyCartService();
  if (result.ok) {
    await writeState(result.state);
  }
  return result;
}

export interface CartReconcileResult {
  ok: true;
  /** True when the cookie was rewritten or cleared because the read state
   * differed from the persisted state (expired/void, pruned, or clamped). */
  changed: boolean;
}

/**
 * Persist the cart state the page already revalidated (ADR-0007): clears an
 * expired, tampered, or void cookie, prunes unpublished/unknown lines, and
 * clamps remaining quantities to the CURRENT inventory — so the signed cookie
 * never retains state the storefront reported as cleared, and revealed
 * shortages cannot reappear after stock is restored. It is a no-op when the
 * persistence already matches the revalidated state, so it is safe to call on
 * every cart view. All writes go through this server action (Next.js disallows
 * cookie mutation during a Server Component render).
 *
 * Two layers keep this from fighting a newer user action:
 *
 *  1. The cart shell SERIALIZES this action against user mutations (ADR-0007):
 *     the reconcile never starts while a mutation is in flight, the cart
 *     controls are disabled while a reconcile is in flight, and this action
 *     only fires when the render actually surfaced something to persist
 *     (expired/void, dropped line, or a stock clamp), so an untouched render
 *     issues no competing write at all. At most one cookie write is ever in
 *     flight per cart view, so the request-time cookie snapshot cannot be
 *     ordered under a mutation that shares it.
 *  2. The write is still compare-and-set as a backstop: the cart page passes
 *     the exact decoded cookie value this render was built from
 *     (`expectedCookieValue`); if the cookie differs by the time this request
 *     is processed (e.g. a concurrent tab rewrote it), the action skips the
 *     write and reports no change, so a stale snapshot can never win.
 */
export async function reconcileCartAction(
  expectedCookieValue?: string | null,
): Promise<CartReconcileResult> {
  const store = await cookies();
  const currentValue = store.get(CART_COOKIE)?.value;
  // Guarded write: only reconcile-and-persist when nothing changed the cookie
  // since the dispatching render read it. A newer state always wins.
  if (currentValue !== expectedCookieValue) {
    return { ok: true, changed: false };
  }
  const parsed = parseCart(currentValue);
  const reconciled = await reconcileCartState(parsed);
  const currentItems: CartItem[] = parsed.status === 'ok' ? parsed.items : [];
  const changed =
    parsed.status !== reconciled.status || !sameItems(currentItems, reconciled.items);
  if (changed) {
    if (reconciled.items.length === 0) {
      store.delete(CART_COOKIE);
    } else {
      store.set(CART_COOKIE, serializeCart(reconciled.items), {
        path: '/',
        maxAge: CART_MAX_AGE_SECONDS,
        sameSite: 'lax',
      });
    }
  }
  return { ok: true, changed };
}
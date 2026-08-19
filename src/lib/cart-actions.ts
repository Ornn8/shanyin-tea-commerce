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
  parseCart,
  serializeCart,
  type CartItem,
  type CartState,
} from '@/lib/cart';
import {
  addToCartService,
  emptyCartService,
  pruneStaleState,
  removeCartItemService,
  setCartItemQuantityService,
  type CartMutationResult,
} from '@/lib/cart-service';

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
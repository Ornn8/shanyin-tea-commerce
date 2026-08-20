/**
 * Cross-tab cart mutation lock (Issue #5, ADR-0007).
 *
 * Every cart server action (`src/lib/cart-actions.ts`) is a read-modify-write
 * on the ONE signed `shanyin_cart` cookie: the server reads the request's
 * cookie snapshot, re-validates and mutates the in-memory cart, then
 * `Set-Cookie` replaces the WHOLE value. Two same-origin browsing contexts
 * (tabs, windows) racing those round trips can each start from the same
 * snapshot, and the last `Set-Cookie` then silently drops the other mutation
 * — for example two product tabs adding different SKUs lose one of the two
 * additions. The server cannot serialize this on its own: an action only ever
 * sees its own request's cookie snapshot, and the cart is deliberately
 * cookie-only (no server-side cart table, ADR-0007), so a request-local
 * compare-and-set cannot even detect a concurrent tab that started from the
 * same snapshot.
 *
 * The fix is to serialize every cart WRITE round trip at the client, across
 * ALL same-origin tabs of the storefront, using the Web Locks API
 * (`navigator.locks`). While the shared lock is held, no other browsing
 * context can *start* its own mutation: each later request is sent only after
 * the earlier response's `Set-Cookie` has already been applied to the shared
 * cookie store, so the request carries a cookie that already includes every
 * committed change and the server action merges onto it. Exactly one cookie
 * write is ever in flight across the whole storefront at a time.
 *
 * Fallback: when `navigator.locks` is unavailable (older Safari/webviews),
 * a per-context promise chain still serializes mutations within the tab. The
 * server actions always re-read the request cookie before writing, so the
 * only degradation on such a browser is that it cannot coordinate ACROSS its
 * own tabs — recorded in ADR-0007 as a non-blocking browser limitation.
 *
 * THIS MODULE IS BROWSER-SAFE (no Node.js/Next.js imports) so client
 * components can use it directly; it degrades to the queue in any Node
 * environment, which unit tests exercise.
 */

/** The one lock name shared by EVERY cart cookie write in the storefront
 * (add, quantity, remove, empty, and reconcile). Using a single name is what
 * makes unrelated actions in different tabs mutually exclusive. */
export const CART_LOCK_NAME = 'shanyin:cart-write';

// Per-context fallback queue (used only when navigator.locks is unavailable):
// serializes cart mutations within this browsing context so two mutations in
// the same tab can never interleave.
let queueTail: Promise<unknown> = Promise.resolve();

function withLocalQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task);
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Run `task` while holding the storefront-wide cart write lock, so no other
 * tab's cart mutation round trip overlaps it. Uses `navigator.locks` when the
 * browser supports it; otherwise serializes within this context.
 */
export async function withCartLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(CART_LOCK_NAME, () => task());
  }
  return withLocalQueue(task);
}

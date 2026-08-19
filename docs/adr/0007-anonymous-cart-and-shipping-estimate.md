# ADR-0007: Durable anonymous cart with a non-binding shipping estimate

- Status: Accepted
- Date: 2026-08-19

## Context

Issue #5: a visitor must be able to add, update, remove, empty, and recover
cart items across refreshes and locale switches, retaining stable SKU
identities, quantities, and price snapshots for display, plus a coarse,
clearly labeled shipping estimate in CNY — all without treating translated
strings as data. The cart must be anonymous (no account), persist "securely",
keep quantity changes server-validated, atomic, and bounded (nothing can
describe negative inventory or trust a client-supplied price), communicate
expired / unpublished / price-changed / insufficient-stock states plus the
fluid states (add, update, remove, empty) in `zh-CN`, `en`, and `ja`, change
presentation only on locale switch, and be demonstrably accessible (keyboard,
screen reader, focus restoration, long labels, Japanese line breaking) at
390×844 and 1440×900.

## Decision

**One signed, encrypted-free cookie is the cart.** The cart stays in a single
`shanyin_cart` cookie, a stateless design consistent with the current
storefront (no new table, no migration). The payload is JSON holding only
language-neutral data — SKU, quantity, an integer-cents display price snapshot
captured at add time, and the item's add timestamp — plus an expiry. It is
signed with HMAC-SHA256 (`CART_SECRET`, falling back to `AUTH_SECRET` locally)
so the server can detect any forgery or mutation: an unsigned, tampered, or
expired cookie reads back as `expired` and the storefront clears it with a
localized notice — a stale or forged cart is never displayed. The value is
percent-encoded on the wire (Next.js encodes `cookies().set` values and decodes
on read); the client badges decode it leniently **without** signature
verification purely for display, because the signing key never reaches the
browser.

The HMAC boundary is isolated so the signing key never reaches the browser
graph: `src/lib/cart.ts` is the browser-safe core (constants, types, the
canonical payload form, display parsing, and the pure cart operations — no
Node.js/Next.js/database imports), while the signed wire functions
`serializeCart` / `parseCart` live in the server-only
`src/lib/cart-signing.ts` (imports `node:crypto`). Server components, server
actions, and tests import signing from there; client components import only the
core, so the browser bundle carries no `node:crypto`.

**Every mutation is a server action that re-validates before writing.**
`src/lib/cart-actions.ts` exposes `addToCart`, `setCartItemQuantity`,
`removeCartItem`, and `emptyCart`. Each action re-reads the live variant row
(publication state, current price, shared integer inventory) and writes the
whole signed cookie in one round trip (`src/lib/cart-service.ts`). Clients
can never set a price: the snapshot always comes from the variant row. The
demo has no checkout, so "atomic" means one validated server round trip that
re-resolves and rewrites the entire cart state — no client-side arithmetic is
trusted, no checkout-time inventory reservation exists (recorded, not
blocking).

**Quantities are bounded and stock-aware.** Each line is `1..CART_MAX_QTY`
(99). Additive merges are capped by the CURRENT inventory (8 + 6 against
stock 10 lands at 10), a quantity update clamps to the current inventory, and
stale lines whose product was unpublished or removed are pruned before any
write (`pruneStaleState`). Nothing in the cart can ever claim more stock than
the shared fact holds at the moment of the last validated write.

**The page re-resolves on every render, and the revalidated state is
persisted.** `resolveCartItems` (`src/lib/products.ts`) is called on every cart
render: lines whose product is unpublished/unknown are dropped and announced
in localized copy; a line whose stored quantity exceeds the live inventory is
clamped (`effectiveQty`) and flagged; a line whose snapshot price differs from
the live price is flagged. Cookie order is preserved and copy is picked per
locale (ADR-0003), so locale switching is presentation only — lines are never
duplicated or dropped by locale and SKU identity is stable.

On each cart view, the client shell calls a `reconcileCartAction` server
action (`src/lib/cart-actions.ts`) that persists exactly what the page just
revalidated (`reconcileCartState` in `src/lib/cart-service.ts`): an expired,
void, or empty cookie is **deleted** (no longer merely hidden); unpublished or
unknown lines are pruned from the cookie so they cannot reappear after
re-publication; and each surviving line's stored quantity is clamped to the
current shared inventory so a shortage the page reported never silently jumps
back when stock is restored. A line whose variant is out of stock (0) cannot
honestly hold a quantity, so it is dropped. The action is idempotent — a
cookie that already matches is left untouched, so it is safe to run on every
view. Cookie mutation is a Server Action in Next.js, so this persistence is
deliberately not done during the render itself.

Reconciliation is serialized against the shopper's own mutations, so a
background write can never fight a newer action. The server action's
compare-and-set guard alone is NOT sufficient: each request sees only its own
cookie snapshot, so a mount-time reconcile and a mutation that both start from
the same render can each pass the guard and race — if the reconcile response is
applied last, its `Set-Cookie` overwrites the newer mutation. The client shell
therefore makes the two writes mutually exclusive (at most one cookie write in
flight per cart view):

- **Gating** — the page only asks for reconciliation when this render actually
  surfaced something to persist (an expired/void cookie, a dropped line, or a
  stock clamp). A plain revalidation render issues no competing cookie write.
- **Mutual exclusion / serialization** — the reconcile never starts while a
  user mutation is in flight (it yields: the mutation owns the cookie and
  rewrites it from a fresh read, and the refreshed render re-evaluates), and no
  mutation can start while a reconcile is in flight (the cart controls are
  disabled for the brief reconcile). With at most one write in flight, the
  reconcile's request-time cookie snapshot can never be ordered under a
  mutation that shares it, so a reconcile can never resurrect a removed item or
  undo a new quantity.
- **Compare-and-set (backstop)** — the shell still passes this render's exact
  cookie value to `reconcileCartAction`; if the cookie has since been rewritten
  (e.g. a concurrent tab), the action skips its write and reports no change, so
  a stale snapshot can never win.

**Every cart write is serialized across all tabs of the storefront.** Each cart
action is a read-modify-write on its request's own cookie snapshot, so two
same-origin browsing contexts (tabs) that start from the same snapshot and each
rewrite the whole cookie let the LAST `Set-Cookie` silently drop the other
mutation — two product tabs adding different SKUs lose one addition. A
server-side guard cannot fix this: an action only ever sees its own request's
cookie, and the cart is deliberately cookie-only (no shared server-side cart
table). The storefront therefore places EVERY cart cookie write — add-to-cart,
quantity, remove, empty, and the background reconcile — behind ONE client-side
lock (`withCartLock`, `src/lib/cart-lock.ts`) backed by the Web Locks API
(`navigator.locks`): while the lock is held no other tab can even start its
mutation, so each later request is sent only after the earlier response's
`Set-Cookie` has been applied and carries every committed change, which the
action then re-reads and merges onto. One cookie write is ever in flight at a
time across all tabs. On browsers without `navigator.locks` (older
Safari/webviews) the lock degrades to per-tab serialization; the action's
request-time re-read still prevents data corruption, and cross-tab races on
those browsers are a recorded, non-blocking limitation.

**Subtotal + clearly labeled non-binding shipping estimate.** Totals use
revalidated prices and effective quantities in integer CNY cents. The shipping
estimate (`src/lib/shipping-estimate.ts`) is a deterministic demo rule —
¥12.00 below ¥200.00, free at/over it — always labeled
"shipping estimate (non-binding)" and never presented as a quote. The cart
page shows the subtotal, the estimate, a free-shipping note when eligible,
and an estimated total, with `product.cartDemoNote` restated as
"Demo cart — no checkout".

**Accessibility.** Quantity steppers are native buttons with localized
`aria-label`s (decrease/increase per product name), the current quantity is a
labeled value, an `aria-live="polite"` region announces quantity/removal
changes, and removing a line restores focus to the cart heading
(`tabIndex={-1}`). Long product names wrap (`overflow-wrap: anywhere` on the
name/meta; the global `overflow-wrap: break-word` keeps CJK and Japanese
native per-character breaking), so a Japanese long name never overflows the
390px viewport.

## Consequences

- Anonymous carts persist ~30 days across refreshes and locale switches
  without an account; there is no server-side cart table, so carts are not
  shared across devices/browsers and `CART_SECRET` must be kept stable for
  the full cookie lifetime. Recorded, not blocking: a future checkout can
  migrate the signed cookie into a server-side cart in a transaction.
- Tampering or staleness is degraded gracefully (localized "expired" notice),
  never displayed, and the cleanup is persisted: the cart view deletes the
  void/expired cookie and the badge treats such a cookie as empty, so the
  stale count does not survive reloads.
- Two secrets now exist (`AUTH_SECRET` for sessions, `CART_SECRET` for carts),
  documented in `.env.example`/`SETUP.md` and set in CI; production must
  rotate both independently.
- The previous demo cart (a plain array of SKUs) is superseded: legacy
  unsigned cookies read back as expired and are cleared (deleted on the next
  cart view), which is communicated in localized copy.
- The header badge is client-side and reads the cookie WITHOUT verification,
  but it honors the readable envelope: an expired or void cookie counts as
  empty, so the badge never contradicts the page's "cleared" state. The badge
  may still briefly count a line whose product was unpublished until a cart
  view or mutation prunes it — recorded, not blocking.
- Reconcile persistence never fights a newer user action: it is gated to
  renders that surfaced something to persist, serialized with user mutations
  (mutually exclusive in the client shell), and its write is compare-and-set
  against the rendered cookie value as a cross-tab backstop — so a background
  reconcile cannot clobber a remove/quantity/clear that landed after the
  render.
- Every cart cookie write runs under one storefront-wide client lock
  (`withCartLock`), so no tab's mutation can be silently overwritten by a
  concurrent one from another tab; the Web Locks API serializes the
  read-modify-write round trips across same-origin tabs (per-tab serialization
  on browsers without `navigator.locks`, recorded as non-blocking).
- New unit/integration suites (`tests/unit/cart.test.ts`,
  `tests/unit/cart-lock.test.ts`, `tests/integration/cart.test.ts`) and a
  Playwright spec (`e2e/cart.spec.ts`) cover the signed model, all localized
  states, the shipping threshold, recovery, locale switching, concurrent
  stock/price changes, unpublish removal, cross-tab serialization (two tabs
  adding concurrently never lose a mutation), keyboard/live-region/focus
  behavior, long labels, and both viewports.

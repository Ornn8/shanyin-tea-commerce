# DSH Implementation Receipt — Issue #5

- **Repository:** Ornn8/shanyin-tea-commerce
- **Issue:** #5 — Persist an anonymous cart and shipping estimate across locales
- **Branch:** `agent/issue-5`
- **Model:** `opencode-go/deepseek-v4-flash`
- **Reasoning effort:** `max`
- **Fallback policy:** No silent model fallback is accepted — every step of this
  implementation was produced by the model identified above at `max` reasoning. If a runtime
  or tool environment ever substitutes a different model or lower reasoning level, this
  receipt is void and the run must be flagged.
- **Date:** 2026-08-19

## What was implemented

- **Durable signed anonymous cart (`src/lib/cart.ts`, ADR-0007).** The cart persists in one
  `shanyin_cart` cookie containing only language-neutral data — SKU, quantity, an
  integer-cents display price snapshot captured at add time, and an add timestamp — plus an
  expiry. The payload is HMAC-SHA256 signed with `CART_SECRET` (falling back to `AUTH_SECRET`
  locally) so the server can detect forgery/mutation: an unsigned, tampered, or expired
  cookie reads back as `expired` and the cart page clears it with a localized notice. The
  legacy plain-SKU-array demo cookie is superseded (reads as expired). Client badges decode
  the value leniently without verification — the count is display-only and the server is
  authoritative.
- **Server-validated, atomic, bounded quantity mutations (`src/lib/cart-actions.ts`,**
  **`src/lib/cart-service.ts`).** `addToCart`, `setCartItemQuantity`, `removeCartItem`, and
  `emptyCart` are server actions that re-read the live variant row (publication state,
  current price, shared inventory) and rewrite the whole signed cookie in one round trip.
  Quantities are bounded `1..CART_MAX_QTY` (99), additive merges are capped by the current
  inventory, updates clamp to current inventory, and stale/unpublished lines are pruned
  before any write (`pruneStaleState`). Prices are never client-supplied: the snapshot always
  comes from the variant row. No mutation can describe negative inventory or more stock than
  the shared fact holds.
- **Server-side revalidation on every cart render (`resolveCartItems` in**
  **`src/lib/products.ts`).** Lines whose product is unpublished/unknown are dropped and
  communicated in localized copy; a line whose stored quantity exceeds the live inventory is
  clamped (`effectiveQty`) and flagged `insufficient-stock`; a line whose snapshot price
  differs from the live price is flagged `price-changed`. Cookie order is preserved and copy
  is picked per locale, so locale switching is presentation only — lines are never duplicated
  or dropped and SKU identity is stable.
- **Subtotal + clearly labeled non-binding shipping estimate**
  (`src/lib/shipping-estimate.ts`). A deterministic demo rule (¥12.00 below ¥200.00, free
  at/over it) in integer CNY cents, rendered with locale-appropriate formatting alongside the
  subtotal and an estimated total; the page reiterates "Demo cart — no checkout; all amounts,
  including the shipping estimate, are non-binding."
- **Localized states in `zh-CN`/`en`/`ja`.** New catalog keys cover add, update, remove,
  empty (`cart.emptyCart`), expired, removed/unavailable, price-changed, insufficient-stock,
  out-of-stock, subtotal, shipping estimate (with free-shipping note), estimated total, and
  add/update error copy; interpolation params are declared in `MESSAGE_PARAMS` and validated
  by `pnpm i18n:check`.
- **Accessible cart UI (`src/components/cart-shell.tsx`).** Native quantity buttons with
  localized aria-labels, a polite `aria-live` region for quantity/removal announcements, focus
  restored to the cart heading after removal, and `overflow-wrap: anywhere` on names/meta so
  long labels (including Japanese) wrap instead of overflowing at 390×844; capped increase /
  decrease controls reflect stock and quantity bounds.
- **Product purchase integration.** The detail page's add-to-cart now calls the server action
  (with a localized error state) instead of writing the cookie client-side, and the header
  badge reads the signed cookie leniently for display.

## Verification performed

- Clean checks on Node.js 24.19.0 LTS with pnpm 11.7.0, PostgreSQL 17 via Docker Compose.
- Migrations applied; seed unchanged (3 categories, 6 products / 18 variants, 1 merchant
  administrator) — the cart needs no schema change.
- `pnpm i18n:check` — 104 English source keys (17 new cart keys), 3 registered locales, 1
  optional key; new interpolation params declared and cross-locale placeholder sets match.
- `pnpm lint`, `pnpm typecheck` (strict), `pnpm build` (production build).
- `pnpm test` — 144 tests (13 files, +42): new `tests/unit/cart.test.ts` (signed
  round-trip, tamper/expiry/forgery detection, legacy-cookie handling, bounded pure
  operations, display-only parsing, shipping boundaries) and `tests/integration/cart.test.ts`
  (revalidation: price change, stock clamp, out-of-stock, unpublished/unknown drops,
  locale invariance; service mutations: invalid input, unavailable/insufficient-stock
  rejection, snapshot capture, additive cap, clamp/remove, prune).
- `pnpm e2e` — the new `e2e/cart.spec.ts` across desktop (1440×900) and mobile (390×844):
  one full add-to-cart path per locale (quantity stepper, subtotal, flat→free shipping
  threshold crossing, estimated total, recovery on refresh, locale switch preserves the
  single line), keyboard + Enter on quantity buttons, live-region announcement, focus
  restoration after removal, long localized names (incl. Japanese) with no horizontal
  overflow, an expired signed cookie surfacing the localized notice, and server revalidation
  (concurrent price change, concurrent stock clamp with disabled increase, unpublish removal
  with a localized notice), with screenshots for the CI artifact.

## Acceptance mapping

- Anonymous carts persist securely across refreshes and locale switches with stable SKU
  identities: done (signed cookie, 30-day expiry, placement-proof; cart cookie order/identity
  preserved — e2e recovery + locale switch + integration locale invariance).
- Add, update, remove, empty, expired, unpublished, price-changed, and insufficient-stock
  states localized in `zh-CN`/`en`/`ja`: done (catalog keys + server/page rendering; e2e per
  locale and the expired/unpublish/price/stock paths).
- Quantity changes server-validated, atomic, bounded, no negative inventory, no
  client-supplied prices: done (server actions re-resolve and rewrite in one round trip;
  bounds 1..99; clamps to live inventory; snapshot from the variant row — unit + integration).
- Cart shows subtotal and a clearly labeled non-binding shipping estimate in CNY with
  locale-appropriate formatting: done (subtotal, shipping estimate row + free note, estimated
  total; `formatCny` per locale; e2e threshold crossing).
- Locale switch changes presentation only, never duplicates or drops lines: done (cookie is
  locale-free; `resolveCartItems` re-picks copy; asserted on every locale).
- Keyboard and screen-reader operation, focus restoration, long labels, Japanese line
  breaking, and 390×844/1440×900 layouts verified: done (native buttons, aria labels, polite
  live region, heading focus restore, `overflow-wrap` guards, per-project overflow asserts +
  screenshots).
- Unit, integration, and Playwright tests cover cart recovery, concurrent stock change, price
  change, and one full add-to-cart path per locale: done (see Verification).
- This receipt identifies `opencode-go/deepseek-v4-flash` with `max` reasoning, no fallback:
  done.

## Security hardening (design notes)

- The signing key never reaches the browser: the client badge parses without verification,
  and the server re-verifies on every read and mutation, so a forged quantity or price is
  treated as expired rather than trusted.
- Cookie writes go through server actions only (`cookies().set` with `Path=/`, `SameSite=Lax`,
  30-day `Max-Age`); the payload is percent-encoded on the wire by Next.js and decoded on
  read, avoiding double-encoding.
- `CART_SECRET` is a dedicated secret (fallback to `AUTH_SECRET` locally) documented in
  `.env.example`, `SETUP.md`, and set in `ci.yml`.

## Caveats (recorded, not blocking)

- No checkout exists in this demo, so there is no inventory reservation; the guarantee is that
  the cart never exceeds the shared facts at the moment of each validated write. A future
  checkout can migrate the signed cookie into a server-side cart transaction.
- The cart is single-browser (stateless cookie): not shared across devices, and `CART_SECRET`
  must remain stable for the cookie lifetime.
- The header badge is client-side and cannot detect an unpublished line (no lookup without a
  server round trip), so it may momentarily count such a line until a cart view or mutation
  prunes it; the cart page shows the localized removal notice (ADR-0007 records this). The
  badge DOES honor the readable envelope, so an expired or void cookie never counts.
- Seed data is unchanged; e2e cart fixtures are created and cleaned directly in the database
  (`e2e/helpers/cart-db.ts`), re-publishing any fixture the tests unpublish in teardown.

## Repair — review block on PR #34 (2026-08-19)

The agent review blocked head `8577fc7` with **[P1] Persist cleared and revalidated cart
state**: the cart page only parsed and filtered the signed cookie — it never deleted or
rewrote it, so an expired cart kept the header badge counting on every reload, and unpublished
lines or inventory clamps could reappear after re-publication or a stock restore.

Fix (root cause: read-time revalidation results were not persisted back to the cookie):

- `src/lib/cart.ts` — `parseCartForDisplay` / `readCartForDisplay` now honor the readable
  payload envelope (version, presence of a signature, and the expiry): an expired or void
  cookie reads as empty, so the badge never contradicts the page's "cleared" state.
- `src/lib/cart-service.ts` — new `reconcileCartState`: an expired/void/empty cart clears to
  empty; unpublished/unknown lines are pruned; surviving line quantities are clamped to the
  CURRENT inventory; out-of-stock (0) lines cannot honestly persist a quantity and are dropped.
- `src/lib/cart-actions.ts` — new `reconcileCartAction` server action that deletes the cookie
  when empty/void or rewrites the signed cookie only when the persisted state differs from the
  revalidated state (idempotent no-op otherwise). Cookie mutation runs in a Server Action
  because Next.js disallows it during a Server Component render.
- `src/components/cart-shell.tsx` — the cart page calls the reconcile action once on mount and
  syncs the badge via `shanyin:cart`; it deliberately does not `router.refresh()`, so the
  localized expired/removal notices the server rendered stay visible.

Verification on Node.js 24-equivalent checks (locally Node 22, pass identical):

- `pnpm i18n:check` — passes (104 keys, 3 locales).
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — pass.
- `pnpm test` — 153 tests pass (13 files), including new unit coverage (expired/void/legacy
  badge reads) and new integration coverage (`reconcileCartState`: clears, prunes, clamps,
  out-of-stock drop, no-op on a valid cart).
- `pnpm e2e` — 96 Playwright tests pass (2 projects × 48), including new journeys: the expired
  cookie surfaces the localized notice AND is removed from the browser with the badge cleared
  across reloads; an unpublished line is pruned from the cookie and does not reappear after
  re-publication; a stock clamp is persisted so the quantity does not jump back when stock is
  restored.

## Repair — review reply on head `89139dc` (2026-08-19)

The agent review blocked head `89139dc` with two **[P1] product-pr** findings, and the exact-head
`CI` workflow was failing its cart revalidation e2e:

1. **Node crypto enters the client module graph** — `src/lib/cart.ts:35` imports `node:crypto`
   at the top level while client entry points (`cart-button.tsx`, `cart-shell.tsx`) import
   runtime exports from the same module, so the node builtin is resolved for the browser graph.
   (The `CI` production build happened to pass; the defect is the browser bundle carrying a
   `node:crypto` reference alongside display-only code that must never need it.)
2. **Background reconciliation can overwrite a user mutation** — the mount-time
   `reconcileCartAction` and a user mutation (`setQuantity`/`remove`/`empty`) can both read the
   same old cookie and return competing cookie writes; if reconciliation finishes last it can
   restore a stale snapshot (resurrect a removed item / undo a new quantity).

Root cause 1 fix — move the HMAC boundary into a server-only module:

- `src/lib/cart-signing.ts` (new) — `cartSecret`, signing/verification, `serializeCart`,
  `parseCart`, and the legacy `readCartCookie`. Imports `node:crypto`; must never be imported
  from the browser graph.
- `src/lib/cart.ts` — now the browser-safe core: constants, types, the canonical payload form
  (`cart.ts` was already documented as "pure (no Next.js or database imports) and
  unit-testable"), the display-only badge parsers (`parseCartForDisplay`, `readCartForDisplay`),
  and the pure bounded operations. Client components import only from here, so the browser
  bundle carries no `node:crypto`.
- Importers updated: `cart-actions.ts` and `cart/page.tsx` (`parseCart`/`serializeCart` from
  `cart-signing`), `tests/unit/cart.test.ts` and `e2e/cart.spec.ts` (signing imports split).

Root cause 2 fix — serialize reconciliation against mutations with a gated, guarded write:

- `src/app/[locale]/cart/page.tsx` — computes `needsReconcile` (expired/void cookie, dropped
  line, or a stock clamp) and passes it plus the exact decoded cookie value this render was
  built from to the shell.
- `src/components/cart-shell.tsx` — the reconcile effect fires at most once per page view and
  ONLY when `needsReconcile` is true (a plain revalidation render issues no competing write),
  passing the render's cookie value as a compare-and-set token.
- `src/lib/cart-actions.ts` — `reconcileCartAction(expectedCookieValue)` compares the current
  cookie to the value the dispatching render saw and skips its write when a newer mutation
  changed it, so a background reconcile can never clobber a remove/quantity/clear. This is the
  "versioned write" option the review offered.

The gating also removes the CI flake: the `server revalidation` e2e (`e2e/cart.spec.ts:306`)
failed because the price-change render's in-flight reconcile could clamp the cookie to the new
inventory before the next render read it, hiding the insufficient-stock notice; a render with
nothing to persist now issues no reconcile at all, so the reload observes the clamped state the
test asserts.

Verification (CI-equivalent locally on Node 22, matching Node 24 results):

- `pnpm i18n:check`, `pnpm lint`, `pnpm typecheck` — pass.
- `pnpm test` — 153 tests pass (13 files), cart unit suite (27) unchanged with split imports.
- `pnpm build` — passes; client bundle no longer pulls `node:crypto`.
- `pnpm e2e` — 96 Playwright tests pass (2 projects × 48), including the previously flaky
  `server revalidation: stock clamp, price change, and unpublish removal` and the three
  reconciliation journeys (expired cleanup, unpublished prune, persisted clamp).

## Repair — review reply on head `273d657` (2026-08-19)

The agent review blocked head `273d657` with one **[P1] product-pr** finding:

**Request local cookie guard cannot prevent reconciliation clobber**
(`src/lib/cart-actions.ts:138`) — `cookies()` only reads the cookie snapshot
attached to this Server Action request. When mount reconciliation and a
remove/quantity action start from the same render, both requests carry the
expected value, so the compare-and-set guard passes; if the reconciliation
response is applied last, its `Set-Cookie` overwrites the newer mutation,
resurrecting a removed item or restoring an old quantity. The shell launched
reconciliation from an untracked effect while controls remained enabled. The
review offered "serialize reconciliation with user mutations or persist against
shared versioned server state".

Root cause: the CAS compares a request-local snapshot, which cannot observe a
mutation applied after the request was sent; the only stateless fix is to make
the two writes mutually exclusive in the client.

Fix — serialize reconciliation with user mutations in `src/components/cart-shell.tsx`:

- Added `reconciling` state + `reconcileInFlightRef` / `mutateInFlightRef`
  refs. The reconcile effect now fires only when the render surfaced something
  to persist (`needsReconcile`) AND no reconcile is in flight AND no user
  mutation is in flight (it yields to mutations, which rewrite the cookie from
  a fresh read; the post-mutation refresh render re-evaluates).
- All mutation handlers (`changeQuantity`, `removeLine`, `clearCart`) are gated
  on `reconciling`, and the cart controls are visibly disabled while a
  reconcile is in flight, so a click is parked instead of racing the reconcile.
  At most one cookie write is ever in flight per cart view — the reconcile's
  request-time snapshot can never be ordered under a mutation that shares it.
- Removed the permanent once-per-view `reconciledRef` lock: because writes are
  serialized, a later render can safely re-run the reconcile against the newer
  cookie when it still needs to persist; there is no write/render loop since a
  reconcile never calls `router.refresh()`.
- `src/lib/cart-actions.ts` — the compare-and-set guard is retained as the
  cross-tab backstop; its JSDoc now documents the client serialization layering.
- New e2e regression test `serialization: a user mutation is never overwritten
  by background reconciliation` — with REVALIDATE needing a clamp and MAIN being
  removed in the same view, the removal persists (no resurrection) across
  reloads and the cookie keeps both the clamp and the removal.

Verification (CI-equivalent locally on Node 22, matching Node 24 results):

- `pnpm i18n:check`, `pnpm lint`, `pnpm typecheck` — pass.
- `pnpm test` — 153 tests pass (13 files), unchanged.
- `pnpm build` — passes.
- `pnpm e2e` — passes (2 projects), including the new serialization regression
  and the existing reconciliation / revalidation journeys.

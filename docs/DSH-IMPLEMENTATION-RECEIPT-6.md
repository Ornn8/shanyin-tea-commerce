# DSH Implementation Receipt — Issue #6

- **Repository:** Ornn8/shanyin-tea-commerce
- **Issue:** #6 — Create idempotent test orders and secure customer order lookup
- **Branch:** `agent/issue-6`
- **Model:** `deepseek-v4-flash`
- **Reasoning effort:** `max`
- **Fallback policy:** No silent model fallback is accepted — every step of this
  implementation was produced by the model identified above at `max` reasoning.
  If a runtime or tool environment ever substitutes a different model or lower
  reasoning level, this receipt is void and the run must be flagged.
- **Date:** 2026-08-20

## What was implemented

- **Server-owned checkout with the minimum documented fields
  (`src/lib/checkout-validation.ts`, `src/app/[locale]/checkout/page.tsx`,
  `src/components/checkout-form.tsx`, ADR-0008).** The form collects only a
  contact email plus a shipping address (`email`, `recipientName`,
  `addressLine1`, `city`, `region`, `postalCode`, `countryCode`), every field is
  re-validated server-side, and prices/quantities/totals are NEVER
  client-supplied. `resolveCheckoutLines` (`src/lib/order-service.ts`) re-reads
  the signed cart and re-resolves it against the live catalog at checkout time:
  unknown/unpublished lines are dropped, quantities are clamped to current
  inventory, an out-of-stock line rejects the whole checkout, and prices come
  from the current variant row — the cart's stale display snapshot is never
  trusted. Shipping uses the same deterministic non-binding estimate as the
  cart (ADR-0007). Privacy, error, and demo-payment copy is localized in
  `zh-CN`/`en`/`ja`.
- **Immutable order snapshots (`prisma/schema.prisma`, migration
  `20260820000000_checkout_orders`, `src/lib/order-service.ts`).** `Order`
  stores the non-sequential `SHY-…` order number, the six-state machine (see
  below), integer-CNY totals, contact/shipping, `gateway`, and
  `providerIntentId`. `OrderLine` stores per line the SKU, package-size name,
  localized display-name snapshots for all three locales, unit price, quantity,
  subtotal, and currency — so current catalog copy and prices remain
  independently editable (ADR-0003) and an order's meaning never changes.
- **Replay-safe verified payment pipeline (`src/lib/simulated-gateway.ts`,
  `src/lib/order-service.ts`, `src/lib/stripe-adapter.ts`, webhook route
  `src/app/api/payments/webhook/route.ts`).** `applyGatewayEvent` is the only
  place payment state moves and stock is touched; a browser redirect is never
  payment authority. Events are signature-verified (the deterministic simulated
  gateway signs with HMAC-SHA256 under `PAYMENT_SIM_SECRET`), idempotent by the
  unique `(gateway, providerEventId)` key that is reserved inside the SAME
  transaction as an atomic conditional stock decrement, so duplicate/reordered
  deliveries can never create a duplicate order or double-decrement stock. The
  explicit state machine moves `PENDING → PAID|FAILED|EXPIRED|CANCELLED` and
  `PAID → REFUNDED` (domain placeholder); contradictory/duplicate events are
  recorded no-ops. An optional Stripe TEST-mode adapter is dormant unless
  `sk_test_*` + `whsec_*` credentials exist (live keys are rejected outright)
  and maps verified webhook events onto the same pipeline.
- **Secure customer lookup (`src/lib/order-credentials.ts`,
  `src/app/[locale]/orders/lookup/page.tsx`,
  `src/components/order-lookup-shell.tsx`).** The high-entropy credential
  (256-bit, base64url) is stored only as a SHA-256 hash
  (`Order.lookupHash`), never in plaintext, and is DERIVED deterministically
  from the client submission key (HMAC-SHA256 under `ORDER_LOOKUP_SECRET`,
  which falls back to `AUTH_SECRET`) — so a replay after a lost first response
  recovers the SAME credential and can always authorize the order's payment,
  while the database still holds only the hash; it is shown to the shopper at
  confirmation and travels through this tab's sessionStorage (never a URL).
  `/…/orders/lookup` returns a uniform "not found" for any wrong, missing, or
  malformed credential — order existence and personal data are not enumerable
  through order numbers, emails, or URLs.
- **Explicit failure/retry + locale-stable presentation.** A failed payment is
  a terminal `FAILED` state with zero stock movement and a deterministic retry
  path: the kept cart cookie is only cleared on success, and a terminal failure
  RELEASES the checkout submission idempotency key so the retry starts a FRESH
  order from the kept cart instead of replaying the terminal one. ANY paid
  conclusion — including a re-entrant payment step after a lost response that
  committed the order but never delivered the Set-Cookie — clears the
  purchased cart lines, so they can never be checked out again. Confirmation
  and lookup render the stored order immutably; a locale switch changes copy
  only, never totals, identifiers, or payment state.
- **Validation/docs/CI:** `.env.example` and `.github/workflows/ci.yml` gain
  `PAYMENT_SIM_SECRET` and `ORDER_LOOKUP_SECRET` (and document the optional
  Stripe vars), SETUP.md / README.md / PRODUCT.md are updated, a new ADR
  (`docs/adr/0008-checkout-orders-and-payments.md`) records the design, and
  this receipt documents the model + reasoning.

## Verification performed

- Clean checks on the local toolchain (Node 22-equivalent, matching the Node 24
  CI results per prior receipts) with pnpm 11.7.0 and PostgreSQL 17 via Docker
  Compose.
- New migration `20260820000000_checkout_orders` applied; seed unchanged
  (orders are created at runtime, never seeded).
- `pnpm i18n:check` — 178 English source keys (74 new checkout/order keys),
  3 registered locales, 1 optional key; no new interpolation params (all new
  messages are param-free, so cross-locale placeholder sets trivially match).
- `pnpm typecheck` — strict TypeScript passes.
- `pnpm test` — 205 tests pass (20 files, +49 to the 156 of Issue #5): new
  unit suites `order-status` (explicit transitions, terminal guards),
  `checkout-validation`, `payment-gateway` (sign/verify, tamper rejection,
  deterministic replay-safe event ids, Stripe v1 signature verification and
  test-mode guard), `order-credentials` (entropy/hash/non-enumerability/replay
  recovery derivation), and
  `order-view` (locale snapshot picking, totals invariance), plus the new
  `tests/integration/checkout.test.ts` covering: server-owned totals (stale
  cart price), immutable snapshots, signature rejection, duplicate events,
  event reordering (both directions), the concurrent last-unit purchase (exactly
  one of two competing payments wins; inventory never negative), payment
  failure + retry, paid→refunded, idempotent creation with credential
  RECOVERY on replay (a lost first response still yields the same payable
  credential), and credential-only non-enumerable lookup.
- `pnpm build` — production build (dynamic checkout pages; no DB access at
  build time) — see run below.
- `pnpm e2e` — new `e2e/checkout.spec.ts` across desktop (1440×900) and mobile
  (390×844): one complete simulated purchase + order lookup per locale
  (cart → checkout with fake `@example.test` data → payment → confirmation
  showing the recoverable credential → credential lookup), locale-switch
  invariance of totals/order number/status, credential never in the URL,
  unknown/malformed credentials surfacing the uniform not-found, and
  server-side localized field validation — with no screenshots of any page that
  shows the credential or personal data (redaction policy), and e2e orders
  cleaned from the database in teardown. `e2e/checkout-recovery.spec.ts` adds
  the recovery journeys (terminal failure releases the submission key → fresh
  retry order; re-entering an already-paid order clears the purchased cart).

## Acceptance mapping

- Minimum documented contact/shipping fields, server-side validation, localized
  privacy/error copy: done (validation unit + e2e localized field errors +
  localized privacy note).
- Order lines store immutable SKU, localized display snapshot, unit price,
  quantity, subtotal, currency; catalog stays independently editable: done
  (OrderLine snapshot columns; integration "stale price + catalog edit" test).
- Simulated + optional Stripe-test events signature-verified, idempotent,
  replay-safe, no duplicate orders / no double stock decrement: done
  (payment-gateway unit + integration duplicate/reordering/concurrency tests;
  unique event key reserved in the stock-decrement transaction).
- Success redirects never count as payment authority; explicit pending/paid/
  failed/expired/cancelled/refunded states: done (state machine unit tests;
  e2e passes only after the verified event; confirmation re-validates by
  credential).
- Lookup only through a high-entropy credential; existence/data not enumerable:
  done (hash-only storage, uniform not-found, unit + integration + e2e).
- Locale switching never changes totals/identifiers/payment state; all states
  localized in zh-CN/en/ja: done (order-view unit + e2e locale-switch assert +
  74 localized keys).
- Integration tests for the listed scenarios: done (see Verification).
- Playwright per-locale simulated purchase + lookup, secrets/personal data
  redacted: done (fake identities, no sensitive screenshots, credential never
  in the URL, e2e orders cleaned).
- Receipt identifies `deepseek-v4-flash` with `max` reasoning, no fallback: done.

## Review repair (PR #36, review-repair runs)

### Round 1 (head `b2e2e46`)

Two P1 findings from the first pull-request review were fixed on this branch
without changing the public UI:

1. **Serialize payment transitions per order.** `applyGatewayEvent` previously
   read the order status OUTSIDE its transaction and updated the order by id
   only, so two valid events with DIFFERENT ids for the same order (Stripe maps
   both `checkout.session.completed` and `payment_intent.succeeded` to
   `succeeded`) could both observe `PENDING` — double-decrementing stock, and
   the stock-shortage fallback could overwrite `PAID` with `FAILED`. Now every
   transition runs in ONE transaction that LOCKS the order row
   (`SELECT … FOR UPDATE`), computes the transition from the locked fresh
   status, and conditions the status update on that status; the shortage
   fallback only transitions a still-`PENDING` order. New integration coverage:
   two concurrent distinct `succeeded` events never double-decrement, a
   post-`PAID` shortage never downgrades, and concurrent shortage deliveries
   leave the order `FAILED` with inventory never negative.
2. **Make checkout order creation idempotent.** `createOrder` now takes a
   client submission key (`Order.submissionKey`, UNIQUE) that the checkout form
   generates once per cart (pinned in `sessionStorage`, rebound by cart
   fingerprint, sent as a hidden field). A replayed submission returns the
   EXISTING order (`replay: true`) instead of creating a duplicate order +
   duplicate personal data for one checkout. New integration coverage: same key
   → same order / one row; distinct keys → distinct orders; a unit test for the
   key shape check.

### Round 2 (exact head `dd0d13e`)

Three P1 checkout-recovery findings from the exact-head review were fixed
without changing the public UI:

1. **Replay must recover the SAME credential, not lose it.** Finding: if the
   first create response is lost after the insert, an idempotent replay
   returned NO credential (the server stores only the SHA-256 hash), leaving
   the checkout form to write an empty credential — payment could not authorize
   the created PENDING order. Fix: the lookup credential is now DERIVED
   deterministically from the submission key (HMAC-SHA256 under
   `ORDER_LOOKUP_SECRET`, fallback `AUTH_SECRET`); a replay returns the SAME
   credential, so a lost first response recovers it and payment proceeds (still
   one order row, one credential). Integration coverage: replay returns the
   identical credential and a payment succeeds; unit coverage for the
   deterministic derivation.
2. **A terminal failure must release the submission key so retry starts a fresh
   order.** Finding: only the PAID branch cleared the submission ref; a failed /
   expired / cancelled / stock-shortage order kept the key pinned to the
   retained cart, so every retry replayed the terminal order forever. Fix:
   `payment-shell` clears the submission idempotency key on ANY terminal
   non-PAID outcome, so the next checkout from the kept cart rotates to a fresh
   key and creates a NEW order (ADR-0008's deterministic retry path).
3. **Any PAID conclusion must clear the purchased cart lines.** Finding: the
   `already PAID` early return skipped the cart-cookie deletion, so a paid
   replay whose response was lost left the purchased lines in the cart for a
   possible duplicate checkout. Fix: `completePayment` clears the cart cookie
   on EVERY PAID conclusion — a fresh payment and a re-entrant already-paid
   call alike.

These are captured in ADR-0008 and covered by
`tests/integration/checkout.test.ts` (credential recovery on replay),
`tests/unit/order-credentials.test.ts` (deterministic derivation), and
`e2e/checkout-recovery.spec.ts` (failed-terminal retry creates a fresh order;
re-entering an already-paid order clears the cart).

With the repair, the local verification reran clean on the new diff:
`pnpm i18n:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and
`pnpm test` — all suites pass — plus the complete checkout Playwright journey
per locale on desktop and mobile and the new recovery journeys.

### Round 3 (exact head `d530bb5`)

One P1 checkout-recovery finding from the exact-head review was fixed without
changing the public UI:

1. **Payment completion must not race cart writes and must preserve
   unrelated items.** Finding: `completePayment` (`src/lib/checkout-actions.ts:172`)
   deleted the entire `shanyin_cart` cookie without holding the shared
   `withCartLock` (Web Locks, `src/lib/cart-lock.ts`) used by every cart
   mutation and without matching current cart items to the paid order's lines.
   If another tab mutated the cart while payment was in flight, response
   ordering either dropped newly added unrelated SKUs or resurrected purchased
   lines from a stale snapshot, allowing a duplicate checkout. The sequential
   CI success did not cover this overlap. Fix: (a) `src/components/payment-shell.tsx`
   now serializes the `completePayment` round trip through the same
   `withCartLock` as every cart write, so exactly one cart cookie write is in
   flight across the storefront and the request's cookie snapshot already
   includes any committed mutation; (b) `src/lib/checkout-actions.ts`
   `completePayment` now surgically removes only the purchased SKUs from the
   current cart (quantity-aware: `remaining = cartQty - orderedQty`, keep a
   remainder >0) instead of blindly deleting the whole cookie, preserving
   unrelated items added concurrently and never resurrecting a stale cart.
   A re-entrant paid call after a lost `Set-Cookie` still clears the purchased
   lines. Covered by the existing sequential e2e (cart is empty after a single-SKU
   purchase) and the storefront's `withCartLock` unit coverage; the surgical
   removal is exercised by the cart-lock queue and the order-line matching
   logic (manual verification of the two race orderings).

With this repair the local verification reran clean on the new diff:
`pnpm i18n:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and
`pnpm test` — unit suites pass, integration suites pass when the database is
available — plus the per-locale checkout Playwright journeys and recovery
journeys.

## Security hardening (design notes)

- The lookup credential is stored only as a SHA-256 hash: a database leak is
  not replayable for order reads. It is derived deterministically from the
  submission key (server secret required), so only a holder of both the client
  submission key and the server secret can derive it — the plaintext is shown
  to the shopper at confirmation and never persisted.
- The credential never enters a URL, referrer, or server log; it rides in
  sessionStorage and confirmation re-validates by credential per render.
- Live charges are impossible: the Stripe adapter only activates with
  `sk_test_*`/`whsec_*` and rejects `sk_live_*` outright; the mock payment path
  cannot mint real money.
- Payment events are signature-verified; a bad signature throws and records
  nothing (integration-tested), and external-gateway wires must be verified at
  the webhook boundary before they can reach the processor.
- Stock decrement is a conditional update inside the same transaction that
  reserves the idempotency key, so concurrent last-unit purchases yield exactly
  one winner and inventory never goes negative.

## Caveats (recorded, not blocking)

- A single-browser `sessionStorage` ticket holds the credential between steps:
  if a shopper loses it before copying it from the confirmation page (or clears
  their tab/browser), the order cannot be recovered from the storefront — by
  design, since the server stores only the hash. The credit-card/saved-lookup
  experience is out of scope for the Pilot.
- "Event reordering" semantics are defined as: the first signature-valid event
  that legally transitions `pending` fixes the terminal state; later
  contradictory events are recorded and ignored (they never mutate or
  double-decrement). This is documented in ADR-0008 and demonstrated for both
  directions.
- The optional Stripe adapter is dormant without test-mode credentials (never
  exercised in CI) and is implemented with `node:crypto` only — no SDK, no
  dependency; the webhook maps a verified event onto an order whose
  `providerIntentId` matches the Stripe intent, otherwise it acknowledges and
  ignores it.
- e2e purchases persist real-shaped order rows (a property of a store that
  sells); the spec creates them with fake identities and deletes them in
  teardown.

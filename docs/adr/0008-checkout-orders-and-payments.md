# ADR-0008: Pilot checkout, idempotent orders, and secure customer lookup

- Status: Accepted
- Date: 2026-08-20

## Context

Issue #6: deliver the Pilot checkout path from the anonymous cart (ADR-0007)
to an idempotently created order and a secure customer order lookup. CI uses a
deterministic simulated payment gateway; an optional Stripe test-mode adapter
may be enabled with external credentials, but live charges are forbidden in
this slice. The server owns totals, stock validation, payment state, and order
creation. Payment completion must be driven by a verified, replay-safe gateway
event rather than a browser redirect. Customer-facing checkout, confirmation,
failure, retry, and lookup surfaces must support `zh-CN`, `en`, and `ja`, and a
locale switch must never change totals, identifiers, or payment state.

## Decision

**The server owns the order; checkout collects only the minimum documented
contact + shipping fields.** The form gathers a contact email plus a shipping
address (`email`, `recipientName`, `addressLine1`, `city`, `region`,
`postalCode`, `countryCode`), re-validated server-side
(`src/lib/checkout-validation.ts`) — prices, quantities, and totals are NEVER
client-supplied. `resolveCheckoutLines` (`src/lib/order-service.ts`)
re-reads the signed cart and re-resolves it against the live catalog at
checkout time: unknown/unpublished lines are dropped, quantities are clamped to
current inventory, an out-of-stock line rejects the whole checkout, and prices
come from the current variant row — the cart's display snapshot is never
trusted (the "stale cart price" case). Shipping uses the same deterministic
non-binding estimate as the cart (ADR-0007).

**Orders are immutable snapshots with only a credential hash persisted.**
`Order` stores the language-neutral order number (`SHY-…`, non-sequential),
the six-state machine, integer-CNY totals, contact/shipping, `gateway`, and
`providerIntentId`. `OrderLine` stores, per line: the SKU, the package-size
name, localized display-name snapshots for `zh-CN`/`en`/`ja`
(`nameZhCn`/`nameEn`/`nameJa`), unit price, quantity, subtotal, and currency —
so catalog copy and prices remain independently editable (ADR-0003) and an
order's meaning never changes. The high-entropy lookup credential (256-bit
CSPRNG, base64url) is NEVER stored: only its SHA-256 is persisted
(`lookupHash`), so a database leak cannot be replayed to fetch orders, and it
is shown to the shopper exactly once at confirmation.

**Payment state changes only through verified, replay-safe gateway events.**
`applyGatewayEvent` (`src/lib/order-service.ts`) is the only place payment
state moves and stock is touched, and a browser redirect is never payment
authority. Each event is signature-verified (the simulated gateway signs with
HMAC-SHA256 under `PAYMENT_SIM_SECRET`; an optional Stripe test-mode webhook
verifies its own boundary signature and maps onto the same wire). The event is
idempotent by the unique `(gateway, providerEventId)` key, RESERVED inside the
SAME transaction as the atomic stock decrement (a conditional
`UPDATE … WHERE inventory >= qty`), so a concurrent duplicate either blocks on
the reservation or hits a unique violation and rolls back — no duplicate order,
no double-decrement. Only the explicit state machine moves
`PENDING → PAID|FAILED|EXPIRED|CANCELLED` and `PAID → REFUNDED` (domain
placeholder); a duplicate, reordered, or contradictory event is a recorded
no-op that never mutates state or stock. Failure is a real state with a
deterministic retry path (a new order from the kept cart).

**Lookup is credential-only and not enumerable.** `Order.lookupHash` is the
single public read key; a wrong, missing, or malformed credential is the same
uniform "not found" through `lookupOrder` / `getOrderViewByCredential` — order
existence and personal data are never observable through order numbers, emails,
or URLs. The credential travels through this tab's sessionStorage (never a URL
parameter), the confirmation page re-validates by credential on every render,
and local-viewing is locale-driven presentation over the stored snapshots.

## Consequences

- New schema: `Order`, `OrderLine`, `PaymentEvent`, and the `OrderStatus` enum
  (migration `20260820000000_checkout_orders`); `PaymentEvent` is an audit log
  of every signature-valid event (never the raw payload or secrets).
- Checkout is a multi-step flow: `/…/checkout` (form) → `/…/checkout/payment`
  (drives the deterministic simulated gateway) → `/…/checkout/confirmation`
  (once-only credential) and `/…/orders/lookup` (credential-only read). On
  success the cart cookie is cleared; a failed payment keeps the cart for retry.
- CI stays fully deterministic: the simulated gateway always emits a `succeeded`
  event in the happy path, and the integration suite drives `failed`/`expired`/
  `cancelled`/`refunded` plus duplicates and reordering through the same
  pipeline. Live charges are impossible: the Stripe adapter is dormant unless
  test-mode credentials (`sk_test_*` + `whsec_*`) are configured and rejects
  live keys outright.
- `CART_SECRET`, `AUTH_SECRET`, and now `PAYMENT_SIM_SECRET` are independent
  secrets; production must rotate them separately and keep the sim secret out
  of any live deployment.
- New suites: `tests/unit/order-status.test.ts`,
  `tests/unit/checkout-validation.test.ts`, `tests/unit/payment-gateway.test.ts`,
  `tests/unit/order-credentials.test.ts`, `tests/unit/order-view.test.ts`,
  `tests/integration/checkout.test.ts` (concurrent last-unit purchase, duplicate
  events, stale cart price, payment failure + retry, event reordering,
  unauthorized lookup, signature rejection), and `e2e/checkout.spec.ts` (one
  simulated purchase + lookup per locale, locale-switch invariance, redacted
  artifacts).

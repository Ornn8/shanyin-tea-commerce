# ADR-0005: Merchant administration, authentication, variants, and audit

- Status: Accepted
- Date: 2026-08-17

## Context

Issue #3: the merchant needs one protected workflow to create, edit, publish,
unpublish, and inventory-manage tea products, with localized content per
`zh-CN` / `en` / `ja`. Civilian requirements: no public registration, one
allowlisted administrator, secure server-side sessions, no duplicate SKUs,
no negative stock, no floating-point prices, no locale-specific inventory,
per-locale completeness with English fallback previews, and an audit trail
without secrets.

## Decision

**Authentication — maintained library, minimal surface.** Use
[better-auth](https://www.better-auth.com) 1.6.x (actively maintained;
peer-supported on Next.js 16, React 19, Prisma 7, Vitest 4) with the Prisma
adapter (`provider: "postgresql"`). Email/password credentials are enabled
with `disableSignUp: true` — there is no public registration endpoint in the
application, and the auth library rejects sign-up outright
(`EMAIL_PASSWORD_SIGN_UP_DISABLED`). The seed creates exactly one
allowlisted merchant administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
(env, gitignored) and keeps the scrypt hash in both `user.password` and the
`credential` account row better-auth verifies against. Sessions are
server-side rows in `Session` (7-day expiry, 1-day sliding update); the
browser holds one httpOnly cookie. The authorization guard
(`src/lib/admin/authz.ts`) additionally enforces the allowlist: a valid
session whose user is not `ADMIN_EMAIL` is rejected.

**CSRF / rate limits.** better-auth's built-in CSRF (Origin validation for
state-changing requests, plus fetch-metadata checks) stays enabled in every
environment (`advanced.disableOriginCheck: false`; better-auth would
otherwise skip origin checks under `NODE_ENV=test`). Next.js Server Actions
add their own origin checks. The built-in rate limiter is enabled everywhere
with a tighter rule for `/sign-in/email` (10 attempts / 15 min per IP; IP
from `x-forwarded-for`). Tests exercise the 403 CSRF rejection, the wrong-
origin positive control, and the 429 throttle through the real HTTP layer
(`auth.handler`).

**Variants and language-neutral facts.** A product owns shared facts (slug,
origin, form, caffeine, category) and a lifecycle state (`published`,
`publishedAt`); sellable units live in `ProductVariant` (globally unique
SKU, shared name, `priceCents` as integer minor units of CNY, non-negative
`inventory`). The legacy single-row SKU/price/inventory columns were dropped
(migration backfills one default variant per existing product). Because every
pre-migration product was storefront-visible, the migration also backfills
`published = true` with `publishedAt = createdAt` for the existing rows — the
new published-only storefront queries never hide products that were visible
before the migration; only products created afterwards start unpublished.
Storefront views read the first-created variant; all storefront queries filter
`published: true`. Inventory is per variant and shared across locales by
construction — localization rows carry no stock fields.

**Publishing.** `computePublishability` requires at least one variant and an
English title + description (the deterministic fallback base, ADR-0003) and
computes per-locale translation coverage for all seven localized fields. The
editor shows completeness per locale, live English-fallback previews, and
the coverage table; the publish audit entry snapshots the coverage.
Publishing can never create duplicate SKUs (normalization + pre-check +
unique index), negative stock or float prices (integer-only validation), or
per-locale inventory (schema). The gate is enforced on edits too: an update
to a published product that would leave it unpublishable (for example,
clearing the English description, which field validation permits) is
rejected in the same transaction before any audit row is written, so the
storefront never serves a published product that no longer meets the
requirements — the merchant unpublishes first or restores them. Drafts,
being already unpublished, may always be saved while incomplete.

**Publishing persists the editor's current payload.** The editor's Publish
action first saves the working copy via the update mutation, then flips the
product to published (single merchant, sequential server actions). Clicking
Publish before Save therefore publishes exactly what the merchant sees —
unsaved edits are never silently discarded, and the storefront never serves
stale facts or copy. A rejected edit stops before the publish; a persisted
edit whose state still fails the gate (for example an incomplete draft that
cannot be published) is reported with the publish reasons while the saved
state is kept. Unpublishing only flips lifecycle state; it leaves the
unsaved-changes indicator intact so on-screen edits are never silently
treated as saved.

**Storefront copy applies the advertised English fallback.** Field
validation permits empty description/tasting notes in a non-English locale
row (the publication gate checks English only), so the storefront renders
the same effective copy the editor preview advertises — per-field
requested locale → English → any row — instead of returning the blank
string. Published zh-CN / ja pages therefore show the English fallback, and
search matches that displayed copy (ADR-0004).

**Publication gate is concurrency-safe.** `publishProduct` and
`updateProduct` run as SERIALIZABLE interactive transactions and read the
product (with variants and localizations) *inside* that transaction, so the
gate evaluates the exact state the write commits against. A concurrent
draft edit can no longer commit between the publish's validation and the
`published` flip: PostgreSQL's serializable isolation aborts one of the two
transactions (P2034) whenever they overlap on the same rows, and the service
surfaces that as a retryable `concurrent-edit` domain error (UI: review and
try again). `updateProduct` likewise re-reads the product inside its
transaction, so a draft edit can never skip the gate on a stale
`published = false` snapshot after a publish committed. The invariant holds
under every interleaving: either both operations serialize cleanly (the
publish validates the committed edit, or the update sees `published` and
enforces the gate) or one aborts — the storefront never serves a published
product that fails the publication requirements.

**Audit trail.** Every commerce mutation (`product.create`, `product.update`,
`product.publish`, `product.unpublish`, `variant.inventory`) writes an
`AuditLog` row in the same transaction: actor (admin email), timestamp, entity
type + id, and a JSON before/after summary of product data. Summaries contain
facts, variants, and localized copy only — never passwords, session tokens,
or cookies (a test asserts the invariant).

**UI boundaries.** The admin surface (`/admin/**`) is a separate root layout
with English chrome; product content is edited per locale inside the editor.
The admin header labels, sign-in link, and login page copy are plain English
(merchant tooling), while storefront-visible strings — including the
`merchant.signIn` header link — remain in all three i18n catalogs.

## Consequences

- One allowlisted merchant key rotates through env; changing
  `ADMIN_PASSWORD` and reseeding re-hashes the credential account.
- Production behind TLS should set `BETTER_AUTH_URL` (and export
  `AUTH_SECRET`); Secure-cookie behavior follows the request protocol
  (http → unsecure, https → Secure).
- The in-memory rate-limit store resets on server restart; a multi-instance
  deployment should move rate limiting to a shared store.
- `next.config.ts` marks `better-auth` as a `serverExternalPackages` entry
  because the package statically re-exports optional database adapters whose
  packages are not installed; Node resolves it at runtime via pnpm symlinks.
- Storefront fixtures and queries were migrated to variants; integration
  tests cover the migration invariants (shared facts, one variant per seeded
  product, published-only storefront views).
- SERIALIZABLE isolation on `publishProduct`/`updateProduct` trades a
  retryable `concurrent-edit` error for atomicity of the publication gate
  under concurrent administration; single-merchant traffic makes conflicts
  rare, and the merchant simply reviews and retries.
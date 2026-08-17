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
(migration backfills one default variant per existing product). Storefront
views read the first-created variant; all storefront queries filter
`published: true`. Inventory is per variant and shared across locales by
construction — localization rows carry no stock fields.

**Publishing.** `computePublishability` requires at least one variant and an
English title + description (the deterministic fallback base, ADR-0003) and
computes per-locale translation coverage for all seven localized fields. The
editor shows completeness per locale, live English-fallback previews, and
the coverage table; the publish audit entry snapshots the coverage.
Publishing can never create duplicate SKUs (normalization + pre-check +
unique index), negative stock or float prices (integer-only validation), or
per-locale inventory (schema).

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
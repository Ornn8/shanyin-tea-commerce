# DSH Implementation Receipt — Issue #3

- **Repository:** Ornn8/shanyin-tea-commerce
- **Issue:** #3 — Let the merchant manage localized products, prices, and stock
- **Branch:** `agent/issue-3`
- **Model:** `opencode-go/deepseek-v4-flash`
- **Reasoning effort:** `max`
- **Fallback policy:** No silent model fallback is accepted — every step of this
  implementation was produced by the model identified above at `max` reasoning. If a runtime
  or tool environment ever substitutes a different model or lower reasoning level, this
  receipt is void and the run must be flagged.
- **Date:** 2026-08-17

## What was implemented

- **Protected merchant administration surface** (`/admin/**`, ADR-0005) with a guarded route
  group: `/admin/login` (public, sign-in only), `/admin/products`, `/admin/products/new`, and
  `/admin/products/[id]` (full editor). Unauthenticated visitors are redirected; every server
  action re-checks the allowlisted admin session.
- **Maintained authentication library** — better-auth 1.6.29 (Prisma adapter, PostgreSQL)
  with `disableSignUp` (public registration disabled; the endpoint rejects with
  `EMAIL_PASSWORD_SIGN_UP_DISABLED`), server-side `Session` rows, an httpOnly cookie, CSRF
  origin enforcement kept on in every environment, and the built-in rate limiter enabled
  with a tighter `/sign-in/email` rule (10 attempts / 15 min per IP). The seed creates the
  single allowlisted merchant administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (scrypt).
- **One workflow over shared facts, variants, prices, inventory, publication state, and
  localized content**: `Product` keeps shared facts + `published`/`publishedAt`; new
  `ProductVariant` rows own globally unique SKUs, integer-minor-unit CNY prices, and
  non-negative inventory (shared across locales by construction — the legacy
  columns were migrated with a variant backfill, and existing products are
  backfilled `published = true` with `publishedAt = createdAt` so the new
  published-only storefront queries never hide pre-migration products).
  `ProductLocalization` gained brewing guidance, SEO title/
  description, and media alt text.
- **Editor UX**: per-locale completeness (n/7), live English-fallback previews (requested
  locale → English → any row), per-field server validation errors, unsaved-changes
  indicator + beforeunload warning, a coverage table, and clear shared-versus-localized
  section boundaries. Prices are typed as yuan strings and converted to integer cents
  without floating-point arithmetic.
- **Publishing** requires a variant and English title/description; it computes and exposes
  per-locale translation coverage (also snapshotted into the audit entry) and can never
  produce duplicate SKUs, negative stock, floating-point prices, or locale-specific
  inventory. Unpublished products are invisible to the storefront. The gate is revalidated
  on edits: `updateProduct` rejects (same transaction, `not-publishable`) any update that
  would leave a currently published product unpublishable — for example clearing the
  English description, which field validation permits — so the storefront never serves a
  published product that fails the requirement (integration + e2e covered).
- **The publication gate is concurrency-safe**: `publishProduct` and `updateProduct` run as
  SERIALIZABLE interactive transactions and read the product (with variants and
  localizations) inside that transaction, so the gate evaluates the exact state the write
  commits against. A concurrent draft edit can no longer slip between the publish's
  validation and the `published` flip: overlapping transactions abort with a PostgreSQL
  serialization failure (P2034), surfaced as a retryable `concurrent-edit` domain error,
  and `updateProduct`'s gate uses the fresh in-transaction `published` state — the
  storefront never serves a published product that fails the gate under any interleaving
  (deterministic paused-transaction regression test + racing publish/update rounds,
  integration-covered).
- **Audit trail**: every mutation (`product.create/update/publish/unpublish`,
  `variant.inventory`) writes an `AuditLog` row in the same transaction — actor, timestamp,
  entity, before/after JSON summary — containing product data only, never secrets.
- **Storefront migration**: catalog queries read the first-created variant and filter
  `published: true`; seed, cart, and catalog fixtures updated; a localized "Merchant
  sign-in" link appears in the header (`merchant.signIn` in all three catalogs).

## Verification performed

- Clean checks on Node.js 24.19.0 LTS with pnpm 11.7.0, PostgreSQL 17 via Docker Compose.
- Migration `20260817100000_merchant_admin_variants_audit` applied; seed creates 3
  categories, 6 products (6 variants, 18 localizations) and 1 merchant administrator.
- Upgrade-path check: a database populated at the pre-migration schema keeps every
  existing product storefront-visible after the migration (backfilled
  `published = true`, `publishedAt = createdAt`) — verified against PostgreSQL 17.
- `pnpm i18n:check` — 73 English source keys, 3 registered locales.
- `pnpm lint`, `pnpm typecheck` (strict), `pnpm build` (production build, all 13 routes).
- `pnpm test` — 82 tests (9 files), including the new admin suite: guards (no cookie /
  forged cookie / valid session / non-allowlisted user), disabled sign-up, CSRF 403 +
  same-origin positive control, sign-in rate-limit 429, all mutation paths with audit
  assertions (before/after, coverage, no secrets), the invalid-input matrix (duplicate
  SKUs across and within payloads, negative stock, float prices, unknown locales, duplicate
  slugs, empty variants, unpublishable products), the published-edit gate (an update
  that would break a published product's publishability is rejected with rollback and no
  audit row; publishable edits and incomplete drafts still save), and the publication-gate
  concurrency tests (a draft edit landing between the publish's validation and the flip
  aborts the publish via SERIALIZABLE isolation; racing publish/update rounds never commit
  an invalid published state and failures surface only as domain codes); unit tests for
  yuan→cents parsing, slug/SKU/inventory validation, and fallback/completeness.
- `pnpm e2e` — 38 Playwright tests across desktop (1440×900) and mobile (390×844): the new
  admin journeys (redirect, failed/successful sign-in, create → localize → publish →
  storefront visibility → inventory adjustment → sign-out, unpublish hiding, editing a
  published product into a non-publishable state is rejected while the storefront keeps
  serving it, no horizontal overflow, screenshots) plus the existing storefront smoke and
  discovery suites unchanged.

## Acceptance mapping

- Unauthorized users cannot access admin pages or mutations; public registration disabled:
  done (guarded layout + guarded server actions + better-auth `disableSignUp`, integration
  + e2e coverage).
- Manage shared facts, variants, integer-minor-unit CNY prices, inventory, publication
  state, and localized content in one workflow: done (editor + service layer).
- Editor shows per-locale completeness, fallback previews, validation errors, unsaved
  changes, shared-vs-localized boundaries: done (unit + e2e coverage).
- Publishing cannot create duplicate SKUs, negative stock, floating-point prices, or
  locale-specific inventory; a published product can never be edited into a state that
  fails the publication requirements: done (normalization + pre-check + unique index +
  integer-only validation + schema + revalidation on `updateProduct`; integration-tested).
- Every mutation records actor, timestamp, entity, before/after summary without secrets:
  done (`AuditLog` in-transaction; no-secrets test).
- CSRF/session protections, authorization checks, rate limits, invalid-input cases
  integration-tested: done.
- Playwright covers sign-in, create, localize, publish, inventory adjustment, sign-out at
  desktop and mobile widths: done (`e2e/admin.spec.ts`, both projects, screenshots
  uploaded by CI).
- This receipt identifies `opencode-go/deepseek-v4-flash` with `max` reasoning, no fallback:
  done.

## Caveats (recorded, not blocking)

- The rate-limit store is in-memory (per process); a multi-instance deployment should move
  it to shared storage. Secure-cookie behavior follows the request protocol (enable TLS +
  `BETTER_AUTH_URL` for production).
- Seed reseeding re-publishes demo products the merchant may have unpublished (documented
  in `prisma/seed.ts`).
- The storefront displays the first-created variant only; multi-variant display is out of
  scope for this slice (ADR-0005).

## Review repair round (head `e7f04f0` → new head)

The trusted review at head `e7f04f0` raised two P1 findings; both were confirmed and fixed
on `agent/issue-3`:

- **[P1] Publishing silently discarded unsaved editor changes** — the editor's Publish
  action sent only the product id, so it published the previously persisted state and then
  cleared the unsaved-changes flag. Fix (`src/components/admin/product-editor.tsx`): Publish
  now persists the current editor payload via the update mutation first, then flips the
  product to published. A merchant who edits copy/facts and clicks Publish before Save
  publishes exactly what they see; a rejected edit stops before the publish, and a persisted
  edit whose state still fails the publication gate keeps the saved state and surfaces the
  publish reasons. Unpublish (lifecycle-only) no longer clears the dirty flag, so on-screen
  edits are never silently treated as saved. Covered by a new Playwright journey
  (desktop + mobile) that edits name/description/price without saving, publishes, and
  asserts the storefront serves the revised payload.
- **[P1] Localized storefront copy ignored the advertised English fallback** —
  `toProductView` picked one localization row and returned its empty description directly
  (field validation permits empty non-English description/tasting notes; the gate checks
  English only), so published zh-CN / ja pages could show blank copy where the editor
  preview showed the English fallback. Fix (`src/lib/products.ts`): the storefront
  resolves name/description/tasting notes through the same deterministic per-field
  fallback as the preview (requested locale → English → any row), and search matches that
  displayed copy (ADR-0004 contract). Covered by a new integration test
  (`demo-fallback-fields` fixture: published product with empty zh-CN/ja
  description/tasting notes) asserting `getProductBySlug`/`listProducts` render the
  English fallback and search finds it by the displayed English text.

Updated verification: `pnpm i18n:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
(83 tests), `pnpm build`, and `pnpm e2e` (40 tests across desktop + mobile) all pass on
Node 24.19.0 / pnpm 11.7.0 / PostgreSQL 17. ADR-0005 and ADR-0004 record the two
invariants.

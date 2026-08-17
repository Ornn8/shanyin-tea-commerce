# DSH Implementation Receipt — Issue #4

- **Repository:** Ornn8/shanyin-tea-commerce
- **Issue:** #4 — Sell tea variants from a trustworthy localized product page
- **Branch:** `agent/issue-4`
- **Model:** `opencode-go/deepseek-v4-flash`
- **Reasoning effort:** `max`
- **Fallback policy:** No silent model fallback is accepted — every step of this
  implementation was produced by the model identified above at `max` reasoning. If a runtime
  or tool environment ever substitutes a different model or lower reasoning level, this
  receipt is void and the run must be flagged.
- **Date:** 2026-08-17

## What was implemented

- **Canonical localized detail pages with a stable language-neutral identity** (ADR-0006).
  The existing `/…/products/:slug` route is the canonical URL under every locale; the page
  root carries `data-product-id` (the product CUID, identical across all three locales).
  `generateMetadata` derives the request origin from headers (`src/lib/site-url.ts`) and
  emits `alternates.canonical` + `alternates.languages` for `zh-CN`/`en`/`ja` with
  `x-default` → English, preferring the seeded `seoTitle`/`seoDescription` and falling back
  to the localized name/description (ADR-0003/0005 pick order, never blank).
- **Client-side variant selection** (`src/components/product-purchase.tsx`). A native radio
  group over all of the product's variants (first-created = default) updates SKU, price,
  stock text (in-stock / low-stock / unavailable), the per-variant media illustration, and
  add-to-cart eligibility entirely in place — no navigation, so the locale and the
  accessibility state are preserved. Native radio semantics, per-option `aria-label`s,
  an `aria-live` announcement region, focus-visible rings, and disabled + tagged
  out-of-stock options are included. `LOW_STOCK_THRESHOLD = 5` in `src/lib/catalog-options.ts`
  derives the low-stock notice from the shared integer inventory fact.
- **Cart lines resolve the exact variant** — `getCartLines` (`src/lib/products.ts`) maps
  each SKU in the cart cookie back to its own price, unit name, and inventory, so a 250g
  line shows the 250g price and total; unknown SKUs and unpublished products are dropped,
  cookie order is preserved.
- **Published-only recommendations** — `getRelatedProducts` returns the same category first,
  then the rest of the catalog, excluding the current product, capped at 3; product facts
  are language-neutral so there is no per-locale duplication, and unpublished products are
  never exposed.
- **Structured data with verified facts only** (`src/lib/product-schema.ts`). One
  `application/ld+json` Product schema rendered for the default variant: canonical URL
  `@id`/`url`, language-neutral SKU, integer-derived CNY price, shared-inventory-derived
  availability, and the visible working brand. No ratings, reviews, GTINs, MPNs,
  certifications, harvest dates, or scarcity; `image` omitted until real merchant
  photography URLs exist. The client patches the `offers` block in place on variant change
  so structured data always matches the visible price and availability.
- **Localized completeness with explicit English-fallback tests** — product facts share
  values with i18n-key labels; brewing guidance and media alt resolve per field through the
  documented fallback, with a localized brewing empty state. `[locale]/not-found.tsx` and a
  new `[locale]/error.tsx` are localized via the pathname-derived locale using the same
  catalog keys. Japanese line breaking is guarded globally with `overflow-wrap: break-word`.
- **Seed truth extended** (`prisma/seed.ts`, PRODUCT.md): every seeded tea now carries three
  language-neutral package-size variants (first = storefront default) including demo
  low-stock and out-of-stock states, plus localized brewing guidance in all three locales.

## Verification performed

- Clean checks on Node.js 24.19.0 LTS with pnpm 11.7.0, PostgreSQL 17 via Docker Compose.
- Migrations applied; seed creates 3 categories, 6 products (18 variants, 18 localizations,
  1 merchant administrator).
- `pnpm i18n:check` — 87 English source keys, 3 registered locales, 1 optional key
  (`home.announcement`), new interpolation key `product.mediaAlt` declared.
- `pnpm lint`, `pnpm typecheck` (strict), `pnpm build` (production build).
- `pnpm test` — 102 tests (11 files), including the new `product-schema` unit suite
  (decimal-yuan conversion, availability mapping, no-fabricated-claims policy, brand
  identity, image omission, low-stock boundaries, request-origin derivation) and the new
  `product-detail` integration suite (variant ordering and facts, stable identity across
  locales, English-fallback brewing guidance, unpublished/unknown-slug rejection,
  unavailable default, published-only recommendations without duplicates, per-SKU cart
  lines with preserved order).
- `pnpm e2e` — 76 Playwright tests across desktop (1440×900) and mobile (390×844): the
  existing smoke/discovery/admin suites unchanged, plus the new `product-detail.spec.ts`
  journeys (variant selection updates price/SKU/stock/media/JSON-LD/add-to-cart; per-variant
  cart pricing; low-stock notice; unavailable default + disabled add-to-cart; localized 404
  for invalid slugs; locale switching preserving product identity with hreflang/canonical
  links; keyboard radio-group operation with focus retention; localized image alt text;
  recommendations never exposing the current or unpublished products; no horizontal
  overflow) with screenshots.

## Acceptance mapping

- Every seeded tea has a canonical localized URL, locale-aware metadata, alternate-language
  links, and a stable language-neutral product identity: done (canonical/alternates in
  `generateMetadata`, `data-product-id`, CUID identity asserted across locales).
- Variant selection updates SKU, price, stock, media, and add-to-cart eligibility without
  losing locale or accessibility state: done (client-only radio group, no navigation,
  native radio a11y + announce region, e2e keyboard + focus + aria checks).
- Product facts, warnings, brewing guidance, empty states, and errors complete in all three
  locales with English fallback explicitly tested: done (i18n keys + facts table + warning
  notice + localized not-found/error; integration test proves zh-CN/ja render the English
  brewing fallback; e2e asserts localized 404 and low-stock copy).
- Recommendations never expose unpublished products and do not duplicate factual records by
  locale: done (published-only query, category-first ordering, one record per product,
  integration + e2e).
- Structured data contains only verified seeded facts and matches visible price and
  availability: done (pure builders unit-tested for the no-claims policy; JSON-LD asserted
  against visible price/availability initially and after variant switch in e2e).
- Keyboard, screen-reader naming, focus visibility, Japanese line breaking, image alt text,
  and 390×844/1440×900 layouts verified: done (e2e keyboard/radio/alt assertions,
  `overflow-wrap` guard, per-project overflow checks at both viewports, screenshots).
- Unit, integration, and Playwright tests cover in-stock, low-stock, unavailable,
  invalid-slug, and locale-switch paths: done (see Verification).
- This receipt identifies `opencode-go/deepseek-v4-flash` with `max` reasoning, no fallback:
  done.

## Caveats (recorded, not blocking)

- The JSON-LD patch mutates the rendered script element in place; it is a guarded no-op when
  the element is absent or unparseable. Structured data for the default variant is what
  crawlers receive; the post-select patch keeps the on-page state consistent.
- Variant selection is per-page client state: a locale switch (or refresh) returns to the
  default variant. The acceptance contract requires locale/accessibility preservation during
  selection, which this satisfies; URL-encoded variant state is out of scope.
- Placeholder media illustrations vary per variant deterministically (seed
  `slug:variantId`); merchant photography will replace the whole media component (see
  PRODUCT.md replacement checklist) and can keep the same per-variant slotting.
- Seed reseeding re-publishes demo products the merchant may have unpublished and re-sets
  variant inventories (documented in `prisma/seed.ts`).
# ADR-0006: Trustworthy localized product detail with purchasable variants

- Status: Accepted
- Date: 2026-08-17

## Context

Issue #4: visitors reach a product detail page from a catalog result and must
select a purchasable tea variant (package size). The page must present shared
factual commerce data, localized descriptive content, brewing guidance,
inventory state, media, and recommendations without inventing
certifications, medicinal effects, reviews, origin claims, or urgency
(PRODUCT.md content policy). Variants carry stable SKUs, prices, and
inventory; the purchase area must work on desktop and mobile while preserving
the Eastern visual system. SEO and structured data must describe the page
truthfully in every locale, and every path — in-stock, low-stock,
unavailable, invalid slug, locale switch — must be covered by unit,
integration, and Playwright tests.

## Decision

**Canonical localized URLs and a stable language-neutral identity.** Every
seeded tea keeps its canonical URL `/…/products/:slug` under the active locale
segment. The route is force-dynamic and resolves the product by its
language-neutral `slug`; the page root carries `data-product-id` with the
product's CUID (identical across all three locales). `generateMetadata`
derives the request origin from the trusted configured public origin
(`PUBLIC_SITE_URL`, `src/lib/site-url.ts`) and emits `alternates.canonical`
plus `alternates.languages` for `zh-CN`/`en`/`ja` with `x-default` pointing at
the English fallback locale. Title/description prefer the seeded
`seoTitle`/`seoDescription` and fall back to the localized name and
description — the ADR-0003/0005 pick order, never blank.

**Variant selection is pure client state.** The purchase panel
(`src/components/product-purchase.tsx`) renders a native radio group over the
product's variants (first-created first = the default selection). Choosing a
size updates the SKU, price, stock text (in-stock / low-stock / unavailable),
the media illustration (derived per variant from `slug:variantId`), and
add-to-cart eligibility entirely in place — no navigation, so the locale
(path segment) is untouched and the accessibility state is preserved:
native radio semantics, keyboard arrow navigation, an `aria-live`
announcement region, and per-option `aria-label`s that include the localized
price and availability. Out-of-stock options are disabled and tagged with the
localized "Unavailable" chip. `LOW_STOCK_THRESHOLD = 5` (`src/lib/catalog-options.ts`)
derives the low-stock notice from the shared integer inventory fact.

**Cart lines resolve the exact variant.** The cart cookie already stores SKUs
(language-neutral). `getCartLines` (`src/lib/products.ts`) maps each SKU back
to its own price, unit name, and inventory, so a 250g line shows the 250g
price and total — never the product's default-variant price. Unknown SKUs and
unpublished products are dropped.

**Recommendations are server-derived and published-only.**
`getRelatedProducts` returns published products only, same category first,
then the rest of the catalog, excluding the current product, capped at three.
Product facts are language-neutral, so each product appears once; there is no
per-locale duplication by construction.

**Structured data contains verified seeded facts only.** The page renders one
`application/ld+json` Product schema for the default variant: `@id` and `url`
are the canonical URL, `sku` is the language-neutral SKU, `offers` carries the
integer-derived CNY price (`priceYuanFromCents`), the shared inventory-derived
availability, and the currency. The schema never emits ratings, reviews,
GTINs, MPNs, certifications, harvest dates, or scarcity; `image` is omitted
until merchant photography supplies real URLs. When the visitor selects a
different variant, the client patches the `offers` block in place
(`src/lib/product-schema.ts`) so the structured data always matches the
visible price and availability. The builders are pure and unit-tested; the
patch is exercised by e2e (initial render and after a switch).

**Script-safe serialization and a trusted origin (security hardening).** The
JSON string is embedded verbatim with `dangerouslySetInnerHTML` in a
`<script type="application/ld+json">` element, so `serializeProductSchema`
escapes every HTML-sensitive character (`<`, `>`, `&`, U+2028, U+2029) to
its JSON `\uXXXX` form before embedding — `JSON.stringify` alone would let a
merchant-editable name or description containing `</script><script>…`
terminate the data element and execute script on the storefront. The escapes
keep the document valid JSON, round-trip exactly through `JSON.parse`
(regression-tested), and make the schema independent of which field carries
the payload. Because the schema (and the canonical/hreflang links) contain a
canonical URL, the public origin is derived from trusted configuration
(`PUBLIC_SITE_URL`) when set; without it only local-development hosts are
accepted from request headers, so an unconfigured instance cannot be poisoned
into emitting attacker-chosen origins.

**Localized completeness with English fallback, explicitly tested.** Product
facts (origin, form, caffeine, SKU) use shared values with i18n key labels;
brewery guidance and media alt text resolve through the same per-field
ADR-0003/0005 fallback (requested locale → English → any row) with a
localized empty state for brewing guidance. The empty slate and error
boundary are localized too: `[locale]/not-found.tsx` and `[locale]/error.tsx`
derive the locale from the pathname and render the same keys the rest of the
storefront uses. Japanese line breaking is guarded globally with
`overflow-wrap: break-word` (CJK keeps native per-character breaking).

## Consequences

- Every detail-page fact shown to the visitor is also present in structured
  data with matching values, and product facts never duplicate per locale.
- A merchant adding or reordering variants changes the default selection only
  when they reorder the first-created row; the storefront otherwise keeps
  showing the previously default variant — deterministic and tested.
- The JSON-LD patch is a small, guarded DOM update; if the element is absent
  or unparseable it is a silent no-op rather than a crash.
- The demo seed now carries three variants per tea (including low-stock and
  out-of-stock states) and localized brewing notes; PRODUCT.md lists the
  updated seed truth and the merchant facts still required.
- CI e2e now also runs the product-detail journeys at 1440×900 and 390×844,
  asserting no horizontal overflow and uploading screenshots.
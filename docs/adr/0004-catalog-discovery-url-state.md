# ADR-0004: Catalog discovery — URL-encoded query state, locale-scoped search

- Status: Accepted
- Date: 2026-08-17

## Context

Issue #2 requires a complete discovery path: a localized global search field and category
navigation that lead to a server-backed catalog result page. Visitors must be able to search
localized tea names and descriptions and filter the shared catalog by tea family, form,
caffeine profile, price range, and availability — without duplicating SKUs or inventory by
language. URLs must preserve locale, search intent, filters, sort order, and pagination so
results are shareable and recoverable. Search may index localized fields, but identifiers,
price, stock, and ranking inputs must remain language-neutral.

## Decision

**One discovery engine, two routes.** `queryProducts` (`src/lib/products.ts`) is the single
server-backed query behind both `/…/products` (catalog) and `/…/search` (results for the
global search field). Both pages render the same `CatalogBrowser` composition
(`src/components/catalog-browser.tsx`): title/summary differ, filters, result count, empty
state, and pagination are identical.

**URL is the only state.** Every discovery input is a query parameter on the route's locale
segment; the locale picker swaps the segment in place and preserves the query string
(`src/components/locale-picker.tsx`). Refresh, back/forward, and locale switching therefore
re-derive the same results. `parseCatalogParams` / `buildCatalogUrl`
(`src/lib/catalog-params.ts`) parse raw search params deterministically and emit canonical
URLs (defaults like `page=1` and `sort=featured` are omitted).

| Param       | Values                              | Meaning                                   |
| ----------- | ----------------------------------- | ----------------------------------------- |
| `q`         | free text (≤ 200 chars)             | Matches the active locale's copy          |
| `category`  | category slug (`green-tea`, …)      | Tea family                                |
| `form`      | `loose` \| `compressed`             | Leaf form (language-neutral fact)         |
| `caffeine`  | `low` \| `medium` \| `high`         | Caffeine profile (language-neutral fact)  |
| `priceMin`  | whole CNY yuan ≥ 0                  | Inclusive lower price bound               |
| `priceMax`  | whole CNY yuan ≥ 0                  | Inclusive upper price bound               |
| `inStock`   | `true` \| `false`                   | In stock only / out of stock only         |
| `sort`      | `featured` \| `price-asc` \| `price-desc` \| `name-asc` | Result order   |
| `page`      | positive integer                    | 1-based page                              |

**Locale-scoped search with a documented deterministic fallback.** Search matches the SAME
copy the page displays for the active locale, using the ADR-0003 pick order: the requested
locale's `ProductLocalization` row → English → any available row. A product that lacks a row
for the active locale is found by its effective (fallback) copy; a product that has its own
row is never matched through another locale's rows. The fallback is exercised by the
`demo-fallback` fixture in integration tests (a product with no `ja` row, matched by its
English name from `ja`, not from `zh-CN`, which has its own row).

**Filters operate on shared facts.** `category` filters on `Category.slug`;
`form`/`caffeine` on the new language-neutral `Product.form` / `Product.caffeine` enum
columns (migration `20260817000000_add_catalog_discovery_attributes`); `priceMin`/`priceMax`
convert yuan to integer `priceCents`; `inStock` compares `inventory > 0`. No filter ever
touches localized display strings. Display labels for form/caffeine/sort are i18n message
keys (`catalog.form.*`, `catalog.caffeine.*`, `catalog.sort.*`).

**Sorting and ranking.** `featured` (the default) ranks by `createdAt` ascending then slug —
language-neutral. `price-asc`/`price-desc` sort the shared `priceCents`. `name-asc` is a
visitor-chosen display sort over the localized name with the active locale's collation.

**Pagination.** `CATALOG_PAGE_SIZE = 4` (`src/lib/catalog-options.ts`), small enough that the
six-tea demo catalog paginates observably. Out-of-range pages clamp to the last page;
malformed pages fall back to 1. `pageSize` is accepted by the query API for tests but is not
part of the URL contract.

**Validation.** Unknown values (`form=brick`, `sort=random`, `page=abc`, negative or decimal
prices) are ignored deterministically, never crash the page. A range with `priceMin >
priceMax` is rejected as a whole, both bounds are dropped, and the UI shows a localized
notice (`catalog.invalidPriceRange`). All filtering is case-insensitive for Latin text via
`toLocaleLowerCase` and executed in memory over one deterministic query because the demo
catalog is tiny.

## Consequences

- Any discovery state can be shared as a plain URL and reproduced exactly; the e2e suite
  asserts this for search, combined filters, sort, pagination, back/forward, and locale
  switching in all three locales.
- Localized search is predictable per locale, and the fallback behavior is documented,
  seeded-for-testing, and covered by integration tests.
- Form and caffeine are now product facts (demo placeholders, see PRODUCT.md); merchant
  verification must supply real values before production.
- The in-memory filter/sort/pagination implementation is a deliberate slice-scale choice:
  when the catalog outgrows a few hundred rows, move the predicates into the Prisma query
  (`where`/`orderBy`/`skip`/`take`) behind the same `queryProducts` signature.

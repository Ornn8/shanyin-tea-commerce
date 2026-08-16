# DSH Implementation Receipt — Issue #2

- **Repository:** Ornn8/shanyin-tea-commerce
- **Issue:** #2 — Make the tea catalog searchable and filterable in every locale
- **Branch:** `agent/issue-2`
- **Model:** `opencode-go/deepseek-v4-flash`
- **Reasoning effort:** `max`
- **Fallback policy:** No silent model fallback is accepted — every step of this
  implementation was produced by the model identified above at `max` reasoning. If a runtime
  or tool environment ever substitutes a different model or lower reasoning level, this
  receipt is void and the run must be flagged.
- **Date:** 2026-08-17

## What was implemented

- **Language-neutral discovery facts:** `Product.form` (`LOOSE`/`COMPRESSED`) and
  `Product.caffeine` (`LOW`/`MEDIUM`/`HIGH`) added to the Prisma schema with migration
  `20260817000000_add_catalog_discovery_attributes`; the seed assigns demo values; display
  labels are localized message keys (`catalog.form.*`, `catalog.caffeine.*`).
- **One server-backed discovery engine** (`queryProducts` in `src/lib/products.ts`) behind
  both `/…/products` and `/…/search`, rendered by the shared `CatalogBrowser` +
  `CatalogFilters` + `CatalogPagination` components.
- **URL is the only state** (`src/lib/catalog-params.ts`): `q`, `category`, `form`, `caffeine`,
  `priceMin`/`priceMax` (CNY yuan → cents), `inStock`, `sort`, `page`, with canonical URL
  building and deterministic validation (unknown values ignored; min > max rejected with a
  localized notice). The locale picker now preserves the query string on locale switching.
- **Locale-scoped search with a documented deterministic fallback** (ADR-0004): search matches
  the same copy the page displays — requested locale → English → any row (ADR-0003 pick order).
- **Price/availability filters operate on shared facts** (`priceCents`, `inventory`), never on
  localized strings; sort options cover featured (language-neutral ranking), price, and
  localized name; pagination (4 per page) clamps out-of-range pages.
- **Out-of-stock badge** on product cards; localized empty state and result counts on the
  catalog pages.

## Verification performed

- Clean install on Node.js 24.19.0 LTS with pnpm (frozen lockfile), PostgreSQL 17 via Docker
  Compose (`pnpm install`, `docker compose up -d --wait`)
- `pnpm prisma:migrate` (2 migrations) + `pnpm db:seed` (3 categories, 6 products, 18
  localizations)
- `pnpm i18n:check` — 72 English source keys, 3 registered locales
- `pnpm lint`, `pnpm typecheck` (strict)
- `pnpm test` — 43 unit + integration tests (6 files), including the new
  `tests/integration/catalog.test.ts` suite: combined filters, unavailable products via a
  throwaway inventory-0 fixture, empty results, deterministic fallback content via a
  no-`ja`-row fixture, stable pagination, and deterministic sorting; plus
  `tests/unit/catalog-params.test.ts` for URL parsing/validation/build.
- `pnpm build` (production build)
- `pnpm e2e` — Playwright smoke (existing suite) plus the new
  `e2e/discovery.spec.ts` proving one discovery journey per locale (global search → results →
  combined filters in the URL → sort → availability empty state → pagination with
  back/forward → locale switching preserving query state, no horizontal overflow at
  390×844/1440×900) with per-project screenshots; CI uploads them to the
  `storefront-screenshots` artifact.

## Acceptance mapping

- Search + filters on `/zh-CN`, `/en`, `/ja` with localized labels, empty states, validation,
  and result counts: done.
- Search matches the active locale's product copy with a documented deterministic fallback
  (ADR-0004 + integration/unit/e2e coverage): done.
- Filter/sort/page/query state encoded in the URL, surviving refresh, back/forward, and locale
  switching (picker preserves query string): done.
- Price and inventory filters operate on shared factual data (`priceCents`, `inventory`):
  done.
- 390×844 and 1440×900 layouts usable with long English labels, Japanese line breaking,
  keyboard-accessible native controls, no horizontal overflow: done (e2e asserts overflow ≤ 1px).
- Integration tests cover combined filters, unavailable products, empty results, fallback
  content, stable pagination: done.
- Playwright proves one discovery journey per locale and uploads screenshots: done.
- This receipt identifies `opencode-go/deepseek-v4-flash` with `max` reasoning, no fallback:
  done.
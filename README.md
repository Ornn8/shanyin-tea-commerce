# Shanyin Tea · 山隐茶事

A production-shaped vertical slice for a single-merchant tea storefront under the working brand
**Shanyin Tea** (山隐茶事). A visitor can open the home page, switch among Simplified Chinese,
English, and Japanese, and search and filter seeded demo tea products — served from PostgreSQL
through the real application stack — with shareable, URL-encoded discovery state. Each tea has a
canonical localized detail page with purchasable package-size variants (stable SKUs, prices, and
inventory), localized brewing guidance, structured data, and suggestions. The merchant can sign
in through a protected administration surface (ADR-0005) to manage products, variants, prices,
inventory, publication state, and per-locale content in one workflow, with an audit trail for
every mutation.

> ⚠️ **Demo content.** All commercial claims, certifications, origins, prices, and imagery in
> this repository are replaceable placeholders until the merchant supplies verified assets.
> See [PRODUCT.md](./PRODUCT.md) for the product truth and the production checklist.

## Stack

| Layer      | Choice                                                            |
| ---------- | ----------------------------------------------------------------- |
| Runtime    | Node.js 24 LTS                                                    |
| Framework  | Next.js 16.2.11 (App Router, React 19.2, Turbopack)               |
| Language   | TypeScript (strict)                                               |
| Styling    | Tailwind CSS v4 (pine / celadon / stone / lacquer design tokens)  |
| Database   | PostgreSQL 17 (Docker Compose for local dev)                      |
| ORM        | Prisma ORM 7 (current GA)                                         |
| i18n       | Registry-driven catalogs: `zh-CN`, `en`, `ja` (English fallback)  |
| Tests      | Vitest (unit + integration), Playwright (smoke + screenshots)     |
| Package    | pnpm 11                                                           |

## Quick start

Prerequisites: Node.js 24 LTS, pnpm 11, Docker Desktop (or any Docker engine).

```bash
# 1. Start PostgreSQL
docker compose up -d --wait

# 2. Configure environment
cp .env.example .env

# 3. Install dependencies (postinstall generates the Prisma client)
pnpm install

# 4. Apply migrations and seed the demo catalog
pnpm prisma:migrate
pnpm db:seed

# 5. Run the storefront
pnpm dev            # http://localhost:3000 — redirects to /zh-CN
```

Full instructions and every verification command are in [SETUP.md](./SETUP.md).

## Routes

| Route                          | Purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| `/`                            | Redirects to the persisted (or default) locale |
| `/zh-CN`, `/en`, `/ja`         | Localized home page                            |
| `/…/products`                  | Catalog with URL-state discovery (see below)   |
| `/…/products/:slug`            | Product detail: variants, facts, brewing guidance, structured data |
| `/…/search?q=…`                | Search results with the same discovery view    |
| `/…/cart`                      | Durable anonymous cart: signed cookie, quantities, price snapshots, and a non-binding shipping estimate (no checkout) |
| `/admin/login`                 | Merchant sign-in (public registration disabled)|
| `/admin/products`              | Merchant product list (protected)              |
| `/admin/products/new`          | Create a product draft (protected)             |
| `/admin/products/:id`          | Full product editor (protected)                |
| `/api/auth/[...all]`           | better-auth HTTP surface (sign-in/out/session) |

Both `/…/products` and `/…/search` share one server-backed discovery view. Search intent,
filters, sort order, and page are encoded in the URL — `q`, `category`, `form`
(`loose`/`compressed`), `caffeine` (`low`/`medium`/`high`), `priceMin`/`priceMax` (whole CNY
yuan), `inStock` (`true`/`false`), `sort` (`featured`/`price-asc`/`price-desc`/`name-asc`),
and `page` — so results survive refresh, back/forward navigation, and locale switching. See
[ADR-0004](./docs/adr/0004-catalog-discovery-url-state.md) for the full contract.

Every product detail page (`/…/products/:slug`) is canonical per locale with hreflang
alternates, offers purchasable package-size variants (SKU, price, and stock update in place on
selection), renders structured data that matches the visible price and availability, and shows
localized brewing guidance plus published-only recommendations. See
[ADR-0006](./docs/adr/0006-product-detail-variants.md).

The anonymous cart (`/…/cart`) persists across refreshes and locale switches in one
HMAC-signed cookie holding only language-neutral data (SKU, quantity, price snapshot), so
switching locale changes presentation only — never duplicating or dropping lines. Every
quantity change is a server action that re-validates publication state, current price, and
stock (quantities stay bounded and never exceed stock; prices are never client-supplied). The
cart shows the subtotal and a clearly labeled non-binding shipping estimate in CNY, and
communicates expired, removed, price-changed, and insufficient-stock states in all three
locales. See [ADR-0007](./docs/adr/0007-anonymous-cart-and-shipping-estimate.md).

## Scripts

| Command              | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `pnpm dev`           | Start the dev server                                |
| `pnpm lint`          | ESLint (flat config, next core-web-vitals + ts)     |
| `pnpm typecheck`     | `tsc --noEmit` (strict)                             |
| `pnpm i18n:check`    | Validate catalogs (see below)                       |
| `pnpm test`          | Vitest unit + integration tests                     |
| `pnpm build`         | Production build                                    |
| `pnpm e2e`           | Playwright (storefront + merchant admin journeys)   |
| `pnpm prisma:migrate`| Apply migrations                                    |
| `pnpm db:seed`       | Seed the demo catalog + the admin account           |

The demo merchant credentials live in `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`,
see [.env.example](./.env.example)); the admin area is at `/admin`.

## Documentation

- [PRODUCT.md](./PRODUCT.md) — product truth, demo boundaries, and the merchant facts/assets
  still required for production.
- [SETUP.md](./SETUP.md) — clean-install guide, verification commands, troubleshooting.
- [docs/adr](./docs/adr) — architecture decision records:
  - `0001-full-stack-monolith.md` — why the app is a single Next.js monolith.
  - `0002-localization-registry.md` — registry-driven i18n, fallback, race safety, CI checks.
  - `0003-commerce-data-and-currency.md` — language-neutral facts vs. localized copy, CNY.
  - `0004-catalog-discovery-url-state.md` — URL-encoded search/filter/sort/page state,
    locale-scoped search with a deterministic fallback.
  - `0005-merchant-administration-and-audit.md` — better-auth, the allowlisted admin,
    variants/inventory rules, publication lifecycle, and the audit trail.
  - `0006-product-detail-variants.md` — canonical localized detail pages, client-side
    variant selection, structured-data policy, published-only recommendations.
  - `0007-anonymous-cart-and-shipping-estimate.md` — signed anonymous cart (SKU + quantity +
    price snapshot), server-validated bounded quantity changes, revalidation on every render,
    and the non-binding shipping estimate.
- [docs/DSH-IMPLEMENTATION-RECEIPT.md](./docs/DSH-IMPLEMENTATION-RECEIPT.md) — implementation
  receipt for Issue #1 (model + reasoning, no fallback).
- [docs/DSH-IMPLEMENTATION-RECEIPT-2.md](./docs/DSH-IMPLEMENTATION-RECEIPT-2.md) — implementation
  receipt for Issue #2 (model + reasoning, no fallback).
- [docs/DSH-IMPLEMENTATION-RECEIPT-3.md](./docs/DSH-IMPLEMENTATION-RECEIPT-3.md) — implementation
  receipt for Issue #3 (model + reasoning, no fallback).
- [docs/DSH-IMPLEMENTATION-RECEIPT-4.md](./docs/DSH-IMPLEMENTATION-RECEIPT-4.md) — implementation
  receipt for Issue #4 (model + reasoning, no fallback).
- [docs/DSH-IMPLEMENTATION-RECEIPT-5.md](./docs/DSH-IMPLEMENTATION-RECEIPT-5.md) — implementation
  receipt for Issue #5 (model + reasoning, no fallback).

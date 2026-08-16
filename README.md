# Shanyin Tea · 山隐茶事

A production-shaped vertical slice for a single-merchant tea storefront under the working brand
**Shanyin Tea** (山隐茶事). A visitor can open the home page, switch among Simplified Chinese,
English, and Japanese, and browse seeded demo tea products served from PostgreSQL through the
real application stack.

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
| `/…/products`                  | Full catalog (optional `?category=slug`)       |
| `/…/products/:slug`            | Product detail + add-to-cart                   |
| `/…/search?q=…`                | Catalog search                                 |
| `/…/cart`                      | Demo cart (cookie-persisted, no checkout)      |

## Scripts

| Command              | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `pnpm dev`           | Start the dev server                                |
| `pnpm lint`          | ESLint (flat config, next core-web-vitals + ts)     |
| `pnpm typecheck`     | `tsc --noEmit` (strict)                             |
| `pnpm i18n:check`    | Validate catalogs (see below)                       |
| `pnpm test`          | Vitest unit + integration tests                     |
| `pnpm build`         | Production build                                    |
| `pnpm e2e`           | Playwright smoke (desktop 1440×900 + mobile 390×844)|
| `pnpm prisma:migrate`| Apply migrations                                    |
| `pnpm db:seed`       | Seed the demo catalog                               |

## Documentation

- [PRODUCT.md](./PRODUCT.md) — product truth, demo boundaries, and the merchant facts/assets
  still required for production.
- [SETUP.md](./SETUP.md) — clean-install guide, verification commands, troubleshooting.
- [docs/adr](./docs/adr) — architecture decision records:
  - `0001-full-stack-monolith.md` — why the app is a single Next.js monolith.
  - `0002-localization-registry.md` — registry-driven i18n, fallback, race safety, CI checks.
  - `0003-commerce-data-and-currency.md` — language-neutral facts vs. localized copy, CNY.
- [docs/DSH-IMPLEMENTATION-RECEIPT.md](./docs/DSH-IMPLEMENTATION-RECEIPT.md) — implementation
  receipt (model + reasoning, no fallback).

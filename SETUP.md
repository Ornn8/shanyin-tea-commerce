# Setup Guide

This guide covers a clean install of the Shanyin Tea storefront on a fresh machine, plus every
verification command used by CI. All commands assume a POSIX shell on macOS/Linux or PowerShell
on Windows; paths and env syntax differ only in the usual ways.

## Prerequisites

| Tool      | Version          | Notes                                              |
| --------- | ---------------- | -------------------------------------------------- |
| Node.js   | 24 LTS (24.x)    | `engines` is enforced via `engine-strict` (`.npmrc`) |
| pnpm      | 11.x             | `packageManager` pins 11.7.0                       |
| Docker    | any recent       | Required only for the local PostgreSQL container   |

Verify:

```bash
node --version   # v24.x
pnpm --version   # 11.x
docker info      # daemon running
```

## 1. Start PostgreSQL

```bash
docker compose up -d --wait
```

This starts `postgres:17-alpine` on `localhost:5432` with database `shanyin`, user `shanyin`,
password `shanyin` (see `docker-compose.yml`). The volume `shanyin-pgdata` persists data
between restarts. To stop: `docker compose down` (keeps data) or `docker compose down -v`
(also deletes data).

## 2. Configure environment

```bash
cp .env.example .env
```

`.env` holds `DATABASE_URL` (used by Prisma CLI, the app server, and tests). It is
gitignored. In CI the same value is provided as a workflow environment variable.

New in Issue #3 (`ADR-0005`): `.env` also carries the merchant administrator
credentials and the session secret:

| Variable          | Purpose                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `ADMIN_EMAIL`     | The single allowlisted merchant administrator email (seeded)         |
| `ADMIN_PASSWORD`  | Password hashed (scrypt) into the seeded `credential` account        |
| `AUTH_SECRET`     | Signs the admin session cookie (long, random value in production)    |
| `CART_SECRET`     | Signs the anonymous cart cookie (Issue #5, ADR-0007); falls back to `AUTH_SECRET` locally |
| `BETTER_AUTH_URL` | Optional public origin used by better-auth (default `http://localhost:3000`) |

New in Issue #4 (`ADR-0006`): the public origin used to build canonical
links, hreflang alternates, and JSON-LD URLs:

| Variable          | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `PUBLIC_SITE_URL` | Optional trusted absolute public origin (e.g. `https://shop.example.com`). When set, canonical/structured-data URLs use it and forwarded request headers are never trusted; unset in local development, where only `localhost`/`127.0.0.1` on the dev ports are honored from headers |

New in Issue #5 (`ADR-0007`): the anonymous cart signing secret. New in
Issue #6 (`ADR-0008`): the simulated-payment signing secret and the optional
Stripe test-mode adapter:

| Variable          | Purpose                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `PAYMENT_SIM_SECRET` | Signs the deterministic simulated payment gateway events (Issue #6, ADR-0008). Test/simulation only — it can never enable a live charge. Falls back to `AUTH_SECRET` locally |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Optional Stripe TEST-mode adapter (Issue #6, ADR-0008). Dormant unless the key is a `sk_test_*` key and a `whsec_*` webhook secret is set; live (`sk_live_*`) keys are rejected. Unset by default, so checkout runs entirely on the simulated gateway |

## 3. Install dependencies

```bash
pnpm install
```

A `postinstall` hook runs `prisma generate` automatically, so the generated Prisma client
(`src/generated/prisma/`, gitignored) is always in sync with `prisma/schema.prisma`.
To regenerate manually: `pnpm prisma:generate`.

## 4. Apply migrations and seed

```bash
pnpm prisma:migrate   # prisma migrate deploy
pnpm db:seed          # prisma db seed  (tsx prisma/seed.ts, upsert-based, idempotent)
```

The seed creates 3 categories and 6 demo products, each localized in `zh-CN`, `en`, and `ja`,
with language-neutral leaf form (`form`) and caffeine (`caffeine`) demo facts used by catalog
filtering (ADR-0004), three language-neutral variants per product (package-size SKUs with
integer-cents CNY prices and inventory — ADR-0005, ADR-0006; each variant stores an explicit
0-based position (seed order), and the position-0 variant is the
storefront default, later ones are selectable on the detail page and include demo low-stock
and out-of-stock states), localized brewing guidance, and the single allowlisted merchant
administrator (`ADMIN_EMAIL` / `ADMIN_PASSWORD`); public registration is disabled, so
reseeding is the way to rotate the demo password.

## 5. Run

```bash
pnpm dev              # http://localhost:3000, redirects / → /zh-CN
```

Open `http://localhost:3000/admin` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Verification suite (mirrors CI)

With the database up, migrated, and seeded:

```bash
pnpm i18n:check     # catalogs: missing English source keys, unknown locale ids, unsafe interpolation
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit (strict)
pnpm test           # Vitest: unit + integration (integration needs DATABASE_URL)
pnpm build          # production build (dynamic pages; no DB access at build time)
pnpm exec playwright install chromium   # once per machine
pnpm e2e            # Playwright: storefront smoke + discovery + merchant admin journeys
```

`pnpm test` adds the merchant-administration integration suite
(`tests/integration/admin.test.ts`): authorization guards (anonymous, forged cookie, valid
session, non-allowlisted user), disabled public sign-up, CSRF origin rejection (403), sign-in
rate limiting (429), and every mutation with its audit row (no secrets). The product-detail
integration suite (`tests/integration/product-detail.test.ts`) covers variant ordering,
English-fallback brewing guidance, language-neutral identity stability, published-only
recommendations, and per-SKU cart lines (ADR-0006). The checkout integration suite
(`tests/integration/checkout.test.ts`, Issue #6, ADR-0008) covers server-owned totals (stale
cart price never trusted), immutable order snapshots, signature rejection, duplicate events,
event reordering, the concurrent last-unit purchase (only one of two competing payments wins),
payment failure + retry, and credential-only non-enumerable lookup. The e2e merchant journeys sign in with
`ADMIN_EMAIL` / `ADMIN_PASSWORD` and cover sign-in → create → localize → publish → inventory
adjustment → sign-out at desktop (1440×900) and mobile (390×844) widths, the
product-detail journeys (`e2e/product-detail.spec.ts`) cover variant selection, low-stock,
unavailable defaults, invalid slugs, locale switching, structured data, and accessibility for
the same two viewports, the cart journeys (`e2e/cart.spec.ts`) cover one full add-to-cart
path per locale (quantities, subtotal, the non-binding shipping estimate, recovery across
refresh and locale switch), server revalidation (concurrent stock change, price change,
unpublish removal), a stock-capped add reporting the shortage instead of a false success, the
expired-cart notice, and keyboard/live-region/focus behavior with long labels (Issue #5,
ADR-0007), and the checkout journeys (`e2e/checkout.spec.ts`, Issue #6, ADR-0008) complete one
simulated purchase and order lookup in every locale (cart → checkout with fake `@example.test`
data → simulated payment → confirmation with the once-only lookup credential → credential
lookup), assert locale switching changes copy only (never totals/order number/state), and
redact artifacts (no screenshots or URLs ever contain the credential or real personal data).
The cart unit suite (`tests/unit/cart.test.ts`) covers the signed cookie model
(tamper/expiry) and shipping boundaries; `tests/integration/cart.test.ts` covers revalidation
and the bounded, atomic service mutations — including an add that cannot grow the line
reporting `insufficient-stock` rather than a false success. New unit suites cover the order
state machine, checkout validation, payment-gateway signing, order credentials, and the
order→view mapping (ADR-0008).

Playwright writes screenshots to `e2e/screenshots/<project>/<locale>-*.png` and, in CI, a
`commit.txt` with the exact tested commit. Artifacts are uploaded by the `CI` workflow
(`.github/workflows/ci.yml`).

## Troubleshooting

| Symptom                                     | Fix                                                            |
| ------------------------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL is not set`                   | Copy `.env.example` to `.env`                                  |
| `prisma generate` fails after `pnpm install`| Run `pnpm prisma:generate` manually; check `.env`              |
| `ECONNREFUSED 127.0.0.1:5432`               | `docker compose up -d --wait`; check `docker ps`               |
| `engine-strict` install error               | Use Node.js 24 (`.node-version`); `nvm use` / `fnm use`        |
| Port 5432 already in use                    | Change the host port in `docker-compose.yml` and `.env`        |
| Playwright says browser missing            | `pnpm exec playwright install chromium`                        |

## CI

`.github/workflows/ci.yml` (workflow name `CI`) runs on push/PR: clean install → migrate →
seed → i18n validation → lint → typecheck → unit+integration tests → production build →
Playwright smoke with screenshots → uploads the `storefront-screenshots` artifact containing
desktop and mobile screenshots for all three locales plus `commit.txt` (exact tested commit).
The repository's landing automation listens for this workflow by name.

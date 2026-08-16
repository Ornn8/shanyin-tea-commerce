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
filtering (ADR-0004).

## 5. Run

```bash
pnpm dev              # http://localhost:3000, redirects / → /zh-CN
```

## Verification suite (mirrors CI)

With the database up, migrated, and seeded:

```bash
pnpm i18n:check     # catalogs: missing English source keys, unknown locale ids, unsafe interpolation
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit (strict)
pnpm test           # Vitest: unit + integration (integration needs DATABASE_URL)
pnpm build          # production build (dynamic pages; no DB access at build time)
pnpm exec playwright install chromium   # once per machine
pnpm e2e            # Playwright smoke: desktop 1440×900 + mobile 390×844, all 3 locales
```

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

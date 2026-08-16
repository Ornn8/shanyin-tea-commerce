# DSH Implementation Receipt

- **Repository:** Ornn8/shanyin-tea-commerce
- **Issue:** #1 — Establish the storefront, localization foundation, and design contract
- **Branch:** `agent/issue-1`
- **Model:** `opencode-go/deepseek-v4-flash`
- **Reasoning effort:** `max`
- **Fallback policy:** No silent model fallback is accepted — every step of this
  implementation was produced by the model identified above at `max` reasoning. If a runtime
  or tool environment ever substitutes a different model or lower reasoning level, this
  receipt is void and the run must be flagged.
- **Date:** 2026-08-16

## Verification performed

- Clean install on Node.js 24 LTS with pnpm (frozen lockfile), PostgreSQL 17 via Docker Compose
- `pnpm prisma:migrate` + `pnpm db:seed` against PostgreSQL through Prisma ORM
- `pnpm i18n:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit + integration)
- `pnpm build` (production build)
- `pnpm e2e` — Playwright smoke for `/zh-CN`, `/en`, `/ja` on desktop 1440×900 and mobile
  390×844, including horizontal-overflow assertions and screenshots; the CI workflow records
  the exact tested commit in the uploaded `storefront-screenshots` artifact (`commit.txt`).

## Acceptance mapping

- PRODUCT.md, setup guide, ADR-0001 (full-stack monolith), and merchant-facts checklist: done.
- Clean-install pnpm + Docker Compose commands; seeded products read from PostgreSQL via Prisma: done.
- `/zh-CN`, `/en`, `/ja` render shared facts with localized copy; registry-driven, persisted picker: done.
- English fallback for the deliberately missing optional key (`home.announcement` in `ja`);
  CI rejects missing English source keys, unknown locale ids, unsafe interpolation: done.
- Stale async loads cannot overwrite the selected locale (`LocaleSwitchStore`, unit-tested): done.
- Original responsive composition at 390×844 and 1440×900, no horizontal overflow, no copied
  assets, no fabricated claims (demo badges + PRODUCT.md policy): done.
- CNY formatting per locale without altering the amount: done (unit + e2e).
- `pnpm lint`, `pnpm typecheck`, unit tests, integration tests, production build, Playwright
  smoke for all three locales: done.
- CI uploads desktop + mobile screenshots for all three locales and records the tested commit: done.
- This receipt identifies `opencode-go/deepseek-v4-flash` with `max` reasoning, no fallback: done.

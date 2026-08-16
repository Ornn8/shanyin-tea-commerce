# ADR-0002: Localization as a registry-driven dimension

- Status: Accepted
- Date: 2026-08-16

## Context

The storefront supports `zh-CN`, `en`, and `ja`. Requirements: route-visible locale
selection (`/zh-CN`, `/en`, `/ja`), persisted visitor choice, race-safe switching, English as
the deterministic fallback for deliberately missing optional keys, and CI that rejects
catalog drift (missing English source keys, unknown locale ids, unsafe interpolation).
Hard-coded binary/ternary locale checks are explicitly forbidden.

## Decision

- A single **locale registry** (`src/i18n/registry.ts`) declares `LOCALE_IDS`,
  `DEFAULT_LOCALE`, `FALLBACK_LOCALE` (English), `OPTIONAL_KEYS`, `MESSAGE_PARAMS`, and
  per-locale metadata. Everything locale-related is derived from it.
- **Routing:** locale is a top-level dynamic segment `/[locale]` with `generateStaticParams`
  from the registry and `dynamicParams = false`. `/` reads the persisted cookie and redirects
  to the saved or default locale.
- **Persistence:** the picker writes `shanyin_locale` (cookie, 1 year) and localStorage
  before navigating; `router.replace` swaps the locale segment in place.
- **Catalogs:** flat, typed message catalogs (`src/i18n/messages/<locale>.ts`); English is the
  source of truth. `getResolvedCatalog` merges `{ ...en, ...locale }`, so an omitted optional
  key deterministically resolves to English. `t()` escapes all interpolated values and throws
  on unknown keys, unused params, or missing params — no unsafe interpolation.
- **Race safety:** all asynchronous locale-data loads go through `LocaleSwitchStore`
  (`src/i18n/client-store.ts`), which tags each request with a monotonic sequence and rejects
  stale resolutions; a slower, earlier switch can never overwrite a newer selection. Because
  messages are server-rendered per request, this guard is the safety layer for any future
  client-side dictionary loading, and it is unit-tested with out-of-order resolutions.
- **CI validation:** `pnpm i18n:check` (`scripts/i18n-validate.mjs`) fails on unknown locale
  ids, missing required keys, keys absent from the English source, HTML/`${}` in messages,
  and placeholder sets that diverge from English. Runs in the `CI` workflow.

## Consequences

- Adding a locale = add registry entry + catalog file; routing, picker, formatting, and CI
  pick it up automatically. Removing the English fallback requires changing
  `FALLBACK_LOCALE` and the validator's expectations.
- `OPTIONAL_KEYS` must stay small and deliberate; every key in it weakens full coverage.
- Message values are plain text only; any future rich-text needs a separate safe renderer
  (this is enforced by validation today).

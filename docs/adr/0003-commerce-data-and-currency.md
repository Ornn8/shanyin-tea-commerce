# ADR-0003: Commerce data boundaries and CNY currency

- Status: Accepted
- Date: 2026-08-16

## Context

The storefront must keep product identifiers, SKUs, prices, inventory, and user-authored
content language-neutral, while allowing localized product copy. Currency must remain CNY and
be formatted correctly per locale **without altering the underlying amount**. All commerce
data is demo content until the merchant supplies verified facts (see PRODUCT.md).

## Decision

**Schema split** (`prisma/schema.prisma`):

- Language-neutral facts on `Product`: `slug`, `sku`, `priceCents` (integer cents),
  `currency` (`CNY`), `inventory`, `origin` (factual field; demo values for now).
- Localized copy in `ProductLocalization` / `CategoryLocalization` keyed by `(entityId, locale)`
  with locale ids from the i18n registry. Views (`src/lib/products.ts`) pick the requested
  locale and fall back to English, then to any available row.
- No user-authored content exists in this slice; when it arrives it must be stored once,
  language-neutral, per this policy.

**Currency formatting** (`src/i18n/format.ts`):

- The only money representation is integer CNY cents. `formatCny(cents, locale)` uses
  `Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY', min/maxFractionDigits: 2 })`
  — e.g. `¥1,280.00` (zh-CN), `CN¥1,280.00` (en), `￥1,280.00` (ja) — purely presentational.
- Tests assert the same underlying digits across locales, deterministic output, input
  immutability, and rejection of non-integer amounts.

**Design contract tokens** (`src/app/globals.css`, `@theme`):

- pine green (`--color-pine-*`), celadon (`--color-celadon-*`), stone gray (Tailwind `stone`),
  restrained lacquer red (`--color-lacquer-*`), CJK-first font stacks.
- Distinctive details: seal-label stamps (`seal-stamp`), tea-ticket cards with perforated
  divider and notched price tickets (`ticket-card`, `ticket-perforation`, `price-ticket`).
- Original visual direction only; no marketplace assets, text, icons, or branding are copied.

## Consequences

- A price change is one row in one table and renders identically in all three locales —
  formatting differences cannot drift because display never mutates the amount.
- Localization rows are required for every registered locale (seed + integration test
  enforce this); missing rows degrade to English deterministically.
- Design tokens are the only palette source; components use `pine`/`celadon`/`lacquer`/`stone`
  utilities, keeping the contract machine-checkable via Tailwind compilation.

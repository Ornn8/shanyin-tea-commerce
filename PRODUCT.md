# PRODUCT.md — Product Truth for Shanyin Tea (山隐茶事)

This document is the single source of truth for what the storefront currently sells and for
what must change before production. Everything in this repository that looks like a commercial
fact — product names, origins, prices, inventory, descriptions, tasting notes, and imagery —
is **demo content** unless explicitly marked otherwise.

## Content policy

1. **No fabricated claims.** The storefront never asserts health benefits, certifications
   (organic, fair-trade, quality grades), harvest dates, real scarcity, testimonials, or
   sustainability credentials. If a fact is not supplied by the merchant, it is not claimed.
2. **Everything is replaceable.** Every demo listing is visibly tagged "Demo", and the footer
   and home page state that products, prices, origins, and imagery are placeholders pending
   merchant verification.
3. **Facts are language-neutral.** Product identifiers (slug, SKU), prices, inventory, origin,
   leaf form, and caffeine level are stored once and shared across all three locales (see
   `docs/adr/0003-commerce-data-and-currency.md` and `docs/adr/0004-catalog-discovery-url-state.md`).
   Only product copy (name, description, tasting notes) is localized; the display labels for
   leaf form and caffeine are localized message keys (`catalog.form.*`, `catalog.caffeine.*`).

## Demo catalog (seeded by `prisma db seed`)

All prices are in CNY (¥), stored as integer cents (`priceCents`), displayed with
`Intl.NumberFormat(..., { style: 'currency', currency: 'CNY' })`.

| # | Slug             | SKU        | Name (en / zh-CN / ja)      | Price (¥)  | Inventory | Form (demo) | Caffeine (demo) | Origin (demo placeholder)            | Category |
| - | ---------------- | ---------- | --------------------------- | ---------- | --------- | ----------- | ---------------- | ------------------------------------- | -------- |
| 1 | `spring-longjing`| SHY-G-001  | Spring Longjing / 西湖龙井·明前 / 西湖龍井・明前 | 1,280.00 | 40 | Loose | High | Longjing Village, Hangzhou, Zhejiang | Green tea |
| 2 | `biluochun`      | SHY-G-002  | Biluochun / 碧螺春 / 碧螺春   | 960.00     | 25 | Loose | Medium | Dongting Mountain, Suzhou, Jiangsu   | Green tea |
| 3 | `tieguanyin`     | SHY-O-001  | Tieguanyin Oolong / 安溪铁观音 / 安渓鉄観音 | 880.00 | 60 | Loose | Medium | Anxi County, Fujian                  | Oolong tea |
| 4 | `dahongpao`      | SHY-O-002  | Dahongpao Rock Tea / 武夷大红袍 / 武夷山大紅袍 | 1,680.00 | 12 | Loose | Medium | Wuyi Mountain, Fujian                | Oolong tea |
| 5 | `liubao`         | SHY-D-001  | Liubao Dark Tea / 六堡茶 / 六堡茶 | 720.00  | 30 | Compressed | Low | Liubao Town, Wuzhou, Guangxi         | Dark tea |
| 6 | `ripe-puerh`     | SHY-D-002  | Ripe Pu-erh / 云南熟普 / 熟プーアル茶 | 640.00 | 18 | Compressed | Low | Menghai, Yunnan                      | Dark tea |

Categories: `green-tea` (绿茶 / Green tea / 緑茶), `oolong-tea` (乌龙茶 / Oolong tea / 烏龍茶),
`dark-tea` (黑茶 / Dark tea / 黒茶).

Availability is derived from the shared inventory fact: `inventory > 0` means in stock.
Catalog search and filters (family, form, caffeine, price range, availability) operate on
these language-neutral facts; only the search query matches localized product copy, with a
documented deterministic fallback (see `docs/adr/0004-catalog-discovery-url-state.md`).

Descriptions and tasting notes in the seed are deliberately generic ("Demo listing…",
"Demo notes…") so no prose can be mistaken for a verified claim.

## Merchant facts and assets still required for production

Before production the merchant must supply verified replacements for every item below. This
list is the acceptance checklist for the "explicit list of merchant facts/assets" requirement.

**Facts (per product)**

- [ ] Verified product names (all three locales: zh-CN, en, ja)
- [ ] Verified place of origin, including harvest/processing year and lot information
- [ ] Real prices in CNY (the currency of record for the storefront)
- [ ] Real inventory levels and restock policy
- [ ] Verified leaf form and caffeine levels for every product (current values are demo
      placeholders; their display labels are localized message keys)
- [ ] Verified descriptions and tasting notes (all three locales)
- [ ] Any certifications or quality claims the merchant can actually substantiate — and
      removal of all demo tags once real facts exist
- [ ] SKU/identifier policy (the demo SKU scheme `SHY-*` is a placeholder)

**Assets**

- [ ] Logo and brand assets (the seal "山" and hand-drawn SVG tea illustrations are placeholders)
- [ ] Merchant photography for every product (current images are generated SVG placeholders)
- [ ] Legal business identity: registered name, address, contact, tax/vAT details where applicable
- [ ] Terms of service, privacy policy, returns/refunds policy
- [ ] Shipping and fulfillment details, delivery areas and fees
- [ ] Payment provider integration (the current cart is an explicit local demo with no checkout)
- [ ] Customer support channel

**Storefront**

- [ ] Confirm the locale set (zh-CN, en, ja) and the default locale (currently zh-CN)
- [ ] Confirm the fallback-locale policy (currently: English for deliberately missing optional keys)
- [ ] Decide whether any optional message keys (e.g. `home.announcement`) should ship in all locales

## How to replace demo data

1. Update `prisma/seed.ts` (or the CMS/import pipeline that replaces it) with verified facts
   and copy; re-run `pnpm db:seed` (upserts, idempotent).
2. Replace placeholder imagery (`src/components/placeholder-tea.tsx` + any `PlaceholderTea`
   usages) with merchant photography.
3. Replace the "Demo" badges and demo banners in the header/home/footer and in
   `src/i18n/messages/*` once real content is verified.
4. Update this file to reflect the new truth.

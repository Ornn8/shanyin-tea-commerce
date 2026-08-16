/**
 * Catalog discovery option lists — canonical, language-neutral URL ids for
 * leaf form, caffeine level, and sort. Labels are i18n message keys
 * (`catalog.form.*`, `catalog.caffeine.*`, `catalog.sort.*`); these values
 * are what URLs and the Prisma enum mapping use, so this module stays free of
 * any database import (unit-testable in isolation).
 */
export const CATALOG_PAGE_SIZE = 4;

/** Canonical URL ids for leaf form (labels are i18n keys, values are language-neutral). */
export const PRODUCT_FORMS = ['loose', 'compressed'] as const;
export type ProductFormId = (typeof PRODUCT_FORMS)[number];

/** Canonical URL ids for caffeine level (labels are i18n keys, values are language-neutral). */
export const CAFFEINE_LEVELS = ['low', 'medium', 'high'] as const;
export type CaffeineLevelId = (typeof CAFFEINE_LEVELS)[number];

/** Catalog sort ids; `featured` is the default ranking (language-neutral). */
export const CATALOG_SORTS = ['featured', 'price-asc', 'price-desc', 'name-asc'] as const;
export type CatalogSortId = (typeof CATALOG_SORTS)[number];

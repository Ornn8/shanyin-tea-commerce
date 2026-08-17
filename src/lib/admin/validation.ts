/**
 * Server-side validation for merchant administration mutations.
 *
 * Every mutation re-validates the full payload on the server — client-side
 * convenience parsing is never trusted. Rules that map to the acceptance
 * criteria (Issue #3):
 *
 * - Prices are integer minor units of CNY (`priceCents`): floats, decimals,
 *   and unsafe integers are rejected. `parsePriceToCents` converts the
 *   editor's yuan string without ever going through a floating-point amount.
 * - Inventory is a non-negative integer; negative stock is rejected.
 * - SKUs are unique per product and globally (DB unique index + pre-check);
 *   slugs are stable URL identifiers.
 * - Localization rows are keyed by registered locale ids only; a provided
 *   locale row must carry a non-empty title (missing translations fall back
 *   to English in preview instead of being stored empty).
 */
import { LOCALE_IDS, isLocaleId, type LocaleId } from '@/i18n/registry';
import { AdminError } from './errors';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Whole-yuan input: digits with an optional two-digit fraction. */
export const PRICE_YUAN_PATTERN = /^\d{1,7}(?:\.\d{1,2})?$/;

export const MAX_SLUG_LENGTH = 64;
export const MAX_SKU_LENGTH = 64;
export const MAX_VARIANT_NAME_LENGTH = 120;
export const MAX_ORIGIN_LENGTH = 500;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_SEO_TITLE_LENGTH = 200;
export const MAX_SEO_DESCRIPTION_LENGTH = 500;
export const MAX_MEDIA_ALT_LENGTH = 500;
export const MAX_PRICE_CENTS = 100_000_000; // ¥1,000,000.00
export const MAX_INVENTORY = 10_000_000;

export type ProductFormId = 'LOOSE' | 'COMPRESSED';
export type CaffeineLevelId = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LocalizedCopyInput {
  name: string;
  description: string;
  tastingNotes: string;
  brewingNotes?: string;
  seoTitle?: string;
  seoDescription?: string;
  mediaAlt?: string;
}

export interface VariantInput {
  /** Present only for existing variants being updated. */
  id?: string;
  sku: string;
  name: string;
  priceCents: number;
  inventory: number;
}

export interface ProductInput {
  slug: string;
  origin: string;
  form: ProductFormId;
  caffeine: CaffeineLevelId;
  categoryId: string;
  variants: VariantInput[];
  localizations: Partial<Record<LocaleId, LocalizedCopyInput>>;
}

function fail(code: string, message: string, field?: string): never {
  throw new AdminError(code, message, field ? { [field]: message } : {});
}

/** Strict integer parse (number or numeric string); rejects floats and non-digits. */
export function parseInteger(raw: unknown, label: string, field: string): number {
  if (typeof raw === 'number') {
    if (Number.isSafeInteger(raw)) return raw;
    fail('invalid-input', `${label} must be an integer.`, field);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^-?\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed))) {
      return Number(trimmed);
    }
  }
  fail('invalid-input', `${label} must be an integer.`, field);
}

/**
 * Convert the editor's yuan string into integer cents without floating-point
 * arithmetic: "1280.50" → 128050. Rejects empty, negative, more-than-two-
 * decimal, non-numeric, and overflow input.
 */
export function parsePriceToCents(raw: unknown, field = 'price'): number {
  if (typeof raw !== 'string') {
    fail('invalid-price', 'Price must be a whole yuan amount with at most two decimals.', field);
  }
  const trimmed = raw.trim();
  if (!PRICE_YUAN_PATTERN.test(trimmed)) {
    fail(
      'invalid-price',
      'Price must be a whole yuan amount with at most two decimals (e.g. 1280 or 1280.50).',
      field,
    );
  }
  const [yuan = '0', fen = ''] = trimmed.split('.');
  const cents = Number(yuan) * 100 + (fen ? Number(fen.padEnd(2, '0')) : 0);
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_CENTS) {
    fail('invalid-price', `Price must be between ¥0.00 and ¥1,000,000.00.`, field);
  }
  return cents;
}

export function validateSlug(raw: unknown, field = 'slug'): string {
  if (typeof raw !== 'string') fail('invalid-slug', 'Slug must be a string.', field);
  const slug = raw.trim().toLowerCase();
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    fail(
      'invalid-slug',
      'Slug must be 1–64 lowercase letters, digits, and single hyphens (e.g. spring-longjing).',
      field,
    );
  }
  return slug;
}

export function validateSku(raw: unknown, field = 'sku'): string {
  if (typeof raw !== 'string') fail('invalid-sku', 'SKU must be a string.', field);
  const sku = raw.trim();
  if (sku.length === 0 || sku.length > MAX_SKU_LENGTH || !SKU_PATTERN.test(sku)) {
    fail('invalid-sku', 'SKU must be 1–64 characters: letters, digits, dot, dash, underscore.', field);
  }
  return sku;
}

export function validateVariantName(raw: unknown, field = 'name'): string {
  if (typeof raw !== 'string') fail('invalid-variant-name', 'Variant name must be a string.', field);
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_VARIANT_NAME_LENGTH) {
    fail('invalid-variant-name', `Variant name must be 1–${MAX_VARIANT_NAME_LENGTH} characters.`, field);
  }
  return name;
}

function toStrictInteger(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^-?\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed))) return Number(trimmed);
  }
  return undefined;
}

export function validatePriceCents(raw: unknown, field = 'priceCents'): number {
  const cents = toStrictInteger(raw);
  if (cents === undefined) {
    fail('invalid-price', 'Price must be an integer number of cents (no fractions).', field);
  }
  if (cents < 0 || cents > MAX_PRICE_CENTS) {
    fail('invalid-price', 'Price must be between 0 and 100000000 cents.', field);
  }
  return cents;
}

export function validateInventory(raw: unknown, field = 'inventory'): number {
  const inventory = toStrictInteger(raw);
  if (inventory === undefined) {
    fail('invalid-inventory', 'Inventory must be an integer (no fractions).', field);
  }
  if (inventory < 0 || inventory > MAX_INVENTORY) {
    fail('invalid-inventory', 'Inventory must be a non-negative integer.', field);
  }
  return inventory;
}

function validateOptionalText(
  raw: unknown,
  label: string,
  maxLength: number,
  field: string,
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') fail('invalid-input', `${label} must be a string.`, field);
  const value = raw.trim();
  if (value.length > maxLength) {
    fail('invalid-input', `${label} must be at most ${maxLength} characters.`, field);
  }
  return value === '' ? undefined : value;
}

/** String that may be empty (falls back to English in preview) but never null. */
function validateOptionalString(
  raw: unknown,
  label: string,
  maxLength: number,
  field: string,
): string {
  if (typeof raw !== 'string') fail('invalid-input', `${label} must be a string.`, field);
  const value = raw.trim();
  if (value.length > maxLength) {
    fail('invalid-input', `${label} must be at most ${maxLength} characters.`, field);
  }
  return value;
}

function validateRequiredText(
  raw: unknown,
  label: string,
  maxLength: number,
  field: string,
): string {
  if (typeof raw !== 'string') fail('invalid-input', `${label} must be a string.`, field);
  const value = raw.trim();
  if (value.length === 0) fail('invalid-input', `${label} is required.`, field);
  if (value.length > maxLength) {
    fail('invalid-input', `${label} must be at most ${maxLength} characters.`, field);
  }
  return value;
}

export function validateLocalizedCopy(
  locale: string,
  raw: unknown,
  fieldPrefix = 'localizations',
): LocalizedCopyInput {
  if (!isLocaleId(locale)) {
    fail('invalid-locale', `Unknown locale "${locale}".`, `${fieldPrefix}.${locale}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    fail('invalid-input', 'Localized copy must be an object.', `${fieldPrefix}.${locale}`);
  }
  const obj = raw as Record<string, unknown>;
  const p = (name: string) => `${fieldPrefix}.${locale}.${name}`;
  return {
    // Title is the anchor of every locale row; a missing translation means
    // no row at all (English fallback), never an empty stored title.
    name: validateRequiredText(obj.name, 'Title', MAX_TITLE_LENGTH, p('name')),
    // Description and tasting notes may stay empty in a locale (English
    // fallback in preview); publishing requires the English ones.
    description: validateOptionalString(obj.description, 'Description', MAX_TEXT_LENGTH, p('description')),
    tastingNotes: validateOptionalString(obj.tastingNotes, 'Tasting notes', MAX_NOTES_LENGTH, p('tastingNotes')),
    brewingNotes: validateOptionalText(obj.brewingNotes, 'Brewing guidance', MAX_NOTES_LENGTH, p('brewingNotes')),
    seoTitle: validateOptionalText(obj.seoTitle, 'SEO title', MAX_SEO_TITLE_LENGTH, p('seoTitle')),
    seoDescription: validateOptionalText(obj.seoDescription, 'SEO description', MAX_SEO_DESCRIPTION_LENGTH, p('seoDescription')),
    mediaAlt: validateOptionalText(obj.mediaAlt, 'Media alt text', MAX_MEDIA_ALT_LENGTH, p('mediaAlt')),
  };
}

export function validateFormId(raw: unknown): ProductFormId {
  if (raw === 'LOOSE' || raw === 'COMPRESSED') return raw;
  fail('invalid-form', 'Leaf form must be LOOSE or COMPRESSED.', 'form');
}

export function validateCaffeineId(raw: unknown): CaffeineLevelId {
  if (raw === 'LOW' || raw === 'MEDIUM' || raw === 'HIGH') return raw;
  fail('invalid-caffeine', 'Caffeine level must be LOW, MEDIUM, or HIGH.', 'caffeine');
}

export function validateOrigin(raw: unknown): string {
  return validateRequiredText(raw, 'Origin', MAX_ORIGIN_LENGTH, 'origin');
}

export function normalizeVariant(raw: unknown, index: number): VariantInput {
  if (typeof raw !== 'object' || raw === null) {
    fail('invalid-input', `Variant ${index + 1} must be an object.`, `variants[${index}]`);
  }
  const obj = raw as Record<string, unknown>;
  const p = (name: string) => `variants[${index}].${name}`;
  const variant: VariantInput = {
    sku: validateSku(obj.sku, p('sku')),
    name: validateVariantName(obj.name, p('name')),
    priceCents: validatePriceCents(obj.priceCents, p('priceCents')),
    inventory: validateInventory(obj.inventory, p('inventory')),
  };
  if (obj.id !== undefined && obj.id !== null) {
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
      fail('invalid-input', 'Variant id must be a string.', p('id'));
    }
    variant.id = obj.id;
  }
  return variant;
}

/**
 * Normalize and validate the raw (client-supplied, untrusted) product
 * payload. Throws AdminError with per-field messages on the first problem.
 */
export function normalizeProductInput(raw: unknown): ProductInput {
  if (typeof raw !== 'object' || raw === null) {
    fail('invalid-input', 'Product payload must be an object.', 'payload');
  }
  const obj = raw as Record<string, unknown>;

  const categoryId = obj.categoryId;
  if (typeof categoryId !== 'string' || categoryId.length === 0) {
    fail('invalid-category', 'A category is required.', 'categoryId');
  }

  if (!Array.isArray(obj.variants) || obj.variants.length === 0) {
    fail('invalid-variants', 'At least one variant is required.', 'variants');
  }

  if (typeof obj.localizations !== 'object' || obj.localizations === null) {
    fail('invalid-input', 'Localized copy must be an object.', 'localizations');
  }

  const localizations: ProductInput['localizations'] = {};
  for (const [key, value] of Object.entries(obj.localizations as Record<string, unknown>)) {
    if (!(LOCALE_IDS as readonly string[]).includes(key)) {
      fail('invalid-locale', `Unknown locale "${key}".`, `localizations.${key}`);
    }
    localizations[key as LocaleId] = validateLocalizedCopy(key, value);
  }

  const variants = (obj.variants as unknown[]).map(normalizeVariant);
  const seenSkus = new Set<string>();
  variants.forEach((variant, index) => {
    if (seenSkus.has(variant.sku)) {
      fail(
        'duplicate-sku',
        `SKU "${variant.sku}" is used more than once in this product.`,
        `variants[${index}].sku`,
      );
    }
    seenSkus.add(variant.sku);
  });

  return {
    slug: validateSlug(obj.slug),
    origin: validateOrigin(obj.origin),
    form: validateFormId(obj.form),
    caffeine: validateCaffeineId(obj.caffeine),
    categoryId,
    variants,
    localizations,
  };
}

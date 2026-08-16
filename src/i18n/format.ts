/**
 * Locale-aware formatting. Currency stays CNY for every locale; only the
 * presentation changes (symbol, separators, decimal digits), never the
 * underlying amount (cents are the single source of truth).
 */
import type { LocaleId } from './registry';

export const CURRENCY = 'CNY' as const;

const CNY_FORMATTERS = new Map<LocaleId, Intl.NumberFormat>();

function formatter(locale: LocaleId): Intl.NumberFormat {
  let format = CNY_FORMATTERS.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    CNY_FORMATTERS.set(locale, format);
  }
  return format;
}

/** Format an amount in CNY cents for the given locale. Pure — never mutates input. */
export function formatCny(cents: number, locale: LocaleId): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`formatCny expects a safe integer amount in cents, got ${cents}`);
  }
  return formatter(locale).format(cents / 100);
}

/** Locale-specific symbol shown by the currency formatter. */
export function cnySymbol(locale: LocaleId): string {
  const parts = formatter(locale).formatToParts(1234);
  return parts.find((part) => part.type === 'currency')?.value ?? '¥';
}

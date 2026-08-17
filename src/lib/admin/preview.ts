/**
 * Per-locale completeness and English-fallback preview helpers (ADR-0003,
 * ADR-0005). Shared by the server (publish checks, admin queries) and the
 * client editor (live completeness + fallback preview), so preview logic is
 * deterministic and unit-tested in one place.
 */
import { FALLBACK_LOCALE, type LocaleId } from '@/i18n/registry';

export const LOCALIZED_FIELDS = [
  'name',
  'description',
  'tastingNotes',
  'brewingNotes',
  'seoTitle',
  'seoDescription',
  'mediaAlt',
] as const;

export type LocalizedField = (typeof LOCALIZED_FIELDS)[number];

export interface LocalizedRow {
  locale: string;
  name: string;
  description: string;
  tastingNotes: string;
  brewingNotes?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  mediaAlt?: string | null;
}

export function isFieldFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** ADR-0003 pick order: requested locale → English → any available row. */
export function pickEffectiveRow(
  rows: LocalizedRow[],
  locale: LocaleId,
): LocalizedRow | undefined {
  return (
    rows.find((row) => row.locale === locale) ??
    rows.find((row) => row.locale === FALLBACK_LOCALE) ??
    rows[0]
  );
}

/** Per-field filled map for one locale row (missing row = all empty). */
export function fieldCompleteness(
  row: LocalizedRow | undefined,
): Record<LocalizedField, boolean> {
  const filled: Record<LocalizedField, boolean> = {
    name: false,
    description: false,
    tastingNotes: false,
    brewingNotes: false,
    seoTitle: false,
    seoDescription: false,
    mediaAlt: false,
  };
  if (!row) return filled;
  for (const field of LOCALIZED_FIELDS) {
    filled[field] = isFieldFilled(row[field] as string | null | undefined);
  }
  return filled;
}

/** Number of filled fields (0–7) for one locale row. */
export function completenessCount(row: LocalizedRow | undefined): number {
  return Object.values(fieldCompleteness(row)).filter(Boolean).length;
}

export const TOTAL_LOCALIZED_FIELDS = LOCALIZED_FIELDS.length;

/**
 * Effective value a shopper sees for a field in `locale`: the locale's own
 * row, else English, else any row, else the given fallback (usually the slug).
 */
export function effectiveField(
  rows: LocalizedRow[],
  locale: LocaleId,
  field: LocalizedField,
  fallback = '',
): string {
  const row = pickEffectiveRow(rows, locale);
  const value = row?.[field];
  if (isFieldFilled(value)) return value as string;
  if (row && locale !== FALLBACK_LOCALE) {
    const en = rows.find((r) => r.locale === FALLBACK_LOCALE);
    if (isFieldFilled(en?.[field])) return en![field] as string;
  }
  if (locale === FALLBACK_LOCALE) {
    // English row exists but the field is empty: fall back to any row.
    const any = rows.find((r) => isFieldFilled(r[field] as string | null | undefined));
    if (any) return any[field] as string;
  }
  return fallback;
}

/** True when the locale's own row is empty for a field (English shown instead). */
export function isFallbackUsed(
  rows: LocalizedRow[],
  locale: LocaleId,
  field: LocalizedField,
): boolean {
  if (locale === FALLBACK_LOCALE) return false;
  const row = rows.find((r) => r.locale === locale);
  return !isFieldFilled(row?.[field]);
}

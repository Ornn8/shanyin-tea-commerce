/**
 * Locale registry — the single source of truth for which locales exist.
 *
 * Everything locale-related in the storefront is derived from this registry
 * (routing, catalogs, formatting, the picker, and CI validation). There are
 * deliberately no hard-coded binary/ternary locale checks in the app.
 */

export const LOCALE_IDS = ['zh-CN', 'en', 'ja'] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

/** Locale a visitor without a saved choice is redirected to. */
export const DEFAULT_LOCALE: LocaleId = 'zh-CN';

/**
 * Locale used to resolve a deliberately missing optional translation key.
 * English is the deterministic fallback for missing optional keys.
 */
export const FALLBACK_LOCALE: LocaleId = 'en';

/** Name of the cookie that persists the visitor's locale choice. */
export const LOCALE_COOKIE = 'shanyin_locale';

/**
 * Message keys that a locale may deliberately omit; the fallback locale
 * (English) is then used deterministically. Any key NOT listed here must
 * exist in every locale catalog (enforced by `pnpm i18n:check`).
 */
export const OPTIONAL_KEYS: readonly string[] = ['home.announcement'];

/**
 * Interpolation parameters each parameterized message key accepts.
 * Enforced by `pnpm i18n:check` and at runtime by `t()` (a param that is
 * missing, unknown, or unescaped is rejected — no unsafe interpolation).
 */
export const MESSAGE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'search.resultsFor': ['query'],
  'search.noResults': ['query'],
};

export interface LocaleMeta {
  /** Human-readable name shown in the locale picker. */
  label: string;
  /** Value for the <html lang> attribute. */
  htmlLang: string;
  /** Text direction. */
  direction: 'ltr' | 'rtl';
}

export const LOCALE_META: Record<LocaleId, LocaleMeta> = {
  'zh-CN': { label: '简体中文', htmlLang: 'zh-CN', direction: 'ltr' },
  en: { label: 'English', htmlLang: 'en', direction: 'ltr' },
  ja: { label: '日本語', htmlLang: 'ja', direction: 'ltr' },
};

export function isLocaleId(value: string): value is LocaleId {
  return (LOCALE_IDS as readonly string[]).includes(value);
}

/** Coerce an arbitrary (possibly stale/unknown) value into a known locale id. */
export function normalizeLocale(value: string | null | undefined): LocaleId {
  return value !== undefined && value !== null && isLocaleId(value) ? value : DEFAULT_LOCALE;
}

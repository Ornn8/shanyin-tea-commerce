/**
 * Catalog resolution and safe message interpolation.
 *
 * - Catalogs are loaded from the registry (never via hard-coded locale checks).
 * - Missing optional keys resolve deterministically to English
 *   (FALLBACK_LOCALE in src/i18n/registry.ts).
 * - `t()` escapes interpolated values and throws on unknown keys, missing
 *   params, unused params, or leftover placeholders — no unsafe interpolation.
 */
import { en, type MessageKey } from './messages/en';
import { zhCN } from './messages/zh-CN';
import { ja } from './messages/ja';
import { FALLBACK_LOCALE, type LocaleId } from './registry';

export type MessageParams = Readonly<Record<string, string | number>>;

type Catalog = Readonly<Record<string, string>>;

/** Registry-driven catalog loader keyed by locale id. */
const CATALOG_LOADERS: Readonly<Record<LocaleId, () => Catalog>> = {
  'zh-CN': () => zhCN,
  en: () => en,
  ja: () => ja,
};

export function getCatalog(locale: LocaleId): Catalog {
  return CATALOG_LOADERS[locale]();
}

/**
 * Deterministic resolved catalog: English first, then the locale's own
 * entries override it. Any key the locale omits therefore falls back to
 * English, and required keys are guaranteed present by `pnpm i18n:check`.
 */
export function getResolvedCatalog(locale: LocaleId): Catalog {
  if (locale === FALLBACK_LOCALE) return en;
  return { ...en, ...CATALOG_LOADERS[locale]() };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

export function translate(
  catalog: Catalog,
  key: string,
  params?: MessageParams,
): string {
  let message = catalog[key];
  if (message === undefined) {
    message = en[key];
  }
  if (message === undefined) {
    throw new Error(`Unknown message key: "${key}"`);
  }

  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      if (!message.includes(`{${name}}`)) {
        throw new Error(`Unsafe interpolation in "${key}": param "${name}" is not used by the message`);
      }
      message = message.replaceAll(`{${name}}`, escapeHtml(String(value)));
    }
  }

  const leftover = message.match(PLACEHOLDER);
  if (leftover) {
    throw new Error(`Unsafe interpolation in "${key}": missing param(s) for ${leftover.join(', ')}`);
  }
  return message;
}

/** Translator bound to a locale (server components). */
export type Translator = (key: MessageKey, params?: MessageParams) => string;

export function createT(locale: LocaleId): Translator {
  const catalog = getResolvedCatalog(locale);
  return (key, params) => translate(catalog, key, params);
}

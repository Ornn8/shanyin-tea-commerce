/**
 * Race-safe locale switching store (client).
 *
 * Rapid locale switching must never allow a stale asynchronous load to
 * overwrite the selected locale. Every `apply()` call grabs a monotonically
 * increasing sequence number; a load that resolves after a newer request was
 * issued is rejected as stale and can never overwrite the current selection.
 *
 * The storefront renders messages server-side per request, so in practice
 * client catalogs are never swapped in; this guard is the explicit safety
 * layer for any future client-side dictionary loading, and it is unit-tested
 * with out-of-order resolutions.
 */
import type { LocaleId } from './registry';

export class StaleLocaleError extends Error {
  constructor(readonly locale: LocaleId) {
    super(`Stale locale load rejected for "${locale}" (a newer switch superseded it)`);
    this.name = 'StaleLocaleError';
  }
}

export interface LocaleSelection<T> {
  locale: LocaleId;
  data: T;
}

export class LocaleSwitchStore<T> {
  private sequence = 0;
  private current: LocaleSelection<T> | null = null;

  /**
   * Load data for `locale` and apply it only if no newer request has been
   * issued meanwhile. Resolves with the applied selection or throws
   * `StaleLocaleError` when a newer switch superseded this load.
   */
  async apply(locale: LocaleId, load: () => Promise<T>): Promise<LocaleSelection<T>> {
    const seq = ++this.sequence;
    const data = await load();
    if (seq < this.sequence) {
      throw new StaleLocaleError(locale);
    }
    const selection: LocaleSelection<T> = { locale, data };
    this.current = selection;
    return selection;
  }

  /** Invalidate any in-flight load without changing the current selection. */
  cancelPending(): void {
    this.sequence += 1;
  }

  get selection(): LocaleSelection<T> | null {
    return this.current;
  }
}

const PERSISTED_LOCALE_KEY = 'shanyin.locale';

export function readPersistedLocale(): LocaleId | null {
  try {
    const value = localStorage.getItem(PERSISTED_LOCALE_KEY);
    return value as LocaleId | null;
  } catch {
    return null;
  }
}

export function writePersistedLocale(locale: LocaleId): void {
  try {
    localStorage.setItem(PERSISTED_LOCALE_KEY, locale);
  } catch {
    // Persistence is best-effort; navigation must still work without it.
  }
}

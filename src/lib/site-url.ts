/**
 * Request-origin helpers for absolute URLs (canonical links, hreflang
 * alternates, and structured data). The app has no hard-coded public origin,
 * so every absolute URL is derived from the request headers at render time —
 * behind a TLS-terminating proxy the forwarded proto/host are honored.
 */
import type { LocaleId } from '@/i18n/registry';

export interface HeaderLookup {
  get(name: string): string | null;
}

/** Absolute origin for the current request (proxy-aware, deterministic). */
export function originFromHeaders(headers: HeaderLookup): string {
  const proto = headers.get('x-forwarded-proto') ?? 'http';
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

/** Canonical absolute URL of a localized product page. */
export function absoluteProductUrl(
  origin: string,
  locale: LocaleId,
  slug: string,
): string {
  return `${origin}/${locale}/products/${slug}`;
}
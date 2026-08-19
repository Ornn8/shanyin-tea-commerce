/**
 * Request-origin helpers for absolute URLs (canonical links, hreflang
 * alternates, and structured data).
 *
 * Trust model: the public origin MUST come from trusted configuration, not
 * from client-controlled request headers. When `PUBLIC_SITE_URL` is
 * configured (production), it wins and request headers are never consulted.
 * Without it, request headers are honored only for local-development hosts
 * (`localhost`/`127.0.0.1` on the documented dev ports); any other host falls
 * back to `http://localhost:3000`, so an unconfigured instance cannot be
 * made to emit attacker-chosen origins (host-header/forwarded-header
 * poisoning of canonical links and JSON-LD URLs).
 */
import type { LocaleId } from '@/i18n/registry';

export interface HeaderLookup {
  get(name: string): string | null;
}

/** Local-development hosts allowed to name the origin when nothing is configured. */
const DEV_ORIGIN_HOSTS = new Set([
  'localhost:3000',
  '127.0.0.1:3000',
  'localhost:3100',
  '127.0.0.1:3100',
]);

const DEFAULT_ORIGIN = 'http://localhost:3000';

/** Absolute origin for the current request (trusted configuration first). */
export function originFromHeaders(headers: HeaderLookup): string {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  // Trusted configuration wins; forwarded/host headers must never override it.
  if (configured) return configured.replace(/\/+$/, '');
  const proto = headers.get('x-forwarded-proto') ?? 'http';
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  return DEV_ORIGIN_HOSTS.has(host) ? `${proto}://${host}` : DEFAULT_ORIGIN;
}

/** Canonical absolute URL of a localized product page. */
export function absoluteProductUrl(
  origin: string,
  locale: LocaleId,
  slug: string,
): string {
  return `${origin}/${locale}/products/${slug}`;
}
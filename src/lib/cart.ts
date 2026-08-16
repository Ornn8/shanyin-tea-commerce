/**
 * Demo cart persisted in a cookie (SKUs only — language-neutral).
 * The cart is explicitly a local demo: no checkout, payment, or shipping.
 */
export const CART_COOKIE = 'shanyin_cart';

const CART_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function parseCart(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function serializeCart(skus: string[]): string {
  return JSON.stringify(skus);
}

/** Cookie attribute string for client-side writes. */
export function cartCookieAttributes(): string {
  return `${CART_COOKIE}=; Path=/; Max-Age=${CART_MAX_AGE}; SameSite=Lax`;
}

/** Read the cart cookie value on the server. */
export function readCartCookie(cookieHeader: string | null | undefined): string[] {
  if (!cookieHeader) return [];
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CART_COOKIE}=`));
  if (!match) return [];
  return parseCart(decodeURIComponent(match.slice(CART_COOKIE.length + 1)));
}

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { parseCart } from '@/lib/cart-signing';
import { resolveCartItems, type CartLineView } from '@/lib/products';
import { estimateShipping } from '@/lib/shipping-estimate';
import { CartShell, type CartShellLine } from '@/components/cart-shell';

export const dynamic = 'force-dynamic';

interface CartPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Cart page (Issue #5, ADR-0007).
 *
 * Reads and VERIFIES the signed cart cookie, re-resolves every line against
 * the live catalog (publication state, current price, current stock — see
 * ADR-0003 for the language-neutral facts vs. localized-copy split), computes
 * the subtotal + coarse non-binding shipping estimate in CNY, and hands the
 * presentation to the CartShell. An unsigned, tampered, or expired cookie is
 * never displayed: it becomes the localized "expired" notice. Switching locale
 * passes the same SKUs through the same resolver with different copy — lines
 * are never duplicated or dropped by locale.
 */
export default async function CartPage({ params }: CartPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;

  const cookieStore = await cookies();
  // Next.js percent-decodes the cookie value; parseCart verifies the HMAC.
  const expectedCartCookie = cookieStore.get('shanyin_cart')?.value;
  const state = parseCart(expectedCartCookie);

  let lines: CartLineView[] = [];
  let removedNotice = false;
  if (state.status === 'ok') {
    const resolution = await resolveCartItems(state.items, locale);
    lines = resolution.lines;
    removedNotice = resolution.removedSkus.length > 0;
  }

  // Whether this render surfaced something the shell must persist (ADR-0007):
  // an expired/void cookie, a dropped line, or a stock clamp. The client
  // reconcile is gated on this so a plain revalidation render issues no
  // competing cookie write.
  const needsReconcile =
    state.status === 'expired' ||
    removedNotice ||
    lines.some((line) => line.qty !== line.effectiveQty);

  const subtotalCents = lines.reduce((sum, line) => sum + line.effectiveQty * line.priceCents, 0);
  const shipping = estimateShipping(subtotalCents);
  const totals =
    lines.length > 0
      ? {
          subtotalCents,
          shippingFeeCents: shipping.feeCents,
          freeEligible: shipping.freeEligible,
          estimatedTotalCents: subtotalCents + shipping.feeCents,
        }
      : null;

  const shellLines: CartShellLine[] = lines.map((line) => ({
    sku: line.sku,
    productName: line.product.name,
    productSlug: line.product.slug,
    variantName: line.variant.name,
    origin: line.product.origin,
    qty: line.qty,
    effectiveQty: line.effectiveQty,
    inventory: line.variant.inventory,
    snapshotPriceCents: line.snapshotPriceCents,
    priceCents: line.priceCents,
    issues: line.issues,
  }));

  return (
    <CartShell
      locale={locale}
      lines={shellLines}
      totals={totals}
      expired={state.status === 'expired'}
      removedNotice={removedNotice}
      needsReconcile={needsReconcile}
      expectedCartCookie={expectedCartCookie}
    />
  );
}
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isLocaleId, type LocaleId } from '@/i18n/registry';
import { CART_COOKIE } from '@/lib/cart';
import { parseCart } from '@/lib/cart-signing';
import { resolveCheckoutLines } from '@/lib/order-service';
import { estimateShipping } from '@/lib/shipping-estimate';
import { CheckoutForm, type CheckoutFormLine } from '@/components/checkout-form';

export const dynamic = 'force-dynamic';

interface CheckoutPageProps {
  params: Promise<{ locale: string }>;
}

/** Localized product-name snapshot for the active locale (ADR-0003/0008). */
function localizedName(line: { nameZhCn: string; nameEn: string; nameJa: string }, locale: LocaleId): string {
  if (locale === 'zh-CN') return line.nameZhCn || line.nameEn || line.nameJa;
  if (locale === 'ja') return line.nameJa || line.nameEn || line.nameZhCn;
  return line.nameEn || line.nameZhCn || line.nameJa;
}

/**
 * Checkout page (Issue #6, ADR-0008).
 *
 * The server re-reads and VERIFIES the signed cart, re-resolves every line
 * against the live catalog (current prices, current stock), computes the
 * totals (subtotal + the deterministic non-binding shipping estimate) — the
 * client can never supply a price or total — and hands the form a localized
 * order summary. A cart that is empty, tampered, expired, or has an
 * out-of-stock line is returned to the cart page.
 */
export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { locale: raw } = await params;
  if (!isLocaleId(raw)) notFound();
  const locale: LocaleId = raw;

  const cookieStore = await cookies();
  const cartCookie = cookieStore.get(CART_COOKIE)?.value ?? '';
  const state = parseCart(cartCookie);
  if (state.status !== 'ok') redirect(`/${locale}/cart`);
  const resolved = await resolveCheckoutLines(state.items);
  if (resolved.lines.length === 0 || resolved.outOfStock) redirect(`/${locale}/cart`);

  const shipping = estimateShipping(resolved.subtotalCents);
  const totalCents = resolved.subtotalCents + shipping.feeCents;

  const lines: CheckoutFormLine[] = resolved.lines.map((line) => ({
    sku: line.sku,
    name: localizedName(line, locale),
    variantName: line.variantName,
    quantity: line.quantity,
    priceCents: line.priceCents,
    subtotalCents: line.quantity * line.priceCents,
  }));

  // Short fingerprint of the EXACT signed cart cookie. The form pins its
  // submission idempotency key to this value so a genuinely new cart (which
  // signs a different cookie — item set, quantities, AND per-add timestamps)
  // always rotates to a fresh key instead of replaying an older order.
  const cartFingerprint = createHash('sha256').update(cartCookie).digest('hex').slice(0, 16);

  return (
    <CheckoutForm
      locale={locale}
      lines={lines}
      subtotalCents={resolved.subtotalCents}
      shippingFeeCents={shipping.feeCents}
      totalCents={totalCents}
      cartFingerprint={cartFingerprint}
    />
  );
}

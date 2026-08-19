/**
 * Coarse, non-binding shipping estimate (Issue #5, ADR-0007).
 *
 * The demo has no checkout or logistics integration, so the estimate is a
 * simple, deterministic rule on the language-neutral subtotal in integer CNY
 * cents: a flat demo fee below a free-shipping threshold, free at/above it.
 * The UI always labels this as an estimate — it is never presented as a
 * binding quote.
 */
export const SHIPPING_FLAT_CENTS = 1200; // ¥12.00 demo flat estimate
export const SHIPPING_FREE_THRESHOLD_CENTS = 20000; // free over ¥200.00

export interface ShippingEstimate {
  /** Estimated shipping fee in integer CNY cents (0 when free). */
  feeCents: number;
  /** True when the subtotal qualifies for the free tier. */
  freeEligible: boolean;
}

export function estimateShipping(subtotalCents: number): ShippingEstimate {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new Error(`estimateShipping expects a non-negative safe-integer subtotal in cents, got ${subtotalCents}`);
  }
  if (subtotalCents >= SHIPPING_FREE_THRESHOLD_CENTS) {
    return { feeCents: 0, freeEligible: true };
  }
  return { feeCents: SHIPPING_FLAT_CENTS, freeEligible: false };
}
/**
 * Order → serializable view mapping (Issue #6, ADR-0008).
 *
 * The view is what the confirmation and lookup surfaces render. It carries the
 * order's immutable snapshot data (localized name snapshot picked per locale,
 * unit prices, quantities, totals, currency, stable status id, order number)
 * and the contact/shipping data the shopper provided — which is only ever
 * returned when the caller presents the matching credential. Totals and
 * identifiers come from the stored order, never recomputed or reformatted by
 * locale: switching locale changes only the displayed copy (ADR-0003/0008).
 *
 * This module is PURE (no imports) so it is unit-testable in isolation; the
 * row type is structural so callers can pass Prisma rows or test fixtures.
 */
import type { LocaleId } from '@/i18n/registry';
import type { OrderStatusId } from '@/lib/order-status';

export interface OrderLineRowLike {
  sku: string;
  variantName: string;
  nameZhCn: string;
  nameEn: string;
  nameJa: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  currency: string;
}

export interface OrderRowLike {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotalCents: number;
  shippingFeeCents: number;
  totalCents: number;
  email: string;
  recipientName: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  failureReason: string | null;
  paidAt: Date | null;
  createdAt: Date;
  lines: OrderLineRowLike[];
}

export interface OrderLineView {
  sku: string;
  variantName: string;
  /** Localized display-name snapshot for the active locale (ADR-0003/0008). */
  name: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  currency: string;
}

export interface OrderView {
  orderId: string;
  orderNumber: string;
  /** Stable status id; customers see localized copy via message keys. */
  status: OrderStatusId;
  currency: string;
  subtotalCents: number;
  shippingFeeCents: number;
  totalCents: number;
  createdAt: string;
  paidAt: string | null;
  failureReason: string | null;
  lines: OrderLineView[];
  email: string;
  recipientName: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
}

/** Deterministic name-snapshot pick: the locale's own snapshot, else English,
 * else any. (Snapshots are captured for every locale at checkout, so the
 * fallback only matters for fixtures or legacy rows.) */
function localizedName(line: OrderLineRowLike, locale: LocaleId): string {
  if (locale === 'zh-CN') return line.nameZhCn || line.nameEn || line.nameJa;
  if (locale === 'ja') return line.nameJa || line.nameEn || line.nameZhCn;
  return line.nameEn || line.nameZhCn || line.nameJa;
}

export function toOrderView(row: OrderRowLike, locale: LocaleId = 'en'): OrderView {
  return {
    orderId: row.id,
    orderNumber: row.orderNumber,
    status: row.status as OrderStatusId,
    currency: row.currency,
    subtotalCents: row.subtotalCents,
    shippingFeeCents: row.shippingFeeCents,
    totalCents: row.totalCents,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    failureReason: row.failureReason,
    lines: row.lines.map((line) => ({
      sku: line.sku,
      variantName: line.variantName,
      name: localizedName(line, locale),
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      subtotalCents: line.subtotalCents,
      currency: line.currency,
    })),
    email: row.email,
    recipientName: row.recipientName,
    addressLine1: row.addressLine1,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
  };
}

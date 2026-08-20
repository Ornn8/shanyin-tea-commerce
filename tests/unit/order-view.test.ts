/**
 * Order → view mapping unit tests (Issue #6, ADR-0008).
 */
import { describe, expect, it } from 'vitest';
import { toOrderView, type OrderRowLike } from '@/lib/order-view';

function row(overrides: Partial<OrderRowLike> = {}): OrderRowLike {
  return {
    id: 'order_1',
    orderNumber: 'SHY-ABC1234567',
    status: 'PAID',
    currency: 'CNY',
    subtotalCents: 30000,
    shippingFeeCents: 0,
    totalCents: 30000,
    email: 'shopper@example.com',
    recipientName: 'Test Shopper',
    addressLine1: '1 Tea Lane',
    city: 'Hangzhou',
    region: 'Zhejiang',
    postalCode: '310000',
    countryCode: 'CN',
    failureReason: null,
    paidAt: new Date('2026-08-20T00:00:00Z'),
    createdAt: new Date('2026-08-20T00:00:00Z'),
    lines: [
      {
        sku: 'SHY-G-001',
        variantName: '100g',
        nameZhCn: '西湖龙井·明前',
        nameEn: 'Spring Longjing',
        nameJa: '西湖龍井・明前',
        unitPriceCents: 15000,
        quantity: 2,
        subtotalCents: 30000,
        currency: 'CNY',
      },
    ],
    ...overrides,
  };
}

describe('toOrderView (immutable snapshot presentation)', () => {
  it('picks the localized name snapshot per active locale', () => {
    const source = row();
    expect(toOrderView(source, 'en').lines[0].name).toBe('Spring Longjing');
    expect(toOrderView(source, 'zh-CN').lines[0].name).toBe('西湖龙井·明前');
    expect(toOrderView(source, 'ja').lines[0].name).toBe('西湖龍井・明前');
  });

  it('falls back deterministically to another snapshot when a locale lacks one', () => {
    const source = row();
    const line = { ...source.lines[0], nameZhCn: '', nameJa: '' };
    const view = toOrderView({ ...source, lines: [line] }, 'zh-CN');
    expect(view.lines[0].name).toBe('Spring Longjing');
  });

  it('never recomputes totals or identifiers per locale', () => {
    const source = row();
    const en = toOrderView(source, 'en');
    const zh = toOrderView(source, 'zh-CN');
    expect(zh.orderNumber).toBe(en.orderNumber);
    expect(zh.status).toBe(en.status);
    expect(zh.totalCents).toBe(30000);
    expect(zh.orderNumber).toBe('SHY-ABC1234567');
    expect(zh.lines[0].unitPriceCents).toBe(15000);
    expect(zh.lines[0].subtotalCents).toBe(30000);
    // Only the display name differs.
    expect(zh.lines[0].name).not.toBe(en.lines[0].name);
  });

  it('surfaces status and failure reason as stable ids', () => {
    const failed = toOrderView(row({ status: 'FAILED', failureReason: 'out-of-stock', paidAt: null }), 'en');
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toBe('out-of-stock');
    expect(failed.paidAt).toBeNull();
  });
});

/**
 * Unit tests for the product-detail structured data builders, the low-stock
 * threshold, and the request-origin helper (Issue #4, ADR-0006).
 *
 * The policy under test: JSON-LD contains ONLY verified seeded facts —
 * canonical URL, language-neutral SKU, the displayed price and availability,
 * and the visible working brand — and never ratings, reviews, GTINs, MPNs,
 * certifications, harvest dates, or scarcity claims (PRODUCT.md).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  availabilityFromInventory,
  buildProductSchema,
  priceYuanFromCents,
  serializeProductSchema,
} from '@/lib/product-schema';
import { isLowStock, LOW_STOCK_THRESHOLD } from '@/lib/catalog-options';
import { originFromHeaders } from '@/lib/site-url';

const BASE = {
  canonicalUrl: 'https://shop.example/zh-CN/products/spring-longjing',
  name: '西湖龙井 · 明前',
  description: '演示条目。',
  sku: 'SHY-G-001',
  priceCents: 128000,
  inventory: 40,
  brandName: '山隐茶事',
};

describe('priceYuanFromCents (integer CNY cents → decimal yuan)', () => {
  it('converts integer cents to a two-decimal yuan string', () => {
    expect(priceYuanFromCents(128000)).toBe('1280.00');
    expect(priceYuanFromCents(64000)).toBe('640.00');
    expect(priceYuanFromCents(100)).toBe('1.00');
    expect(priceYuanFromCents(123)).toBe('1.23');
    expect(priceYuanFromCents(5)).toBe('0.05');
    expect(priceYuanFromCents(0)).toBe('0.00');
  });

  it('rejects amounts that are not non-negative safe integers', () => {
    expect(() => priceYuanFromCents(1.5)).toThrow();
    expect(() => priceYuanFromCents(-1)).toThrow();
    expect(() => priceYuanFromCents(Number.NaN)).toThrow();
  });
});

describe('availabilityFromInventory (shared inventory fact)', () => {
  it('maps zero to OutOfStock and any positive value to InStock', () => {
    expect(availabilityFromInventory(0)).toBe('https://schema.org/OutOfStock');
    expect(availabilityFromInventory(1)).toBe('https://schema.org/InStock');
    expect(availabilityFromInventory(40)).toBe('https://schema.org/InStock');
  });
});

describe('buildProductSchema (verified facts only)', () => {
  it('emits the canonical URL, SKU, price, currency, and availability', () => {
    const schema = buildProductSchema(BASE);
    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('Product');
    expect(schema['@id']).toBe(BASE.canonicalUrl);
    expect(schema.name).toBe(BASE.name);
    expect(schema.description).toBe(BASE.description);
    expect(schema.sku).toBe('SHY-G-001');

    const offers = schema.offers as Record<string, unknown>;
    expect(offers.price).toBe('1280.00');
    expect(offers.priceCurrency).toBe('CNY');
    expect(offers.availability).toBe('https://schema.org/InStock');
    expect(offers.url).toBe(BASE.canonicalUrl);
    expect(offers.sku).toBe('SHY-G-001');
  });

  it('never fabricates ratings, reviews, GTINs, MPNs, or claims', () => {
    const schema = buildProductSchema(BASE);
    for (const forbidden of [
      'aggregateRating',
      'review',
      'gtin',
      'gtin13',
      'mpn',
      'brand',
      'certification',
      'productionDate',
      'itemCondition',
    ]) {
      // brand IS emitted intentionally (the visible working identity); every
      // other key must be absent.
      if (forbidden === 'brand') continue;
      expect(schema).not.toHaveProperty(forbidden);
    }
  });

  it('includes the visible working brand identity', () => {
    const schema = buildProductSchema(BASE);
    expect(schema.brand).toEqual({ '@type': 'Brand', name: '山隐茶事' });
  });

  it('omits image unless a verified image URL is supplied', () => {
    const without = buildProductSchema(BASE);
    expect(without).not.toHaveProperty('image');
    const withImage = buildProductSchema({ ...BASE, imageUrl: 'https://cdn.example/tea.png' });
    expect(withImage.image).toBe('https://cdn.example/tea.png');
  });

  it('matches the visible availability for an out-of-stock variant', () => {
    const schema = buildProductSchema({ ...BASE, inventory: 0, priceCents: 64000 });
    const offers = schema.offers as Record<string, unknown>;
    expect(offers.price).toBe('640.00');
    expect(offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('serializes to a single valid JSON-LD document', () => {
    const json = serializeProductSchema(BASE);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(buildProductSchema(BASE));
  });
});

describe('serializeProductSchema (script-safe script embedding)', () => {
  it('escapes a script-breakout name so the JSON-LD element can never be terminated', () => {
    const payload = '</script><script>alert(1)</script>';
    const json = serializeProductSchema({ ...BASE, name: `Loose leaf ${payload}` });
    // No raw less-than may survive; the closing tag sequence must be absent.
    expect(json).not.toContain('<');
    expect(json).not.toContain('</script');
    // The document stays valid JSON and round-trips to the original bytes,
    // so search engines still see the exact merchant text.
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.name).toBe(`Loose leaf ${payload}`);
  });

  it('escapes less-than, greater-than, ampersand, and JS line separators everywhere', () => {
    const nasty = 'a<b>c&d\u2028e\u2029f';
    const json = serializeProductSchema({ ...BASE, description: nasty });
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(json).not.toContain('&');
    expect(json).not.toContain('\u2028');
    expect(json).not.toContain('\u2029');
    expect(json).toContain('\\u003c');
    expect(json).toContain('\\u003e');
    expect(json).toContain('\\u0026');
    expect(json).toContain('\\u2028');
    expect(json).toContain('\\u2029');
    // Escapes are JSON-valid and decode back to the same characters.
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.description).toBe(nasty);
  });

  it('does not double-escape literal backslash-u sequences in merchant text', () => {
    const json = serializeProductSchema({ ...BASE, name: 'literal \\u003c text' });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.name).toBe('literal \\u003c text');
  });
});

describe('LOW_STOCK_THRESHOLD / isLowStock (shared inventory fact)', () => {
  it('is 5 and marks in-stock variants at or below it as low', () => {
    expect(LOW_STOCK_THRESHOLD).toBe(5);
    expect(isLowStock(0)).toBe(false); // unavailable, not low
    expect(isLowStock(1)).toBe(true);
    expect(isLowStock(5)).toBe(true);
    expect(isLowStock(6)).toBe(false);
    expect(isLowStock(40)).toBe(false);
  });
});

describe('originFromHeaders (trusted-configuration canonical origins)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses PUBLIC_SITE_URL when configured and never consults request headers', () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'https://shop.example');
    const spoofed = {
      get(name: string) {
        return { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example' }[name] ?? null;
      },
    };
    expect(originFromHeaders(spoofed)).toBe('https://shop.example');
  });

  it('normalizes a trailing slash on the configured origin', () => {
    vi.stubEnv('PUBLIC_SITE_URL', 'https://shop.example/');
    expect(originFromHeaders({ get: () => null })).toBe('https://shop.example');
  });

  it('honors local-development hosts from headers when nothing is configured', () => {
    const hostOnly = {
      get(name: string) {
        return name === 'host' ? 'localhost:3000' : null;
      },
    };
    expect(originFromHeaders(hostOnly)).toBe('http://localhost:3000');
    const forwarded = {
      get(name: string) {
        return { 'x-forwarded-proto': 'https', 'x-forwarded-host': '127.0.0.1:3100' }[name] ?? null;
      },
    };
    expect(originFromHeaders(forwarded)).toBe('https://127.0.0.1:3100');
  });

  it('never accepts non-local hosts from headers (host-header poisoning guard)', () => {
    const spoofed = {
      get(name: string) {
        return { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'shop.example' }[name] ?? null;
      },
    };
    expect(originFromHeaders(spoofed)).toBe('http://localhost:3000');
    const none = { get: () => null };
    expect(originFromHeaders(none)).toBe('http://localhost:3000');
  });
});
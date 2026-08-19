/**
 * Anonymous cart model unit tests (Issue #5, ADR-0007).
 *
 * These cover the pure, database-free core: signed serialization and
 * verification (tamper/expiry detection), the bounded pure cart operations,
 * display-only client parsing, and the coarse shipping estimate boundaries.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CART_MAX_AGE_SECONDS,
  CART_MAX_QTY,
  EMPTY_CART,
  addItem,
  parseCart,
  parseCartForDisplay,
  removeItem,
  serializeCart,
  setItemQuantity,
  totalQuantity,
  type CartItem,
} from '@/lib/cart';
import {
  SHIPPING_FLAT_CENTS,
  SHIPPING_FREE_THRESHOLD_CENTS,
  estimateShipping,
} from '@/lib/shipping-estimate';

const SECRET = 'cart-unit-test-secret';
const NOW = 1_700_000_000_000;

function items(list: Array<[sku: string, qty: number, priceCents: number]>): CartItem[] {
  return list.map(([sku, qty, priceCents], index) => ({ sku, qty, priceCents, addedAt: NOW + index }));
}

beforeEach(() => {
  process.env.CART_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.CART_SECRET;
});

describe('signed serialization', () => {
  it('round-trips a signed cart', () => {
    const source = items([['SHY-A', 2, 15000], ['SHY-B', 1, 7500]]);
    const encoded = serializeCart(source, NOW);
    const state = parseCart(encoded, NOW + 1000);
    expect(state.status).toBe('ok');
    expect(state.items).toEqual(source);
  });

  it('returns the empty state for a missing cookie', () => {
    expect(parseCart(null, NOW)).toEqual(EMPTY_CART);
    expect(parseCart(undefined, NOW)).toEqual(EMPTY_CART);
    expect(parseCart('', NOW)).toEqual(EMPTY_CART);
  });

  it('treats an unreadable cookie as expired', () => {
    expect(parseCart('not-json', NOW).status).toBe('expired');
    expect(parseCart('{"v":1}', NOW).status).toBe('expired');
    expect(parseCart('42', NOW).status).toBe('expired');
    expect(parseCart('[]', NOW).status).toBe('expired');
  });

  it('treats an unsigned payload as expired (forgery is never trusted)', () => {
    const encoded = serializeCart(items([['SHY-A', 1, 1000]]), NOW);
    const body = JSON.parse(encoded);
    delete body.sig;
    expect(parseCart(JSON.stringify(body), NOW + 1).status).toBe('expired');
  });

  it('treats a tampered quantity as expired', () => {
    const encoded = serializeCart(items([['SHY-A', 1, 1000]]), NOW);
    const body = JSON.parse(encoded);
    body.items[0].qty = 50;
    expect(parseCart(JSON.stringify(body), NOW + 1).status).toBe('expired');
  });

  it('treats a tampered price snapshot as expired', () => {
    const encoded = serializeCart(items([['SHY-A', 1, 1000]]), NOW);
    const body = JSON.parse(encoded);
    body.items[0].priceCents = 999999;
    expect(parseCart(JSON.stringify(body), NOW + 1).status).toBe('expired');
  });

  it('treats a signature made with a different secret as expired', () => {
    const encoded = serializeCart(items([['SHY-A', 1, 1000]]), NOW);
    process.env.CART_SECRET = 'another-secret';
    expect(parseCart(encoded, NOW + 1).status).toBe('expired');
  });

  it('treats an expired (past-expiry) cart as expired', () => {
    const encoded = serializeCart(items([['SHY-A', 1, 1000]]), NOW);
    const later = NOW + CART_MAX_AGE_SECONDS * 1000 + 1000;
    expect(parseCart(encoded, later).status).toBe('expired');
  });

  it('treats a legacy plain-SKU-array cookie (pre-Issue-5) as expired', () => {
    // The old demo cookie was an unsiged JSON array of SKU strings.
    expect(parseCart(JSON.stringify(['SHY-A', 'SHY-B']), NOW).status).toBe('expired');
  });
});

describe('display-only client parse (badge)', () => {
  it('decodes the percent-encoded cookie value without verifying the signature', () => {
    const source = items([['SHY-A', 3, 15000]]);
    const encoded = serializeCart(source, NOW);
    // The badge reads document.cookie, which returns the percent-encoded value.
    const raw = encodeURIComponent(encoded);
    expect(parseCartForDisplay(raw)).toEqual(source);
  });

  it('is lenient on garbage and missing input', () => {
    expect(parseCartForDisplay(undefined)).toEqual([]);
    expect(parseCartForDisplay('garbage')).toEqual([]);
    expect(parseCartForDisplay(encodeURIComponent('{"nope":1}'))).toEqual([]);
  });

  it('parses even a tampered payload (presentation only, never trusted)', () => {
    const source = items([['SHY-A', 1, 1000]]);
    const encoded = serializeCart(source, NOW);
    const body = JSON.parse(encoded);
    body.items[0].qty = 77;
    expect(parseCartForDisplay(encodeURIComponent(JSON.stringify(body)))).toEqual([
      { sku: 'SHY-A', qty: 77, priceCents: 1000, addedAt: body.items[0].addedAt },
    ]);
  });

  it('filters malformed lines in the lenient display parser', () => {
    const source = items([['SHY-A', 1, 1000]]);
    const encoded = serializeCart(source, NOW);
    const body = JSON.parse(encoded);
    body.items.push({ sku: 'SHY-B', qty: 0, priceCents: 1000, addedAt: NOW }); // qty 0 is invalid
    const shown = parseCartForDisplay(encodeURIComponent(JSON.stringify(body)));
    expect(shown.map((item) => item.sku)).toEqual(['SHY-A']);
  });
});

describe('pure cart operations (bounded)', () => {
  it('adds a new line with the current price snapshot', () => {
    const state = addItem(EMPTY_CART, 'SHY-A', 2, 15000);
    expect(state.status).toBe('ok');
    expect(state.items).toHaveLength(1);
    expect(state.items[0].qty).toBe(2);
    expect(state.items[0].priceCents).toBe(15000);
  });

  it('merges an existing line additively and caps at the hard bound', () => {
    const initial = addItem(EMPTY_CART, 'SHY-A', 90, 15000);
    const merged = addItem(initial, 'SHY-A', 30, 15000);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].qty).toBe(CART_MAX_QTY);
  });

  it('keeps the original snapshot and addedAt when merging', () => {
    const initial = addItem(EMPTY_CART, 'SHY-A', 1, 15000);
    const merged = addItem(initial, 'SHY-A', 1, 19000);
    expect(merged.items[0].priceCents).toBe(15000);
    expect(merged.items[0].addedAt).toBe(initial.items[0].addedAt);
  });

  it('sets a quantity and removes the line at zero', () => {
    const state = addItem(EMPTY_CART, 'SHY-A', 3, 15000);
    const updated = setItemQuantity(state, 'SHY-A', 5);
    expect(updated.items[0].qty).toBe(5);
    const removed = setItemQuantity(updated, 'SHY-A', 0);
    expect(removed).toEqual(EMPTY_CART);
  });

  it('rejects out-of-range quantity updates as no-ops', () => {
    const state = addItem(EMPTY_CART, 'SHY-A', 3, 15000);
    expect(setItemQuantity(state, 'SHY-A', CART_MAX_QTY + 1)).toBe(state);
    expect(setItemQuantity(state, 'SHY-A', 2.5)).toBe(state);
  });

  it('removes a single line (unknown SKUs are no-ops)', () => {
    const state = addItem(EMPTY_CART, 'SHY-A', 1, 1000);
    const after = addItem(state, 'SHY-B', 2, 2000);
    expect(removeItem(after, 'SHY-A').items.map((item) => item.sku)).toEqual(['SHY-B']);
    expect(removeItem(after, 'SHY-NOPE')).toEqual(after);
  });

  it('totals the quantity across lines', () => {
    const state = addItem(EMPTY_CART, 'SHY-A', 2, 1000);
    const withB = addItem(state, 'SHY-B', 3, 2000);
    expect(totalQuantity(withB)).toBe(5);
    expect(totalQuantity(EMPTY_CART)).toBe(0);
  });
});

describe('coarse shipping estimate (non-binding)', () => {
  it('charges the flat demo fee below the free threshold', () => {
    for (const subtotal of [0, 1, SHIPPING_FREE_THRESHOLD_CENTS - 1]) {
      expect(estimateShipping(subtotal)).toEqual({
        feeCents: SHIPPING_FLAT_CENTS,
        freeEligible: false,
      });
    }
  });

  it('is free at and above the free threshold', () => {
    for (const subtotal of [SHIPPING_FREE_THRESHOLD_CENTS, SHIPPING_FREE_THRESHOLD_CENTS + 1]) {
      expect(estimateShipping(subtotal)).toEqual({ feeCents: 0, freeEligible: true });
    }
  });

  it('rejects invalid subtotals', () => {
    expect(() => estimateShipping(-1)).toThrow();
    expect(() => estimateShipping(10.5)).toThrow();
  });
});
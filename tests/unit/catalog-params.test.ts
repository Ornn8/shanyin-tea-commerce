import { describe, expect, it } from 'vitest';
import { MAX_QUERY_LENGTH, buildCatalogUrl, parseCatalogParams } from '@/lib/catalog-params';

describe('catalog URL param parsing and validation', () => {
  it('parses every supported parameter from raw search params', () => {
    const parsed = parseCatalogParams({
      q: '  Longjing  ',
      category: 'dark-tea',
      form: 'compressed',
      caffeine: 'low',
      priceMin: '640',
      priceMax: '720',
      inStock: 'true',
      sort: 'price-asc',
      page: '2',
    });
    expect(parsed.q).toBe('Longjing');
    expect(parsed.category).toBe('dark-tea');
    expect(parsed.form).toBe('compressed');
    expect(parsed.caffeine).toBe('low');
    expect(parsed.priceMinYuan).toBe(640);
    expect(parsed.priceMaxYuan).toBe(720);
    expect(parsed.inStock).toBe(true);
    expect(parsed.sort).toBe('price-asc');
    expect(parsed.page).toBe(2);
    expect(parsed.priceRangeInvalid).toBe(false);
  });

  it('trims and caps the query length', () => {
    const parsed = parseCatalogParams({ q: 'x'.repeat(500) });
    expect(parsed.q).toHaveLength(MAX_QUERY_LENGTH);
    expect(parseCatalogParams({ q: '   ' }).q).toBeUndefined();
  });

  it('ignores malformed or unknown values deterministically', () => {
    const parsed = parseCatalogParams({
      q: ['first', 'second'],
      form: 'brick',
      caffeine: 'extreme',
      sort: 'random',
      inStock: 'maybe',
      page: 'abc',
      priceMin: '-5',
      priceMax: '12.5',
      category: '',
    });
    expect(parsed.q).toBe('first');
    expect(parsed.form).toBeUndefined();
    expect(parsed.caffeine).toBeUndefined();
    expect(parsed.sort).toBeUndefined();
    expect(parsed.inStock).toBeUndefined();
    expect(parsed.page).toBeUndefined();
    expect(parsed.priceMinYuan).toBeUndefined();
    expect(parsed.priceMaxYuan).toBeUndefined();
    expect(parsed.category).toBeUndefined();
    expect(parsed.priceRangeInvalid).toBe(false);
  });

  it('rejects a price range whose minimum exceeds its maximum', () => {
    const parsed = parseCatalogParams({ priceMin: '1000', priceMax: '500' });
    expect(parsed.priceRangeInvalid).toBe(true);
    expect(parsed.priceMinYuan).toBeUndefined();
    expect(parsed.priceMaxYuan).toBeUndefined();
  });

  it('treats equal min/max as a valid single-point range', () => {
    const parsed = parseCatalogParams({ priceMin: '720', priceMax: '720' });
    expect(parsed.priceRangeInvalid).toBe(false);
    expect(parsed.priceMinYuan).toBe(720);
    expect(parsed.priceMaxYuan).toBe(720);
  });

  it('parses inStock true/false only', () => {
    expect(parseCatalogParams({ inStock: 'true' }).inStock).toBe(true);
    expect(parseCatalogParams({ inStock: 'false' }).inStock).toBe(false);
    expect(parseCatalogParams({ inStock: '' }).inStock).toBeUndefined();
  });
});

describe('buildCatalogUrl', () => {
  it('builds canonical URLs: defaults omitted, locale and base preserved', () => {
    expect(buildCatalogUrl('en', 'products', {})).toBe('/en/products');
    expect(buildCatalogUrl('ja', 'search', { q: '龍井' })).toBe(
      `/ja/search?q=${encodeURIComponent('龍井')}`,
    );
    expect(buildCatalogUrl('zh-CN', 'products', { sort: 'featured', page: 1 })).toBe(
      '/zh-CN/products',
    );
  });

  it('encodes every active filter so results are shareable', () => {
    const url = buildCatalogUrl('en', 'products', {
      category: 'dark-tea',
      form: 'compressed',
      caffeine: 'low',
      priceMinYuan: 640,
      priceMaxYuan: 720,
      inStock: true,
      sort: 'price-asc',
      page: 2,
    });
    expect(url).toBe(
      '/en/products?category=dark-tea&form=compressed&caffeine=low&priceMin=640&priceMax=720&inStock=true&sort=price-asc&page=2',
    );
  });

  it('drops price bounds of a rejected range', () => {
    const url = buildCatalogUrl('en', 'products', {
      priceMinYuan: 1000,
      priceMaxYuan: 500,
      priceRangeInvalid: true,
    });
    expect(url).toBe('/en/products');
  });
});

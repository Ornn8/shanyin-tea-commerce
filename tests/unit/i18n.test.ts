import { describe, expect, it } from 'vitest';
import { createT, getCatalog, getResolvedCatalog, translate } from '@/i18n/catalog';
import { en } from '@/i18n/messages/en';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  isLocaleId,
  LOCALE_IDS,
  MESSAGE_PARAMS,
  normalizeLocale,
  OPTIONAL_KEYS,
} from '@/i18n/registry';

describe('locale registry', () => {
  it('defines exactly zh-CN, en, ja', () => {
    expect(LOCALE_IDS).toEqual(['zh-CN', 'en', 'ja']);
  });

  it('uses English as the deterministic fallback locale', () => {
    expect(FALLBACK_LOCALE).toBe('en');
  });

  it('normalizes unknown or missing values to the default locale', () => {
    expect(isLocaleId('en')).toBe(true);
    expect(isLocaleId('fr')).toBe(false);
    expect(normalizeLocale('fr')).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale('ja')).toBe('ja');
  });
});

describe('catalog fallback', () => {
  it('resolves a deliberately missing optional key to English for ja', () => {
    expect(OPTIONAL_KEYS).toContain('home.announcement');
    expect(getCatalog('ja')['home.announcement']).toBeUndefined();
    const t = createT('ja');
    expect(t('home.announcement')).toBe(en['home.announcement']);
  });

  it('keeps locale-specific copy for keys the locale provides', () => {
    const t = createT('zh-CN');
    expect(t('nav.products')).toBe('全部茶品');
    const jaT = createT('ja');
    expect(jaT('nav.products')).toBe('茶葉一覧');
  });

  it('resolved catalog covers every English key for every locale', () => {
    for (const locale of LOCALE_IDS) {
      const resolved = getResolvedCatalog(locale);
      for (const key of Object.keys(en)) {
        expect(resolved[key]).toBeDefined();
      }
    }
  });
});

describe('safe message interpolation', () => {
  it('substitutes declared params', () => {
    const t = createT('en');
    expect(t('search.resultsFor', { query: 'Longjing' })).toBe('Results for “Longjing”');
  });

  it('escapes interpolated values (no HTML injection)', () => {
    const t = createT('en');
    const result = t('search.resultsFor', { query: '<script>alert(1)</script>' });
    expect(result).not.toContain('<script');
    expect(result).toContain('&lt;script&gt;');
  });

  it('throws on unknown message keys', () => {
    expect(() => translate(en, 'nope.missing')).toThrow(/Unknown message key/);
  });

  it('throws when a supplied param is not used by the message', () => {
    expect(() => translate(en, 'nav.home', { extra: 'x' })).toThrow(/not used by the message/);
  });

  it('throws when a placeholder is missing its param', () => {
    expect(() => translate(en, 'search.resultsFor', {})).toThrow(/missing param/);
  });

  it('throws when a placeholder token is not declared', () => {
    expect(() => translate(en, 'search.resultsFor', { query: 'x', other: 'y' })).toThrow(
      /not used by the message/,
    );
  });

  it('declares every parameterized key in MESSAGE_PARAMS', () => {
    const paramKeys = Object.keys(MESSAGE_PARAMS);
    for (const key of paramKeys) {
      expect(en[key]).toBeDefined();
    }
  });
});

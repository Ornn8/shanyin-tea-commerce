/**
 * Per-locale completeness + English-fallback preview unit tests (Issue #3:
 * "The editor shows per-locale completeness, fallback previews…").
 */
import { describe, expect, it } from 'vitest';
import {
  completenessCount,
  effectiveField,
  fieldCompleteness,
  isFallbackUsed,
  pickEffectiveRow,
} from '@/lib/admin/preview';

const fullEn = {
  locale: 'en',
  name: 'Spring Longjing',
  description: 'A pan-fired green tea.',
  tastingNotes: 'Clean and sweet.',
  brewingNotes: '85°C for 3 minutes.',
  seoTitle: 'Spring Longjing',
  seoDescription: 'A demo green tea.',
  mediaAlt: 'Tea leaves illustration',
};

const partialZh = {
  locale: 'zh-CN',
  name: '西湖龙井 · 明前',
  description: '演示条目。',
  tastingNotes: '',
  brewingNotes: undefined,
  seoTitle: undefined,
  seoDescription: undefined,
  mediaAlt: undefined,
};

describe('completeness', () => {
  it('counts filled fields per locale (0–7)', () => {
    expect(completenessCount(undefined)).toBe(0);
    expect(completenessCount(partialZh)).toBe(2);
    expect(completenessCount(fullEn)).toBe(7);
    expect(fieldCompleteness(partialZh).seoTitle).toBe(false);
    expect(fieldCompleteness(fullEn).mediaAlt).toBe(true);
  });
});

describe('English fallback preview', () => {
  const rows = [partialZh, fullEn];

  it('picks the requested locale, then English, then any row (ADR-0003 order)', () => {
    expect(pickEffectiveRow(rows, 'zh-CN')?.locale).toBe('zh-CN');
    expect(pickEffectiveRow(rows, 'en')?.locale).toBe('en');
    expect(pickEffectiveRow(rows, 'ja')?.locale).toBe('en');
    expect(pickEffectiveRow([partialZh], 'ja')?.locale).toBe('zh-CN');
  });

  it('falls back to English for empty fields of a locale row', () => {
    expect(effectiveField(rows, 'zh-CN', 'name')).toBe('西湖龙井 · 明前');
    // zh-CN has no tasting notes → English is shown.
    expect(effectiveField(rows, 'zh-CN', 'tastingNotes')).toBe('Clean and sweet.');
    expect(isFallbackUsed(rows, 'zh-CN', 'tastingNotes')).toBe(true);
    expect(isFallbackUsed(rows, 'zh-CN', 'name')).toBe(false);
    expect(isFallbackUsed(rows, 'en', 'name')).toBe(false);
  });

  it('falls back to the slug when no row anywhere has the field', () => {
    expect(effectiveField(rows, 'ja', 'seoTitle', 'spring-longjing')).toBe('Spring Longjing');
    expect(effectiveField([], 'ja', 'name', 'slug-fallback')).toBe('slug-fallback');
  });

  it('a missing ja row entirely is a fallback for every field', () => {
    expect(isFallbackUsed(rows, 'ja', 'name')).toBe(true);
    expect(effectiveField(rows, 'ja', 'name')).toBe('Spring Longjing');
  });
});

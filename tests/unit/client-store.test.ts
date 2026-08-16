import { describe, expect, it } from 'vitest';
import { LocaleSwitchStore, StaleLocaleError } from '@/i18n/client-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LocaleSwitchStore race guard', () => {
  it('never lets a stale async load overwrite a newer selection', async () => {
    const store = new LocaleSwitchStore<string>();
    const slowZh = deferred<string>();
    const fastEn = deferred<string>();

    const zhLoad = store.apply('zh-CN', () => slowZh.promise);
    const enLoad = store.apply('en', () => fastEn.promise);

    fastEn.resolve('en-catalog');
    await expect(enLoad).resolves.toEqual({ locale: 'en', data: 'en-catalog' });

    // The earlier zh-CN load resolves AFTER the newer en switch: it must be
    // rejected and must not overwrite the selection.
    slowZh.resolve('zh-catalog');
    await expect(zhLoad).rejects.toBeInstanceOf(StaleLocaleError);
    expect(store.selection).toEqual({ locale: 'en', data: 'en-catalog' });
  });

  it('keeps the last selection when three switches race', async () => {
    const store = new LocaleSwitchStore<number>();
    const a = deferred<number>();
    const b = deferred<number>();
    const c = deferred<number>();

    const first = store.apply('zh-CN', () => a.promise);
    const second = store.apply('en', () => b.promise);
    const third = store.apply('ja', () => c.promise);

    a.resolve(1);
    b.resolve(2);
    c.resolve(3);
    await third;
    await expect(first).rejects.toBeInstanceOf(StaleLocaleError);
    await expect(second).rejects.toBeInstanceOf(StaleLocaleError);
    expect(store.selection).toEqual({ locale: 'ja', data: 3 });
  });

  it('cancelPending invalidates in-flight loads without touching the selection', async () => {
    const store = new LocaleSwitchStore<string>();
    const d = deferred<string>();

    const pending = store.apply('zh-CN', () => d.promise);
    store.cancelPending();
    d.resolve('late');
    await expect(pending).rejects.toBeInstanceOf(StaleLocaleError);
    expect(store.selection).toBeNull();
  });

  it('a newer apply supersedes an older one even before it resolves', async () => {
    const store = new LocaleSwitchStore<string>();
    const d = deferred<string>();

    const first = store.apply('zh-CN', () => d.promise);
    const second = store.apply('en', async () => 'en');
    await second;
    d.resolve('zh');
    await expect(first).rejects.toThrow(/stale/i);
    expect(store.selection).toEqual({ locale: 'en', data: 'en' });
  });
});

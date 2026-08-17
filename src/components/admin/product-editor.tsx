'use client';

/**
 * The merchant product editor (ADR-0005): one workflow over shared facts,
 * variants (SKU / integer-cents CNY price / inventory), per-locale content,
 * and publication state.
 *
 * - Clear shared-versus-localized boundaries: two labelled sections; variant
 *   facts are explicitly language-neutral.
 * - Per-locale completeness (n/7) and a live English-fallback preview.
 * - Validation errors from the server are shown per field; prices are parsed
 *   from a yuan string into integer cents (no floating-point amounts).
 * - Unsaved changes are tracked (indicator + beforeunload warning).
 * - Publishing surfaces translation coverage and blocks with reasons.
 */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LOCALE_IDS, LOCALE_META, type LocaleId } from '@/i18n/registry';
import { formatCny } from '@/i18n/format';
import type { AdminCategoryView, AdminProductView } from '@/lib/admin/products';
import {
  parsePriceToCents,
  validateInventory,
  type LocalizedCopyInput,
} from '@/lib/admin/validation';
import {
  completenessCount,
  effectiveField,
  isFallbackUsed,
  LOCALIZED_FIELDS,
  TOTAL_LOCALIZED_FIELDS,
} from '@/lib/admin/preview';
import {
  createProductAction,
  publishProductAction,
  setVariantInventoryAction,
  unpublishProductAction,
  updateProductAction,
  type ActionResult,
} from '@/lib/admin/actions';
import { AdminError } from '@/lib/admin/errors';

interface VariantDraft {
  id?: string;
  sku: string;
  name: string;
  priceYuan: string;
  inventory: string;
}

interface LocalizationDraft {
  name: string;
  description: string;
  tastingNotes: string;
  brewingNotes: string;
  seoTitle: string;
  seoDescription: string;
  mediaAlt: string;
}

interface EditorState {
  slug: string;
  origin: string;
  form: 'LOOSE' | 'COMPRESSED';
  caffeine: 'LOW' | 'MEDIUM' | 'HIGH';
  categoryId: string;
  variants: VariantDraft[];
  localizations: Record<LocaleId, LocalizationDraft>;
}

const EMPTY_LOCALIZATION: LocalizationDraft = {
  name: '',
  description: '',
  tastingNotes: '',
  brewingNotes: '',
  seoTitle: '',
  seoDescription: '',
  mediaAlt: '',
};

function centsToYuanInput(cents: number): string {
  const yuan = cents / 100;
  const fixed = yuan.toFixed(2);
  return fixed.endsWith('.00') ? fixed.slice(0, -3) : fixed.replace(/0$/, '');
}

function initialVariants(product: AdminProductView | null): VariantDraft[] {
  if (product && product.variants.length > 0) {
    return product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      priceYuan: centsToYuanInput(variant.priceCents),
      inventory: String(variant.inventory),
    }));
  }
  return [{ sku: '', name: '', priceYuan: '', inventory: '0' }];
}

function initialState(product: AdminProductView | null): EditorState {
  const localizations = {} as Record<LocaleId, LocalizationDraft>;
  for (const locale of LOCALE_IDS) {
    const loc = product?.localizations.find((row) => row.locale === locale);
    localizations[locale] = loc
      ? {
          name: loc.name,
          description: loc.description,
          tastingNotes: loc.tastingNotes,
          brewingNotes: loc.brewingNotes ?? '',
          seoTitle: loc.seoTitle ?? '',
          seoDescription: loc.seoDescription ?? '',
          mediaAlt: loc.mediaAlt ?? '',
        }
      : { ...EMPTY_LOCALIZATION };
  }
  return {
    slug: product?.slug ?? '',
    origin: product?.origin ?? '',
    form: product?.form ?? 'LOOSE',
    caffeine: product?.caffeine ?? 'MEDIUM',
    categoryId: product?.categoryId ?? '',
    variants: initialVariants(product),
    localizations,
  };
}

interface ProductEditorProps {
  product: AdminProductView | null;
  categories: AdminCategoryView[];
}

const INPUT_CLASS =
  'w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-200';
const LABEL_CLASS = 'flex flex-col gap-1 text-sm';
const LABEL_TEXT_CLASS = 'font-medium text-stone-700';

export function ProductEditor({ product, categories }: ProductEditorProps) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>(() => initialState(product));
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; fieldErrors: Record<string, string> } | null>(null);

  const isCreate = product === null;
  const title = isCreate ? 'New product' : product.slug;

  // --- unsaved-changes guard ---------------------------------------------
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const patch = useCallback((update: Partial<EditorState>) => {
    setState((current) => ({ ...current, ...update }));
    setDirty(true);
    setNotice(null);
    setError(null);
  }, []);

  const patchLocalization = useCallback(
    (locale: LocaleId, field: keyof LocalizationDraft, value: string) => {
      setState((current) => ({
        ...current,
        localizations: {
          ...current.localizations,
          [locale]: { ...current.localizations[locale], [field]: value },
        },
      }));
      setDirty(true);
      setNotice(null);
      setError(null);
    },
    [],
  );

  const patchVariant = useCallback((index: number, field: keyof VariantDraft, value: string) => {
    setState((current) => ({
      ...current,
      variants: current.variants.map((variant, i) => (i === index ? { ...variant, [field]: value } : variant)),
    }));
    setDirty(true);
    setNotice(null);
    setError(null);
  }, []);

  const addVariant = useCallback(() => {
    setState((current) => ({
      ...current,
      variants: [...current.variants, { sku: '', name: '', priceYuan: '', inventory: '0' }],
    }));
    setDirty(true);
  }, []);

  const removeVariant = useCallback((index: number) => {
    setState((current) => ({
      ...current,
      variants: current.variants.filter((_, i) => i !== index),
    }));
    setDirty(true);
  }, []);

  // --- payload building (client-side parse; server re-validates) ---------
  const buildPayload = useCallback(() => {
    const variants = state.variants.map((variant, index) => ({
      ...(variant.id ? { id: variant.id } : {}),
      sku: variant.sku,
      name: variant.name,
      priceCents: parsePriceToCents(variant.priceYuan, `variants[${index}].priceCents`),
      inventory: validateInventory(variant.inventory, `variants[${index}].inventory`),
    }));
    const localizations: Record<string, LocalizedCopyInput> = {};
    for (const locale of LOCALE_IDS) {
      const copy = state.localizations[locale];
      localizations[locale] = {
        name: copy.name,
        description: copy.description,
        tastingNotes: copy.tastingNotes,
        brewingNotes: copy.brewingNotes || undefined,
        seoTitle: copy.seoTitle || undefined,
        seoDescription: copy.seoDescription || undefined,
        mediaAlt: copy.mediaAlt || undefined,
      };
    }
    return {
      slug: state.slug,
      origin: state.origin,
      form: state.form,
      caffeine: state.caffeine,
      categoryId: state.categoryId,
      variants,
      localizations,
    };
  }, [state]);

  const handleActionResult = useCallback(
    (result: ActionResult) => {
      if (result.ok) {
        setDirty(false);
        setNotice('Saved.');
        setError(null);
        return result.id;
      }
      if (result.code === 'unauthorized') {
        router.push('/admin/login');
        router.refresh();
        return undefined;
      }
      setError({ message: result.error, fieldErrors: result.fieldErrors ?? {} });
      return undefined;
    },
    [router],
  );

  const save = useCallback(async () => {
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      const payload = buildPayload();
      if (isCreate) {
        const result = await createProductAction(payload);
        const id = handleActionResult(result);
        if (id) {
          // Navigate only: the target page is fetched fresh from the server,
          // so no router.refresh() is needed here (calling it right after
          // push can cancel the pending navigation).
          router.push(`/admin/products/${id}`);
        }
      } else {
        const result = await updateProductAction(product.id, payload);
        handleActionResult(result);
        router.refresh();
      }
    } catch (caught) {
      if (caught instanceof AdminError) {
        setError({ message: caught.message, fieldErrors: { ...caught.fieldErrors } });
      } else {
        setError({ message: 'Unexpected error while saving.', fieldErrors: {} });
      }
    } finally {
      setPending(false);
    }
  }, [buildPayload, handleActionResult, isCreate, product, router]);

  const publish = useCallback(async () => {
    if (!product) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      // Publish exactly what the editor shows, never the previously persisted
      // state. A merchant may click Publish before Save; the publish action
      // used to send only the product id, silently discarding the on-screen
      // edits (the success handler then cleared the unsaved-changes flag).
      // Persist the current payload first (a draft may be saved while
      // incomplete — the publish gate then runs on this fresh state), and
      // only then flip the product to published.
      const saveResult = await updateProductAction(product.id, buildPayload());
      if (!saveResult.ok) {
        if (saveResult.code === 'unauthorized') {
          router.push('/admin/login');
        } else {
          setError({ message: saveResult.error, fieldErrors: saveResult.fieldErrors ?? {} });
        }
        return;
      }
      const publishResult = await publishProductAction(product.id);
      if (publishResult.ok) {
        setDirty(false);
        setNotice('Published.');
        setError(null);
      } else if (publishResult.code === 'unauthorized') {
        router.push('/admin/login');
      } else {
        // The edit was persisted, but the publication gate rejected this
        // state (e.g. incomplete English copy): keep the editor in sync with
        // the saved payload (dirty = false) and surface why publishing failed.
        setDirty(false);
        setNotice('Changes saved — publishing was rejected.');
        setError({ message: publishResult.error, fieldErrors: publishResult.fieldErrors ?? {} });
      }
    } catch (caught) {
      if (caught instanceof AdminError) {
        setError({ message: caught.message, fieldErrors: { ...caught.fieldErrors } });
      } else {
        setError({ message: 'Unexpected error while publishing.', fieldErrors: {} });
      }
    } finally {
      setPending(false);
      router.refresh();
    }
  }, [buildPayload, product, router]);

  const unpublish = useCallback(async () => {
    if (!product) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await unpublishProductAction(product.id);
      if (result.ok) {
        // Unpublish only flips the lifecycle state; it does NOT persist the
        // editor content. Keep the unsaved-changes state untouched so on-
        // screen edits are never silently treated as saved.
        setNotice('Unpublished.');
      } else if (result.code === 'unauthorized') {
        router.push('/admin/login');
      } else {
        setError({ message: result.error, fieldErrors: result.fieldErrors ?? {} });
      }
    } catch (caught) {
      if (caught instanceof AdminError) {
        setError({ message: caught.message, fieldErrors: { ...caught.fieldErrors } });
      } else {
        setError({ message: 'Unexpected error while unpublishing.', fieldErrors: {} });
      }
    } finally {
      setPending(false);
      router.refresh();
    }
  }, [product, router]);

  const applyInventory = useCallback(
    async (index: number) => {
      const variant = state.variants[index];
      if (!variant?.id) return;
      setPending(true);
      setError(null);
      setNotice(null);
      try {
        const inventory = validateInventory(variant.inventory, `variants[${index}].inventory`);
        const result = await setVariantInventoryAction(variant.id, inventory);
        if (result.ok) {
          setNotice('Inventory saved.');
        } else if (result.code === 'unauthorized') {
          router.push('/admin/login');
          router.refresh();
        } else {
          setError({ message: result.error, fieldErrors: result.fieldErrors ?? {} });
        }
      } catch (caught) {
        if (caught instanceof AdminError) {
          setError({ message: caught.message, fieldErrors: { ...caught.fieldErrors } });
        } else {
          setError({ message: 'Unexpected error while saving inventory.', fieldErrors: {} });
        }
      } finally {
        setPending(false);
      }
    },
    [state.variants, router],
  );

  // --- derived ------------------------------------------------------------
  const previewRows = useMemo(
    () =>
      LOCALE_IDS.map((locale) => ({
        locale,
        name: state.localizations[locale].name,
        description: state.localizations[locale].description,
        tastingNotes: state.localizations[locale].tastingNotes,
        brewingNotes: state.localizations[locale].brewingNotes || undefined,
        seoTitle: state.localizations[locale].seoTitle || undefined,
        seoDescription: state.localizations[locale].seoDescription || undefined,
        mediaAlt: state.localizations[locale].mediaAlt || undefined,
      })),
    [state.localizations],
  );

  const publishable =
    state.variants.length > 0 &&
    state.localizations.en.name.trim().length > 0 &&
    state.localizations.en.description.trim().length > 0;

  const fieldError = (field: string): string | undefined => error?.fieldErrors[field];

  const selectClass = `${INPUT_CLASS} ${fieldError('categoryId') ? 'border-lacquer-400' : ''}`;

  return (
    <div className="flex flex-col gap-6" data-testid="product-editor">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-pine-900" data-testid="editor-title">
              {title}
            </h1>
            {product?.published ? (
              <span className="rounded-full bg-pine-100 px-2 py-0.5 text-xs font-medium text-pine-800" data-testid="editor-published-badge">
                Published
              </span>
            ) : (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600" data-testid="editor-draft-badge">
                Draft
              </span>
            )}
            {dirty ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" data-testid="unsaved-indicator">
                Unsaved changes
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-stone-500">
            {isCreate
              ? 'Create a draft — publish it when the shared facts and localized copy are ready.'
              : 'Shared facts, variants, prices, inventory, and per-locale content in one workflow.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/products"
            className="rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-700 transition-colors hover:border-pine-300 hover:text-pine-700"
          >
            Back to products
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-800 disabled:opacity-50"
            data-testid="save-button"
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Banners */}
      {notice ? (
        <p role="status" className="rounded-md border border-pine-200 bg-pine-50 px-3 py-2 text-sm text-pine-900" data-testid="editor-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-md border border-lacquer-200 bg-lacquer-50 px-3 py-2 text-sm text-lacquer-800" data-testid="editor-error">
          <p>{error.message}</p>
        </div>
      ) : null}

      {/* Shared facts */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-5" data-testid="shared-facts-section">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold text-pine-900">Shared facts</h2>
          <span className="text-xs text-stone-400">Language-neutral — every locale reads the same facts</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>Slug</span>
            <input
              type="text"
              value={state.slug}
              onChange={(event) => patch({ slug: event.target.value })}
              className={`${INPUT_CLASS} ${fieldError('slug') ? 'border-lacquer-400' : ''}`}
              data-testid="field-slug"
            />
            {fieldError('slug') ? <span className="text-xs text-lacquer-700">{fieldError('slug')}</span> : null}
          </label>
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>Category</span>
            <select
              value={state.categoryId}
              onChange={(event) => patch({ categoryId: event.target.value })}
              className={selectClass}
              data-testid="field-category"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.names.en ?? category.slug}
                </option>
              ))}
            </select>
            {fieldError('categoryId') ? <span className="text-xs text-lacquer-700">{fieldError('categoryId')}</span> : null}
          </label>
          <label className={`${LABEL_CLASS} sm:col-span-2`}>
            <span className={LABEL_TEXT_CLASS}>Origin</span>
            <input
              type="text"
              value={state.origin}
              onChange={(event) => patch({ origin: event.target.value })}
              className={`${INPUT_CLASS} ${fieldError('origin') ? 'border-lacquer-400' : ''}`}
              data-testid="field-origin"
            />
            {fieldError('origin') ? <span className="text-xs text-lacquer-700">{fieldError('origin')}</span> : null}
          </label>
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>Leaf form</span>
            <select
              value={state.form}
              onChange={(event) => patch({ form: event.target.value as EditorState['form'] })}
              className={INPUT_CLASS}
              data-testid="field-form"
            >
              <option value="LOOSE">Loose leaf</option>
              <option value="COMPRESSED">Compressed</option>
            </select>
          </label>
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>Caffeine</span>
            <select
              value={state.caffeine}
              onChange={(event) => patch({ caffeine: event.target.value as EditorState['caffeine'] })}
              className={INPUT_CLASS}
              data-testid="field-caffeine"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
        </div>
      </section>

      {/* Variants */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-5" data-testid="variants-section">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold text-pine-900">Variants</h2>
          <span className="text-xs text-stone-400">
            SKU, price, and inventory are shared facts — never per-locale
          </span>
        </div>
        <ul className="flex flex-col gap-3" data-testid="variant-list">
          {state.variants.map((variant, index) => (
            <li
              key={variant.id ?? `new-${index}`}
              className="rounded-md border border-stone-200 bg-stone-50 p-3"
              data-testid={`variant-row-${index}`}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>SKU</span>
                  <input
                    type="text"
                    value={variant.sku}
                    onChange={(event) => patchVariant(index, 'sku', event.target.value)}
                    className={`${INPUT_CLASS} ${fieldError(`variants[${index}].sku`) ? 'border-lacquer-400' : ''}`}
                    data-testid={`variant-sku-${index}`}
                  />
                  {fieldError(`variants[${index}].sku`) ? (
                    <span className="text-xs text-lacquer-700">{fieldError(`variants[${index}].sku`)}</span>
                  ) : null}
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Variant name</span>
                  <input
                    type="text"
                    value={variant.name}
                    onChange={(event) => patchVariant(index, 'name', event.target.value)}
                    className={INPUT_CLASS}
                    data-testid={`variant-name-${index}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Price (CNY)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={variant.priceYuan}
                    onChange={(event) => patchVariant(index, 'priceYuan', event.target.value)}
                    placeholder="1280.50"
                    className={`${INPUT_CLASS} ${fieldError(`variants[${index}].priceCents`) ? 'border-lacquer-400' : ''}`}
                    data-testid={`variant-price-${index}`}
                  />
                  {fieldError(`variants[${index}].priceCents`) ? (
                    <span className="text-xs text-lacquer-700">{fieldError(`variants[${index}].priceCents`)}</span>
                  ) : null}
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Inventory</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={variant.inventory}
                      onChange={(event) => patchVariant(index, 'inventory', event.target.value)}
                      className={`${INPUT_CLASS} ${fieldError(`variants[${index}].inventory`) ? 'border-lacquer-400' : ''}`}
                      data-testid={`variant-inventory-${index}`}
                    />
                    {variant.id ? (
                      <button
                        type="button"
                        onClick={() => applyInventory(index)}
                        disabled={pending}
                        className="shrink-0 rounded-md border border-pine-300 px-2 py-1 text-xs font-medium text-pine-700 transition-colors hover:bg-pine-50 disabled:opacity-50"
                        data-testid={`inventory-apply-${index}`}
                        title="Save this inventory value immediately (audited)"
                      >
                        Apply
                      </button>
                    ) : null}
                  </div>
                  {fieldError(`variants[${index}].inventory`) ? (
                    <span className="text-xs text-lacquer-700">{fieldError(`variants[${index}].inventory`)}</span>
                  ) : null}
                </label>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-stone-400">
                  {variant.priceYuan ? formatCny(parseCentsSafely(variant.priceYuan), 'en') : '—'}
                </span>
                <button
                  type="button"
                  onClick={() => removeVariant(index)}
                  disabled={state.variants.length <= 1}
                  className="text-xs font-medium text-lacquer-700 underline-offset-2 hover:underline disabled:text-stone-300"
                  data-testid={`remove-variant-${index}`}
                >
                  Remove variant
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addVariant}
          className="mt-3 rounded-md border border-pine-300 px-3 py-1.5 text-sm font-medium text-pine-700 transition-colors hover:bg-pine-50"
          data-testid="add-variant-button"
        >
          + Add variant
        </button>
        {fieldError('variants') ? <p className="mt-2 text-xs text-lacquer-700">{fieldError('variants')}</p> : null}
      </section>

      {/* Localized content */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-5" data-testid="localized-section">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold text-pine-900">Localized content</h2>
          <span className="text-xs text-stone-400">
            Edited per {LOCALE_IDS.join(', ')} — empty fields fall back to English in preview
          </span>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {LOCALE_IDS.map((locale) => {
            const copy = state.localizations[locale];
            const count = completenessCount({
              locale,
              name: copy.name,
              description: copy.description,
              tastingNotes: copy.tastingNotes,
              brewingNotes: copy.brewingNotes || undefined,
              seoTitle: copy.seoTitle || undefined,
              seoDescription: copy.seoDescription || undefined,
              mediaAlt: copy.mediaAlt || undefined,
            });
            const fallbackName = isFallbackUsed(previewRows, locale, 'name');
            const fallbackDescription = isFallbackUsed(previewRows, locale, 'description');
            const lc = (field: string) => fieldError(`localizations.${locale}.${field}`);
            return (
              <div
                key={locale}
                className="flex flex-col gap-3 rounded-md border border-stone-200 p-3"
                data-testid={`locale-panel-${locale}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-stone-900">{LOCALE_META[locale].label}</h3>
                  <span className="text-xs text-stone-500" data-testid={`completeness-${locale}`}>
                    {count}/{TOTAL_LOCALIZED_FIELDS} fields
                  </span>
                </div>
                {locale === 'en' ? (
                  <p className="text-xs text-stone-400">Required for publishing; other locales fall back here.</p>
                ) : null}
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Title</span>
                  <input
                    type="text"
                    value={copy.name}
                    onChange={(event) => patchLocalization(locale, 'name', event.target.value)}
                    className={`${INPUT_CLASS} ${lc('name') ? 'border-lacquer-400' : ''}`}
                    data-testid={`locale-name-${locale}`}
                  />
                  {lc('name') ? <span className="text-xs text-lacquer-700">{lc('name')}</span> : null}
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Description</span>
                  <textarea
                    rows={3}
                    value={copy.description}
                    onChange={(event) => patchLocalization(locale, 'description', event.target.value)}
                    className={`${INPUT_CLASS} ${lc('description') ? 'border-lacquer-400' : ''}`}
                    data-testid={`locale-description-${locale}`}
                  />
                  {lc('description') ? <span className="text-xs text-lacquer-700">{lc('description')}</span> : null}
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Tasting notes</span>
                  <textarea
                    rows={2}
                    value={copy.tastingNotes}
                    onChange={(event) => patchLocalization(locale, 'tastingNotes', event.target.value)}
                    className={INPUT_CLASS}
                    data-testid={`locale-tasting-${locale}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Brewing guidance</span>
                  <textarea
                    rows={2}
                    value={copy.brewingNotes}
                    onChange={(event) => patchLocalization(locale, 'brewingNotes', event.target.value)}
                    className={INPUT_CLASS}
                    data-testid={`locale-brewing-${locale}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>SEO title</span>
                  <input
                    type="text"
                    value={copy.seoTitle}
                    onChange={(event) => patchLocalization(locale, 'seoTitle', event.target.value)}
                    className={INPUT_CLASS}
                    data-testid={`locale-seo-title-${locale}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>SEO description</span>
                  <textarea
                    rows={2}
                    value={copy.seoDescription}
                    onChange={(event) => patchLocalization(locale, 'seoDescription', event.target.value)}
                    className={INPUT_CLASS}
                    data-testid={`locale-seo-description-${locale}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  <span className={LABEL_TEXT_CLASS}>Media alt text</span>
                  <input
                    type="text"
                    value={copy.mediaAlt}
                    onChange={(event) => patchLocalization(locale, 'mediaAlt', event.target.value)}
                    className={INPUT_CLASS}
                    data-testid={`locale-media-alt-${locale}`}
                  />
                </label>
                <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs" data-testid={`fallback-preview-${locale}`}>
                  <p className="mb-1 font-medium text-stone-500">Shopper preview</p>
                  <p className="font-medium text-stone-900">
                    {effectiveField(previewRows, locale, 'name', state.slug || '—')}
                  </p>
                  <p className="mt-1 text-stone-600">
                    {effectiveField(previewRows, locale, 'description', '—')}
                  </p>
                  {(fallbackName || fallbackDescription) && locale !== 'en' ? (
                    <p className="mt-1 text-stone-400" data-testid={`fallback-badge-${locale}`}>
                      Fallback: English copy shown where {locale} is missing.
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Publication */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-5" data-testid="publication-section">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold text-pine-900">Publication</h2>
          {product?.published && product.publishedAt ? (
            <span className="text-xs text-stone-500" data-testid="published-at">
              Published since {new Date(product.publishedAt).toISOString().slice(0, 10)}
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm" data-testid="coverage-table">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3 font-medium">Field</th>
                {LOCALE_IDS.map((locale) => (
                  <th key={locale} className="px-3 py-2 font-medium">
                    {locale}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LOCALIZED_FIELDS.map((field) => (
                <tr key={field} className="border-b border-stone-100">
                  <td className="py-2 pr-3 text-stone-700">{field}</td>
                  {LOCALE_IDS.map((locale) => {
                    const value = previewRows.find((row) => row.locale === locale)?.[field];
                    const filled = typeof value === 'string' && value.trim().length > 0;
                    return (
                      <td key={locale} className="px-3 py-2" data-testid={`coverage-${locale}-${field}`}>
                        {filled ? <span className="text-pine-700">✓</span> : <span className="text-stone-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {product?.published ? (
            <button
              type="button"
              onClick={unpublish}
              disabled={pending}
              className="rounded-md border border-lacquer-300 px-4 py-2 text-sm font-medium text-lacquer-800 transition-colors hover:bg-lacquer-50 disabled:opacity-50"
              data-testid="unpublish-button"
            >
              {pending ? 'Working…' : 'Unpublish'}
            </button>
          ) : (
            <button
              type="button"
              onClick={publish}
              disabled={pending || !publishable}
              className="rounded-md bg-pine-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine-800 disabled:opacity-50"
              data-testid="publish-button"
            >
              {pending ? 'Working…' : 'Publish'}
            </button>
          )}
          {!publishable && !product?.published ? (
            <p className="text-xs text-stone-500" data-testid="publish-reasons">
              Publishing requires at least one variant and an English title and description.
            </p>
          ) : null}
          {fieldError('publish') ? <p className="text-xs text-lacquer-700">{fieldError('publish')}</p> : null}
        </div>
      </section>
    </div>
  );
}

/** Format-only helper: best-effort cents preview for a yuan string (display only). */
function parseCentsSafely(yuan: string): number {
  try {
    return parsePriceToCents(yuan);
  } catch {
    return 0;
  }
}

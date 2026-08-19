'use client';

import { useId, useState } from 'react';
import { formatCny } from '@/i18n/format';
import type { LocaleId } from '@/i18n/registry';
import { isLowStock } from '@/lib/catalog-options';
import { PRODUCT_SCHEMA_SCRIPT_ID, patchJsonLdOffer } from '@/lib/product-schema';
import { AddToCart } from './add-to-cart';
import { PlaceholderTea } from './placeholder-tea';

/** Variant facts the picker needs. SKU/price/inventory are language-neutral. */
export interface PurchaseVariant {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  inventory: number;
}

export interface PurchaseStrings {
  variantLegend: string;
  skuLabel: string;
  inStock: string;
  lowStock: string;
  outOfStock: string;
  /** Short tag shown on an unavailable option (e.g. "Out of stock"). */
  unavailableOption: string;
  addToCart: string;
  addedToCart: string;
  /** Shown when the server rejects the add (e.g. stock changed underneath). */
  addError: string;
  /** Short "Demo" badge label for the media panel. */
  demoBadge: string;
}

interface ProductPurchaseProps {
  locale: LocaleId;
  productSlug: string;
  /** Localized alt text for the product media (variants share it). */
  imageAlt: string;
  variants: PurchaseVariant[];
  /** SKU initially selected: the product's default variant (position 0). */
  defaultSku: string;
  strings: PurchaseStrings;
}

/**
 * The purchase area of the product detail page (ADR-0006).
 *
 * Variant selection is pure client state: choosing a size updates the SKU,
 * price, stock text, media illustration, and add-to-cart eligibility in
 * place — no navigation, so the locale (path segment) and the accessibility
 * state (native radio group semantics, focus, announce region) are never
 * lost. The page's JSON-LD offers block is patched to the selected variant so
 * structured data always matches the visible price and availability.
 */
export function ProductPurchase({
  locale,
  productSlug,
  imageAlt,
  variants,
  defaultSku,
  strings,
}: ProductPurchaseProps) {
  const groupName = useId();
  const [selectedSku, setSelectedSku] = useState(defaultSku);

  const selected =
    variants.find((variant) => variant.sku === selectedSku) ??
    variants[0] ??
    ({ id: '', sku: '', name: '', priceCents: 0, inventory: 0 } satisfies PurchaseVariant);

  const inStock = selected.inventory > 0;
  const lowStock = isLowStock(selected.inventory);
  const statusText = !inStock
    ? strings.outOfStock
    : lowStock
      ? strings.lowStock
      : strings.inStock;
  const priceText = formatCny(selected.priceCents, locale);

  function selectVariant(sku: string, priceCents: number, inventory: number) {
    setSelectedSku(sku);
    patchJsonLdOffer(document.getElementById(PRODUCT_SCHEMA_SCRIPT_ID), {
      sku,
      priceCents,
      inventory,
    });
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <PlaceholderTea
          slug={`${productSlug}:${selected.id}`}
          alt={imageAlt}
          className="aspect-square w-full"
        />
        <span
          className="absolute left-3 top-3 rounded-sm bg-white/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-500 shadow-sm"
        >
          {strings.demoBadge}
        </span>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="price-ticket text-base" data-testid="variant-price">
              {priceText}
            </span>
            <span
              data-testid="stock-status"
              className={`text-sm ${!inStock ? 'text-lacquer-700' : lowStock ? 'text-amber-700' : 'text-pine-700'}`}
            >
              {statusText}
            </span>
          </div>
          <p className="mt-1 text-xs text-stone-500" data-testid="variant-sku">
            {strings.skuLabel}: {selected.sku}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs uppercase tracking-wider text-stone-400">
            {strings.variantLegend}
          </legend>
          <div
            role="radiogroup"
            aria-label={strings.variantLegend}
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            data-testid="variant-options"
          >
            {variants.map((variant) => {
              const optionInStock = variant.inventory > 0;
              const checked = variant.sku === selected.sku;
              return (
                <label
                  key={variant.sku}
                  data-testid="variant-option"
                  className={`relative flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-pine-300 has-[:focus-visible]:outline-none ${
                    checked
                      ? 'border-pine-600 bg-pine-50 text-pine-900'
                      : 'border-stone-200 bg-white text-stone-700 hover:border-pine-300'
                  } ${optionInStock ? '' : 'opacity-70'}`}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={variant.sku}
                    checked={checked}
                    disabled={!optionInStock}
                    onChange={() => selectVariant(variant.sku, variant.priceCents, variant.inventory)}
                    aria-label={`${variant.name} — ${formatCny(variant.priceCents, locale)} — ${
                      optionInStock ? strings.inStock : strings.unavailableOption
                    }`}
                    data-testid={`variant-radio-${variant.sku}`}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <span className="font-medium">{variant.name}</span>
                  <span className="text-stone-600">{formatCny(variant.priceCents, locale)}</span>
                  {!optionInStock && (
                    <span
                      data-testid={`variant-unavailable-${variant.sku}`}
                      className="absolute -top-2 right-2 rounded-sm bg-lacquer-600 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
                    >
                      {strings.unavailableOption}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <AddToCart
              sku={selected.sku}
              label={strings.addToCart}
              addedLabel={strings.addedToCart}
              errorLabel={strings.addError}
              disabled={!inStock}
            />
          </div>
          {/* Announced on variant change: name, price, and stock state. */}
          <p role="status" data-testid="purchase-status" className="text-xs text-stone-400">
            {selected.name} — {priceText} — {statusText}
          </p>
        </div>
      </div>
    </>
  );
}
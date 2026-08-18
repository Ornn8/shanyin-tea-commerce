/**
 * Structured data (JSON-LD Product schema) for the product detail page
 * (ADR-0006).
 *
 * Policy: the schema contains ONLY verified seeded facts — the canonical URL,
 * the language-neutral SKU, the displayed price and availability of the
 * selected variant, and the localized name/description — plus the visible
 * working brand identity. No ratings, reviews, GTINs, MPNs, certifications,
 * harvest dates, scarcity, or other claims are ever emitted (PRODUCT.md).
 *
 * The server renders the schema for the default (first-created) variant, and
 * the client variant selector patches the `offers` block in place on
 * selection so the structured data always matches the visible price and
 * availability (Acceptance: "Structured data contains only verified seeded
 * facts and matches visible price and availability"). The pure builders are
 * unit-tested; the DOM patch is exercised by the e2e suite.
 *
 * Serialization safety: the JSON string is embedded verbatim in an HTML
 * `<script type="application/ld+json">` element (the page uses
 * `dangerouslySetInnerHTML`), so characters that are legal in JSON but unsafe
 * inside a script element — `<`/`>`/`&` and the U+2028/U+2029 line
 * separators — are escaped to their `\uXXXX` forms before embedding
 * (`serializeProductSchema`). `JSON.stringify` alone does NOT do this: a
 * merchant-editable name or description containing `</script><script>…`
 * would otherwise terminate the JSON-LD element and execute script in
 * visitors' browsers. The escapes keep the document valid JSON and round-trip
 * through `JSON.parse` unchanged (regression-tested). The client patch writes
 * through `textContent`, which is never re-parsed as HTML, so it needs no
 * escaping.
 */

export const PRODUCT_SCHEMA_SCRIPT_ID = 'product-jsonld';

/** Integer CNY cents → decimal yuan string, e.g. 128000 → "1280.00". */
export function priceYuanFromCents(priceCents: number): string {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    throw new Error(`priceYuanFromCents expects a non-negative safe integer in cents, got ${priceCents}`);
  }
  const yuan = Math.trunc(priceCents / 100);
  const cents = priceCents % 100;
  return `${yuan}.${String(cents).padStart(2, '0')}`;
}

/** schema.org availability token derived from the shared inventory fact. */
export function availabilityFromInventory(inventory: number): string {
  return inventory > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
}

export interface ProductSchemaInput {
  /** Canonical absolute URL of this localized product page. */
  canonicalUrl: string;
  /** Localized product name (matches visible copy). */
  name: string;
  /** Localized description (matches visible copy). */
  description: string;
  /** Language-neutral SKU of the variant described by the offers block. */
  sku: string;
  /** Shared integer-cents CNY price of that variant. */
  priceCents: number;
  /** Shared per-variant inventory of that variant. */
  inventory: number;
  /** Localized brand identity shown in the page header. */
  brandName: string;
  /** Optional absolute image URL; omitted until merchant photography exists. */
  imageUrl?: string;
}

/** Build the schema.org Product object for the given variant facts. */
export function buildProductSchema(input: ProductSchemaInput): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': input.canonicalUrl,
    name: input.name,
    description: input.description,
    sku: input.sku,
    brand: { '@type': 'Brand', name: input.brandName },
    offers: {
      '@type': 'Offer',
      '@id': `${input.canonicalUrl}#offer-${input.sku}`,
      url: input.canonicalUrl,
      sku: input.sku,
      price: priceYuanFromCents(input.priceCents),
      priceCurrency: 'CNY',
      availability: availabilityFromInventory(input.inventory),
    },
  };
  if (input.imageUrl) schema.image = input.imageUrl;
  return schema;
}

/**
 * Characters that are valid inside a JSON document but unsafe inside an HTML
 * `<script>` element: an unescaped `<` can terminate the element at the next
 * `</script` sequence, `&` starts HTML character references in the parser,
 * and U+2028/U+2029 (JavaScript line/paragraph separators) historically broke
 * string literals in JS engines that execute script content. Every one is
 * emitted as a JSON `\uXXXX` escape so the document stays valid JSON and
 * parses back to the original characters.
 */
const SCRIPT_UNSAFE_RE = /[<>&\u2028\u2029]/g;

function escapeScriptUnsafe(match: string): string {
  switch (match) {
    case '<':
      return '\\u003c';
    case '>':
      return '\\u003e';
    case '&':
      return '\\u0026';
    case '\u2028':
      return '\\u2028';
    case '\u2029':
      return '\\u2029';
    default:
      return match;
  }
}

/** JSON string for the page's `<script type="application/ld+json">` element. */
export function serializeProductSchema(input: ProductSchemaInput): string {
  return JSON.stringify(buildProductSchema(input)).replace(SCRIPT_UNSAFE_RE, escapeScriptUnsafe);
}

/** The offer facts of the currently selected variant (client patch input). */
export interface OfferPatch {
  sku: string;
  priceCents: number;
  inventory: number;
}

/**
 * Patch the `offers` block of the rendered Product schema in place so the
 * structured data always matches the variant the visitor has selected.
 * No-op (and safe) when the element is missing or unparseable.
 */
export function patchJsonLdOffer(
  script: HTMLElement | null | undefined,
  patch: OfferPatch,
): boolean {
  if (!script) return false;
  try {
    const data: unknown = JSON.parse(script.textContent ?? '{}');
    if (typeof data !== 'object' || data === null || !('offers' in data)) return false;
    const record = data as Record<string, unknown>;
    const offers = record.offers as Record<string, unknown>;
    if (typeof offers !== 'object' || offers === null) return false;
    offers.sku = patch.sku;
    offers.price = priceYuanFromCents(patch.priceCents);
    offers.availability = availabilityFromInventory(patch.inventory);
    script.textContent = JSON.stringify(data);
    return true;
  } catch {
    return false;
  }
}
/**
 * Merchant administration mutations (ADR-0005).
 *
 * All commerce mutations:
 * - are called with the authenticated, allowlisted actor email (the
 *   authorization guard lives in the server-action layer / authz.ts);
 * - re-validate the full payload server-side (validation.ts);
 * - run in a transaction that also writes the AuditLog row (actor, action,
 *   entity, before/after JSON summary — no secrets);
 * - can never produce duplicate SKUs, negative stock, floating-point prices,
 *   or locale-specific inventory (integer cents + per-variant inventory +
 *   global SKU uniqueness + publish checks below);
 * - never leave a published product in a state that fails the publishability
 *   gate (updateProduct rejects edits that would break it, ADR-0005).
 */
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { FALLBACK_LOCALE, LOCALE_IDS, type LocaleId } from '@/i18n/registry';
import { AdminError } from './errors';
import {
  normalizeProductInput,
  validateInventory,
  validatePriceCents,
  validateSku,
  type ProductInput,
} from './validation';
import {
  fieldCompleteness,
  isFieldFilled,
  type LocalizedField,
  type LocalizedRow,
} from './preview';
import { summarizeProduct, summarizeVariant, writeAudit, type ProductRowForAudit } from './audit';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface ProductWithRelations extends ProductRowForAudit {
  categoryId: string;
}

async function loadProductWithRelations(id: string): Promise<ProductWithRelations> {
  const row = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: { createdAt: 'asc' } },
      localizations: true,
    },
  });
  if (!row) throw new AdminError('not-found', 'Product not found.');
  return row;
}

function toAuditRow(
  row: ProductWithRelations,
): ProductRowForAudit {
  return {
    id: row.id,
    slug: row.slug,
    origin: row.origin,
    form: row.form,
    caffeine: row.caffeine,
    categoryId: row.categoryId,
    published: row.published,
    publishedAt: row.publishedAt,
    variants: row.variants,
    localizations: row.localizations,
  };
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new AdminError('invalid-category', 'The selected category does not exist.', { categoryId: 'The selected category does not exist.' });
}

async function assertSlugAvailable(slug: string, excludeProductId?: string): Promise<void> {
  const existing = await prisma.product.findUnique({ where: { slug } });
  if (existing && existing.id !== excludeProductId) {
    throw new AdminError('duplicate-slug', `The slug "${slug}" is already used by another product.`, { slug: 'This slug is already used by another product.' });
  }
}

/** Cross-product SKU uniqueness check (same-product duplicates were already rejected). */
async function assertSkusAvailable(
  tx: Tx,
  productId: string,
  variants: ProductInput['variants'],
  keptVariantIds: string[],
): Promise<void> {
  const skus = variants.map((variant) => validateSku(variant.sku));
  const clash = await tx.productVariant.findFirst({
    where: {
      sku: { in: skus },
      productId: { not: productId },
      NOT: { id: { in: keptVariantIds } },
    },
  });
  if (clash) {
    const index = Math.max(
      0,
      variants.findIndex((variant) => validateSku(variant.sku) === clash.sku),
    );
    throw new AdminError('duplicate-sku', `SKU "${clash.sku}" is already used by another product.`, {
      [`variants[${index}].sku`]: 'This SKU is already used by another product.',
    });
  }
}

/** Replace a product's variant set inside a transaction (delete/update/create). */
async function replaceVariants(
  tx: Tx,
  productId: string,
  variants: ProductInput['variants'],
): Promise<void> {
  const existing = await tx.productVariant.findMany({ where: { productId } });
  const existingById = new Map(existing.map((variant) => [variant.id, variant]));
  const incoming = new Set(
    variants.filter((variant) => variant.id && existingById.has(variant.id)).map((variant) => variant.id!),
  );

  await assertSkusAvailable(tx, productId, variants, [...incoming]);

  const removed = existing.filter((variant) => !incoming.has(variant.id));
  if (removed.length > 0) {
    await tx.productVariant.deleteMany({ where: { id: { in: removed.map((variant) => variant.id) } } });
  }

  for (const variant of variants) {
    const data = {
      sku: validateSku(variant.sku),
      name: variant.name,
      priceCents: validatePriceCents(variant.priceCents),
      inventory: validateInventory(variant.inventory),
    };
    if (variant.id && existingById.has(variant.id)) {
      await tx.productVariant.update({ where: { id: variant.id }, data });
    } else {
      await tx.productVariant.create({ data: { productId, ...data } });
    }
  }
}

/** Upsert localization rows for the given locales (transaction). */
async function replaceLocalizations(
  tx: Tx,
  productId: string,
  localizations: ProductInput['localizations'],
): Promise<void> {
  for (const locale of LOCALE_IDS) {
    const copy = localizations[locale];
    if (!copy) continue;
    const data = {
      name: copy.name,
      description: copy.description,
      tastingNotes: copy.tastingNotes,
      brewingNotes: copy.brewingNotes ?? null,
      seoTitle: copy.seoTitle ?? null,
      seoDescription: copy.seoDescription ?? null,
      mediaAlt: copy.mediaAlt ?? null,
    };
    await tx.productLocalization.upsert({
      where: { productId_locale: { productId, locale } },
      update: data,
      create: { productId, locale, ...data },
    });
  }
}

export async function createProduct(
  actorEmail: string,
  raw: unknown,
): Promise<{ id: string }> {
  const input = normalizeProductInput(raw);
  await assertCategoryExists(input.categoryId);
  await assertSlugAvailable(input.slug);

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        slug: input.slug,
        origin: input.origin,
        form: input.form,
        caffeine: input.caffeine,
        categoryId: input.categoryId,
        // New products start unpublished; the merchant publishes explicitly.
        published: false,
      },
    });
    // Cross-product SKU uniqueness (the global unique index is the backstop).
    await assertSkusAvailable(tx, product.id, input.variants, []);
    for (const variant of input.variants) {
      await tx.productVariant.create({
        data: {
          productId: product.id,
          sku: validateSku(variant.sku),
          name: variant.name,
          priceCents: validatePriceCents(variant.priceCents),
          inventory: validateInventory(variant.inventory),
        },
      });
    }
    await replaceLocalizations(tx, product.id, input.localizations);

    const created = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { variants: true, localizations: true },
    });
    await writeAuditInTx(tx, {
      action: 'product.create',
      entityType: 'product',
      entityId: product.id,
      actorEmail,
      before: null,
      after: summarizeProduct(toAuditRow(created as ProductWithRelations)),
    });
    return { id: product.id };
  });
}

export async function updateProduct(
  actorEmail: string,
  productId: string,
  raw: unknown,
): Promise<void> {
  const input = normalizeProductInput(raw);
  await assertCategoryExists(input.categoryId);
  await assertSlugAvailable(input.slug, productId);

  const beforeRow = await loadProductWithRelations(productId);

  return prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: {
        slug: input.slug,
        origin: input.origin,
        form: input.form,
        caffeine: input.caffeine,
        categoryId: input.categoryId,
      },
    });
    await replaceVariants(tx, productId, input.variants);
    await replaceLocalizations(tx, productId, input.localizations);

    const afterRow = (await tx.product.findUniqueOrThrow({
      where: { id: productId },
      include: { variants: true, localizations: true },
    })) as ProductWithRelations;

    // Publication invariant (ADR-0005): a published product must keep meeting
    // the publishability gate. Field validation allows an empty description
    // (English fallback for other locales), so an edit that would leave a
    // published product without the required English copy or its last variant
    // is rejected here — the transaction rolls back and the storefront never
    // serves a product that no longer satisfies the gate. The merchant
    // unpublishes first or restores the missing requirements.
    if (beforeRow.published) {
      const publishability = computePublishability(afterRow);
      if (!publishability.ok) {
        throw new AdminError(
          'not-publishable',
          `Cannot save: this product is published and must keep meeting the publication requirements. ${publishability.reasons.join(' ')}`,
          { publish: publishability.reasons.join(' ') },
        );
      }
    }

    await writeAuditInTx(tx, {
      action: 'product.update',
      entityType: 'product',
      entityId: productId,
      actorEmail,
      before: summarizeProduct(toAuditRow(beforeRow)),
      after: summarizeProduct(toAuditRow(afterRow)),
    });
  });
}

export async function setVariantInventory(
  actorEmail: string,
  variantId: string,
  rawInventory: unknown,
): Promise<void> {
  const inventory = validateInventory(rawInventory, 'inventory');
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
  if (!variant) throw new AdminError('not-found', 'Variant not found.');

  await prisma.$transaction(async (tx) => {
    const updated = await tx.productVariant.update({
      where: { id: variantId },
      data: { inventory },
    });
    await writeAuditInTx(tx, {
      action: 'variant.inventory',
      entityType: 'variant',
      entityId: variantId,
      actorEmail,
      before: summarizeVariant(variant),
      after: summarizeVariant(updated),
    });
  });
}

export interface PublishCoverage {
  [locale: string]: Record<LocalizedField, boolean>;
}

export interface Publishability {
  ok: boolean;
  reasons: string[];
  coverage: PublishCoverage;
}

/** Translation coverage + publishability for a product (pure, unit-testable). */
export function computePublishability(
  row: Pick<ProductWithRelations, 'variants' | 'localizations'>,
): Publishability {
  const reasons: string[] = [];
  if (row.variants.length === 0) {
    reasons.push('At least one variant with a SKU, price, and inventory is required.');
  }
  const en = row.localizations.find((loc) => loc.locale === FALLBACK_LOCALE);
  if (!en) {
    reasons.push('English title and description are required to publish (other locales fall back to English).');
  } else {
    if (!isFieldFilled(en.name)) reasons.push('English title is required to publish.');
    if (!isFieldFilled(en.description)) reasons.push('English description is required to publish.');
  }

  const coverage: PublishCoverage = {};
  for (const locale of LOCALE_IDS) {
    coverage[locale] = fieldCompleteness(
      row.localizations.find((loc) => loc.locale === locale) as LocalizedRow | undefined,
    );
  }
  return { ok: reasons.length === 0, reasons, coverage };
}

export async function publishProduct(actorEmail: string, productId: string): Promise<void> {
  const beforeRow = await loadProductWithRelations(productId);
  const publishability = computePublishability(beforeRow);
  if (!publishability.ok) {
    throw new AdminError('not-publishable', publishability.reasons.join(' '), {
      publish: publishability.reasons.join(' '),
    });
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { published: true, publishedAt: beforeRow.publishedAt ?? new Date() },
      include: { variants: true, localizations: true },
    });
    await writeAuditInTx(tx, {
      action: 'product.publish',
      entityType: 'product',
      entityId: productId,
      actorEmail,
      before: summarizeProduct(toAuditRow(beforeRow)),
      after: {
        ...summarizeProduct(toAuditRow(updated as ProductWithRelations)),
        coverage: publishability.coverage,
      },
    });
  });
}

export async function unpublishProduct(actorEmail: string, productId: string): Promise<void> {
  const beforeRow = await loadProductWithRelations(productId);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { published: false },
      include: { variants: true, localizations: true },
    });
    await writeAuditInTx(tx, {
      action: 'product.unpublish',
      entityType: 'product',
      entityId: productId,
      actorEmail,
      before: summarizeProduct(toAuditRow(beforeRow)),
      after: summarizeProduct(toAuditRow(updated as ProductWithRelations)),
    });
  });
}

/** Audit writes participate in the same transaction as the mutation. */
async function writeAuditInTx(
  tx: Tx,
  entry: Parameters<typeof writeAudit>[0],
): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorEmail: entry.actorEmail,
      before: entry.before === null || entry.before === undefined ? Prisma.DbNull : entry.before,
      after: entry.after === null || entry.after === undefined ? Prisma.DbNull : entry.after,
    },
  });
}

export type { LocalizedField, LocaleId };

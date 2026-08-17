/**
 * Merchant administration integration tests (ADR-0005, Issue #3 acceptance).
 *
 * Covers, against the real PostgreSQL database and the real better-auth
 * instance:
 *
 * - authorization: no cookie / forged cookie / valid session / session of a
 *   non-allowlisted user; public registration disabled;
 * - CSRF: a state-changing auth request with a foreign Origin and cookies is
 *   rejected (403);
 * - rate limits: sign-in attempts from one IP are throttled (429);
 * - mutations: create/update/publish/unpublish/inventory with audit rows for
 *   every mutation (actor, timestamp, entity, before/after, no secrets);
 * - invalid input: duplicate SKUs, negative stock, floating-point prices,
 *   unknown locales, duplicate slugs, missing publish requirements;
 * - publication gate on edit: an update that would leave a published product
 *   unpublishable is rejected (rollback, no audit row), a published product
 *   can still be edited while it stays publishable, and drafts may be saved
 *   while incomplete.
 *
 * Test files run serially (`fileParallelism: false`) and share one database;
 * every fixture is cleaned up in `afterAll`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from 'better-auth/crypto';
import { prisma } from '@/lib/prisma';
import { auth, SIGN_IN_RATE_LIMIT } from '@/lib/auth';
import { ADMIN_EMAIL, getSessionForHeaders, requireAdminForHeaders } from '@/lib/admin/authz';
import {
  computePublishability,
  createProduct,
  publishProduct,
  setVariantInventory,
  unpublishProduct,
  updateProduct,
} from '@/lib/admin/service';
import { listProducts } from '@/lib/products';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me-shanyin-demo-2026';
const ADMIN_IP = '203.0.113.1';
const OTHER_IP = '203.0.113.2';

/** Sign in through the real HTTP handler and return the signed session cookie. */
async function signInCookie(email: string, password: string, ip: string): Promise<string> {
  const response = await auth.handler(
    new Request('http://127.0.0.1:3100/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        origin: 'http://127.0.0.1:3100',
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(response.status).toBe(200);
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return setCookie!.split(';')[0];
}

describeDb('merchant administration (ADR-0005)', () => {
  const createdProductIds: string[] = [];
  const createdVariantIds: string[] = [];
  const createdUserEmails: string[] = [];

  let greenCategoryId: string;

  beforeAll(async () => {
    await prisma.$connect();
    greenCategoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'green-tea' } })).id;
  });

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdProductIds } } });
    }
    if (createdVariantIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdVariantIds } } });
    }
    await prisma.product.deleteMany({
      where: { slug: { startsWith: 'it-admin-' } },
    });
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await prisma.$disconnect();
  });

  // --- authorization ------------------------------------------------------

  it('no cookie or a forged cookie yields no admin session', async () => {
    expect(await getSessionForHeaders(new Headers())).toBeNull();
    expect(
      await getSessionForHeaders(
        new Headers({ cookie: 'better-auth.session_token=forged-token-value' }),
      ),
    ).toBeNull();
    await expect(requireAdminForHeaders(new Headers())).rejects.toThrow(/sign-in required/i);
  });

  it('a valid allowlisted admin session is accepted by the guard', async () => {
    const cookie = await signInCookie(ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_IP);
    const session = await getSessionForHeaders(new Headers({ cookie }));
    expect(session?.user.email).toBe(ADMIN_EMAIL);
  });

  it('a session belonging to a non-allowlisted user is rejected by the guard', async () => {
    const email = 'it-admin-intruder@example.com';
    const hash = await hashPassword('intruder-pass-123');
    const user = await prisma.user.create({
      data: { email, name: 'Intruder', password: hash, emailVerified: true },
    });
    // better-auth verifies sign-in via the "credential" account row.
    await prisma.account.create({
      data: {
        id: `credential-${user.id}`,
        userId: user.id,
        providerId: 'credential',
        accountId: email,
        password: hash,
      },
    });
    createdUserEmails.push(email);

    const cookie = await signInCookie(email, 'intruder-pass-123', OTHER_IP);
    expect(await getSessionForHeaders(new Headers({ cookie }))).toBeNull();
    await expect(requireAdminForHeaders(new Headers({ cookie }))).rejects.toThrow();
  });

  it('public registration is disabled (sign-up endpoint rejects)', async () => {
    const response = await auth.handler(
      new Request('http://127.0.0.1:3100/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.3',
          origin: 'http://127.0.0.1:3100',
        },
        body: JSON.stringify({
          email: 'it-admin-signup@example.com',
          password: 'whatever-123',
          name: 'Nobody',
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    expect(body?.code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');
  });

  // --- CSRF / rate limits ------------------------------------------------

  it('CSRF: state-changing auth request with a foreign Origin is rejected', async () => {
    // Form-submission CSRF path: an Origin header that is not trusted is
    // rejected with 403 even without cookies (force-validated).
    const response = await auth.handler(
      new Request('http://127.0.0.1:3100/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.5',
          origin: 'https://evil.example',
        },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      }),
    );
    expect(response.status).toBe(403);

    // Positive control: a same-origin state-changing request is NOT blocked.
    const sameOrigin = await auth.handler(
      new Request('http://127.0.0.1:3100/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.6',
          origin: 'http://127.0.0.1:3100',
        },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password-123' }),
      }),
    );
    expect(sameOrigin.status).toBe(401);
  });

  it('rate limit: sign-in attempts from one IP are throttled after the limit', async () => {
    const ip = '203.0.113.9';
    const attempts: number[] = [];
    for (let i = 0; i < SIGN_IN_RATE_LIMIT.max + 1; i++) {
      const response = await auth.handler(
        new Request('http://127.0.0.1:3100/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ip,
          },
          body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password-123' }),
        }),
      );
      attempts.push(response.status);
    }
    const throttled = attempts.filter((status) => status === 429);
    expect(throttled.length).toBeGreaterThanOrEqual(1);
    expect(attempts[attempts.length - 1]).toBe(429);
  });

  // --- mutations + audit --------------------------------------------------

  const basePayload = (slug = 'it-admin-demo', sku = 'IT-ADMIN-001') => ({
    slug,
    origin: 'Demo origin for admin tests',
    form: 'LOOSE' as const,
    caffeine: 'MEDIUM' as const,
    categoryId: greenCategoryId,
    variants: [{ sku, name: 'Standard', priceCents: 88050, inventory: 3 }],
    localizations: {
      en: {
        name: 'Admin Demo Tea',
        description: 'Demo product created by the admin integration suite.',
        tastingNotes: 'Demo notes.',
        brewingNotes: 'Steep 3 minutes at 85°C.',
        seoTitle: 'Admin Demo Tea — Shanyin',
        seoDescription: 'A demo listing managed through the merchant editor.',
        mediaAlt: 'A placeholder illustration of Admin Demo Tea.',
      },
      'zh-CN': {
        name: '管理员演示茶',
        description: '演示条目：由商户后台集成测试创建。',
        tastingNotes: '演示笔记。',
      },
      ja: {
        name: '管理者デモ茶',
        description: 'デモ商品：管理画面の統合テストで作成されました。',
        tastingNotes: 'デモ備考。',
      },
    },
  });

  it('createProduct creates an unpublished product with variants, localizations, and an audit row', async () => {
    const { id } = await createProduct(ADMIN_EMAIL, basePayload());
    createdProductIds.push(id);

    const row = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: { variants: true, localizations: true },
    });
    expect(row.published).toBe(false);
    expect(row.publishedAt).toBeNull();
    expect(row.variants).toHaveLength(1);
    expect(row.variants[0]).toMatchObject({ sku: 'IT-ADMIN-001', priceCents: 88050, inventory: 3 });
    expect(row.localizations).toHaveLength(3);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'product.create' },
    });
    expect(audit.actorEmail).toBe(ADMIN_EMAIL);
    expect(audit.before).toBeNull();
    expect((audit.after as { slug: string }).slug).toBe('it-admin-demo');
  });

  it('createProduct rejects duplicate SKUs across products', async () => {
    const payload = basePayload('it-admin-dupe-sku');
    payload.variants = [{ sku: 'IT-ADMIN-001', name: 'Standard', priceCents: 100, inventory: 1 }];
    await expect(createProduct(ADMIN_EMAIL, payload)).rejects.toMatchObject({
      code: 'duplicate-sku',
    });
  });

  it('createProduct rejects duplicate SKUs within one payload', async () => {
    const payload = basePayload('it-admin-inner-dupe');
    payload.variants = [
      { sku: 'IT-ADMIN-900', name: 'A', priceCents: 100, inventory: 1 },
      { sku: 'IT-ADMIN-900', name: 'B', priceCents: 200, inventory: 2 },
    ];
    await expect(createProduct(ADMIN_EMAIL, payload)).rejects.toMatchObject({
      code: 'duplicate-sku',
    });
  });

  it('createProduct rejects negative stock, floating-point prices, and unknown locales', async () => {
    const negative = basePayload('it-admin-negative');
    negative.variants = [{ sku: 'IT-ADMIN-002', name: 'Standard', priceCents: 100, inventory: -1 }];
    await expect(createProduct(ADMIN_EMAIL, negative)).rejects.toMatchObject({ code: 'invalid-inventory' });

    const floatPrice = basePayload('it-admin-float');
    floatPrice.variants = [{ sku: 'IT-ADMIN-003', name: 'Standard', priceCents: 10.5, inventory: 1 }];
    await expect(createProduct(ADMIN_EMAIL, floatPrice)).rejects.toMatchObject({ code: 'invalid-price' });

    const unknownLocale = basePayload('it-admin-locale');
    // Intentionally malformed: a locale that is not in the registry.
    unknownLocale.localizations = {
      'xx-XX': { name: 'Nope', description: 'd', tastingNotes: 't' },
    } as unknown as typeof unknownLocale.localizations;
    await expect(createProduct(ADMIN_EMAIL, unknownLocale)).rejects.toMatchObject({ code: 'invalid-locale' });
  });

  it('createProduct rejects duplicate slugs and empty variants', async () => {
    await expect(createProduct(ADMIN_EMAIL, basePayload())).rejects.toMatchObject({ code: 'duplicate-slug' });

    const noVariants = basePayload('it-admin-novariants');
    noVariants.variants = [];
    await expect(createProduct(ADMIN_EMAIL, noVariants)).rejects.toMatchObject({ code: 'invalid-variants' });
  });

  it('updateProduct edits facts, variants, and localizations with before/after audit', async () => {
    const { id } = await createProduct(ADMIN_EMAIL, {
      ...basePayload('it-admin-update'),
      variants: [
        { sku: 'IT-ADMIN-010', name: 'Standard', priceCents: 10000, inventory: 2 },
        { sku: 'IT-ADMIN-011', name: 'Gift tin', priceCents: 15000, inventory: 5 },
      ],
    });
    createdProductIds.push(id);

    await updateProduct(ADMIN_EMAIL, id, {
      ...basePayload('it-admin-update'),
      origin: 'Updated demo origin',
      variants: [
        { sku: 'IT-ADMIN-010', name: 'Standard', priceCents: 12500, inventory: 9 },
        { sku: 'IT-ADMIN-012', name: 'Travel pack', priceCents: 20000, inventory: 1 },
      ],
      localizations: {
        en: { name: 'Admin Demo Tea (updated)', description: 'Updated description.', tastingNotes: 'Notes.' },
      },
    });

    const row = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: { variants: true, localizations: true },
    });
    expect(row.origin).toBe('Updated demo origin');
    expect(row.variants.map((variant) => variant.sku).sort()).toEqual(['IT-ADMIN-010', 'IT-ADMIN-012']);
    const standard = row.variants.find((variant) => variant.sku === 'IT-ADMIN-010')!;
    expect(standard).toMatchObject({ priceCents: 12500, inventory: 9 });
    // Provided locales are upserted; untouched locale rows are preserved.
    expect(row.localizations).toHaveLength(3);
    const en = row.localizations.find((loc) => loc.locale === 'en')!;
    expect(en.name).toBe('Admin Demo Tea (updated)');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'product.update' },
      orderBy: { createdAt: 'desc' },
    });
    const before = audit.before as { variants: Array<{ sku: string; priceCents: number }>; origin: string };
    const after = audit.after as { variants: Array<{ sku: string; priceCents: number }>; origin: string };
    expect(before.origin).toBe('Demo origin for admin tests');
    expect(after.origin).toBe('Updated demo origin');
    expect(before.variants.find((variant) => variant.sku === 'IT-ADMIN-010')?.priceCents).toBe(10000);
    expect(after.variants.find((variant) => variant.sku === 'IT-ADMIN-010')?.priceCents).toBe(12500);
  });

  it('updateProduct rejects an edit that would break publishability of a published product (storefront gate holds)', async () => {
    const slug = 'it-admin-published-gate';
    const { id } = await createProduct(ADMIN_EMAIL, basePayload(slug, 'IT-ADMIN-060'));
    createdProductIds.push(id);
    await publishProduct(ADMIN_EMAIL, id);

    // Clearing the English description is allowed by field validation, but it
    // must not leave a published product failing the required English gate.
    const broken = basePayload(slug, 'IT-ADMIN-060');
    broken.localizations.en.description = '';
    await expect(updateProduct(ADMIN_EMAIL, id, broken)).rejects.toMatchObject({
      code: 'not-publishable',
    });

    // The transaction rolled back: nothing changed, no audit row, and the
    // product is still published and storefront-visible with the old copy.
    const row = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: { localizations: true },
    });
    expect(row.published).toBe(true);
    expect(row.localizations.find((loc) => loc.locale === 'en')?.description).toBe(
      'Demo product created by the admin integration suite.',
    );
    const updateAudits = await prisma.auditLog.count({
      where: { entityId: id, action: 'product.update' },
    });
    expect(updateAudits).toBe(0);
    expect((await listProducts('en')).some((product) => product.slug === slug)).toBe(true);
  });

  it('updateProduct allows editing a published product when the new state stays publishable', async () => {
    const slug = 'it-admin-published-keep';
    const { id } = await createProduct(ADMIN_EMAIL, basePayload(slug, 'IT-ADMIN-061'));
    createdProductIds.push(id);
    await publishProduct(ADMIN_EMAIL, id);

    const edit = basePayload(slug, 'IT-ADMIN-061');
    edit.localizations.en.description = 'A refreshed description that still satisfies the gate.';
    await updateProduct(ADMIN_EMAIL, id, edit);

    const row = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: { localizations: true },
    });
    expect(row.published).toBe(true);
    expect(row.localizations.find((loc) => loc.locale === 'en')?.description).toBe(
      'A refreshed description that still satisfies the gate.',
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'product.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit.after as { published: boolean }).published).toBe(true);
    expect((audit.before as { published: boolean }).published).toBe(true);
  });

  it('updateProduct lets a draft be saved even when it is not publishable yet', async () => {
    const slug = 'it-admin-draft-incomplete';
    const { id } = await createProduct(ADMIN_EMAIL, basePayload(slug, 'IT-ADMIN-062'));
    createdProductIds.push(id);

    // Drafts may be incomplete (the publish action enforces the gate).
    const incomplete = basePayload(slug, 'IT-ADMIN-062');
    incomplete.localizations = {
      en: { name: 'Draft only', description: '', tastingNotes: '' },
    } as unknown as typeof incomplete.localizations;
    await updateProduct(ADMIN_EMAIL, id, incomplete);

    const row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.published).toBe(false);
    expect((await listProducts('en')).some((product) => product.slug === slug)).toBe(false);
  });

  it('setVariantInventory adjusts stock with an audited variant.inventory action', async () => {
    const { id } = await createProduct(ADMIN_EMAIL, basePayload('it-admin-inventory', 'IT-ADMIN-050'));
    createdProductIds.push(id);
    const variant = (await prisma.product.findUniqueOrThrow({ where: { id }, include: { variants: true } }))
      .variants[0];
    createdVariantIds.push(variant.id);

    await setVariantInventory(ADMIN_EMAIL, variant.id, 12);
    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.inventory).toBe(12);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: variant.id, action: 'variant.inventory' },
    });
    expect((audit.before as { inventory: number }).inventory).toBe(3);
    expect((audit.after as { inventory: number }).inventory).toBe(12);

    await expect(setVariantInventory(ADMIN_EMAIL, variant.id, -5)).rejects.toMatchObject({
      code: 'invalid-inventory',
    });
    await expect(setVariantInventory(ADMIN_EMAIL, variant.id, 2.5)).rejects.toMatchObject({
      code: 'invalid-inventory',
    });
  });

  it('publishability: coverage is exposed; publish requires English copy and a variant', async () => {
    const bare = {
      variants: [] as Array<{ id: string; sku: string; name: string; priceCents: number; inventory: number }>,
      localizations: [] as Array<{ locale: string; name: string; description: string; tastingNotes: string }>,
    };
    const check = computePublishability(bare);
    expect(check.ok).toBe(false);
    expect(check.reasons.length).toBeGreaterThan(0);
    expect(check.coverage.en.name).toBe(false);

    const { id } = await createProduct(ADMIN_EMAIL, basePayload('it-admin-publishability', 'IT-ADMIN-030'));
    createdProductIds.push(id);

    // Remove the English row → publish must fail.
    await prisma.productLocalization.delete({ where: { productId_locale: { productId: id, locale: 'en' } } });
    await expect(publishProduct(ADMIN_EMAIL, id)).rejects.toMatchObject({ code: 'not-publishable' });
  });

  it('publish exposes translation coverage, sets publishedAt, and never duplicates inventory per locale', async () => {
    const { id } = await createProduct(ADMIN_EMAIL, {
      ...basePayload(),
      slug: 'it-admin-publish',
      variants: [{ sku: 'IT-ADMIN-020', name: 'Standard', priceCents: 88050, inventory: 7 }],
    });
    createdProductIds.push(id);

    await publishProduct(ADMIN_EMAIL, id);
    const row = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: { variants: true, localizations: true },
    });
    expect(row.published).toBe(true);
    expect(row.publishedAt).not.toBeNull();
    expect(row.variants).toHaveLength(1);
    expect(row.variants[0].inventory).toBe(7);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'product.publish' },
    });
    const after = audit.after as { coverage: Record<string, Record<string, boolean>> };
    expect(after.coverage.en.name).toBe(true);
    expect(after.coverage.en.description).toBe(true);
    expect(after.coverage['zh-CN'].name).toBe(true);
    // ja has no seo fields in the fixture → coverage exposes the gap.
    expect(after.coverage.ja.seoTitle).toBe(false);

    // Storefront: published product becomes visible.
    const visible = await listProducts('en');
    expect(visible.some((product) => product.slug === 'it-admin-publish')).toBe(true);

    // Inventory stays on the variant — localization rows never carry stock.
    for (const loc of row.localizations) {
      expect(Object.keys(loc)).not.toContain('inventory');
    }
  });

  it('unpublish hides the product from the storefront and audits the action', async () => {
    const { id } = await createProduct(ADMIN_EMAIL, basePayload('it-admin-unpublish', 'IT-ADMIN-040'));
    createdProductIds.push(id);
    await publishProduct(ADMIN_EMAIL, id);
    await unpublishProduct(ADMIN_EMAIL, id);

    const row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.published).toBe(false);
    expect((await listProducts('en')).some((product) => product.slug === 'it-admin-unpublish')).toBe(false);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'product.unpublish' },
    });
    expect((audit.before as { published: boolean }).published).toBe(true);
    expect((audit.after as { published: boolean }).published).toBe(false);
  });

  it('audit rows never store secrets (passwords, tokens, sessions)', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { entityId: { in: createdProductIds } },
    });
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows.map((row) => [row.before, row.after]));
    expect(serialized).not.toMatch(/password|passwd|secret|token|session/i);
  });
});

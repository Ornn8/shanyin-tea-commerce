import { expect, test } from '@playwright/test';
import { cleanupAdminE2e, disconnectAdminE2e } from './helpers/admin-db';

/**
 * Merchant administration journeys (Issue #3 acceptance):
 * sign-in → create → localize → publish → inventory adjustment → sign-out,
 * at desktop (1440×900) and mobile (390×844) widths, with no horizontal
 * overflow and screenshots for the CI artifact.
 *
 * Each project uses its own deterministic slug (`e2e-admin-<project>`) and
 * cleans up after itself so the storefront catalog counts stay untouched.
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'merchant@shanyin.example';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me-shanyin-demo-2026';

function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('merchant administration journeys', () => {
  const projectSlug = () => `e2e-admin-${test.info().project.name}`;
  const projectSku = () => `E2E-ADMIN-${test.info().project.name.toUpperCase().slice(0, 7)}`;

  test.beforeAll(async () => {
    await cleanupAdminE2e();
  });
  test.afterAll(async () => {
    await cleanupAdminE2e();
    await disconnectAdminE2e();
  });

  test('unauthorized visitors are redirected from admin pages to sign-in', async ({ page }) => {
    await page.goto('/admin/products');
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('failed sign-in shows an error; sign-in lands on the product list', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);

    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await expect(page.getByTestId('admin-product-count')).toBeVisible();
    await expect(page.getByTestId('admin-email')).toHaveText(ADMIN_EMAIL);
  });

  test('create → localize → publish → inventory adjustment → sign-out (full journey)', async ({ page }, testInfo) => {
    const slug = projectSlug();
    const sku = projectSku();

    // Fresh browser context per test: sign in first.
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);

    // 1. Create a new product (starts as a draft).
    await page.goto('/admin/products/new');
    await expect(page.getByTestId('product-editor')).toBeVisible();
    await page.getByTestId('field-slug').fill(slug);
    await expect(page.getByTestId('unsaved-indicator')).toBeVisible();
    await page.getByTestId('field-origin').fill('E2E demo origin, Fujian');
    await page.getByTestId('field-category').selectOption({ label: 'Green tea' });
    await page.getByTestId('field-form').selectOption('LOOSE');
    await page.getByTestId('field-caffeine').selectOption('MEDIUM');

    // Variant: integer-cents price entered as a yuan string.
    await page.getByTestId('variant-sku-0').fill(sku);
    await page.getByTestId('variant-name-0').fill('Standard');
    await page.getByTestId('variant-price-0').fill('880.50');
    await page.getByTestId('variant-inventory-0').fill('3');

    // English copy: complete → 7/7; completeness indicator live.
    await page.getByTestId('locale-name-en').fill('E2E Admin Tea');
    await page.getByTestId('locale-description-en').fill('A demo tea managed entirely through the merchant editor.');
    await page.getByTestId('locale-tasting-en').fill('Clean, gentle finish.');
    await page.getByTestId('locale-brewing-en').fill('85°C for 3 minutes.');
    await page.getByTestId('locale-seo-title-en').fill('E2E Admin Tea');
    await page.getByTestId('locale-seo-description-en').fill('Demo listing created by the Playwright admin journey.');
    await page.getByTestId('locale-media-alt-en').fill('Illustration of E2E Admin Tea');
    await expect(page.getByTestId('completeness-en')).toHaveText('7/7 fields');

    // zh-CN: partial copy (name + description) → 2/7 + fallback preview gone.
    await page.getByTestId('locale-name-zh-CN').fill('E2E 管理员演示茶');
    await page.getByTestId('locale-description-zh-CN').fill('演示条目：由端到端测试创建。');
    await expect(page.getByTestId('completeness-zh-CN')).toHaveText('2/7 fields');
    await expect(page.getByTestId('fallback-preview-zh-CN')).toContainText('E2E 管理员演示茶');
    await expect(page.getByTestId('fallback-badge-zh-CN')).toBeHidden();

    // ja: name only → fallback badge still visible for description.
    await page.getByTestId('locale-name-ja').fill('E2E管理者デモ茶');
    await expect(page.getByTestId('fallback-badge-ja')).toBeVisible();

    await page.getByTestId('save-button').click();
    // The editor now serves the created product (navigated away from "New product").
    await expect(page.getByTestId('editor-title')).toHaveText(slug);
    await expect(page.getByTestId('editor-draft-badge')).toBeVisible();
    await expect(page.getByTestId('unsaved-indicator')).toBeHidden();

    // Publishable: English complete + a variant. Coverage table exposes gaps.
    await expect(page.getByTestId('coverage-ja-mediaAlt')).toContainText('—');
    await expect(page.getByTestId('publish-button')).toBeEnabled();

    // 2. Publish → badge flips; the storefront now lists the product.
    await page.getByTestId('publish-button').click();
    await expect(page.getByTestId('editor-published-badge')).toBeVisible();
    await expect(page.getByTestId('published-at')).toContainText('Published since');
    await page.goto('/en/products?q=E2E');
    await expect(page.getByTestId('product-card').filter({ hasText: 'E2E Admin Tea' })).toBeVisible();

    // 3. Inventory adjustment via the editor (audited variant.inventory).
    await page.goto('/admin/products');
    const row = page.getByTestId('admin-product-row').filter({ hasText: slug });
    await expect(row.getByTestId('inventory-total')).toContainText('3');
    await row.click();
    await page.getByTestId('variant-inventory-0').fill('7');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('unsaved-indicator')).toBeHidden();
    // Quick "Apply" path for a per-row audited adjustment.
    await page.getByTestId('variant-inventory-0').fill('9');
    await page.getByTestId('inventory-apply-0').click();
    await expect(page.getByTestId('editor-notice')).toContainText('Inventory saved.');
    await page.goto('/admin/products');
    const updated = page.getByTestId('admin-product-row').filter({ hasText: slug });
    await expect(updated.getByTestId('inventory-total')).toContainText('9');

    // 4. No horizontal overflow at this viewport.
    await updated.click();
    await expect(page.getByTestId('product-editor')).toBeVisible();
    const overflow = await assertNoHorizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `e2e/screenshots/${testInfo.project.name}/admin-editor.png`,
      fullPage: true,
    });

    // 5. Sign out → protected pages redirect again.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto('/admin/products');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('unpublish hides the product from the storefront', async ({ page }) => {
    const slug = projectSlug();

    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);

    const row = page.getByTestId('admin-product-row').filter({ hasText: slug });
    await row.click();
    await page.getByTestId('unpublish-button').click();
    await expect(page.getByTestId('editor-draft-badge')).toBeVisible();

    await page.goto('/en/products?q=E2E');
    await expect(page.getByTestId('product-card').filter({ hasText: 'E2E Admin Tea' })).toHaveCount(0);
  });

  test('editing a published product into a non-publishable state is rejected and the storefront keeps serving it', async ({ page }) => {
    const slug = `e2e-admin-${test.info().project.name}-gate`;
    const sku = `E2E-GATE-${test.info().project.name.toUpperCase().slice(0, 4)}`;

    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);

    // Create a minimal product and publish it. The editor always submits a
    // row per locale, whose title is required, so every locale gets a name.
    await page.goto('/admin/products/new');
    await expect(page.getByTestId('product-editor')).toBeVisible();
    await page.getByTestId('field-slug').fill(slug);
    await page.getByTestId('field-origin').fill('E2E gate origin, Fujian');
    await page.getByTestId('field-category').selectOption({ label: 'Green tea' });
    await page.getByTestId('variant-sku-0').fill(sku);
    await page.getByTestId('variant-name-0').fill('Standard');
    await page.getByTestId('variant-price-0').fill('100');
    await page.getByTestId('variant-inventory-0').fill('1');
    await page.getByTestId('locale-name-en').fill('E2E Gate Tea');
    await page.getByTestId('locale-description-en').fill('A publishable English description.');
    await page.getByTestId('locale-name-zh-CN').fill('E2E 门禁演示茶');
    await page.getByTestId('locale-name-ja').fill('E2Eゲートデモ茶');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('editor-title')).toHaveText(slug);
    await page.getByTestId('publish-button').click();
    await expect(page.getByTestId('editor-published-badge')).toBeVisible();

    // Clear the English description: the update must be rejected, the product
    // must stay published, and the storefront must keep serving it.
    await page.getByTestId('locale-description-en').fill('');
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('editor-error')).toContainText('published');
    await expect(page.getByTestId('editor-published-badge')).toBeVisible();

    await page.goto('/en/products?q=Gate');
    await expect(page.getByTestId('product-card').filter({ hasText: 'E2E Gate Tea' })).toBeVisible();
  });
});

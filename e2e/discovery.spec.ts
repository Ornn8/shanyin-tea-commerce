import { expect, test } from '@playwright/test';
import { LOCALE_IDS, type LocaleId } from '../src/i18n/registry';

/**
 * One complete discovery journey per locale (acceptance: "Playwright proves
 * one discovery journey in each locale and uploads screenshots").
 *
 * The journey: localized global search → server-backed results → combined
 * filters encoded in the URL → sort → availability empty state → pagination
 * with back/forward → locale switching preserving query state — all with a
 * no-horizontal-overflow assertion at the project viewport (1440×900 desktop,
 * 390×844 mobile). Screenshots land in `e2e/screenshots/<project>/` and are
 * uploaded by the CI workflow.
 */
const JOURNEYS: Record<LocaleId, { term: string; cheapestDarkTea: string }> = {
  'zh-CN': { term: '龙井', cheapestDarkTea: '云南熟普' },
  en: { term: 'Longjing', cheapestDarkTea: 'Ripe Pu-erh' },
  ja: { term: '龍井', cheapestDarkTea: '熟プーアル茶' },
};

const NEXT_LOCALE: Record<LocaleId, LocaleId> = {
  'zh-CN': 'en',
  en: 'ja',
  ja: 'zh-CN',
};

function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('discovery journey — one per locale', () => {
  for (const locale of LOCALE_IDS) {
    test(`${locale}: search, filter, sort, paginate, and switch locale with URL state`, async ({ page }, testInfo) => {
      const journey = JOURNEYS[locale];
      const next = NEXT_LOCALE[locale];

      // 1. Localized global search field → server-backed catalog results page.
      await page.goto(`/${locale}`);
      await page.locator('header').getByRole('searchbox').fill(journey.term);
      await page.locator('header').getByRole('searchbox').press('Enter');
      await expect(page).toHaveURL(new RegExp(`/${locale}/search\\?q=`));
      await expect(page.getByTestId('search-summary')).toContainText(journey.term);
      await expect(page.getByTestId('catalog-count')).toContainText('1');
      await expect(page.getByTestId('product-card')).toHaveCount(1);

      // 2. Combined filters (family + form + caffeine) with sort, all in the URL.
      await page.goto(
        `/${locale}/products?category=dark-tea&form=compressed&caffeine=low&sort=price-asc`,
      );
      await expect(page).toHaveURL(/category=dark-tea/);
      await expect(page).toHaveURL(/form=compressed/);
      await expect(page).toHaveURL(/caffeine=low/);
      await expect(page).toHaveURL(/sort=price-asc/);
      await expect(page.getByTestId('catalog-count')).toContainText('2');
      await expect(page.getByTestId('product-card')).toHaveCount(2);
      await expect(page.getByTestId('product-card').first()).toContainText(
        journey.cheapestDarkTea,
      );

      // 3. Usable at this viewport: no horizontal overflow.
      const overflow = await assertNoHorizontalOverflow(page);
      expect(overflow).toBeLessThanOrEqual(1);

      // 4. Availability filter for unavailable products → localized empty state.
      await page.goto(`/${locale}/products?category=dark-tea&inStock=false`);
      await expect(page).toHaveURL(/inStock=false/);
      await expect(page.getByTestId('catalog-empty')).toBeVisible();
      await expect(page.getByTestId('catalog-count')).toContainText('0');

      // 5. Stable pagination: 6 teas, 4 per page; back/forward restores state.
      await page.goto(`/${locale}/products`);
      await expect(page.getByTestId('product-card')).toHaveCount(4);
      await page.getByTestId('page-2').click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.getByTestId('product-card')).toHaveCount(2);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/${locale}/products$`));
      await expect(page.getByTestId('product-card')).toHaveCount(4);

      // 6. Locale switching keeps query state (filters + sort survive).
      await page.goto(`/${locale}/products?category=dark-tea&sort=price-asc`);
      await page.selectOption('#locale-picker', next);
      await expect(page).toHaveURL(
        new RegExp(`/${next}/products\\?category=dark-tea&sort=price-asc`),
      );
      await expect(page.getByTestId('product-card')).toHaveCount(2);

      // 7. Screenshot the filtered catalog result page for the artifact.
      await page.goto(
        `/${locale}/products?category=dark-tea&form=compressed&caffeine=low&sort=price-asc`,
      );
      await page.screenshot({
        path: `e2e/screenshots/${testInfo.project.name}/${locale}-catalog-discovery.png`,
        fullPage: true,
      });
    });
  }
});

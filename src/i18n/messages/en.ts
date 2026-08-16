/**
 * English message catalog — the source of truth for message keys.
 * Every locale catalog must cover all keys below except the ones listed in
 * OPTIONAL_KEYS (see src/i18n/registry.ts). CI enforces this with
 * `pnpm i18n:check`.
 */
const enMessages = {
  'common.brandName': 'Shanyin Tea',
  'common.brandNameZh': '山隐茶事',
  'common.demoBadge': 'Demo',
  'common.demoBanner':
    'Demo storefront — products, prices, origins, and imagery are placeholders until the merchant supplies verified assets. See PRODUCT.md.',
  'common.skipToContent': 'Skip to content',
  'nav.home': 'Home',
  'nav.products': 'Catalog',
  'nav.cart': 'Cart',
  'locale.switchLabel': 'Language',
  'locale.switchTo': 'Switch language',
  'home.heroTitle': 'A quiet tea house for everyday brewing',
  'home.heroSubtitle':
    'Shanyin Tea is a single-merchant tea storefront. This build is a demo vertical slice: the catalog below is seeded placeholder content.',
  'home.heroCta': 'Browse the catalog',
  'home.announcement': 'The demo list is live. All entries are placeholders awaiting merchant verification.',
  'home.searchPlaceholder': 'Search teas by name or description…',
  'home.searchButton': 'Search',
  'home.categoriesTitle': 'Browse by category',
  'home.selectionTitle': 'This season’s selection',
  'home.selectionSubtitle': 'Six demo teas across three categories — names, prices, and origins pending merchant verification.',
  'home.houseTitle': 'About the house',
  'home.houseBody':
    'The storefront pairs contemporary commerce usability with an Eastern tea identity: pine green, celadon, stone gray, and restrained lacquer red, with tea-ticket and seal details. The visual direction is original and shares no assets with any marketplace.',
  'product.priceLabel': 'Price',
  'product.originLabel': 'Origin',
  'product.inStock': 'In stock',
  'product.outOfStock': 'Out of stock',
  'product.addToCart': 'Add to cart',
  'product.addedToCart': 'Added',
  'product.backToCatalog': 'Back to catalog',
  'product.descriptionTitle': 'About this tea',
  'product.tastingNotesTitle': 'Tasting notes',
  'product.notFoundTitle': 'This tea could not be found',
  'product.notFoundBody': 'The tea you are looking for does not exist or is no longer listed.',
  'product.cartDemoNote': 'Cart is a local demo — no checkout, payment, or shipping.',
  'search.title': 'Search',
  'search.resultsFor': 'Results for “{query}”',
  'search.noResults': 'No teas match “{query}”.',
  'search.allProducts': 'All teas',
  'cart.title': 'Your cart',
  'cart.empty': 'Your cart is empty.',
  'cart.remove': 'Remove',
  'footer.disclaimer':
    'Demo content. All commercial claims, certifications, origins, prices, and imagery are placeholders and must be replaced with merchant-verified assets before production.',
  'footer.merchantFacts': 'Production checklist: see PRODUCT.md',
  'footer.copyrightText': '© Shanyin Tea — demo storefront',
} as const satisfies Record<string, string>;

export const en: Readonly<Record<string, string>> = enMessages;
export type MessageKey = keyof typeof enMessages;

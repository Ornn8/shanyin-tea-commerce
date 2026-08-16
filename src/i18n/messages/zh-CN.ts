/**
 * Simplified Chinese message catalog (zh-CN).
 * Covers every required key; see OPTIONAL_KEYS in src/i18n/registry.ts for
 * keys that may be omitted deliberately.
 */
export const zhCN = {
  'common.brandName': '山隐茶事',
  'common.brandNameZh': '山隐茶事',
  'common.demoBadge': '演示',
  'common.demoBanner':
    '演示店铺——在商户提供经核实的资料之前，所有商品、价格、产地与图片均为占位内容。详见 PRODUCT.md。',
  'common.skipToContent': '跳至主要内容',
  'nav.home': '首页',
  'nav.products': '全部茶品',
  'nav.cart': '购物袋',
  'locale.switchLabel': '语言',
  'locale.switchTo': '切换语言',
  'home.heroTitle': '一间安静喝茶的小店',
  'home.heroSubtitle': '山隐茶事是单商户茶叶店铺。当前为演示纵向切片：下方茶单为种子占位内容。',
  'home.heroCta': '浏览茶单',
  'home.announcement': '演示茶单已上线。全部条目均为占位内容，待商户核实。',
  'home.searchPlaceholder': '按名称或描述搜索茶叶…',
  'home.searchButton': '搜索',
  'home.categoriesTitle': '按品类浏览',
  'home.selectionTitle': '本季茶单',
  'home.selectionSubtitle': '三个品类共六款演示茶叶——名称、价格与产地待商户核实。',
  'home.houseTitle': '关于山隐',
  'home.houseBody':
    '本店将现代电商的易用性与东方茶文化视觉相结合：松绿、青瓷、石灰与克制的漆红，辅以茶票与印章细节。视觉方向为原创，不采用任何电商平台的素材。',
  'product.priceLabel': '价格',
  'product.originLabel': '产地',
  'product.inStock': '有货',
  'product.outOfStock': '缺货',
  'product.addToCart': '加入购物袋',
  'product.addedToCart': '已加入',
  'product.backToCatalog': '返回茶单',
  'product.descriptionTitle': '关于这款茶',
  'product.tastingNotesTitle': '品鉴笔记',
  'product.notFoundTitle': '没有找到这款茶',
  'product.notFoundBody': '你要找的茶叶不存在或已下架。',
  'product.cartDemoNote': '购物袋为本地演示——不含结算、支付与物流。',
  'search.title': '搜索',
  'search.resultsFor': '“{query}”的搜索结果',
  'search.noResults': '没有与“{query}”匹配的茶叶。',
  'search.allProducts': '全部茶叶',
  'cart.title': '你的购物袋',
  'cart.empty': '购物袋还是空的。',
  'cart.remove': '移除',
  'footer.disclaimer':
    '演示内容。所有商业主张、认证、产地、价格与图片均为占位内容，上线前必须替换为商户经核实的资料。',
  'footer.merchantFacts': '上线清单：见 PRODUCT.md',
  'footer.copyrightText': '© 山隐茶事 —— 演示店铺',
} as const satisfies Record<string, string>;

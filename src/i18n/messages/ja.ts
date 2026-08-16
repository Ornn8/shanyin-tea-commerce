/**
 * Japanese message catalog (ja).
 * Deliberately omits `home.announcement` (see OPTIONAL_KEYS in
 * src/i18n/registry.ts) — the deterministic English fallback covers it.
 */
export const ja = {
  'common.brandName': '山隠茶事',
  'common.brandNameZh': '山隐茶事',
  'common.demoBadge': 'デモ',
  'common.demoBanner':
    'デモ店舗です。商品・価格・産地・画像はすべて仮内容で、販売元による確認後に差し替えます。詳細は PRODUCT.md をご覧ください。',
  'common.skipToContent': '本文へスキップ',
  'nav.home': 'ホーム',
  'nav.products': '茶葉一覧',
  'nav.cart': 'カート',
  'locale.switchLabel': '言語',
  'locale.switchTo': '言語を切り替える',
  'home.heroTitle': '毎日の一杯に、静かな茶屋を',
  'home.heroSubtitle': '山隠茶事は単一販売元による茶葉ストアです。このビルドはデモの縦断スライスで、下の茶葉一覧はシードによる仮内容です。',
  'home.heroCta': '茶葉一覧を見る',
  'home.searchPlaceholder': '名前や説明で茶葉を検索…',
  'home.searchButton': '検索',
  'home.categoriesTitle': 'カテゴリから探す',
  'home.selectionTitle': '今季のセレクション',
  'home.selectionSubtitle': '3カテゴリ・6種のデモ茶葉。名前・価格・産地は販売元による確認待ちです。',
  'home.houseTitle': '茶屋について',
  'home.houseBody':
    '現代的なコマースの使いやすさと東アジアの茶文化の佇まいを組み合わせました。松緑・青磁・石灰色・控えめな漆紅、茶券と印のディテール。ビジュアルはすべてオリジナルで、他マーケットプレイスの素材は使用していません。',
  'product.priceLabel': '価格',
  'product.originLabel': '産地',
  'product.inStock': '在庫あり',
  'product.outOfStock': '在庫なし',
  'product.addToCart': 'カートに入れる',
  'product.addedToCart': '追加済み',
  'product.backToCatalog': '茶葉一覧に戻る',
  'product.descriptionTitle': 'この茶葉について',
  'product.tastingNotesTitle': 'テイスティングノート',
  'product.notFoundTitle': 'この茶葉は見つかりません',
  'product.notFoundBody': 'お探しの茶葉は存在しないか、掲載が終了しています。',
  'product.cartDemoNote': 'カートはローカルデモです。決済・配送はありません。',
  'search.title': '検索',
  'search.resultsFor': '「{query}」の検索結果',
  'search.noResults': '「{query}」に一致する茶葉はありません。',
  'search.allProducts': 'すべての茶葉',
  'cart.title': 'カート',
  'cart.empty': 'カートは空です。',
  'cart.remove': '削除',
  'footer.disclaimer':
    'デモコンテンツです。商業上の主張・認証・産地・価格・画像はすべて仮内容で、本番公開前に販売元確認済みの素材へ差し替える必要があります。',
  'footer.merchantFacts': '本番チェックリスト: PRODUCT.md を参照',
  'footer.copyrightText': '© 山隠茶事 — デモ店舗',
} as const satisfies Record<string, string>;

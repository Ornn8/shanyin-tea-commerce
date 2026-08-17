/**
 * Shanyin Tea — demo catalog seed.
 *
 * ALL products, prices, origins, and imagery below are replaceable demo
 * content. See PRODUCT.md for the merchant facts/assets still required
 * before production. No certification, health, scarcity, or sustainability
 * claims are made anywhere in this repository.
 *
 * Also seeds the single allowlisted merchant administrator (ADR-0005):
 * credentials come from ADMIN_EMAIL / ADMIN_PASSWORD (see .env.example).
 * Public sign-up is disabled, so this seeded account is the only way in.
 */
import 'dotenv/config';
import { hashPassword } from 'better-auth/crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type LocaleSeed = 'zh-CN' | 'en' | 'ja';

interface CategorySeed {
  slug: string;
  sortOrder: number;
  names: Record<LocaleSeed, string>;
}

interface VariantSeed {
  sku: string;
  /** Language-neutral variant name (package/size label; not localized copy). */
  name: string;
  priceCents: number;
  inventory: number;
}

interface ProductSeed {
  slug: string;
  origin: string;
  /** Language-neutral leaf form fact (demo placeholder). */
  form: 'LOOSE' | 'COMPRESSED';
  /** Language-neutral caffeine fact (demo placeholder). */
  caffeine: 'LOW' | 'MEDIUM' | 'HIGH';
  categorySlug: string;
  variants: VariantSeed[];
  copy: Record<LocaleSeed, { name: string; description: string; tastingNotes: string }>;
}

const categories: CategorySeed[] = [
  { slug: 'green-tea', sortOrder: 1, names: { 'zh-CN': '绿茶', en: 'Green tea', ja: '緑茶' } },
  { slug: 'oolong-tea', sortOrder: 2, names: { 'zh-CN': '乌龙茶', en: 'Oolong tea', ja: '烏龍茶' } },
  { slug: 'dark-tea', sortOrder: 3, names: { 'zh-CN': '黑茶', en: 'Dark tea', ja: '黒茶' } },
];

const products: ProductSeed[] = [
  {
    slug: 'spring-longjing',
    origin: 'Longjing Village, Hangzhou, Zhejiang',
    form: 'LOOSE',
    caffeine: 'HIGH',
    categorySlug: 'green-tea',
    variants: [{ sku: 'SHY-G-001', name: 'Standard', priceCents: 128000, inventory: 40 }],
    copy: {
      'zh-CN': {
        name: '西湖龙井 · 明前',
        description:
          '演示条目：扁平炒青绿茶，豆香清雅。产地、采摘时间与风味描述均待商户核实后替换。',
        tastingNotes: '演示笔记：清豆香，回甘平稳。请以商户提供的品鉴记录为准。',
      },
      en: {
        name: 'Spring Longjing',
        description:
          'Demo listing: a pan-fired flat green tea with a clean, chestnut-like aroma. Origin, picking date, and flavor copy are placeholders pending merchant verification.',
        tastingNotes:
          'Demo notes: clean bean-like aroma, steady sweet finish. Replace with merchant-verified tasting notes.',
      },
      ja: {
        name: '西湖龍井・明前',
        description:
          'デモ商品：釜炒り仕上げの平たい緑茶で、すっきりとした栗のような香り。産地・摘採時期・風味の記載はすべて仮内容で、販売元による確認後に差し替えます。',
        tastingNotes:
          'デモ備考：すっきりとした香ばしさと穏やかな甘み。販売元確認済みのテイスティングノートに差し替えます。',
      },
    },
  },
  {
    slug: 'biluochun',
    origin: 'Dongting Mountain, Suzhou, Jiangsu',
    form: 'LOOSE',
    caffeine: 'MEDIUM',
    categorySlug: 'green-tea',
    variants: [{ sku: 'SHY-G-002', name: 'Standard', priceCents: 96000, inventory: 25 }],
    copy: {
      'zh-CN': {
        name: '碧螺春',
        description:
          '演示条目：卷曲细嫩的炒青绿茶，花果气息。产地与工艺描述待商户核实后替换。',
        tastingNotes: '演示笔记：清香鲜爽。请以商户提供的品鉴记录为准。',
      },
      en: {
        name: 'Biluochun',
        description:
          'Demo listing: a tightly curled green tea with a gentle floral-fruity note. Origin and process copy are placeholders pending merchant verification.',
        tastingNotes: 'Demo notes: fresh, brisk, delicately floral. Replace with merchant-verified tasting notes.',
      },
      ja: {
        name: '碧螺春',
        description:
          'デモ商品：細く巻いた緑茶で、やさしい花果の香り。産地・製法の記載は仮内容で、販売元による確認後に差し替えます。',
        tastingNotes: 'デモ備考：みずみずしく爽やかな味わい。販売元確認済みのテイスティングノートに差し替えます。',
      },
    },
  },
  {
    slug: 'tieguanyin',
    origin: 'Anxi County, Fujian',
    form: 'LOOSE',
    caffeine: 'MEDIUM',
    categorySlug: 'oolong-tea',
    variants: [{ sku: 'SHY-O-001', name: 'Standard', priceCents: 88000, inventory: 60 }],
    copy: {
      'zh-CN': {
        name: '安溪铁观音',
        description:
          '演示条目：清香型乌龙茶，兰花香明显。产地与工艺描述待商户核实后替换。',
        tastingNotes: '演示笔记：兰花香，汤感清透。请以商户提供的品鉴记录为准。',
      },
      en: {
        name: 'Tieguanyin Oolong',
        description:
          'Demo listing: a lightly oxidized oolong with a pronounced orchid-like aroma. Origin and process copy are placeholders pending merchant verification.',
        tastingNotes: 'Demo notes: orchid aroma, clear bright liquor. Replace with merchant-verified tasting notes.',
      },
      ja: {
        name: '安渓鉄観音',
        description:
          'デモ商品：軽発酵の烏龍茶で、蘭を思わせる香り。産地・製法の記載は仮内容で、販売元による確認後に差し替えます。',
        tastingNotes: 'デモ備考：蘭の香り、明るく澄んだ水色。販売元確認済みのテイスティングノートに差し替えます。',
      },
    },
  },
  {
    slug: 'dahongpao',
    origin: 'Wuyi Mountain, Fujian',
    form: 'LOOSE',
    caffeine: 'MEDIUM',
    categorySlug: 'oolong-tea',
    variants: [{ sku: 'SHY-O-002', name: 'Standard', priceCents: 168000, inventory: 12 }],
    copy: {
      'zh-CN': {
        name: '武夷大红袍',
        description:
          '演示条目：岩茶风格的焙火乌龙茶，岩韵醇厚。产地与工艺描述待商户核实后替换。',
        tastingNotes: '演示笔记：焙火香，回韵沉稳。请以商户提供的品鉴记录为准。',
      },
      en: {
        name: 'Dahongpao Rock Tea',
        description:
          'Demo listing: a roasted rock-oolong with a deep, mineral-tinged character. Origin and process copy are placeholders pending merchant verification.',
        tastingNotes: 'Demo notes: roasted depth with a mineral finish. Replace with merchant-verified tasting notes.',
      },
      ja: {
        name: '武夷山大紅袍',
        description:
          'デモ商品：焙煎の効いた岩茶風烏龍茶で、深みのある味わい。産地・製法の記載は仮内容で、販売元による確認後に差し替えます。',
        tastingNotes: 'デモ備考：焙煎香と鉱物的な余韻。販売元確認済みのテイスティングノートに差し替えます。',
      },
    },
  },
  {
    slug: 'liubao',
    origin: 'Liubao Town, Wuzhou, Guangxi',
    form: 'COMPRESSED',
    caffeine: 'LOW',
    categorySlug: 'dark-tea',
    variants: [{ sku: 'SHY-D-001', name: 'Standard', priceCents: 72000, inventory: 30 }],
    copy: {
      'zh-CN': {
        name: '六堡茶',
        description:
          '演示条目：广西梧州六堡镇的传统后发酵黑茶，陈香温润。产地与年份描述待商户核实后替换。',
        tastingNotes: '演示笔记：陈香，汤感醇和。请以商户提供的品鉴记录为准。',
      },
      en: {
        name: 'Liubao Dark Tea',
        description:
          'Demo listing: a traditionally fermented dark tea from Liubao, Guangxi, with a mellow aged character. Origin and vintage copy are placeholders pending merchant verification.',
        tastingNotes: 'Demo notes: mellow aged aroma, smooth rounded body. Replace with merchant-verified tasting notes.',
      },
      ja: {
        name: '六堡茶',
        description:
          'デモ商品：広西梧州六堡の伝統的な後発酵茶。熟成感のあるまろやかな味わい。産地・年期の記載は仮内容で、販売元による確認後に差し替えます。',
        tastingNotes: 'デモ備考：熟成香、なめらかな口当たり。販売元確認済みのテイスティングノートに差し替えます。',
      },
    },
  },
  {
    slug: 'ripe-puerh',
    origin: 'Menghai, Yunnan',
    form: 'COMPRESSED',
    caffeine: 'LOW',
    categorySlug: 'dark-tea',
    variants: [{ sku: 'SHY-D-002', name: 'Standard', priceCents: 64000, inventory: 18 }],
    copy: {
      'zh-CN': {
        name: '云南熟普',
        description:
          '演示条目：勐海熟茶，发酵圆融，枣香沉稳。产地与年份描述待商户核实后替换。',
        tastingNotes: '演示笔记：醇厚，微甜。请以商户提供的品鉴记录为准。',
      },
      en: {
        name: 'Ripe Pu-erh',
        description:
          'Demo listing: a fully fermented pu-erh from Menghai with a deep, softly sweet character. Origin and vintage copy are placeholders pending merchant verification.',
        tastingNotes: 'Demo notes: dense and gently sweet. Replace with merchant-verified tasting notes.',
      },
      ja: {
        name: '熟プーアル茶',
        description:
          'デモ商品：雲南勐海の完全発酵プーアル茶。深くやさしい甘みのある味わい。産地・年期の記載は仮内容で、販売元による確認後に差し替えます。',
        tastingNotes: 'デモ備考：濃厚でほのかに甘い。販売元確認済みのテイスティングノートに差し替えます。',
      },
    },
  },
];

async function seedCategories() {
  for (const category of categories) {
    const dbCategory = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { sortOrder: category.sortOrder },
      create: { slug: category.slug, sortOrder: category.sortOrder },
    });
    for (const [locale, name] of Object.entries(category.names) as [LocaleSeed, string][]) {
      await prisma.categoryLocalization.upsert({
        where: { categoryId_locale: { categoryId: dbCategory.id, locale } },
        update: { name },
        create: { categoryId: dbCategory.id, locale, name },
      });
    }
  }
  return categories.length;
}

async function seedProducts() {
  for (const product of products) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: product.categorySlug } });
    const dbProduct = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        origin: product.origin,
        form: product.form,
        caffeine: product.caffeine,
        categoryId: category.id,
        // The demo catalog is the storefront's seed truth: reseeding re-
        // publishes demo products the merchant may have unpublished.
        published: true,
      },
      create: {
        slug: product.slug,
        origin: product.origin,
        form: product.form,
        caffeine: product.caffeine,
        categoryId: category.id,
        published: true,
        publishedAt: new Date(),
      },
    });

    for (const variant of product.variants) {
      await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        update: { productId: dbProduct.id, name: variant.name, priceCents: variant.priceCents, inventory: variant.inventory },
        create: { productId: dbProduct.id, ...variant },
      });
    }

    for (const [locale, copy] of Object.entries(product.copy) as [LocaleSeed, (typeof product.copy)['en']][]) {
      await prisma.productLocalization.upsert({
        where: { productId_locale: { productId: dbProduct.id, locale } },
        update: { ...copy },
        create: { productId: dbProduct.id, locale, ...copy },
      });
    }
  }
  return products.length;
}

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'merchant@shanyin.example';
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.warn(
      'ADMIN_PASSWORD is not set — skipping the merchant administrator seed (see .env.example).',
    );
    return 0;
  }
  const password = await hashPassword(adminPassword);
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: 'Merchant', password },
    create: { email: adminEmail, name: 'Merchant', password, emailVerified: true },
  });
  // better-auth verifies email/password sign-in through the "credential"
  // account row (providerId "credential"); the user.password column is the
  // same scrypt hash and is kept in sync.
  await prisma.account.upsert({
    where: { id: `credential-${user.id}` },
    update: { password },
    create: {
      id: `credential-${user.id}`,
      userId: user.id,
      providerId: 'credential',
      accountId: adminEmail,
      password,
    },
  });
  return 1;
}

async function main() {
  const categoryCount = await seedCategories();
  const productCount = await seedProducts();
  const adminCount = await seedAdmin();

  const summary = await prisma.product.findMany({
    include: { localizations: true, variants: true },
  });
  console.log(
    `Seeded ${categoryCount} categories, ${productCount} products ` +
      `(${summary.reduce((n, p) => n + p.localizations.length, 0)} localizations, ` +
      `${summary.reduce((n, p) => n + p.variants.length, 0)} variants), ` +
      `${adminCount} merchant administrator(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import type { Metadata } from 'next';
import { ProductEditor } from '@/components/admin/product-editor';
import { listAdminCategories } from '@/lib/admin/products';

export const metadata: Metadata = {
  title: 'New product · Shanyin Tea administration',
};

/** Create flow: same editor, empty product, starts as a draft. */
export default async function AdminNewProductPage() {
  const categories = await listAdminCategories();
  return <ProductEditor product={null} categories={categories} />;
}
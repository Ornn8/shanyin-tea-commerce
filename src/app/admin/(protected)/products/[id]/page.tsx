import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductEditor } from '@/components/admin/product-editor';
import { getAdminProduct, listAdminCategories } from '@/lib/admin/products';

export const metadata: Metadata = {
  title: 'Edit product · Shanyin Tea administration',
};

interface AdminEditProductPageProps {
  params: Promise<{ id: string }>;
}

/** Product editor: shared facts, variants, per-locale content, publish state. */
export default async function AdminEditProductPage({ params }: AdminEditProductPageProps) {
  const { id } = await params;
  const [product, categories] = await Promise.all([getAdminProduct(id), listAdminCategories()]);
  if (!product) notFound();

  return <ProductEditor product={product} categories={categories} />;
}
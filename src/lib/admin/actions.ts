'use server';

/**
 * Server actions for the merchant administration surface. Every mutation
 * enforces the authorization guard first (allowlisted admin session), then
 * delegates to the service layer which re-validates and audits. Errors are
 * returned as plain objects so the editor can render per-field messages.
 */
import { requireAdminOrThrow } from './authz-next';
import { AdminAuthError } from './authz';
import { AdminError, toAdminError } from './errors';
import {
  createProduct,
  publishProduct,
  setVariantInventory,
  unpublishProduct,
  updateProduct,
} from './service';

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; code: string; error: string; fieldErrors?: Readonly<Record<string, string>> };

function toResult(error: unknown): ActionResult {
  if (error instanceof AdminAuthError) {
    return { ok: false, code: 'unauthorized', error: 'Merchant sign-in required.' };
  }
  const adminError = error instanceof AdminError ? error : toAdminError(error);
  return {
    ok: false,
    code: adminError.code,
    error: adminError.message,
    fieldErrors: adminError.fieldErrors,
  };
}

export async function createProductAction(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireAdminOrThrow();
    const product = await createProduct(session.user.email, raw);
    return { ok: true, id: product.id };
  } catch (error) {
    return toResult(error);
  }
}

export async function updateProductAction(productId: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireAdminOrThrow();
    await updateProduct(session.user.email, productId, raw);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function setVariantInventoryAction(
  variantId: string,
  rawInventory: unknown,
): Promise<ActionResult> {
  try {
    const session = await requireAdminOrThrow();
    await setVariantInventory(session.user.email, variantId, rawInventory);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function publishProductAction(productId: string): Promise<ActionResult> {
  try {
    const session = await requireAdminOrThrow();
    await publishProduct(session.user.email, productId);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function unpublishProductAction(productId: string): Promise<ActionResult> {
  try {
    const session = await requireAdminOrThrow();
    await unpublishProduct(session.user.email, productId);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

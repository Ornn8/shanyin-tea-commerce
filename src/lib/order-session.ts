/**
 * Checkout browser storage (Issue #6, ADR-0008).
 *
 * - The checkout flow hands the high-entropy lookup credential to the shopper's
 *   browser ONCE. Between steps the credential travels in sessionStorage (never
 *   the URL), so a refresh of the payment/confirmation page recovers gracefully
 *   and no secret ever appears in a link, referrer, or server log.
 * - The checkout form also pins a high-entropy SUBMISSION idempotency key to
 *   this tab, bound to a fingerprint of the exact cart it was created for. A
 *   double-submit, a browser retry, or a page refresh before paying reuses the
 *   SAME key — so the server can return the existing order instead of creating
 *   a duplicate — while a genuinely new cart (different fingerprint) rotates
 *   to a fresh key.
 *
 * This module is browser-safe (constants + storage helpers only, no Node.js
 * imports) and shared by the client shells.
 */
export const ORDER_TICKET_KEY = 'shanyin_checkout_ticket';
export const CHECKOUT_SUBMISSION_KEY = 'shanyin_checkout_submission_key';

export interface OrderTicket {
  /** High-entropy lookup credential (only ever held in this tab). */
  credential: string;
  checkoutId: string;
  orderNumber: string;
}

export function readOrderTicket(): OrderTicket | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ORDER_TICKET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OrderTicket>;
    if (typeof parsed.credential !== 'string' || parsed.credential.length === 0) return null;
    return {
      credential: parsed.credential,
      checkoutId: typeof parsed.checkoutId === 'string' ? parsed.checkoutId : '',
      orderNumber: typeof parsed.orderNumber === 'string' ? parsed.orderNumber : '',
    };
  } catch {
    return null;
  }
}

export function writeOrderTicket(ticket: OrderTicket): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ORDER_TICKET_KEY, JSON.stringify(ticket));
}

export function clearOrderTicket(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(ORDER_TICKET_KEY);
}

export interface CheckoutSubmissionRef {
  /** High-entropy client submission idempotency key (base64url, 43 chars). */
  key: string;
  /** Fingerprint of the cart this key is bound to (rotates the key on a new
   * cart so it never collides with an old order). */
  cartFingerprint: string;
}

/** 256-bit CSPRNG key rendered in base64url (43 chars) — the same strength and
 * alphabet as the lookup credential. `crypto.getRandomValues` is available in
 * every browser (and a secure-context-required fallback keeps it safe). */
export function generateCheckoutSubmissionKey(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (const byte of bytes) out += ALPHA[byte % ALPHA.length]; // 256 % 64 === 0 → uniform
  return out;
}

export function readCheckoutSubmissionRef(): CheckoutSubmissionRef | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_SUBMISSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutSubmissionRef>;
    if (typeof parsed.key !== 'string' || parsed.key.length === 0) return null;
    return {
      key: parsed.key,
      cartFingerprint: typeof parsed.cartFingerprint === 'string' ? parsed.cartFingerprint : '',
    };
  } catch {
    return null;
  }
}

export function writeCheckoutSubmissionRef(ref: CheckoutSubmissionRef): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(CHECKOUT_SUBMISSION_KEY, JSON.stringify(ref));
}

export function clearCheckoutSubmissionRef(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(CHECKOUT_SUBMISSION_KEY);
}

/**
 * Checkout ticket storage (Issue #6, ADR-0008).
 *
 * The checkout flow hands the high-entropy lookup credential to the shopper's
 * browser ONCE. Between steps the credential travels in sessionStorage (never
 * the URL), so a refresh of the payment/confirmation page recovers gracefully
 * and no secret ever appears in a link, referrer, or server log.
 *
 * This module is browser-safe (constants only) and shared by the client
 * shells.
 */
export const ORDER_TICKET_KEY = 'shanyin_checkout_ticket';

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

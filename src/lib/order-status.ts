/**
 * Order / payment state machine (Issue #6, ADR-0008).
 *
 * Explicit and terminal-safe: `pending` is the only open state, created when
 * the shopper submits the checkout form. A VERIFIED, replay-safe gateway event
 * moves a `pending` order to a terminal state; a `paid` order may only move to
 * the `refunded` domain placeholder. Events that don't match the current state
 * (duplicate, reordered, or contradictory deliveries) are safe no-ops — they
 * are recorded but never mutate the order and never touch stock.
 *
 * This module is PURE (no Node.js/Next.js/Prisma imports) so the transitions
 * are unit-testable in isolation.
 */

/** The six explicit customer-visible order states (ADR-0008). */
export const ORDER_STATUS_IDS = [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type OrderStatusId = (typeof ORDER_STATUS_IDS)[number];

/** Gateway domain events the processor understands (ADR-0008). */
export const GATEWAY_EVENT_TYPES = [
  'pending',
  'succeeded',
  'failed',
  'expired',
  'cancelled',
  'refunded',
] as const;
export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];

/**
 * The only legal transitions. `pending` is the single open state; everything
 * reachable from it is terminal. `paid` supports only the `refunded` domain
 * placeholder. Everything else is terminal and accepts no transition.
 */
const TRANSITIONS: Readonly<Record<OrderStatusId, Readonly<Partial<Record<GatewayEventType, OrderStatusId>>>>> = {
  PENDING: {
    succeeded: 'PAID',
    failed: 'FAILED',
    expired: 'EXPIRED',
    cancelled: 'CANCELLED',
  },
  PAID: { refunded: 'REFUNDED' },
  FAILED: {},
  EXPIRED: {},
  CANCELLED: {},
  REFUNDED: {},
};

/**
 * Return the order status an event moves `current` to, or `null` when the
 * event is a safe no-op for the current state (duplicate, reordered, or
 * contradictory — e.g. `succeeded` after `failed`, or `failed` after `paid`).
 */
export function orderTransition(current: OrderStatusId, eventType: GatewayEventType): OrderStatusId | null {
  return TRANSITIONS[current]?.[eventType] ?? null;
}

/** True when the status has no outgoing transitions (terminal state). */
export function isTerminalOrderStatus(status: OrderStatusId): boolean {
  return status !== 'PENDING';
}

/** True when an event type could EVER transition some state (defensive). */
export function isKnownEventType(eventType: string): eventType is GatewayEventType {
  return (GATEWAY_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Order/payment state machine unit tests (Issue #6, ADR-0008).
 */
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_EVENT_TYPES,
  isKnownEventType,
  isTerminalOrderStatus,
  orderTransition,
  ORDER_STATUS_IDS,
} from '@/lib/order-status';

describe('orderTransition (explicit state machine)', () => {
  it('moves PENDING to every terminal state via the matching event', () => {
    expect(orderTransition('PENDING', 'succeeded')).toBe('PAID');
    expect(orderTransition('PENDING', 'failed')).toBe('FAILED');
    expect(orderTransition('PENDING', 'expired')).toBe('EXPIRED');
    expect(orderTransition('PENDING', 'cancelled')).toBe('CANCELLED');
  });

  it('only PAID → REFUNDED (domain placeholder) is a paid-state transition', () => {
    expect(orderTransition('PAID', 'refunded')).toBe('REFUNDED');
  });

  it('returns null for contradictory, duplicate, or terminal-state events', () => {
    // A terminal/contradictory event is a safe no-op, never a backwards move.
    expect(orderTransition('PAID', 'failed')).toBeNull();
    expect(orderTransition('PAID', 'succeeded')).toBeNull(); // duplicate success
    expect(orderTransition('FAILED', 'succeeded')).toBeNull(); // revive after fail
    expect(orderTransition('FAILED', 'failed')).toBeNull(); // duplicate fail
    expect(orderTransition('EXPIRED', 'succeeded')).toBeNull();
    expect(orderTransition('CANCELLED', 'succeeded')).toBeNull();
    expect(orderTransition('REFUNDED', 'refunded')).toBeNull();
    expect(orderTransition('PENDING', 'pending')).toBeNull(); // no re-pending
  });

  it('PENDING is the only open (non-terminal) state', () => {
    expect(isTerminalOrderStatus('PENDING')).toBe(false);
    for (const status of ORDER_STATUS_IDS) {
      if (status === 'PENDING') continue;
      expect(isTerminalOrderStatus(status)).toBe(true);
    }
  });

  it('exposes a stable, known event/status vocabulary', () => {
    expect(GATEWAY_EVENT_TYPES).toEqual([
      'pending',
      'succeeded',
      'failed',
      'expired',
      'cancelled',
      'refunded',
    ]);
    for (const type of GATEWAY_EVENT_TYPES) expect(isKnownEventType(type)).toBe(true);
    expect(isKnownEventType('charged')).toBe(false);
    expect(isKnownEventType('')).toBe(false);
  });
});

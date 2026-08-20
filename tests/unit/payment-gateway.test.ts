/**
 * Simulated payment gateway + optional Stripe adapter unit tests
 * (Issue #6, ADR-0008).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildSimulatedEvent,
  canonicalSimulatedEvent,
  parseGatewayWire,
  simulatedEventId,
  verifyGatewaySignature,
  verifySimulatedEvent,
} from '@/lib/simulated-gateway';
import {
  buildStripeGatewayWire,
  isStripeTestModeConfigured,
  mapStripeEventType,
  verifyStripeWebhookSignature,
} from '@/lib/stripe-adapter';

function samplePayload() {
  return {
    v: 1 as const,
    gateway: 'simulated' as const,
    orderId: 'order_1',
    intentId: 'sim_123',
    type: 'succeeded' as const,
    eventId: 'evt_sim_sim_123_succeeded',
    createdAt: 1_700_000_000,
  };
}

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('simulated gateway signing (signature-verified events)', () => {
  it('signs and verifies a success event round-trip', () => {
    const wire = buildSimulatedEvent({ orderId: 'order_1', intentId: 'sim_123' });
    expect(wire.payload.type).toBe('succeeded');
    expect(verifyGatewaySignature(wire)).toBe(true);
    expect(verifySimulatedEvent(wire.payload, wire.signature)).toBe(true);
  });

  it('rejects a tampered payload even with a valid-shaped signature', () => {
    const wire = buildSimulatedEvent({ orderId: 'order_1', intentId: 'sim_123' });
    const tampered = { ...wire.payload, type: 'failed' as const };
    expect(verifySimulatedEvent(tampered, wire.signature)).toBe(false);
    expect(verifyGatewaySignature({ ...wire, payload: tampered })).toBe(false);
  });

  it('rejects a signature produced with a different secret', () => {
    withEnv({ PAYMENT_SIM_SECRET: 'base-secret-4f2d' }, () => {
      const payload = samplePayload();
      const forged = createHmac('sha256', 'other-secret-123')
        .update(canonicalSimulatedEvent(payload))
        .digest('base64url');
      // A signature from a different key must not verify against ours.
      expect(verifySimulatedEvent(payload, forged)).toBe(false);
      // Sanity: a signature produced with the configured key verifies.
      const legit = createHmac('sha256', 'base-secret-4f2d')
        .update(canonicalSimulatedEvent(payload))
        .digest('base64url');
      expect(verifySimulatedEvent(payload, legit)).toBe(true);
    });
  });

  it('keeps event ids deterministic per (intent, type) — replay-safe', () => {
    const a = buildSimulatedEvent({ orderId: 'o1', intentId: 'sim_9' });
    const b = buildSimulatedEvent({ orderId: 'o1', intentId: 'sim_9', now: a.eventCreatedAtMs + 5000 });
    expect(a.payload.eventId).toBe(b.payload.eventId);
    expect(a.payload.eventId).toBe(simulatedEventId('sim_9', 'succeeded'));
  });

  it('builds failed/expired/cancelled/refunded events for the integration pipeline', () => {
    for (const type of ['failed', 'expired', 'cancelled', 'refunded'] as const) {
      const wire = buildSimulatedEvent({ orderId: 'o1', intentId: 'sim_9', type });
      expect(wire.payload.type).toBe(type);
      expect(verifyGatewaySignature(wire)).toBe(true);
    }
  });

  it('canonical form is stable and printable', () => {
    expect(canonicalSimulatedEvent(samplePayload())).toMatch(/gateway=simulated\|orderId=order_1/);
  });
});

describe('parseGatewayWire', () => {
  it('round-trips a wire through JSON and verifies', () => {
    const wire = buildSimulatedEvent({ orderId: 'o1', intentId: 'sim_9' });
    const raw = JSON.stringify({ ...wire.payload, signature: wire.signature });
    const parsed = parseGatewayWire(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.payload.intentId).toBe('sim_9');
    expect(parsed?.signatureVerified).toBe(false);
    expect(verifyGatewaySignature(parsed!)).toBe(true);
  });

  it('returns null for malformed wires', () => {
    expect(parseGatewayWire(null)).toBeNull();
    expect(parseGatewayWire('')).toBeNull();
    expect(parseGatewayWire('not json')).toBeNull();
    expect(parseGatewayWire('{"v":2}')).toBeNull();
    expect(parseGatewayWire('{"v":1,"gateway":"paypal","type":"succeeded"}')).toBeNull();
    expect(
      parseGatewayWire('{"v":1,"gateway":"simulated","type":"charged","orderId":"o","intentId":"i","eventId":"e","createdAt":1,"sig":"x"}'),
    ).toBeNull();
  });
});

describe('optional Stripe test-mode adapter', () => {
  it('is dormant without test-mode credentials; live keys are rejected', () => {
    withEnv(
      { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined },
      () => expect(isStripeTestModeConfigured()).toBe(false),
    );
    withEnv(
      { STRIPE_SECRET_KEY: 'sk_live_123', STRIPE_WEBHOOK_SECRET: 'whsec_abc' },
      () => expect(isStripeTestModeConfigured()).toBe(false), // live keys rejected
    );
    withEnv(
      { STRIPE_SECRET_KEY: 'pk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_abc' },
      () => expect(isStripeTestModeConfigured()).toBe(false), // not a secret key
    );
    withEnv(
      { STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_abc' },
      () => expect(isStripeTestModeConfigured()).toBe(true),
    );
  });

  it('maps Stripe event types onto the domain state machine', () => {
    expect(mapStripeEventType('checkout.session.completed')).toBe('succeeded');
    expect(mapStripeEventType('payment_intent.succeeded')).toBe('succeeded');
    expect(mapStripeEventType('payment_intent.payment_failed')).toBe('failed');
    expect(mapStripeEventType('checkout.session.expired')).toBe('expired');
    expect(mapStripeEventType('payment_intent.canceled')).toBe('cancelled');
    expect(mapStripeEventType('charge.refunded')).toBe('refunded');
    expect(mapStripeEventType('charge.updated')).toBeNull();
  });

  it('verifies Stripe v1 webhook signatures over the exact raw body', () => {
    const secret = 'whsec_test_secret';
    const rawBody = '{"id":"evt_1"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const header = `t=${timestamp},v1=${v1}`;
    expect(verifyStripeWebhookSignature(rawBody, header, secret)).toBe(true);
    // Tampered body fails.
    expect(verifyStripeWebhookSignature('{"id":"evt_2"}', header, secret)).toBe(false);
    // Wrong secret fails.
    expect(verifyStripeWebhookSignature(rawBody, header, 'whsec_wrong')).toBe(false);
    // Missing header / stale timestamp fails.
    expect(verifyStripeWebhookSignature(rawBody, null, secret)).toBe(false);
    expect(verifyStripeWebhookSignature(rawBody, `t=${timestamp - 100_000},v1=${v1}`, secret)).toBe(false);
  });

  it('maps a verified Stripe event to a boundary-verified wire', () => {
    const wire = buildStripeGatewayWire({
      orderId: 'order_1',
      intentId: 'pi_123',
      type: 'succeeded',
      eventId: 'evt_stripe_evt_1',
      eventCreatedAtSeconds: 1_700_000_000,
    });
    expect(wire.gateway).toBe('stripe-test');
    expect(wire.signatureVerified).toBe(true);
    expect(verifyGatewaySignature(wire)).toBe(true);
  });
});

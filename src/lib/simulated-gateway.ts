/**
 * Deterministic simulated payment gateway (Issue #6, ADR-0008).
 *
 * CI and local demos drive checkout through this gateway: for a given payment
 * intent the gateway deterministically emits a SIGNED `succeeded` event (the
 * Pilot never simulates a failure in the normal path; payment-failure coverage
 * lives in the integration suite, which crafts signed `failed` events through
 * the same pipeline). Every event is HMAC-SHA256 signed with
 * `PAYMENT_SIM_SECRET` (falling back to `AUTH_SECRET` locally) and flows
 * through the SAME processor as any real webhook: verify → idempotent apply →
 * explicit state machine → atomic stock decrement. A browser redirect is never
 * payment authority.
 *
 * The event id is deterministic per (intent, type), so re-generating or
 * re-delivering the same gateway event is a replay the processor recognizes
 * as already-processed — no duplicate order, no double stock decrement.
 *
 * SERVER-ONLY: imports `node:crypto`; never import from the browser graph.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isKnownEventType, type GatewayEventType } from '@/lib/order-status';

/** Gateways the payment processor understands. `stripe-test` is the optional
 * external adapter; it is dormant unless test-mode credentials are configured
 * (see src/lib/stripe-adapter.ts) and is verified at its webhook boundary. */
export type GatewayId = 'simulated' | 'stripe-test';

/** Canonical signed payload of a gateway event (all fields primitive, stable
 * order — the signature is computed over exactly this form). */
export interface GatewayEventPayload {
  v: 1;
  gateway: GatewayId;
  /** The order the event finalizes (defense-in-depth binding check). */
  orderId: string;
  /** The payment intent id the processor uses to resolve the order. */
  intentId: string;
  type: GatewayEventType;
  /** The gateway's globally unique event id (idempotency key). */
  eventId: string;
  /** Gateway-reported event timestamp (epoch seconds) for reordering audits. */
  createdAt: number;
}

/** A gateway event as handed to the processor. */
export interface GatewayEventWire {
  gateway: GatewayId;
  payload: GatewayEventPayload;
  signature: string;
  /**
   * True when the signature was already verified at the gateway boundary (the
   * Stripe test-mode webhook route verifies its own signature before mapping
   * the event here). False means the processor MUST verify it (the simulated
   * gateway's shared-secret HMAC).
   */
  signatureVerified: boolean;
  /** Gateway-reported event timestamp (epoch milliseconds) for audits. */
  eventCreatedAtMs: number;
}

/** Canonical string the simulated gateway signs (stable field order). */
export function canonicalSimulatedEvent(payload: GatewayEventPayload): string {
  return (
    `v=${payload.v}|gateway=${payload.gateway}|orderId=${payload.orderId}|` +
    `intentId=${payload.intentId}|type=${payload.type}|eventId=${payload.eventId}|` +
    `createdAt=${payload.createdAt}`
  );
}

/** Signing key for simulated events. Test-mode only — never a live charge. */
export function simulatedSecret(): string {
  return process.env.PAYMENT_SIM_SECRET ?? process.env.AUTH_SECRET ?? 'dev-secret-shanyin-sim-payment';
}

function signSimulatedEvent(payload: GatewayEventPayload): string {
  return createHmac('sha256', simulatedSecret())
    .update(canonicalSimulatedEvent(payload))
    .digest('base64url');
}

/** Constant-time verification of a simulated-gateway signature. */
export function verifySimulatedEvent(payload: GatewayEventPayload, signature: string): boolean {
  const expected = createHmac('sha256', simulatedSecret())
    .update(canonicalSimulatedEvent(payload))
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Deterministic event id: re-generating the gateway event for the same
 * (intent, type) yields the same id, making delivery replay-safe. */
export function simulatedEventId(intentId: string, type: GatewayEventType): string {
  return `evt_sim_${intentId}_${type}`;
}

/**
 * Build a SIGNED simulated gateway event. `type` defaults to `succeeded` — the
 * deterministic Pilot outcome. The integration suite passes `failed`/
 * `expired`/`cancelled`/`refunded` directly to exercise the full state machine,
 * and an explicit `eventId` lets it simulate what a real gateway produces for
 * the SAME intent: two distinct ids for the same semantic outcome (e.g.
 * Stripe's `checkout.session.completed` and `payment_intent.succeeded`).
 */
export function buildSimulatedEvent(input: {
  orderId: string;
  intentId: string;
  type?: GatewayEventType;
  now?: number;
  eventId?: string;
}): GatewayEventWire {
  const type = input.type ?? 'succeeded';
  if (!isKnownEventType(type)) throw new Error(`Unknown simulated event type: ${type}`);
  const now = input.now ?? Date.now();
  const payload: GatewayEventPayload = {
    v: 1,
    gateway: 'simulated',
    orderId: input.orderId,
    intentId: input.intentId,
    type,
    eventId: input.eventId ?? simulatedEventId(input.intentId, type),
    createdAt: Math.floor(now / 1000),
  };
  return {
    gateway: 'simulated',
    payload,
    signature: signSimulatedEvent(payload),
    signatureVerified: false,
    eventCreatedAtMs: now,
  };
}

/** Parse a raw wire JSON string into a gateway event; null when malformed. */
export function parseGatewayWire(raw: string | null | undefined): GatewayEventWire | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const body = parsed as Record<string, unknown>;
  if (body.v !== 1) return null;
  const gateway = body.gateway;
  if (gateway !== 'simulated' && gateway !== 'stripe-test') return null;
  const { orderId, intentId, eventId, createdAt } = body as Record<string, unknown>;
  if (typeof orderId !== 'string' || typeof intentId !== 'string') return null;
  if (typeof eventId !== 'string' || eventId.length === 0) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (typeof body.signature !== 'string' || body.signature.length === 0) return null;
  const type = body.type;
  if (typeof type !== 'string' || !isKnownEventType(type)) return null;
  return {
    gateway,
    payload: {
      v: 1,
      gateway,
      orderId,
      intentId,
      type,
      eventId,
      createdAt,
    },
    signature: body.signature,
    signatureVerified: body.signatureVerified === true,
    eventCreatedAtMs: createdAt * 1000,
  };
}

/** Verifies a gateway event's signature with its gateway's verifier. Events
 * already verified at a gateway boundary (`signatureVerified`) pass through. */
export function verifyGatewaySignature(wire: GatewayEventWire): boolean {
  if (wire.signatureVerified) return true;
  if (wire.gateway === 'simulated') {
    return verifySimulatedEvent(wire.payload, wire.signature);
  }
  // A stripe-test wire that did not come from the verified webhook boundary is
  // rejected — the outer adapter is the only verifier for external gateways.
  return false;
}

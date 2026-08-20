/**
 * Optional Stripe TEST-MODE payment adapter (Issue #6, ADR-0008).
 *
 * This adapter is DORMANT unless test-mode credentials are configured, and it
 * is explicitly forbidden from ever enabling a live charge: it only activates
 * when the secret key starts with `sk_test_` (Stripe's test prefix) and a
 * `whsec_` webhook-signing secret is present. With no credentials (the normal
 * CI / local-demo state) the storefront runs entirely on the deterministic
 * simulated gateway.
 *
 * It implements Stripe's documented webhook signature scheme
 * (HMAC-SHA256 over `t=<timestamp>.<rawBody>` with a tolerance window) using
 * only `node:crypto` — no SDK dependency. A verified `checkout.session.*`
 * / `payment_intent.*` event is mapped onto the SAME `GatewayEventWire` the
 * simulated gateway produces, marked `signatureVerified: true`, and processed
 * by the identical idempotent pipeline.
 *
 * SERVER-ONLY: imports `node:crypto`; never import from the browser graph.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GatewayEventPayload, GatewayEventWire } from '@/lib/simulated-gateway';
import type { GatewayEventType } from '@/lib/order-status';

const MAX_CLOCK_SKEW_SECONDS = 300;

function configuredKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

function configuredWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  return typeof secret === 'string' && secret.length > 0 ? secret : null;
}

/** The adapter is active ONLY with test-mode credentials. Live-mode or missing
 * credentials keep the simulated gateway authoritative and a webhook unhandled. */
export function isStripeTestModeConfigured(): boolean {
  const key = configuredKey();
  const secret = configuredWebhookSecret();
  if (!key || !secret) return false;
  // Live charges are forbidden in this slice (ADR-0008): reject any live key.
  if (key.startsWith('sk_live_')) return false;
  if (!key.startsWith('sk_test_')) return false;
  return secret.startsWith('whsec_');
}

/** Constant-time HMAC comparison plus a freshness window, matching Stripe's
 * v1 webhook signature over the exact raw body. */
export function verifyStripeWebhookSignature(
  rawBody: string,
  stripeSignatureHeader: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!stripeSignatureHeader) return false;
  // Parse the spec'd `t=... ,v1=...` header (multiple signatures allowed).
  const parts = stripeSignatureHeader.split(',');
  let timestamp = 0;
  let providedHex = '';
  for (const part of parts) {
    const [keyPart, ...valueParts] = part.trim().split('=');
    const value = valueParts.join('=');
    if (keyPart === 't') timestamp = Number(value);
    if (keyPart === 'v1') providedHex = value;
  }
  if (!timestamp || timestamp <= 0 || !providedHex) return false;
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;
  const expectedHex = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const expected = Buffer.from(expectedHex, 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Map a Stripe event type onto a domain gateway event type. Returns null for
 * events the Pilot does not act on (successful ones drive the state machine;
 * the others are recorded audit evidence when processed). */
export function mapStripeEventType(stripeType: string): GatewayEventType | null {
  switch (stripeType) {
    case 'checkout.session.completed':
    case 'payment_intent.succeeded':
      return 'succeeded';
    case 'payment_intent.payment_failed':
      return 'failed';
    case 'checkout.session.expired':
      return 'expired';
    case 'payment_intent.canceled':
      return 'cancelled';
    case 'charge.refunded':
      return 'refunded';
    default:
      return null;
  }
}

/** Build a boundary-verified wire from a mapped Stripe event. The caller has
 * already verified the webhook signature, so `signatureVerified` is true. */
export function buildStripeGatewayWire(input: {
  orderId: string;
  intentId: string;
  type: GatewayEventType;
  eventId: string;
  eventCreatedAtSeconds: number;
}): GatewayEventWire {
  const payload: GatewayEventPayload = {
    v: 1,
    gateway: 'stripe-test',
    orderId: input.orderId,
    intentId: input.intentId,
    type: input.type,
    eventId: input.eventId,
    createdAt: input.eventCreatedAtSeconds,
  };
  return {
    gateway: 'stripe-test',
    payload,
    signature: 'verified-at-webhook-boundary',
    signatureVerified: true,
    eventCreatedAtMs: input.eventCreatedAtSeconds * 1000,
  };
}

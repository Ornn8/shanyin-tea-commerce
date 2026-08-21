import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  buildStripeGatewayWire,
  isStripeTestModeConfigured,
  mapStripeEventType,
  verifyStripeWebhookSignature,
} from '@/lib/stripe-adapter';
import { applyGatewayEvent } from '@/lib/order-service';

/**
 * Optional Stripe TEST-MODE webhook (Issue #6, ADR-0008).
 *
 * DORMANT unless test-mode credentials are configured (`STRIPE_SECRET_KEY=sk_test_*`
 * + `STRIPE_WEBHOOK_SECRET=whsec_*`); live-mode keys are rejected and a
 * non-configured webhook returns HTTP 501. Every delivery is signature-verified
 * (Stripe's documented `t=…,v1=…` HMAC over the exact raw body with a freshness
 * window), mapped onto the same `GatewayEventWire`, and processed by the same
 * replay-safe, idempotent pipeline as the simulated gateway. A signature failure
 * returns 400 and records nothing.
 *
 * The storefront never creates live Stripe intents in this slice — this route
 * exists so a test-mode integration can map verified events onto orders whose
 * `providerIntentId` matches the Stripe payment intent id; otherwise the
 * delivery is confirmed as seen and harmlessly ignored.
 */

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  if (!isStripeTestModeConfigured()) {
    return NextResponse.json({ error: 'Stripe test-mode webhook is not configured.' }, { status: 501 });
  }
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!verifyStripeWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  let event: { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed payload.' }, { status: 400 });
  }
  if (typeof event.id !== 'string' || typeof event.type !== 'string' || typeof event.data?.object !== 'object') {
    return NextResponse.json({ error: 'Unrecognized event shape.' }, { status: 400 });
  }

  const type = mapStripeEventType(event.type);
  if (!type) {
    // Known-but-unmapped event (e.g. `charge.updated`): acknowledge, no action.
    return NextResponse.json({ received: true, handled: false });
  }

  const object = event.data.object as Record<string, unknown>;
  const intentId =
    typeof object.payment_intent === 'string'
      ? object.payment_intent
      : typeof object.id === 'string' && event.type.startsWith('payment_intent.')
        ? object.id
        : null;
  if (!intentId) {
    // No resolvable intent on this object shape.
    return NextResponse.json({ received: true, handled: false });
  }

  const order = await prisma.order.findUnique({
    where: { providerIntentId: intentId },
    select: { id: true },
  });
  if (!order) {
    // A webhook for an order this deployment never created: acknowledge without
    // retry; nothing is mutated, nothing is recorded.
    return NextResponse.json({ received: true, handled: false });
  }

  const createdAtSeconds =
    typeof object.created === 'number' ? object.created : Math.floor(Date.now() / 1000);
  const wire = buildStripeGatewayWire({
    orderId: order.id,
    intentId,
    type,
    eventId: `evt_stripe_${event.id}`,
    eventCreatedAtSeconds: createdAtSeconds,
  });
  const result = await applyGatewayEvent(wire);

  return NextResponse.json({ received: true, handled: true, applied: result.applied, reason: result.reason });
}

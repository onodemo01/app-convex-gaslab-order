import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import Stripe from 'stripe';
import type { Id } from './_generated/dataModel';

const http = httpRouter();

http.route({
  path: '/stripe/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!secret || !key) return new Response('Stripe 未設定', { status: 500 });

    const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
    const signature = request.headers.get('stripe-signature');
    if (!signature) return new Response('署名なし', { status: 400 });

    const payload = await request.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        payload,
        signature,
        secret,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch {
      return new Response('署名検証に失敗しました', { status: 400 });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.purpose === 'table_settle') {
        const tableSessionId = session.metadata?.tableSessionId as Id<'tableSessions'> | undefined;
        if (tableSessionId) {
          const finalChargeAmount = session.amount_total ?? 0;
          let finalPaymentIntentId: string | undefined;
          const piRef = session.payment_intent;
          if (piRef) {
            finalPaymentIntentId = typeof piRef === 'string' ? piRef : piRef.id;
          }
          await ctx.runMutation(internal.sessions.finishTableSettle, {
            tableSessionId,
            finalChargeAmount,
            finalPaymentIntentId,
            stripeSessionId: session.id,
          });
        }
      }
    }

    // 会計用 Checkout が未払いのまま期限切れ → 会計ロックを解除し再注文・再会計可能に戻す。
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.purpose === 'table_settle') {
        const tableSessionId = session.metadata?.tableSessionId as Id<'tableSessions'> | undefined;
        if (tableSessionId) {
          await ctx.runMutation(internal.sessions.releaseTableSettle, { tableSessionId });
        }
      }
    }

    return new Response(null, { status: 200 });
  }),
});

export default http;

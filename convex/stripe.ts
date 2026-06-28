'use node';

import { action } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import Stripe from 'stripe';

// 卓会計: 客が卓から Stripe Checkout で支払う（card + PayPay）。
export const createTableCheckoutSession = action({
  args: {
    sessionId: v.id('tableSessions'),
    slug: v.string(),
    tableToken: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY 未設定');

    const info = await ctx.runMutation(internal.sessions.beginTableSettle, {
      tableSessionId: args.sessionId,
      slug: args.slug,
      tableToken: args.tableToken,
    });

    const stripe = new Stripe(key);
    const base = process.env.APP_BASE_URL ?? 'http://127.0.0.1:3000';

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      payment_method_types: ['card', 'paypay'] as Stripe.Checkout.SessionCreateParams['payment_method_types'],
      line_items: info.lineItems.map((li) => ({
        quantity: li.quantity,
        price_data: {
          currency: 'jpy',
          unit_amount: li.unitAmount,
          product_data: { name: li.name },
        },
      })),
      metadata: {
        purpose: 'table_settle',
        tableSessionId: args.sessionId,
        billTotal: String(info.billTotal),
      },
      // 未払い放置で会計ロックが固着しないよう最短(30分)で期限切れ→webhookで自動解除。
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      // 決済後の戻り先にセッションIDを載せ、完了画面を「その会計」に固定（新規セッションを作らない）。
      success_url: `${base}/t/${args.slug}/${args.tableToken}?paid=1&s=${args.sessionId}`,
      cancel_url: `${base}/t/${args.slug}/${args.tableToken}?canceled=1`,
    };

    if (info.email) {
      const customer = await stripe.customers.create({
        email: info.email,
        metadata: { tableSessionId: args.sessionId },
      });
      sessionParams.customer = customer.id;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    await ctx.runMutation(internal.sessions.attachStripeSession, {
      tableSessionId: args.sessionId,
      stripeSessionId: session.id,
    });
    return { url: session.url };
  },
});

// 客: 会計を中断（ブラウザ戻る等）した後の復帰。
// charging のままなら Stripe に実際の支払い状態を問い合わせ、
//   - 支払い済み → 会計確定（取りこぼし防止）
//   - 未払い      → ロック解除して再注文・再会計可能に戻す
export const recoverGuestCheckout = action({
  args: {
    sessionId: v.id('tableSessions'),
    slug: v.string(),
    tableToken: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const info = await ctx.runQuery(internal.sessions.getGuestSettleInfo, {
      tableSessionId: args.sessionId,
      slug: args.slug,
      tableToken: args.tableToken,
    });
    if (!info) throw new Error('セッションが見つかりません');
    if (info.settleStatus !== 'charging') return { status: info.settleStatus ?? 'open' };

    const key = process.env.STRIPE_SECRET_KEY;
    if (key && info.stripeSessionId) {
      const stripe = new Stripe(key);
      const cs = await stripe.checkout.sessions.retrieve(info.stripeSessionId);
      if (cs.payment_status === 'paid') {
        let finalPaymentIntentId: string | undefined;
        const piRef = cs.payment_intent;
        if (piRef) finalPaymentIntentId = typeof piRef === 'string' ? piRef : piRef.id;
        await ctx.runMutation(internal.sessions.finishTableSettle, {
          tableSessionId: args.sessionId,
          finalChargeAmount: cs.amount_total ?? info.billTotal,
          finalPaymentIntentId,
          stripeSessionId: cs.id,
        });
        return { status: 'succeeded' };
      }
    }

    await ctx.runMutation(internal.sessions.releaseTableSettle, { tableSessionId: args.sessionId });
    return { status: 'released' };
  },
});

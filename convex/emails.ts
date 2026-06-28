import { internalAction } from './_generated/server';
import { v } from 'convex/values';

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

// 会計完了メール（Resend）。用途は会計完了の領収のみに絞る。
export const sendReceipt = internalAction({
  args: {
    email: v.string(),
    storeName: v.string(),
    tableLabel: v.string(),
    billTotal: v.number(),
    finalChargeAmount: v.number(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('[emails] RESEND_API_KEY 未設定のためメール送信をスキップしました');
      return;
    }

    const subject = `【${args.storeName}】お会計のご案内（${args.tableLabel}）`;
    const html = `
      <p>${args.storeName} をご利用いただきありがとうございました。</p>
      <p><strong>${args.tableLabel}</strong> のお会計が完了しました。</p>
      <ul>
        <li>ご利用合計: ${formatYen(args.billTotal)}</li>
        <li>お支払い額: ${formatYen(args.finalChargeAmount)}</li>
      </ul>
      <p>またのご来店をお待ちしております。</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? 'onboarding@resend.dev',
        to: [args.email],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[emails] Resend エラー:', res.status, body);
    }
  },
});

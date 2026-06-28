import { mutation } from './_generated/server';
import { ConvexError, v } from 'convex/values';

// 会計後アンケートの送信（客・任意回答）。slug＋セッションの一致だけ確認し、1セッション1件で保存。
export const submit = mutation({
  args: {
    slug: v.string(),
    sessionId: v.id('tableSessions'),
    satisfaction: v.optional(v.number()),
    gender: v.optional(v.string()),
    ageGroup: v.optional(v.string()),
    revisit: v.optional(v.string()),
    couponCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query('stores')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!store) throw new ConvexError('店舗が見つかりません');
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== store.orgId) throw new ConvexError('セッションが見つかりません');

    // 既に回答済みなら上書きせず終了（多重送信対策）。
    const existing = await ctx.db
      .query('surveys')
      .withIndex('by_tableSession', (q) => q.eq('tableSessionId', args.sessionId))
      .first();
    if (existing) return { ok: true as const, already: true };

    await ctx.db.insert('surveys', {
      orgId: store.orgId,
      tableSessionId: args.sessionId,
      satisfaction: args.satisfaction,
      gender: args.gender,
      ageGroup: args.ageGroup,
      revisit: args.revisit,
      couponCode: args.couponCode,
      at: Date.now(),
    });
    return { ok: true as const, already: false };
  },
});

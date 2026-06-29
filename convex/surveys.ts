import { mutation, query, type MutationCtx } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { issueCoupon, findIssuedForSession, couponExpiresAt } from './coupons';

async function assertGuestSession(ctx: MutationCtx, slug: string, sessionId: Id<'tableSessions'>) {
  const store = await ctx.db
    .query('stores')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();
  if (!store) throw new ConvexError('店舗が見つかりません');
  const session = await ctx.db.get(sessionId);
  if (!session || session.orgId !== store.orgId) throw new ConvexError('セッションが見つかりません');
  return { store, session };
}

// 客: このセッションでアンケート済みか（送信・スキップ含む）。再読込後も完了画面を維持するため。
export const hasResponded = query({
  args: {
    slug: v.string(),
    sessionId: v.id('tableSessions'),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query('stores')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!store) return false;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== store.orgId) return false;
    const existing = await ctx.db
      .query('surveys')
      .withIndex('by_tableSession', (q) => q.eq('tableSessionId', args.sessionId))
      .first();
    return existing != null;
  },
});

// 会計後アンケートの送信（客・任意回答）。slug＋セッションの一致だけ確認し、1セッション1件で保存。
export const submit = mutation({
  args: {
    slug: v.string(),
    sessionId: v.id('tableSessions'),
    satisfaction: v.optional(v.number()),
    gender: v.optional(v.string()),
    ageGroup: v.optional(v.string()),
    revisit: v.optional(v.string()),
    comment: v.optional(v.string()),
    couponCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { store, session } = await assertGuestSession(ctx, args.slug, args.sessionId);

    // 既に回答済みなら上書きせず終了（多重送信対策）。
    const existing = await ctx.db
      .query('surveys')
      .withIndex('by_tableSession', (q) => q.eq('tableSessionId', args.sessionId))
      .first();
    if (existing) {
      const issued = await findIssuedForSession(ctx, args.sessionId);
      return {
        ok: true as const,
        already: true,
        couponCode: issued?.code ?? null,
        expiresAt: issued ? couponExpiresAt(issued) : null,
      };
    }

    // 自由記述は空白除去のうえ最大400文字でクランプ（暴走入力対策）。空なら保存しない。
    const trimmed = args.comment?.trim();
    const comment = trimmed ? trimmed.slice(0, 400) : undefined;

    await ctx.db.insert('surveys', {
      orgId: store.orgId,
      tableSessionId: args.sessionId,
      satisfaction: args.satisfaction,
      gender: args.gender,
      ageGroup: args.ageGroup,
      revisit: args.revisit,
      comment,
      couponCode: args.couponCode,
      at: Date.now(),
    });

    // 次回クーポンはアンケート回答後に発行（表示タイミングと揃える）。
    let issuedCode: string | null = null;
    let expiresAt: number | null = null;
    if (session.settleStatus === 'succeeded' || session.closedAt !== undefined) {
      issuedCode = await issueCoupon(ctx, store.orgId, args.sessionId);
      const issued = await findIssuedForSession(ctx, args.sessionId);
      expiresAt = issued ? couponExpiresAt(issued) : null;
    }

    return { ok: true as const, already: false, couponCode: issuedCode, expiresAt };
  },
});

// 会計後アンケートのスキップ（客）。回答なしでも1セッション1件として記録し、再読込でフォームを出さない。
export const dismiss = mutation({
  args: {
    slug: v.string(),
    sessionId: v.id('tableSessions'),
  },
  handler: async (ctx, args) => {
    const { store, session } = await assertGuestSession(ctx, args.slug, args.sessionId);

    const existing = await ctx.db
      .query('surveys')
      .withIndex('by_tableSession', (q) => q.eq('tableSessionId', args.sessionId))
      .first();
    if (existing) {
      const issued = await findIssuedForSession(ctx, args.sessionId);
      return {
        ok: true as const,
        already: true,
        couponCode: issued?.code ?? null,
        expiresAt: issued ? couponExpiresAt(issued) : null,
      };
    }

    await ctx.db.insert('surveys', {
      orgId: store.orgId,
      tableSessionId: args.sessionId,
      at: Date.now(),
    });

    let issuedCode: string | null = null;
    let expiresAt: number | null = null;
    if (session.settleStatus === 'succeeded' || session.closedAt !== undefined) {
      issuedCode = await issueCoupon(ctx, store.orgId, args.sessionId);
      const issued = await findIssuedForSession(ctx, args.sessionId);
      expiresAt = issued ? couponExpiresAt(issued) : null;
    }

    return { ok: true as const, already: false, couponCode: issuedCode, expiresAt };
  },
});

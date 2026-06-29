import { mutation } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';

export const COUPON_DISCOUNT_PERCENT = 10;
/** 発行から有効な日数（3ヶ月 ≒ 90日）。 */
export const COUPON_VALID_DAYS = 90;
const COUPON_VALID_MS = COUPON_VALID_DAYS * 24 * 60 * 60 * 1000;

type CouponTiming = { issuedAt: number; expiresAt?: number };

export function couponExpiresAt(coupon: CouponTiming): number {
  return coupon.expiresAt ?? coupon.issuedAt + COUPON_VALID_MS;
}

export function isCouponExpired(coupon: CouponTiming, now = Date.now()): boolean {
  return now > couponExpiresAt(coupon);
}

// 次回クーポンの表示用コード。sessionId の末尾8文字から導出（乱数ではない・同一セッションなら常に同じ）。
export function couponCodeFor(sessionId: string): string {
  const id = sessionId.replace(/[^a-z0-9]/gi, '');
  return `GASLAB-${id.slice(-8).toUpperCase()}`;
}

// このセッションで発行済みのクーポンを返す。
export async function findIssuedForSession(
  ctx: MutationCtx | QueryCtx,
  sessionId: Id<'tableSessions'>,
) {
  return await ctx.db
    .query('coupons')
    .withIndex('by_issuedSession', (q) => q.eq('issuedSessionId', sessionId))
    .first();
}

// クーポンを発行する（冪等）。アンケート回答/スキップ後に呼ぶ。同一セッションで二重発行しない。
export async function issueCoupon(
  ctx: MutationCtx,
  orgId: string,
  sessionId: Id<'tableSessions'>,
): Promise<string> {
  const existing = await findIssuedForSession(ctx, sessionId);
  if (existing) return existing.code;

  let code = couponCodeFor(sessionId);
  let suffix = 0;
  // 別セッションと末尾が被った場合だけ末尾に数字を付けて衝突回避。
  while (true) {
    const taken = await ctx.db
      .query('coupons')
      .withIndex('by_orgId_code', (q) => q.eq('orgId', orgId).eq('code', code))
      .first();
    if (!taken) break;
    suffix += 1;
    code = `${couponCodeFor(sessionId)}${suffix}`;
  }

  const issuedAt = Date.now();
  const expiresAt = issuedAt + COUPON_VALID_MS;

  await ctx.db.insert('coupons', {
    orgId,
    code,
    issuedSessionId: sessionId,
    issuedAt,
    expiresAt,
  });
  return code;
}

// このセッションに適用済みのクーポン（再来客の利用記録）を返す。
export async function findRedeemedForSession(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
  sessionId: Id<'tableSessions'>,
) {
  return await ctx.db
    .query('coupons')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
    .filter((q) => q.eq(q.field('redeemedSessionId'), sessionId))
    .first();
}

export function couponDiscountAmount(subtotal: number, percent = COUPON_DISCOUNT_PERCENT): number {
  if (subtotal <= 0) return 0;
  return Math.floor((subtotal * percent) / 100);
}

// クーポンを「利用」する（客スマホ・次回来店時のコード入力）。
// 表示のみ運用なので Stripe へ割引は通さず、再来の事実だけを記録する（リピート率の根拠）。
export const redeem = mutation({
  args: {
    slug: v.string(),
    sessionId: v.id('tableSessions'),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query('stores')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!store) throw new ConvexError('店舗が見つかりません');
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== store.orgId) throw new ConvexError('セッションが見つかりません');
    if (session.settleStatus === 'succeeded' || session.closedAt !== undefined) {
      throw new ConvexError('会計済みのため適用できません');
    }
    if (session.settleStatus === 'charging') {
      throw new ConvexError('会計処理中はクーポンを変更できません。やり直してから適用してください');
    }

    const code = args.code.trim().toUpperCase();
    if (!code) throw new ConvexError('クーポンコードを入力してください');

    // このセッションが既にクーポンを利用していれば、それを優先（多重適用・重複行を防ぐ）。
    const alreadyByThis = await ctx.db
      .query('coupons')
      .withIndex('by_orgId', (q) => q.eq('orgId', store.orgId))
      .filter((q) => q.eq(q.field('redeemedSessionId'), args.sessionId))
      .first();
    if (alreadyByThis) {
      if (alreadyByThis.code === code) {
        return { ok: true as const, already: true, code, discountPercent: COUPON_DISCOUNT_PERCENT };
      }
      throw new ConvexError('このご注文には既にクーポンが適用済みです');
    }

    const coupon = await ctx.db
      .query('coupons')
      .withIndex('by_orgId_code', (q) => q.eq('orgId', store.orgId).eq('code', code))
      .first();
    if (!coupon) throw new ConvexError('このクーポンコードは見つかりません');
    if (coupon.issuedSessionId === args.sessionId) {
      throw new ConvexError('今回発行したクーポンは次回以降ご利用いただけます');
    }
    if (coupon.redeemedSessionId !== undefined) throw new ConvexError('このクーポンは利用済みです');
    if (isCouponExpired(coupon)) {
      throw new ConvexError(`このクーポンは有効期限切れです（発行から${COUPON_VALID_DAYS}日以内）`);
    }

    await ctx.db.patch(coupon._id, {
      redeemedSessionId: args.sessionId,
      redeemedAt: Date.now(),
    });
    return { ok: true as const, already: false, code, discountPercent: COUPON_DISCOUNT_PERCENT };
  },
});

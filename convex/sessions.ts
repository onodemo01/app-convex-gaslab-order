import { ConvexError, v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { requireOrgId } from './auth';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';

export async function computeBillTotalFromOrders(
  ctx: QueryCtx | MutationCtx,
  tableSessionId: Id<'tableSessions'>,
): Promise<number> {
  const lines = await ctx.db
    .query('orderLines')
    .withIndex('by_tableSession', (q) => q.eq('tableSessionId', tableSessionId))
    .collect();
  return lines.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.qty, 0);
}

// Stripe Checkout 用の明細（同名・同単価をまとめる）。価格未設定の行は合計に寄与しないため除外。
// 価格のある行だけ含めるので、合計は computeBillTotalFromOrders と一致する。
async function buildCheckoutLineItems(
  ctx: QueryCtx | MutationCtx,
  tableSessionId: Id<'tableSessions'>,
): Promise<Array<{ name: string; unitAmount: number; quantity: number }>> {
  const lines = await ctx.db
    .query('orderLines')
    .withIndex('by_tableSession', (q) => q.eq('tableSessionId', tableSessionId))
    .collect();
  const map = new Map<string, { name: string; unitAmount: number; quantity: number }>();
  for (const line of lines) {
    const unitAmount = line.unitPrice ?? 0;
    if (unitAmount <= 0) continue;
    const key = `${line.menuName}@@${unitAmount}`;
    const existing = map.get(key);
    if (existing) existing.quantity += line.qty;
    else map.set(key, { name: line.menuName, unitAmount, quantity: line.qty });
  }
  return Array.from(map.values());
}

// 卓トークン・占有トークンの生成（推測困難なランダム値）。
function randomToken(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return prefix + '_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function resolveGuestTable(ctx: QueryCtx | MutationCtx, slug: string, tableToken: string) {
  const store = await ctx.db
    .query('stores')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();
  if (!store) throw new ConvexError('店舗が見つかりません');

  const table = await ctx.db
    .query('tables')
    .withIndex('by_orgId_and_tableToken', (q) => q.eq('orgId', store.orgId).eq('tableToken', tableToken))
    .first();
  // トークンは退店後の清掃完了で再生成（失効）する。古いQR/履歴からのアクセスはここで弾く。
  if (!table) throw new ConvexError('このQRは無効です。卓に表示されている最新のQRコードを読み取ってください。');

  return { store, table };
}

async function findOpenSession(ctx: QueryCtx | MutationCtx, tableId: Id<'tables'>) {
  const sessions = await ctx.db
    .query('tableSessions')
    .withIndex('by_tableId', (q) => q.eq('tableId', tableId))
    .collect();
  return sessions.find((s) => s.closedAt === undefined) ?? null;
}

function sessionSummary(session: Doc<'tableSessions'>, table: Doc<'tables'>, storeName: string) {
  return {
    sessionId: session._id,
    storeName,
    tableLabel: table.label,
    seats: table.seats,
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? null,
    partySize: session.partySize ?? null,
    settleStatus: session.settleStatus ?? null,
    billTotal: session.billTotal ?? null,
    finalChargeAmount: session.finalChargeAmount ?? null,
  };
}

// 客: QR 初回アクセスで卓セッションを開く。
// 占有ロック（1卓1端末）: 最初にスキャンした端末が claimToken で卓を占有する。
//   - 占有中＋同じ claimToken → 本人として復帰
//   - 占有中＋別端末       → 「利用中」で拒否
//   - 清掃中               → 「準備中」で拒否（スタッフの清掃完了まで着席させない）
//   - 空席                 → 新規セッション作成＋ claimToken 発行（クライアントへ返す）
export const ensureGuestSession = mutation({
  args: {
    slug: v.string(),
    tableToken: v.string(),
    partySize: v.optional(v.number()),
    claimToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { store, table } = await resolveGuestTable(ctx, args.slug, args.tableToken);
    const existing = await findOpenSession(ctx, table._id);
    if (existing) {
      // 占有中。占有端末本人（claimToken 一致）だけが復帰できる。
      if (table.claimToken && args.claimToken && table.claimToken === args.claimToken) {
        return { ...sessionSummary(existing, table, store.name), claimToken: table.claimToken };
      }
      throw new ConvexError('この卓は現在ご利用中です。ご自分の卓のQRコードを読み取ってください。');
    }

    // 清掃中は着席不可（スタッフが「清掃完了」で空席に戻すまで待つ）。
    if (table.cleaning) {
      throw new ConvexError('この卓はただいま準備中です。少々お待ちください。');
    }

    if (args.partySize !== undefined && args.partySize <= 0) {
      throw new ConvexError('人数は 1 以上にしてください');
    }

    const claimToken = randomToken('clm');
    const sessionId = await ctx.db.insert('tableSessions', {
      orgId: store.orgId,
      tableId: table._id,
      openedAt: Date.now(),
      partySize: args.partySize,
    });
    await ctx.db.patch(table._id, { claimToken });
    const session = await ctx.db.get(sessionId);
    if (!session) throw new ConvexError('セッションの作成に失敗しました');
    return { ...sessionSummary(session, table, store.name), claimToken };
  },
});

// 客: 卓セッションの状態（リアルタイム購読用）。
export const guestSession = query({
  args: { sessionId: v.id('tableSessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    const table = await ctx.db.get(session.tableId);
    if (!table) return null;
    const store = await ctx.db
      .query('stores')
      .withIndex('by_orgId', (q) => q.eq('orgId', session.orgId))
      .first();
    const billPreview =
      session.billTotal ?? (session.closedAt === undefined ? await computeBillTotalFromOrders(ctx, session._id) : null);
    return {
      ...sessionSummary(session, table, store?.name ?? ''),
      billPreview,
      canOrder: session.closedAt === undefined && session.settleStatus !== 'charging' && session.settleStatus !== 'succeeded',
      canPay:
        session.closedAt === undefined &&
        (session.settleStatus === undefined || session.settleStatus === 'failed'),
    };
  },
});

// スタッフ: 開いている卓セッション一覧（フロア画面）。
export const floorNow = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const sessions = await ctx.db
      .query('tableSessions')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const open = sessions.filter((s) => s.closedAt === undefined);

    const result = await Promise.all(
      open.map(async (session) => {
        const table = await ctx.db.get(session.tableId);
        const billPreview = session.billTotal ?? (await computeBillTotalFromOrders(ctx, session._id));
        return {
          sessionId: session._id,
          tableLabel: table?.label ?? '—',
          seats: table?.seats ?? 0,
          partySize: session.partySize ?? null,
          openedAt: session.openedAt,
          settleStatus: session.settleStatus ?? null,
          billPreview,
        };
      }),
    );
    result.sort((a, b) => a.tableLabel.localeCompare(b.tableLabel) || a.openedAt - b.openedAt);
    return result;
  },
});

// スタッフ: 全卓をステータス付きで返す（カンバン用）。
// 空席 / 着席中 / 会計中 / 会計済み / 清掃中 を導出する。
export const floorBoard = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const tables = await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const sessions = await ctx.db
      .query('tableSessions')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const openByTable = new Map<string, Doc<'tableSessions'>>();
    for (const s of sessions) if (s.closedAt === undefined) openByTable.set(s.tableId, s);

    const result = await Promise.all(
      tables.map(async (t) => {
        const s = openByTable.get(t._id) ?? null;
        const status = s
          ? s.settleStatus === 'charging'
            ? '会計中'
            : s.settleStatus === 'succeeded'
              ? '会計済み'
              : '着席中'
          : t.cleaning
            ? '清掃中'
            : '空席';
        const billPreview = s ? (s.billTotal ?? (await computeBillTotalFromOrders(ctx, s._id))) : 0;
        return {
          tableId: t._id,
          label: t.label,
          seats: t.seats,
          status,
          sessionId: s?._id ?? null,
          partySize: s?.partySize ?? null,
          openedAt: s?.openedAt ?? null,
          settleStatus: s?.settleStatus ?? null,
          billPreview,
          cleaning: t.cleaning ?? false,
        };
      }),
    );
    result.sort((a, b) => a.seats - b.seats || a.label.localeCompare(b.label));
    return result;
  },
});

// スタッフ: 卓を手動で open。
export const openSession = mutation({
  args: {
    tableId: v.id('tables'),
    partySize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const table = await ctx.db.get(args.tableId);
    if (!table || table.orgId !== orgId) throw new ConvexError('自店舗の卓ではありません');

    const existing = await findOpenSession(ctx, table._id);
    if (existing) throw new ConvexError('この卓は既に使用中です');

    if (args.partySize !== undefined && args.partySize <= 0) {
      throw new ConvexError('人数は 1 以上にしてください');
    }

    if (table.cleaning) await ctx.db.patch(table._id, { cleaning: undefined });

    const sessionId = await ctx.db.insert('tableSessions', {
      orgId,
      tableId: table._id,
      openedAt: Date.now(),
      partySize: args.partySize,
    });
    return { sessionId };
  },
});

// スタッフ: 卓を閉じる（会計済みの退店、または現金・レジ会計）。閉じた卓は清掃中へ。
export const closeSession = mutation({
  args: { sessionId: v.id('tableSessions') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== orgId) throw new ConvexError('自店舗のセッションではありません');
    if (session.closedAt !== undefined) throw new ConvexError('既に閉じています');
    if (session.settleStatus === 'charging') throw new ConvexError('会計処理中です');

    await ctx.db.patch(args.sessionId, { closedAt: Date.now() });
    await ctx.db.patch(session.tableId, { cleaning: true });
  },
});

// スタッフ: 清掃完了（清掃中 → 空席）。次の客に備え卓トークンを再生成（＝旧QR・退店客の履歴を失効）。
export const markCleaningDone = mutation({
  args: { tableId: v.id('tables') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const table = await ctx.db.get(args.tableId);
    if (!table || table.orgId !== orgId) throw new ConvexError('自店舗の卓ではありません');
    // 清掃中フラグを解除し、占有を解放、卓トークンを新規発行（旧トークンは以後 resolveGuestTable で無効）。
    await ctx.db.patch(args.tableId, {
      cleaning: undefined,
      claimToken: undefined,
      tableToken: randomToken('tok'),
    });
  },
});

// 会計ロック（read→check→write）。客・スタッフ共通の内部 mutation。
export const beginTableSettle = internalMutation({
  args: {
    tableSessionId: v.id('tableSessions'),
    orgId: v.optional(v.string()),
    slug: v.optional(v.string()),
    tableToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.tableSessionId);
    if (!session) throw new ConvexError('セッションが見つかりません');

    if (args.orgId) {
      if (session.orgId !== args.orgId) throw new ConvexError('自店舗のセッションではありません');
    } else if (args.slug && args.tableToken) {
      const { store, table } = await resolveGuestTable(ctx, args.slug, args.tableToken);
      if (session.orgId !== store.orgId || session.tableId !== table._id) {
        throw new ConvexError('卓トークンが一致しません');
      }
    } else {
      throw new ConvexError('会計の本人確認に失敗しました');
    }

    if (session.settleStatus === 'succeeded') throw new ConvexError('既に会計済みです');
    if (session.closedAt !== undefined) throw new ConvexError('既に退店済みです');

    let billTotal: number;
    if (session.settleStatus === 'charging' && session.billTotal !== undefined) {
      billTotal = session.billTotal;
    } else {
      if (session.settleStatus === 'charging') throw new ConvexError('会計処理中です。しばらくお待ちください');
      billTotal = await computeBillTotalFromOrders(ctx, session._id);
      if (billTotal <= 0) throw new ConvexError('注文がありません');
      await ctx.db.patch(session._id, { billTotal, settleStatus: 'charging' });
    }

    const store = await ctx.db
      .query('stores')
      .withIndex('by_orgId', (q) => q.eq('orgId', session.orgId))
      .first();

    const lineItems = await buildCheckoutLineItems(ctx, session._id);

    return {
      billTotal,
      remainingAmount: billTotal,
      storeName: store?.name ?? 'ご利用',
      slug: store?.slug ?? '',
      email: session.email ?? null,
      lineItems,
    };
  },
});

// Stripe webhook から会計完了。
export const finishTableSettle = internalMutation({
  args: {
    tableSessionId: v.id('tableSessions'),
    finalChargeAmount: v.number(),
    finalPaymentIntentId: v.optional(v.string()),
    stripeSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.tableSessionId);
    if (!session) return;
    if (session.settleStatus === 'succeeded') return;

    if (session.settleStatus !== 'charging') return;

    const billTotal = session.billTotal ?? args.finalChargeAmount;

    // 会計は成功させるが closedAt は付けない（卓は「会計済み」のまま着席状態を維持）。
    // 退店時にスタッフが closeSession で閉じ、清掃中へ送る。
    await ctx.db.patch(args.tableSessionId, {
      settleStatus: 'succeeded',
      finalChargeAmount: args.finalChargeAmount,
      finalPaymentIntentId: args.finalPaymentIntentId,
      stripeSessionId: args.stripeSessionId,
      billTotal,
    });

    if (session.email && session.receiptEmailSentAt === undefined) {
      const store = await ctx.db
        .query('stores')
        .withIndex('by_orgId', (q) => q.eq('orgId', session.orgId))
        .first();
      const table = await ctx.db.get(session.tableId);
      await ctx.scheduler.runAfter(0, internal.emails.sendReceipt, {
        email: session.email,
        storeName: store?.name ?? 'ご利用',
        tableLabel: table?.label ?? '卓',
        billTotal,
        finalChargeAmount: args.finalChargeAmount,
      });
      await ctx.db.patch(args.tableSessionId, { receiptEmailSentAt: Date.now() });
    }
  },
});

// charging のまま固着したセッションを注文・再会計可能な状態へ戻す共通処理。
// 会計確定（succeeded）済みには触れない。
async function releaseChargingLock(ctx: MutationCtx, session: Doc<'tableSessions'>) {
  if (session.settleStatus !== 'charging') return false;
  await ctx.db.patch(session._id, { settleStatus: undefined, billTotal: undefined });
  return true;
}

// Checkout 作成直後に Stripe セッションIDを卓セッションへ記録（charging 中のみ）。
// 後でブラウザ戻り等で復帰するとき、実際の支払い状態を Stripe に確認するために使う。
export const attachStripeSession = internalMutation({
  args: { tableSessionId: v.id('tableSessions'), stripeSessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.tableSessionId);
    if (!session || session.settleStatus !== 'charging') return;
    await ctx.db.patch(args.tableSessionId, { stripeSessionId: args.stripeSessionId });
  },
});

// 客の会計状態を本人確認つきで取得（復帰アクション用）。
export const getGuestSettleInfo = internalQuery({
  args: { tableSessionId: v.id('tableSessions'), slug: v.string(), tableToken: v.string() },
  handler: async (ctx, args) => {
    const { store, table } = await resolveGuestTable(ctx, args.slug, args.tableToken);
    const session = await ctx.db.get(args.tableSessionId);
    if (!session || session.orgId !== store.orgId || session.tableId !== table._id) return null;
    return {
      settleStatus: session.settleStatus ?? null,
      stripeSessionId: session.stripeSessionId ?? null,
      billTotal: session.billTotal ?? 0,
    };
  },
});

// Stripe webhook（checkout.session.expired）から会計ロックを自動解除。
export const releaseTableSettle = internalMutation({
  args: { tableSessionId: v.id('tableSessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.tableSessionId);
    if (!session) return;
    await releaseChargingLock(ctx, session);
  },
});

// スタッフ: 中断などで charging のまま固着した卓の会計ロックを手動解除。
export const forceReleaseSettle = mutation({
  args: { sessionId: v.id('tableSessions') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== orgId) throw new ConvexError('自店舗のセッションではありません');
    if (session.settleStatus === 'succeeded') throw new ConvexError('既に会計済みです');
    if (session.closedAt !== undefined) throw new ConvexError('既に閉じています');
    const released = await releaseChargingLock(ctx, session);
    if (!released) throw new ConvexError('会計処理中ではありません');
  },
});

// 客: 会計用メールを任意で登録。
export const setGuestEmail = mutation({
  args: {
    sessionId: v.id('tableSessions'),
    slug: v.string(),
    tableToken: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { store, table } = await resolveGuestTable(ctx, args.slug, args.tableToken);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== store.orgId || session.tableId !== table._id) {
      throw new ConvexError('セッションが見つかりません');
    }
    const email = args.email.trim();
    if (email === '') throw new ConvexError('メールアドレスを入力してください');
    await ctx.db.patch(args.sessionId, { email });
  },
});

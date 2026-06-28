import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { requireOrgId } from './auth';
import type { Id } from './_generated/dataModel';

async function findSession(ctx: QueryCtx | MutationCtx, orgId: string, sessionId: Id<'tableSessions'>) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.orgId !== orgId) throw new ConvexError('自店舗のセッションではありません');
  if (session.closedAt !== undefined) throw new ConvexError('この卓は既に閉じています');
  if (session.settleStatus === 'charging' || session.settleStatus === 'succeeded') {
    throw new ConvexError('会計処理中または会計済みのため注文できません');
  }
  return session;
}

// 本人確認のみ（slug・卓トークン・セッションの一致）。状態では弾かない。読み取り用。
async function resolveGuestIdentity(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  tableToken: string,
  sessionId: Id<'tableSessions'>,
) {
  const store = await ctx.db
    .query('stores')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .first();
  if (!store) throw new ConvexError('店舗が見つかりません');

  const table = await ctx.db
    .query('tables')
    .withIndex('by_orgId_and_tableToken', (q) => q.eq('orgId', store.orgId).eq('tableToken', tableToken))
    .first();
  if (!table) throw new ConvexError('卓が見つかりません');

  const session = await ctx.db.get(sessionId);
  if (!session || session.orgId !== store.orgId || session.tableId !== table._id) {
    throw new ConvexError('セッションが見つかりません');
  }
  return { store, table, session };
}

// 本人確認＋注文可能かの状態チェック。書き込み（注文）用。
async function resolveGuestSession(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  tableToken: string,
  sessionId: Id<'tableSessions'>,
) {
  const resolved = await resolveGuestIdentity(ctx, slug, tableToken, sessionId);
  const { session } = resolved;
  if (session.closedAt !== undefined) throw new ConvexError('この卓は既に閉じています');
  if (session.settleStatus === 'charging' || session.settleStatus === 'succeeded') {
    throw new ConvexError('会計処理中または会計済みのため注文できません');
  }
  return resolved;
}

async function mapOrderLines(ctx: QueryCtx | MutationCtx, orgId: string, sessionId: Id<'tableSessions'>) {
  const lines = await ctx.db
    .query('orderLines')
    .withIndex('by_tableSession', (q) => q.eq('tableSessionId', sessionId))
    .collect();
  const menu = await ctx.db
    .query('menuItems')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
    .collect();
  const asapMap = new Map<string, boolean>();
  for (const m of menu) asapMap.set(m._id, m.serveAsap ?? false);
  lines.sort((a, b) => a.orderedAt - b.orderedAt);
  return lines.map((l) => ({
    _id: l._id,
    menuName: l.menuName,
    category: l.category ?? null,
    unitPrice: l.unitPrice ?? null,
    lineTotal: l.unitPrice !== undefined ? l.unitPrice * l.qty : null,
    qty: l.qty,
    orderedAt: l.orderedAt,
    servedAt: l.servedAt ?? null,
    serveAsap: asapMap.get(l.menuItemId) ?? false,
  }));
}

export const listOrders = query({
  args: { sessionId: v.id('tableSessions') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    await findSession(ctx, orgId, args.sessionId);
    return mapOrderLines(ctx, orgId, args.sessionId);
  },
});

// スタッフ用: 状態に関わらず明細を返す（カンバン詳細パネル・会計済みでも閲覧可）。
export const listOrdersForStaff = query({
  args: { sessionId: v.id('tableSessions') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== orgId) throw new ConvexError('自店舗のセッションではありません');
    return mapOrderLines(ctx, orgId, args.sessionId);
  },
});

export const listGuestOrders = query({
  args: {
    slug: v.string(),
    tableToken: v.string(),
    sessionId: v.id('tableSessions'),
  },
  handler: async (ctx, args) => {
    const { session } = await resolveGuestIdentity(ctx, args.slug, args.tableToken, args.sessionId);
    return mapOrderLines(ctx, session.orgId, args.sessionId);
  },
});

// 在庫管理対象（stock 設定済み）なら、注文数を満たせるか検証して減算する。
// 単一ドキュメントの read→check→write。同時注文は Convex の OCC が直列化し、
// 在庫が尽きた注文だけが「売り切れ」になる（オーバーセルしない）。
async function checkAndDecrementStock(
  ctx: MutationCtx,
  item: { _id: Id<'menuItems'>; name: string; stock?: number },
  qty: number,
) {
  if (item.stock === undefined) return;
  if (item.stock < qty) {
    const remaining = Math.max(item.stock, 0);
    throw new ConvexError(
      remaining === 0 ? `「${item.name}」は売り切れです` : `「${item.name}」は残り ${remaining} 点です`,
    );
  }
  await ctx.db.patch(item._id, { stock: item.stock - qty });
}

export const addOrder = mutation({
  args: {
    sessionId: v.id('tableSessions'),
    menuItemId: v.id('menuItems'),
    qty: v.number(),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    if (args.qty <= 0) throw new ConvexError('数量は 1 以上にしてください');
    await findSession(ctx, orgId, args.sessionId);
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== orgId || !item.active) throw new ConvexError('自店舗の商品ではありません');
    await checkAndDecrementStock(ctx, item, args.qty);
    await ctx.db.insert('orderLines', {
      orgId,
      tableSessionId: args.sessionId,
      menuItemId: item._id,
      menuName: item.name,
      category: item.category,
      unitPrice: item.price,
      qty: args.qty,
      orderedAt: Date.now(),
      actor: orgId,
    });
  },
});

export const addGuestOrder = mutation({
  args: {
    slug: v.string(),
    tableToken: v.string(),
    sessionId: v.id('tableSessions'),
    menuItemId: v.id('menuItems'),
    qty: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.qty <= 0) throw new ConvexError('数量は 1 以上にしてください');
    const { session } = await resolveGuestSession(ctx, args.slug, args.tableToken, args.sessionId);
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== session.orgId || !item.active) throw new ConvexError('注文できない商品です');
    await checkAndDecrementStock(ctx, item, args.qty);
    await ctx.db.insert('orderLines', {
      orgId: session.orgId,
      tableSessionId: args.sessionId,
      menuItemId: item._id,
      menuName: item.name,
      category: item.category,
      unitPrice: item.price,
      qty: args.qty,
      orderedAt: Date.now(),
      actor: `guest:${args.tableToken}`,
    });
  },
});

// 客が売り切れ商品を頼もうとした記録（機会損失）。注文は成立しないが事実だけ残す。
// addGuestOrder の在庫チェックは throw でロールバックするため、品切れの記録はこの独立 mutation で行う。
export const recordSoldOut = mutation({
  args: { slug: v.string(), menuItemId: v.id('menuItems') },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query('stores')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!store) return;
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== store.orgId) return;
    await ctx.db.insert('soldOutEvents', {
      orgId: store.orgId,
      menuItemId: item._id,
      menuName: item.name,
      at: Date.now(),
    });
  },
});

export const markServed = mutation({
  args: { orderLineId: v.id('orderLines') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const line = await ctx.db.get(args.orderLineId);
    if (!line || line.orgId !== orgId) throw new ConvexError('自店舗の注文ではありません');
    if (line.servedAt === undefined) await ctx.db.patch(args.orderLineId, { servedAt: Date.now() });
  },
});

export const removeOrder = mutation({
  args: { orderLineId: v.id('orderLines') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const line = await ctx.db.get(args.orderLineId);
    if (!line || line.orgId !== orgId) throw new ConvexError('自店舗の注文ではありません');
    // 在庫管理対象なら取消分を在庫に戻す。
    const item = await ctx.db.get(line.menuItemId);
    if (item && item.stock !== undefined) {
      await ctx.db.patch(item._id, { stock: item.stock + line.qty });
    }
    await ctx.db.delete(args.orderLineId);
  },
});

import { mutation, query, type MutationCtx } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { requireOrgId } from './auth';
import type { Id } from './_generated/dataModel';

// KDS（厨房ディスプレイ）用。開いている全卓の注文明細を卓ごとにまとめて返す。
// floorNow は会計目線（合計・滞在）だが、これは調理目線（商品・提供状況・経過）。
export const board = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const sessions = (
      await ctx.db
        .query('tableSessions')
        .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
        .collect()
    ).filter((s) => s.closedAt === undefined);

    const menu = await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const codeById = new Map(menu.map((m) => [m._id, m.code ?? null] as const));
    const asapById = new Map(menu.map((m) => [m._id, m.serveAsap ?? false] as const));

    const cards = await Promise.all(
      sessions.map(async (s) => {
        const table = await ctx.db.get(s.tableId);
        const lines = await ctx.db
          .query('orderLines')
          .withIndex('by_tableSession', (q) => q.eq('tableSessionId', s._id))
          .collect();
        return {
          sessionId: s._id,
          tableLabel: table?.label ?? '—',
          seats: table?.seats ?? 0,
          openedAt: s.openedAt,
          settleStatus: s.settleStatus ?? null,
          lines: lines.map((l) => ({
            _id: l._id,
            menuItemId: l.menuItemId,
            code: codeById.get(l.menuItemId) ?? null,
            menuName: l.menuName,
            qty: l.qty,
            orderedAt: l.orderedAt,
            servedAt: l.servedAt ?? null,
            serveAsap: asapById.get(l.menuItemId) ?? false,
          })),
        };
      }),
    );
    cards.sort((a, b) => a.tableLabel.localeCompare(b.tableLabel) || a.openedAt - b.openedAt);
    return cards;
  },
});

async function setServed(
  ctx: MutationCtx,
  orgId: string,
  sessionId: Id<'tableSessions'>,
  menuItemId: Id<'menuItems'> | null,
  serve: boolean,
) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.orgId !== orgId) throw new ConvexError('自店舗のセッションではありません');
  const lines = await ctx.db
    .query('orderLines')
    .withIndex('by_tableSession', (q) => q.eq('tableSessionId', sessionId))
    .collect();
  const now = Date.now();
  for (const l of lines) {
    if (menuItemId && l.menuItemId !== menuItemId) continue;
    if (serve && l.servedAt === undefined) await ctx.db.patch(l._id, { servedAt: now });
    if (!serve && l.servedAt !== undefined) await ctx.db.patch(l._id, { servedAt: undefined });
  }
}

// その卓の特定商品をすべて提供済みにする。
export const serveItem = mutation({
  args: { sessionId: v.id('tableSessions'), menuItemId: v.id('menuItems') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    await setServed(ctx, orgId, args.sessionId, args.menuItemId, true);
  },
});

// その卓の特定商品を調理中に戻す（提供済みの取り消し）。
export const unserveItem = mutation({
  args: { sessionId: v.id('tableSessions'), menuItemId: v.id('menuItems') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    await setServed(ctx, orgId, args.sessionId, args.menuItemId, false);
  },
});

// その卓の未提供をすべて提供済みにする。
export const serveAllSession = mutation({
  args: { sessionId: v.id('tableSessions') },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    await setServed(ctx, orgId, args.sessionId, null, true);
  },
});

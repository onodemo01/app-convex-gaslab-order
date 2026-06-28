import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgId } from './auth';

function randomTableToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const generateTables = mutation({
  args: {
    specs: v.array(v.object({ seats: v.number(), count: v.number() })),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);

    const existing = await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .first();
    if (existing) throw new ConvexError('卓は既に登録済みです（作り直すなら先に全削除してください）');

    const store = await ctx.db
      .query('stores')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .first();

    let n = 0;
    for (const spec of args.specs) {
      if (spec.seats <= 0 || spec.count <= 0) throw new ConvexError('席数・台数は 1 以上にしてください');
      for (let i = 0; i < spec.count; i++) {
        n++;
        await ctx.db.insert('tables', {
          orgId,
          label: `T${n}`,
          seats: spec.seats,
          tableToken: randomTableToken(),
        });
      }
    }
    if (n === 0) throw new ConvexError('登録する卓がありません');
    return { created: n, slug: store?.slug ?? null };
  },
});

export const listTables = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const store = await ctx.db
      .query('stores')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .first();
    const tables = await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    // 占有中（開いているセッションがある）卓を特定（QR一覧でグレーアウト用）。
    const sessions = await ctx.db
      .query('tableSessions')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const occupied = new Set(sessions.filter((s) => s.closedAt === undefined).map((s) => s.tableId));
    tables.sort((a, b) => a.seats - b.seats || a.label.localeCompare(b.label));
    return tables.map((t) => ({
      _id: t._id,
      label: t.label,
      seats: t.seats,
      tableToken: t.tableToken,
      guestUrl: store ? `/t/${store.slug}/${t.tableToken}` : null,
      occupied: occupied.has(t._id),
      cleaning: t.cleaning ?? false,
    }));
  },
});

export const clearTables = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const tables = await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    for (const t of tables) await ctx.db.delete(t._id);
    return { removed: tables.length };
  },
});

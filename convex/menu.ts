import { mutation, query } from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { requireOrgId } from './auth';

// カテゴリ別のサンプル単価（税込・円）。既存メニューへの一括投入用。
const SAMPLE_PRICE_BY_CATEGORY: Record<string, number> = {
  前菜: 1800,
  パスタ: 2400,
  メイン: 4800,
  デザート: 1200,
  ドリンク: 800,
  飲み物: 800,
};
const SAMPLE_PRICE_DEFAULT = 2000;

// 商品マスタの一覧（スタッフ・自店舗のみ）。カテゴリ→名前でソート。
export const listMenu = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const items = await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    return items.sort(
      (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name),
    );
  },
});

// 客用: 有効な商品だけ返す（認証なし）。
export const publicMenu = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query('stores')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!store) return [];
    const items = await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', store.orgId))
      .collect();
    return items
      .filter((m) => m.active)
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
      .map((m) => ({
        _id: m._id,
        name: m.name,
        category: m.category ?? null,
        code: m.code ?? null,
        price: m.price ?? null,
        serveAsap: m.serveAsap ?? false,
        // undefined = 無制限。number = 残数。<=0 で売り切れ。
        stock: m.stock ?? null,
        soldOut: m.stock !== undefined && m.stock <= 0,
      }));
  },
});

// 商品を追加（スタッフ・自店舗）。
export const addMenuItem = mutation({
  args: {
    name: v.string(),
    category: v.optional(v.string()),
    price: v.optional(v.number()),
    serveAsap: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const name = args.name.trim();
    if (name === '') throw new ConvexError('商品名を入力してください');
    if (args.price !== undefined && args.price < 0) throw new ConvexError('価格は0以上にしてください');
    const category = args.category?.trim() ? args.category.trim() : undefined;
    await ctx.db.insert('menuItems', {
      orgId,
      name,
      category,
      price: args.price,
      active: true,
      serveAsap: args.serveAsap ?? false,
    });
  },
});

// 価格の更新（自店舗境界つき）。
export const setMenuItemPrice = mutation({
  args: { menuItemId: v.id('menuItems'), price: v.number() },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    if (args.price < 0) throw new ConvexError('価格は0以上にしてください');
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== orgId) throw new ConvexError('自店舗の商品ではありません');
    await ctx.db.patch(args.menuItemId, { price: args.price });
  },
});

// 都度提供/コースの切替（自店舗境界つき）。
export const setServeAsap = mutation({
  args: { menuItemId: v.id('menuItems'), serveAsap: v.boolean() },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== orgId) throw new ConvexError('自店舗の商品ではありません');
    await ctx.db.patch(args.menuItemId, { serveAsap: args.serveAsap });
  },
});

// 紙メニュー番号（code）の設定。null でクリア。自店舗境界つき。
export const setMenuItemCode = mutation({
  args: { menuItemId: v.id('menuItems'), code: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== orgId) throw new ConvexError('自店舗の商品ではありません');
    if (args.code === null) {
      await ctx.db.patch(args.menuItemId, { code: undefined });
      return;
    }
    if (!Number.isInteger(args.code) || args.code < 0) {
      throw new ConvexError('番号は0以上の整数で入力してください');
    }
    await ctx.db.patch(args.menuItemId, { code: args.code });
  },
});

// 在庫数の設定・補充。number で残数を上書き、null で無制限に戻す。自店舗境界つき。
export const setMenuItemStock = mutation({
  args: { menuItemId: v.id('menuItems'), stock: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== orgId) throw new ConvexError('自店舗の商品ではありません');
    if (args.stock === null) {
      await ctx.db.patch(args.menuItemId, { stock: undefined });
      return;
    }
    if (args.stock < 0 || !Number.isInteger(args.stock)) {
      throw new ConvexError('在庫は0以上の整数で入力してください');
    }
    await ctx.db.patch(args.menuItemId, { stock: args.stock });
  },
});

// 商品の有効/無効（論理削除）。注文履歴は残すので物理削除しない。自店舗境界つき。
export const setMenuItemActive = mutation({
  args: { menuItemId: v.id('menuItems'), active: v.boolean() },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const item = await ctx.db.get(args.menuItemId);
    if (!item || item.orgId !== orgId) throw new ConvexError('自店舗の商品ではありません');
    await ctx.db.patch(args.menuItemId, { active: args.active });
  },
});

// 既存商品にサンプル価格を一括投入（price 未設定のみ）。設定タブから実行。
export const fillSamplePrices = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const items = await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    let updated = 0;
    for (const item of items) {
      if (item.price !== undefined) continue;
      const price = item.category ? (SAMPLE_PRICE_BY_CATEGORY[item.category] ?? SAMPLE_PRICE_DEFAULT) : SAMPLE_PRICE_DEFAULT;
      await ctx.db.patch(item._id, { price });
      updated++;
    }
    return { updated, skipped: items.length - updated };
  },
});

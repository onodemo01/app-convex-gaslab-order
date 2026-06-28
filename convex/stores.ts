import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgId } from './auth';

// 店舗の公開プロフィール（客用ページ /t/{slug}/{tableToken} の入口）。
//
// 境界の整理（設計メモ6章・10章のハイブリッド構造と同じ非対称）:
//   - 書き込み（upsertMyStore）: スタッフ専用。orgId は ctx 由来＝自店舗の設定しか書けない。
//   - 読み取り（publicStore）: 認証なし。客が店舗ページを開くために誰でも引ける。
//     ここで返すのは「公開してよい情報」だけ（店名・slug）。orgId そのものは返さない。

// slug の形式: 小文字英数字とハイフン、3〜32文字。URL にそのまま載るので厳しめに絞る。
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

// 自店舗の設定（スタッフ用）。未登録なら null。
export const getMyStore = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const store = await ctx.db
      .query('stores')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .first();
    return store ? { name: store.name, slug: store.slug } : null;
  },
});

// 店名と slug を登録/更新（スタッフ用）。
// slug の一意性チェックも read→check→write を 1 mutation に閉じる（予約と同じ作法）。
export const upsertMyStore = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx); // 自店舗の設定だけ書ける（ctx 由来）

    const name = args.name.trim();
    const slug = args.slug.trim().toLowerCase();
    if (name === '') throw new ConvexError('店名を入力してください');
    if (!SLUG_RE.test(slug)) {
      throw new ConvexError('URL名は小文字英数字とハイフンで3〜32文字にしてください（例: sakura-tei）');
    }

    // 1. read: 同じ slug を使っている店舗
    const taken = await ctx.db
      .query('stores')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();
    // 2. check: 他店舗が使っていたら弾く（自店舗の更新は通す）
    if (taken && taken.orgId !== orgId) {
      throw new ConvexError(`URL名「${slug}」は既に使われています`);
    }

    // 3. write: 既存があれば更新、無ければ作成（1店舗=1レコード）
    const mine = await ctx.db
      .query('stores')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .first();
    if (mine) {
      await ctx.db.patch(mine._id, { name, slug });
    } else {
      await ctx.db.insert('stores', { orgId, name, slug });
    }
    return { slug };
  },
});

// 客用: slug から店舗の公開情報を引く。★認証なし＝誰でも読める。
// 公開してよいものだけ返す（orgId・卓数などの内部情報は載せない）。
export const publicStore = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query('stores')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    return store ? { name: store.name, slug: store.slug } : null;
  },
});

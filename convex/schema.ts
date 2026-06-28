import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  stores: defineTable({
    orgId: v.string(),
    slug: v.string(),
    name: v.string(),
  })
    .index('by_orgId', ['orgId'])
    .index('by_slug', ['slug']),

  tables: defineTable({
    orgId: v.string(),
    label: v.string(),
    seats: v.number(),
    tableToken: v.string(),
    // 会計後の片付け中。true=清掃中（空席に戻すまで新規着席させない目印）。
    cleaning: v.optional(v.boolean()),
    // 現在この卓を占有している端末の識別トークン（1卓1端末ロック）。空席化（清掃完了）でクリア。
    claimToken: v.optional(v.string()),
  })
    .index('by_orgId', ['orgId'])
    .index('by_orgId_and_tableToken', ['orgId', 'tableToken']),

  tableSessions: defineTable({
    orgId: v.string(),
    tableId: v.id('tables'),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    partySize: v.optional(v.number()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    billTotal: v.optional(v.number()),
    settleStatus: v.optional(
      v.union(
        v.literal('charging'),
        v.literal('succeeded'),
        v.literal('failed'),
      ),
    ),
    finalChargeAmount: v.optional(v.number()),
    stripeSessionId: v.optional(v.string()),
    finalPaymentIntentId: v.optional(v.string()),
    receiptEmailSentAt: v.optional(v.number()),
  })
    .index('by_orgId', ['orgId'])
    .index('by_tableId', ['tableId'])
    .index('by_orgId_open', ['orgId', 'closedAt']),

  menuItems: defineTable({
    orgId: v.string(),
    name: v.string(),
    category: v.optional(v.string()),
    // 紙メニューの番号（客スマホのテンキー入力で使う4桁コード）。undefined = 未設定。
    code: v.optional(v.number()),
    price: v.optional(v.number()),
    active: v.boolean(),
    serveAsap: v.optional(v.boolean()),
    // 数量限定商品の在庫数。undefined = 無制限。
    // 厳密な売り切れ制御のため注文 mutation 内で read→check→decrement する。
    stock: v.optional(v.number()),
  }).index('by_orgId', ['orgId']),

  orderLines: defineTable({
    orgId: v.string(),
    tableSessionId: v.id('tableSessions'),
    menuItemId: v.id('menuItems'),
    menuName: v.string(),
    category: v.optional(v.string()),
    unitPrice: v.optional(v.number()),
    qty: v.number(),
    orderedAt: v.number(),
    servedAt: v.optional(v.number()),
    actor: v.string(),
  })
    .index('by_orgId', ['orgId'])
    .index('by_tableSession', ['tableSessionId']),

  // 品切れ（機会損失）イベント。客が売り切れ商品を頼もうとした記録。分析の「品切れ発生」で集計。
  soldOutEvents: defineTable({
    orgId: v.string(),
    menuItemId: v.id('menuItems'),
    menuName: v.string(),
    at: v.number(),
  }).index('by_orgId', ['orgId']),

  // 会計後アンケート。任意回答。客層（男女比・年代）・満足度・再来意向の分析と、
  // クーポンコードでのリピート名寄せに使う。1セッション1件。
  surveys: defineTable({
    orgId: v.string(),
    tableSessionId: v.id('tableSessions'),
    satisfaction: v.optional(v.number()), // 1〜5
    gender: v.optional(v.string()), // 'male' | 'female' | 'other'
    ageGroup: v.optional(v.string()), // '10' | '20' | ... | '60'（代）
    revisit: v.optional(v.string()), // 'high' | 'mid' | 'low'
    couponCode: v.optional(v.string()),
    at: v.number(),
  })
    .index('by_orgId', ['orgId'])
    .index('by_tableSession', ['tableSessionId']),
});

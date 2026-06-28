import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { requireOrgId } from './auth';
import type { Id } from './_generated/dataModel';

// 開発・デモ用のシード。店舗・卓・メニューを restrant-orders/app のデモと同じ内容で投入する。
// 本番では使わない（現場ではフロアの設定タブから登録）。

const STORE = { slug: 'gaslab', name: 'トラットリア ガスラボ' };

const TABLES = [
  { label: 'A1', seats: 2, tableToken: 'tok_a1k9f2' },
  { label: 'A2', seats: 2, tableToken: 'tok_a2m4d7' },
  { label: 'A3', seats: 2, tableToken: 'tok_a3p1x8' },
  { label: 'A4', seats: 2, tableToken: 'tok_a4r6b3' },
  { label: 'A5', seats: 2, tableToken: 'tok_a5t2w5' },
  { label: 'B1', seats: 4, tableToken: 'tok_b1v8c1' },
  { label: 'B2', seats: 4, tableToken: 'tok_b2n3q9' },
  { label: 'B3', seats: 4, tableToken: 'tok_b3h7s6' },
];

// code, name, category, price, stock(undefined=無制限), serveAsap
const MENU: Array<{
  code: number;
  name: string;
  category: string;
  price: number;
  stock?: number;
  serveAsap?: boolean;
}> = [
  { code: 1001, name: '辛味チキン', category: 'サラダ・前菜', price: 300 },
  { code: 1002, name: '小エビのサラダ', category: 'サラダ・前菜', price: 350, stock: 6 },
  { code: 1003, name: 'やわらか青豆の温サラダ', category: 'サラダ・前菜', price: 200 },
  { code: 1004, name: 'エスカルゴのオーブン焼き', category: 'サラダ・前菜', price: 400, stock: 18 },
  { code: 2001, name: 'ミラノ風ドリア', category: 'ピザ・ドリア', price: 300 },
  { code: 2002, name: '半熟卵のミラノ風ドリア', category: 'ピザ・ドリア', price: 350 },
  { code: 2003, name: 'マルゲリータピザ', category: 'ピザ・ドリア', price: 400, stock: 24 },
  { code: 2004, name: '野菜とベーコンのドリア', category: 'ピザ・ドリア', price: 350 },
  { code: 3001, name: 'ペペロンチーノ', category: 'パスタ', price: 350 },
  { code: 3002, name: 'たらこソースシシリー風', category: 'パスタ', price: 400 },
  { code: 3003, name: 'ボロネーゼ', category: 'パスタ', price: 460 },
  { code: 3004, name: 'イカ墨のスパゲッティ', category: 'パスタ', price: 400, stock: 20 },
  { code: 4001, name: 'ミニフィレステーキ', category: 'グリル・肉料理', price: 600, stock: 4 },
  { code: 4002, name: 'ハンバーグステーキ', category: 'グリル・肉料理', price: 460 },
  { code: 4003, name: 'アロスティチーニ（ラム串）', category: 'グリル・肉料理', price: 400, stock: 16 },
  { code: 5001, name: 'ドリンクバー', category: 'ドリンク・デザート', price: 220, serveAsap: true },
  { code: 5002, name: 'ランブルスコ グラス', category: 'ドリンク・デザート', price: 250 },
  { code: 5003, name: 'ティラミス', category: 'ドリンク・デザート', price: 300, stock: 5 },
  { code: 5004, name: 'イタリアンプリン', category: 'ドリンク・デザート', price: 250, stock: 18 },
];

// 空なら一式投入する冪等シード。
export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);

    let store = await ctx.db
      .query('stores')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .first();
    if (!store) {
      const id = await ctx.db.insert('stores', { orgId, slug: STORE.slug, name: STORE.name });
      store = await ctx.db.get(id);
    }

    const tables = await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    if (tables.length === 0) {
      for (const t of TABLES) {
        await ctx.db.insert('tables', { orgId, label: t.label, seats: t.seats, tableToken: t.tableToken });
      }
    }

    const menu = await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    if (menu.length === 0) {
      for (const m of MENU) {
        await ctx.db.insert('menuItems', {
          orgId,
          name: m.name,
          category: m.category,
          code: m.code,
          price: m.price,
          active: true,
          serveAsap: m.serveAsap ?? false,
          stock: m.stock,
        });
      }
    }

    return { slug: store?.slug ?? STORE.slug };
  },
});

// デモ用: どこかの卓が1品注文する（セミナーのリアルタイム演出）。
// 着席中の卓を優先し、無ければ空席を開ける。在庫のある商品をランダムに選ぶ。
// 卓トークン再生成用（清掃完了で発行＝markCleaningDone と同じ挙動）。
function randomToken(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return prefix + '_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// デモを1手だけ進める。注文だけでなく、提供→会計→退店→清掃完了→次の客、まで
// ライフサイクル全体をランダムに少しずつ動かす（自動デモで全フローが流れて見えるように）。
export const simulate = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const tables = await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    if (tables.length === 0) return null;

    const sessions = await ctx.db
      .query('tableSessions')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const open = sessions.filter((s) => s.closedAt === undefined);
    const openTableIds = new Set(open.map((s) => s.tableId));

    const menu = (
      await ctx.db
        .query('menuItems')
        .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
        .collect()
    ).filter((m) => m.active && (m.stock === undefined || m.stock > 0));

    // 取りうる手を重み付きで集める（着席/注文/提供/会計/退店/清掃完了）。
    type Action =
      | { w: number; kind: 'clean'; tableId: Id<'tables'> }
      | { w: number; kind: 'close'; sessionId: Id<'tableSessions'>; tableId: Id<'tables'> }
      | { w: number; kind: 'open'; tableId: Id<'tables'>; seats: number }
      | { w: number; kind: 'serve'; lineId: Id<'orderLines'> }
      | { w: number; kind: 'order'; sessionId: Id<'tableSessions'> }
      | { w: number; kind: 'settle'; sessionId: Id<'tableSessions'>; bill: number }
      | { w: number; kind: 'soldout' };
    const actions: Array<Action> = [];

    // 品切れ（機会損失）をたまに発生させる（分析の「品切れ発生」がライブでも動くように）。
    if (menu.length) actions.push({ w: 1, kind: 'soldout' });

    // F. 清掃完了（清掃中 → 空席＋トークン再生成）
    for (const t of tables) {
      if (t.cleaning) actions.push({ w: 3, kind: 'clean', tableId: t._id });
    }
    // E. 退店（会計済み → 閉じて清掃中へ）
    for (const s of open) {
      if (s.settleStatus === 'succeeded') actions.push({ w: 3, kind: 'close', sessionId: s._id, tableId: s.tableId });
    }
    // A. 着席（空席かつ清掃中でない卓に新規セッション）
    const empties = tables.filter((t) => !openTableIds.has(t._id) && !t.cleaning);
    if (empties.length) {
      const t = empties[Math.floor(Math.random() * empties.length)];
      actions.push({ w: 3, kind: 'open', tableId: t._id, seats: t.seats });
    }
    // B/C/D は会計前の各セッションの明細を見て決める。
    for (const s of open) {
      if (s.settleStatus === 'charging' || s.settleStatus === 'succeeded') continue;
      const lines = await ctx.db
        .query('orderLines')
        .withIndex('by_tableSession', (q) => q.eq('tableSessionId', s._id))
        .collect();
      const unserved = lines.filter((l) => l.servedAt === undefined);
      // C. 提供（未提供の明細を1つ提供済みに）
      if (unserved.length) actions.push({ w: 4, kind: 'serve', lineId: unserved[0]._id });
      // B. 注文追加（明細が増えすぎないよう上限4・メニューあり）
      if (lines.length < 4 && menu.length) actions.push({ w: 4, kind: 'order', sessionId: s._id });
      // D. 会計（注文があり全て提供済み・金額>0 ならデモ会計＝Stripe を介さず succeeded に）
      if (lines.length >= 1 && unserved.length === 0) {
        const bill = lines.reduce((a, l) => a + (l.unitPrice ?? 0) * l.qty, 0);
        if (bill > 0) actions.push({ w: 3, kind: 'settle', sessionId: s._id, bill });
      }
    }

    if (actions.length === 0) return null;

    // 重み付きランダムで1手選ぶ。
    const total = actions.reduce((a, x) => a + x.w, 0);
    let r = Math.random() * total;
    let pick = actions[0];
    for (const a of actions) {
      r -= a.w;
      if (r <= 0) {
        pick = a;
        break;
      }
    }

    switch (pick.kind) {
      case 'clean':
        await ctx.db.patch(pick.tableId, { cleaning: undefined, claimToken: undefined, tableToken: randomToken('tok') });
        return { action: '清掃完了' };
      case 'close':
        await ctx.db.patch(pick.sessionId, { closedAt: Date.now() });
        await ctx.db.patch(pick.tableId, { cleaning: true });
        return { action: '退店' };
      case 'open': {
        await ctx.db.insert('tableSessions', {
          orgId,
          tableId: pick.tableId,
          openedAt: Date.now(),
          partySize: pick.seats >= 4 ? 2 + Math.floor(Math.random() * 3) : 2,
        });
        return { action: '着席' };
      }
      case 'serve':
        await ctx.db.patch(pick.lineId, { servedAt: Date.now() });
        return { action: '提供' };
      case 'order': {
        const it = menu[Math.floor(Math.random() * menu.length)];
        const want = 1 + Math.floor(Math.random() * 2);
        const qty = it.stock !== undefined ? Math.min(want, it.stock) : want;
        if (qty <= 0) return null;
        await ctx.db.insert('orderLines', {
          orgId,
          tableSessionId: pick.sessionId,
          menuItemId: it._id,
          menuName: it.name,
          category: it.category,
          unitPrice: it.price,
          qty,
          orderedAt: Date.now(),
          actor: 'demo',
        });
        if (it.stock !== undefined) await ctx.db.patch(it._id, { stock: Math.max(0, it.stock - qty) });
        return { action: '注文', name: it.name };
      }
      case 'settle':
        await ctx.db.patch(pick.sessionId, { settleStatus: 'succeeded', finalChargeAmount: pick.bill, billTotal: pick.bill });
        return { action: '会計' };
      case 'soldout': {
        const it = menu[Math.floor(Math.random() * menu.length)];
        await ctx.db.insert('soldOutEvents', { orgId, menuItemId: it._id, menuName: it.name, at: Date.now() });
        return { action: '品切れ', name: it.name };
      }
    }
  },
});

// 分析用のサンプル過去データを投入する。過去 days 日分の「会計済み（退店済み）」セッション一式を
// リアルな時間帯分布・提供時間・客単価で生成する（イベントソーシング：tableSessions＋orderLines に事実を積む）。
// Convex は Date.now() のみ → 過去日時は現在からの相対オフセットで作る。
export const seedHistory = mutation({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrgId(ctx);
    const tables = await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const menu = (
      await ctx.db
        .query('menuItems')
        .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
        .collect()
    ).filter((m) => m.active && m.price != null && m.price > 0);
    if (tables.length === 0 || menu.length === 0) {
      return { ok: false as const, reason: '卓またはメニューがありません（先にデモ投入してください）' };
    }

    const days = Math.min(Math.max(Math.round(args.days ?? 14), 1), 30);
    const JST = 9 * 60 * 60 * 1000;
    const MIN = 60 * 1000;
    const DAY = 24 * 60 * MIN;
    const now = Date.now();
    // JST「今日0時」をシフト時間軸で求める。ts(d,h,m)=その日のJST h時m分を UTC ms で返す。
    const jstMidnightShifted = Math.floor((now + JST) / DAY) * DAY;
    const ts = (d: number, hour: number, min: number) => jstMidnightShifted - JST - d * DAY + hour * 3600 * 1000 + min * MIN;

    // 時間帯の重み（昼11-14・夜17-22にピーク）。
    const weight: Record<number, number> = { 11: 4, 12: 6, 13: 5, 14: 2, 17: 2, 18: 5, 19: 6, 20: 6, 21: 4, 22: 2 };
    const hourPool: number[] = [];
    for (const h of Object.keys(weight)) for (let i = 0; i < weight[Number(h)]; i++) hourPool.push(Number(h));
    const pickHour = () => hourPool[Math.floor(Math.random() * hourPool.length)];
    const rnd = (n: number) => Math.floor(Math.random() * n);

    let createdSessions = 0;
    let createdLines = 0;
    let createdSoldOuts = 0;
    let createdSurveys = 0;
    for (let d = 1; d <= days; d++) {
      // 品切れ（機会損失）を 0〜2 件/日 撒く（分析の「品切れ発生」用）。
      const soldOutsToday = rnd(3);
      for (let k = 0; k < soldOutsToday; k++) {
        const it = menu[rnd(menu.length)];
        await ctx.db.insert('soldOutEvents', { orgId, menuItemId: it._id, menuName: it.name, at: ts(d, pickHour(), rnd(60)) });
        createdSoldOuts++;
      }
      const covers = 6 + rnd(9); // 6〜14 組/日
      for (let c = 0; c < covers; c++) {
        const table = tables[rnd(tables.length)];
        const openedAt = ts(d, pickHour(), rnd(30));
        const partySize = table.seats >= 4 ? 2 + rnd(3) : 1 + rnd(2);
        const sessionId: Id<'tableSessions'> = await ctx.db.insert('tableSessions', {
          orgId,
          tableId: table._id,
          openedAt,
          partySize,
        });

        const nLines = 2 + rnd(4); // 2〜5 明細
        let lastServed = openedAt;
        let bill = 0;
        for (let li = 0; li < nLines; li++) {
          const it = menu[rnd(menu.length)];
          const qty = 1 + rnd(2);
          const orderedAt = openedAt + (3 + li * 4 + rnd(4)) * MIN; // 数分おきに注文
          const serveMin = it.serveAsap ? 1 + rnd(5) : 6 + rnd(16); // ドリンク等は速い・料理は遅い
          const servedAt = orderedAt + serveMin * MIN;
          if (servedAt > lastServed) lastServed = servedAt;
          bill += (it.price ?? 0) * qty;
          await ctx.db.insert('orderLines', {
            orgId,
            tableSessionId: sessionId,
            menuItemId: it._id,
            menuName: it.name,
            category: it.category,
            unitPrice: it.price,
            qty,
            orderedAt,
            servedAt,
            actor: 'history',
          });
          createdLines++;
        }
        // 提供後 20〜70 分で会計・退店（過去なので closedAt を設定し succeeded に）。未来時刻は避ける。
        const closedAt = Math.min(lastServed + (20 + rnd(50)) * MIN, now - MIN);
        await ctx.db.patch(sessionId, { settleStatus: 'succeeded', finalChargeAmount: bill, billTotal: bill, closedAt });
        createdSessions++;

        // 会計後アンケート（約6割が回答）。満足度は高め・客層はリアルめに分布。
        if (Math.random() < 0.6) {
          const rs = Math.random();
          const satisfaction = rs < 0.45 ? 5 : rs < 0.78 ? 4 : rs < 0.92 ? 3 : rs < 0.98 ? 2 : 1;
          const rg = Math.random();
          const gender = rg < 0.46 ? 'male' : rg < 0.96 ? 'female' : 'other';
          const ageGroup = ['20', '30', '40', '20', '30', '50', '10', '60'][rnd(8)];
          const rv = Math.random();
          const revisit = rv < 0.55 ? 'high' : rv < 0.88 ? 'mid' : 'low';
          await ctx.db.insert('surveys', { orgId, tableSessionId: sessionId, satisfaction, gender, ageGroup, revisit, at: closedAt });
          createdSurveys++;
        }
      }
    }
    return { ok: true as const, days, createdSessions, createdLines, createdSoldOuts, createdSurveys };
  },
});

// 稼働データ（セッション・注文）を消して在庫を戻す。マスタ（店舗・卓・メニュー）は残す。
export const resetDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    for (const s of await ctx.db
      .query('tableSessions')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect()) {
      const lines = await ctx.db
        .query('orderLines')
        .withIndex('by_tableSession', (q) => q.eq('tableSessionId', s._id))
        .collect();
      for (const l of lines) await ctx.db.delete(l._id);
      await ctx.db.delete(s._id);
    }
    // 品切れ（機会損失）イベントも消す。
    for (const e of await ctx.db
      .query('soldOutEvents')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect()) {
      await ctx.db.delete(e._id);
    }
    // アンケート回答も消す。
    for (const sv of await ctx.db
      .query('surveys')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect()) {
      await ctx.db.delete(sv._id);
    }
    // 清掃中フラグも解除（全卓を空席に戻す）
    for (const t of await ctx.db
      .query('tables')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect()) {
      if (t.cleaning) await ctx.db.patch(t._id, { cleaning: undefined });
    }
    // 在庫を初期値へ戻す
    const byCode = new Map(MENU.map((m) => [m.code, m]));
    for (const m of await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect()) {
      const seed = m.code != null ? byCode.get(m.code) : undefined;
      await ctx.db.patch(m._id, { stock: seed?.stock });
    }
    return { ok: true };
  },
});

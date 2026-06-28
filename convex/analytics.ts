import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireOrgId } from './auth';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // Convex は UTC で動くので JST に補正してから「時」を取る
const DAY_MS = 24 * 60 * 60 * 1000;

// 全体サマリ＋セッション別ログ（スタッフ・自店舗）。
// 集計カラムは持たず tableSessions / orderLines から毎回導出（イベントソーシング）。
// 滞在時間は「現在時刻」を要する（営業中の卓）ため、ここでは生のタイムスタンプを返し、
// 滞在の算出はクライアント側（now を持つ）に任せる。提供時間など絶対値はここで集計。
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const sessions = await ctx.db
      .query('tableSessions')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();

    let sales = 0;
    let serveSum = 0;
    let serveCount = 0;
    let firstSum = 0;
    let firstCount = 0;

    const rows = await Promise.all(
      sessions.map(async (s) => {
        const table = await ctx.db.get(s.tableId);
        const lines = await ctx.db
          .query('orderLines')
          .withIndex('by_tableSession', (q) => q.eq('tableSessionId', s._id))
          .collect();
        let bill = 0;
        let qty = 0;
        let firstOrderAt: number | null = null;
        for (const l of lines) {
          bill += (l.unitPrice ?? 0) * l.qty;
          qty += l.qty;
          firstOrderAt = firstOrderAt === null ? l.orderedAt : Math.min(firstOrderAt, l.orderedAt);
          if (l.servedAt !== undefined) {
            serveSum += (l.servedAt - l.orderedAt) * l.qty;
            serveCount += l.qty;
          }
        }
        sales += bill;
        if (firstOrderAt !== null) {
          firstSum += firstOrderAt - s.openedAt;
          firstCount += 1;
        }
        return {
          id: s._id,
          label: table?.label ?? '—',
          openedAt: s.openedAt,
          closedAt: s.closedAt ?? null,
          firstOrderAt,
          qty,
          bill,
          settleStatus: s.settleStatus ?? null,
        };
      }),
    );
    rows.sort((a, b) => b.openedAt - a.openedAt);

    return {
      sessions: rows,
      groups: sessions.length,
      sales,
      avgServeMs: serveCount > 0 ? Math.round(serveSum / serveCount) : null,
      avgFirstMs: firstCount > 0 ? Math.round(firstSum / firstCount) : null,
      servedQty: serveCount,
    };
  },
});

// 商品別の提供時間サマリ（realtime-reservation から移植）。
// 提供時間 = servedAt - orderedAt。未提供は平均に入れない。アラカルト(都度)を先に・遅い順。
export const menuServeStats = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const lines = await ctx.db
      .query('orderLines')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const menu = await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const asapMap = new Map<string, boolean>();
    const codeMap = new Map<string, number | null>();
    for (const m of menu) {
      asapMap.set(m._id, m.serveAsap ?? false);
      codeMap.set(m._id, m.code ?? null);
    }

    type Group = { menuName: string; code: number | null; serveAsap: boolean; orderedCount: number; servedCount: number; durations: number[] };
    const groups = new Map<string, Group>();
    for (const l of lines) {
      const key = l.menuItemId;
      let g = groups.get(key);
      if (!g) {
        g = { menuName: l.menuName, code: codeMap.get(l.menuItemId) ?? null, serveAsap: asapMap.get(l.menuItemId) ?? false, orderedCount: 0, servedCount: 0, durations: [] };
        groups.set(key, g);
      }
      g.menuName = l.menuName;
      g.orderedCount += 1;
      if (l.servedAt !== undefined) {
        g.servedCount += 1;
        g.durations.push(l.servedAt - l.orderedAt);
      }
    }

    const rows = [...groups.values()].map((g) => {
      const n = g.durations.length;
      return {
        menuName: g.menuName,
        code: g.code,
        serveAsap: g.serveAsap,
        orderedCount: g.orderedCount,
        servedCount: g.servedCount,
        pendingCount: g.orderedCount - g.servedCount,
        avgMs: n > 0 ? Math.round(g.durations.reduce((a, b) => a + b, 0) / n) : null,
        maxMs: n > 0 ? Math.max(...g.durations) : null,
      };
    });

    rows.sort((a, b) => {
      if (a.serveAsap !== b.serveAsap) return a.serveAsap ? -1 : 1;
      if (a.avgMs === null && b.avgMs === null) return a.menuName.localeCompare(b.menuName);
      if (a.avgMs === null) return 1;
      if (b.avgMs === null) return -1;
      return b.avgMs - a.avgMs;
    });
    return rows;
  },
});

// 時間帯別の負荷とスピード（realtime-reservation から移植）。
// 注文時刻(orderedAt)を JST の「時」で束ね、注文件数とアラカルト(都度)の平均提供時間を出す。
export const hourlyServeLoad = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrgId(ctx);
    const lines = await ctx.db
      .query('orderLines')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const menu = await ctx.db
      .query('menuItems')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect();
    const asapMap = new Map<string, boolean>();
    for (const m of menu) asapMap.set(m._id, m.serveAsap ?? false);

    type Bucket = { orderedCount: number; asapDurations: number[] };
    const buckets = new Map<number, Bucket>();
    for (const l of lines) {
      const hour = new Date(l.orderedAt + JST_OFFSET_MS).getUTCHours();
      let b = buckets.get(hour);
      if (!b) {
        b = { orderedCount: 0, asapDurations: [] };
        buckets.set(hour, b);
      }
      b.orderedCount += 1;
      const isAsap = asapMap.get(l.menuItemId) ?? false;
      if (isAsap && l.servedAt !== undefined) b.asapDurations.push(l.servedAt - l.orderedAt);
    }

    return [...buckets.entries()]
      .map(([hour, b]) => {
        const n = b.asapDurations.length;
        return { hour, orderedCount: b.orderedCount, asapServedCount: n, avgAsapMs: n > 0 ? Math.round(b.asapDurations.reduce((a, c) => a + c, 0) / n) : null };
      })
      .sort((a, b) => a.hour - b.hour);
  },
});

// 期間切り替え（日別=直近14日 / 月別=直近6ヶ月 / ライブ=当日）の総合レポート。
// KPI・売上推移バケット・品切れ発生・時間帯別・メニュー別・（ライブのみ）セッション別ログを1本で返す。
// すべて tableSessions / orderLines / soldOutEvents のタイムスタンプから都度導出（イベントソーシング）。
const jstDayIndex = (ms: number) => Math.floor((ms + JST_OFFSET_MS) / DAY_MS);
const jstMonthIndex = (ms: number) => {
  const d = new Date(ms + JST_OFFSET_MS);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

export const report = query({
  args: { period: v.union(v.literal('live'), v.literal('day'), v.literal('month')) },
  handler: async (ctx, { period }) => {
    const orgId = await requireOrgId(ctx);
    const now = Date.now();
    const todayIndex = jstDayIndex(now);

    // 期間の開始時刻（JST 補正）。
    let rangeStart: number;
    if (period === 'live') rangeStart = todayIndex * DAY_MS - JST_OFFSET_MS;
    else if (period === 'day') rangeStart = (todayIndex - 13) * DAY_MS - JST_OFFSET_MS;
    else {
      const d = new Date(now + JST_OFFSET_MS);
      rangeStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5, 1) - JST_OFFSET_MS;
    }

    const [allSessions, allLines, allSoldOut, tables, menu] = await Promise.all([
      ctx.db.query('tableSessions').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('orderLines').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('soldOutEvents').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('tables').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('menuItems').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
    ]);
    const tableLabel = new Map(tables.map((t) => [t._id, t.label]));
    const asapMap = new Map(menu.map((m) => [m._id, m.serveAsap ?? false]));
    const codeMap = new Map(menu.map((m) => [m._id, m.code ?? null]));

    const sessions = allSessions.filter((s) => s.openedAt >= rangeStart);
    const sessionIds = new Set(sessions.map((s) => s._id));
    const lines = allLines.filter((l) => sessionIds.has(l.tableSessionId));
    const soldOut = allSoldOut.filter((e) => e.at >= rangeStart);

    const linesBySession = new Map<string, typeof allLines>();
    for (const l of lines) {
      const a = linesBySession.get(l.tableSessionId) ?? [];
      a.push(l);
      linesBySession.set(l.tableSessionId, a);
    }

    // セッションごとの導出値
    type Derived = { sales: number; qty: number; firstOrderAt: number | null; stayMs: number };
    const derived = new Map<string, Derived>();
    for (const s of sessions) {
      const ls = linesBySession.get(s._id) ?? [];
      let sales = 0;
      let qty = 0;
      let firstOrderAt: number | null = null;
      for (const l of ls) {
        sales += (l.unitPrice ?? 0) * l.qty;
        qty += l.qty;
        firstOrderAt = firstOrderAt === null ? l.orderedAt : Math.min(firstOrderAt, l.orderedAt);
      }
      const end = s.closedAt ?? now;
      derived.set(s._id, { sales, qty, firstOrderAt, stayMs: end - s.openedAt });
    }

    // 期間 KPI
    let sales = 0;
    let guests = 0;
    let dishes = 0;
    let stayWSum = 0;
    let firstSum = 0;
    let firstCount = 0;
    for (const s of sessions) {
      const dv = derived.get(s._id)!;
      sales += dv.sales;
      guests += s.partySize ?? 1;
      dishes += dv.qty;
      stayWSum += dv.stayMs;
      if (dv.firstOrderAt !== null) {
        firstSum += dv.firstOrderAt - s.openedAt;
        firstCount += 1;
      }
    }
    let serveSum = 0;
    let serveCount = 0;
    for (const l of lines) {
      if (l.servedAt !== undefined) {
        serveSum += (l.servedAt - l.orderedAt) * l.qty;
        serveCount += l.qty;
      }
    }
    const groups = sessions.length;
    const kpis = {
      sales,
      groups,
      guests,
      perGuest: guests > 0 ? Math.round(sales / guests) : 0,
      avgStayMs: groups > 0 ? Math.round(stayWSum / groups) : null,
      avgServeMs: serveCount > 0 ? Math.round(serveSum / serveCount) : null,
      avgFirstMs: firstCount > 0 ? Math.round(firstSum / firstCount) : null,
      soldOuts: soldOut.length,
    };

    // 売上推移バケット（日別14・月別6。ライブは空）
    type Bucket = { key: string; label: string; sales: number; groups: number; guests: number; dishes: number; avgStayMs: number | null; avgServeMs: number | null; soldOuts: number };
    const trend: Bucket[] = [];
    if (period !== 'live') {
      const isMonth = period === 'month';
      const count = isMonth ? 6 : 14;
      const indexOf = isMonth ? jstMonthIndex : jstDayIndex;
      const curIndex = isMonth ? jstMonthIndex(now) : todayIndex;
      for (let i = count - 1; i >= 0; i--) {
        const idx = curIndex - i;
        let bSales = 0;
        let bGroups = 0;
        let bGuests = 0;
        let bDishes = 0;
        let bStay = 0;
        let bServeSum = 0;
        let bServeCount = 0;
        for (const s of sessions) {
          if (indexOf(s.openedAt) !== idx) continue;
          const dv = derived.get(s._id)!;
          bSales += dv.sales;
          bGroups += 1;
          bGuests += s.partySize ?? 1;
          bDishes += dv.qty;
          bStay += dv.stayMs;
          for (const l of linesBySession.get(s._id) ?? []) {
            if (l.servedAt !== undefined) {
              bServeSum += (l.servedAt - l.orderedAt) * l.qty;
              bServeCount += l.qty;
            }
          }
        }
        const bSoldOuts = soldOut.filter((e) => indexOf(e.at) === idx).length;
        let label: string;
        let key: string;
        if (isMonth) {
          const y = Math.floor(idx / 12);
          const mo = idx % 12;
          label = `${mo + 1}月`;
          key = `m${y}-${mo}`;
        } else {
          const d = new Date(idx * DAY_MS); // idx*DAY は JST 0時を UTC で表す近似（ラベル用）
          label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
          key = `d${idx}`;
        }
        trend.push({
          key,
          label,
          sales: bSales,
          groups: bGroups,
          guests: bGuests,
          dishes: bDishes,
          avgStayMs: bGroups > 0 ? Math.round(bStay / bGroups) : null,
          avgServeMs: bServeCount > 0 ? Math.round(bServeSum / bServeCount) : null,
          soldOuts: bSoldOuts,
        });
      }
    }

    // 時間帯別（orderedAt の JST 時で束ねる）
    const hourBuckets = new Map<number, { orderedCount: number; asapDurations: number[] }>();
    for (const l of lines) {
      const hour = new Date(l.orderedAt + JST_OFFSET_MS).getUTCHours();
      const b = hourBuckets.get(hour) ?? { orderedCount: 0, asapDurations: [] };
      b.orderedCount += 1;
      if ((asapMap.get(l.menuItemId) ?? false) && l.servedAt !== undefined) b.asapDurations.push(l.servedAt - l.orderedAt);
      hourBuckets.set(hour, b);
    }
    const hourly = [...hourBuckets.entries()]
      .map(([hour, b]) => ({ hour, orderedCount: b.orderedCount, asapServedCount: b.asapDurations.length, avgAsapMs: b.asapDurations.length ? Math.round(b.asapDurations.reduce((a, c) => a + c, 0) / b.asapDurations.length) : null }))
      .sort((a, b) => a.hour - b.hour);

    // メニュー別 提供時間
    type Grp = { menuName: string; code: number | null; serveAsap: boolean; orderedCount: number; servedCount: number; durations: number[] };
    const grp = new Map<string, Grp>();
    for (const l of lines) {
      let g = grp.get(l.menuItemId);
      if (!g) {
        g = { menuName: l.menuName, code: codeMap.get(l.menuItemId) ?? null, serveAsap: asapMap.get(l.menuItemId) ?? false, orderedCount: 0, servedCount: 0, durations: [] };
        grp.set(l.menuItemId, g);
      }
      g.menuName = l.menuName;
      g.orderedCount += 1;
      if (l.servedAt !== undefined) {
        g.servedCount += 1;
        g.durations.push(l.servedAt - l.orderedAt);
      }
    }
    const dishesRows = [...grp.values()]
      .map((g) => {
        const n = g.durations.length;
        return { menuName: g.menuName, code: g.code, serveAsap: g.serveAsap, orderedCount: g.orderedCount, servedCount: g.servedCount, pendingCount: g.orderedCount - g.servedCount, avgMs: n ? Math.round(g.durations.reduce((a, b) => a + b, 0) / n) : null, maxMs: n ? Math.max(...g.durations) : null };
      })
      .sort((a, b) => {
        if (a.serveAsap !== b.serveAsap) return a.serveAsap ? -1 : 1;
        if (a.avgMs === null && b.avgMs === null) return a.menuName.localeCompare(b.menuName);
        if (a.avgMs === null) return 1;
        if (b.avgMs === null) return -1;
        return b.avgMs - a.avgMs;
      });

    // セッション別ログ（ライブのみ・滞在はクライアントが now で算出するため生 ts を返す）
    const sessionRows =
      period === 'live'
        ? sessions
            .map((s) => {
              const dv = derived.get(s._id)!;
              return { id: s._id, label: tableLabel.get(s.tableId) ?? '—', openedAt: s.openedAt, closedAt: s.closedAt ?? null, firstOrderAt: dv.firstOrderAt, qty: dv.qty, settleStatus: s.settleStatus ?? null };
            })
            .sort((a, b) => b.openedAt - a.openedAt)
        : [];

    return { period, kpis, trend, hourly, dishes: dishesRows, sessions: sessionRows };
  },
});

import { v } from 'convex/values';
import { query, action } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { api } from './_generated/api';
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

type Period = 'live' | 'day' | 'month';

async function buildReport(ctx: QueryCtx, period: Period) {
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

    const [allSessions, allLines, allSoldOut, tables, menu, allSurveys, allCoupons] = await Promise.all([
      ctx.db.query('tableSessions').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('orderLines').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('soldOutEvents').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('tables').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('menuItems').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('surveys').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
      ctx.db.query('coupons').withIndex('by_orgId', (q) => q.eq('orgId', orgId)).collect(),
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

    // アンケート（客層）サマリ
    const surveys = allSurveys.filter((s) => s.at >= rangeStart);
    let satSum = 0;
    let satCount = 0;
    const gender = { male: 0, female: 0, other: 0 };
    const age: Record<string, number> = { '10': 0, '20': 0, '30': 0, '40': 0, '50': 0, '60': 0 };
    const revisit = { high: 0, mid: 0, low: 0 };
    for (const s of surveys) {
      if (typeof s.satisfaction === 'number') {
        satSum += s.satisfaction;
        satCount += 1;
      }
      if (s.gender === 'male' || s.gender === 'female' || s.gender === 'other') gender[s.gender] += 1;
      if (s.ageGroup && age[s.ageGroup] !== undefined) age[s.ageGroup] += 1;
      if (s.revisit === 'high' || s.revisit === 'mid' || s.revisit === 'low') revisit[s.revisit] += 1;
    }
    // 自由記述（任意回答）。パネル表示と AI ネガポジ分析の入力。新しい順。
    const comments = surveys
      .filter((s) => typeof s.comment === 'string' && s.comment.trim().length > 0)
      .sort((a, b) => b.at - a.at)
      .map((s) => ({ text: s.comment as string, satisfaction: s.satisfaction ?? null, at: s.at }));

    const survey = {
      responses: surveys.length,
      avgSatisfaction: satCount > 0 ? Math.round((satSum / satCount) * 10) / 10 : null,
      gender,
      age,
      revisit,
      commentCount: comments.length,
    };

    // 品切れ（機会損失）の商品別集計（インサイトで「特に◯◯」を出すため）。
    const soldOutMap = new Map<string, number>();
    for (const e of soldOut) soldOutMap.set(e.menuName, (soldOutMap.get(e.menuName) ?? 0) + 1);
    const soldOutByMenu = [...soldOutMap.entries()]
      .map(([menuName, count]) => ({ menuName, count }))
      .sort((a, b) => b.count - a.count);

    // クーポン・リピート（クーポンコード＝同一客の橋渡し。利用したセッション＝再来客）。
    // 発行数＝期間内に発行されたクーポン、利用数＝期間内に利用されたクーポン、
    // 利用率＝利用数/発行数、リピート率＝期間内の会計組のうちクーポンを利用した割合。
    const issued = allCoupons.filter((c) => c.issuedAt >= rangeStart).length;
    const redeemed = allCoupons.filter((c) => c.redeemedAt !== undefined && c.redeemedAt >= rangeStart).length;
    const repeatSessionIds = new Set<string>();
    for (const c of allCoupons) {
      if (c.redeemedSessionId && sessionIds.has(c.redeemedSessionId)) repeatSessionIds.add(c.redeemedSessionId);
    }
    const repeatSessions = repeatSessionIds.size;
    const coupon = {
      issued,
      redeemed,
      redemptionRate: issued > 0 ? Math.round((redeemed / issued) * 1000) / 10 : null,
      repeatSessions,
      repeatRate: groups > 0 ? Math.round((repeatSessions / groups) * 1000) / 10 : null,
    };

    return { period, kpis, trend, hourly, dishes: dishesRows, sessions: sessionRows, survey, coupon, soldOutByMenu, comments };
}

export const report = query({
  args: { period: v.union(v.literal('live'), v.literal('day'), v.literal('month')) },
  handler: async (ctx, { period }) => buildReport(ctx, period),
});

// インサイト発掘（ルールベース）。揃った軸（売上・時間帯・メニュー・提供時間・品切れ・客層・
// 満足度・クーポン/リピート）を掛け合わせ、「気づき＋打ち手」を自動で並べる。LLM は使わない。
type Finding = { id: string; kind: 'warn' | 'good' | 'info'; title: string; body: string; action: string };

function deriveFindings(r: Awaited<ReturnType<typeof buildReport>>): Finding[] {
  const f: Finding[] = [];
  const min = (ms: number) => Math.round(ms / 60000);
  const yenS = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');

  // 品切れ（機会損失）
  if (r.kpis.soldOuts > 0) {
    const top = r.soldOutByMenu[0];
    f.push({
      id: 'soldout',
      kind: 'warn',
      title: `品切れが ${r.kpis.soldOuts} 件発生`,
      body: top ? `特に「${top.menuName}」が ${top.count} 件。注文できずに離脱した機会損失。` : '注文できずに離脱した機会損失。',
      action: '人気品の在庫を増やすか、品切れ時は早めに一覧から隠す。',
    });
  }

  // 提供が遅い料理（アラカルト以外・3件以上提供・平均15分超）
  const slow = r.dishes
    .filter((d) => !d.serveAsap && d.avgMs != null && d.servedCount >= 3)
    .sort((a, b) => (b.avgMs ?? 0) - (a.avgMs ?? 0))[0];
  if (slow && slow.avgMs != null && slow.avgMs > 15 * 60000) {
    f.push({
      id: 'slow',
      kind: 'warn',
      title: `「${slow.menuName}」の提供が平均 ${min(slow.avgMs)} 分`,
      body: '提供が遅いと回転と満足度が落ちる。',
      action: '仕込みの前倒し、提供順の見直し、品数の調整を検討。',
    });
  }

  // 着席から初回注文までが長い
  if (r.kpis.avgFirstMs != null && r.kpis.avgFirstMs > 10 * 60000) {
    f.push({
      id: 'first-slow',
      kind: 'warn',
      title: `着席から初回注文まで平均 ${min(r.kpis.avgFirstMs)} 分`,
      body: '最初の注文までが長いと滞在の体感が悪化する。',
      action: 'メニューの見やすさ・呼び出し導線・最初の一声を改善。',
    });
  }

  // ピーク時間帯 / 暇な時間帯
  if (r.hourly.length) {
    const byCount = r.hourly.slice().sort((a, b) => b.orderedCount - a.orderedCount);
    const peak = byCount[0];
    f.push({
      id: 'peak',
      kind: 'info',
      title: `${peak.hour} 時台が最も注文が多い（${peak.orderedCount} 件）`,
      body: 'この時間に注文が集中している。',
      action: 'ピーク前に人員と仕込みを厚くして提供の遅れを防ぐ。',
    });
    if (r.hourly.length >= 3) {
      const idle = r.hourly
        .filter((h) => h.orderedCount > 0 && h.orderedCount <= peak.orderedCount * 0.2)
        .sort((a, b) => a.orderedCount - b.orderedCount)[0];
      if (idle) {
        f.push({
          id: 'idle',
          kind: 'info',
          title: `${idle.hour} 時台は注文が少ない（${idle.orderedCount} 件）`,
          body: '空いている時間帯。',
          action: 'この時間限定のクーポンやタイムセールで集客を狙える。',
        });
      }
    }
  }

  // リピート率
  if (r.coupon.repeatRate != null) {
    if (r.coupon.repeatRate >= 25) {
      f.push({ id: 'repeat-good', kind: 'good', title: `リピート率 ${r.coupon.repeatRate}%`, body: 'クーポン経由の再来が定着している。', action: 'クーポンの配布と会計時の案内を継続。' });
    } else if (r.coupon.repeatRate < 12) {
      f.push({ id: 'repeat-low', kind: 'warn', title: `リピート率 ${r.coupon.repeatRate}%`, body: '再来が少ない。', action: '会計時にクーポンを口頭で案内し、次回来店の動機を強める。' });
    }
  }

  // クーポン利用率
  if (r.coupon.issued > 0 && r.coupon.redemptionRate != null && r.coupon.redemptionRate < 20) {
    f.push({
      id: 'coupon-low',
      kind: 'info',
      title: `クーポン利用率 ${r.coupon.redemptionRate}%`,
      body: `${r.coupon.issued} 枚配って ${r.coupon.redeemed} 枚利用。`,
      action: 'コードを会計レシートやテーブルPOPで見せ、使い方を明確に。',
    });
  }

  // 満足度
  if (r.survey.responses >= 5 && r.survey.avgSatisfaction != null) {
    if (r.survey.avgSatisfaction >= 4.3) {
      f.push({ id: 'sat-good', kind: 'good', title: `満足度 ${r.survey.avgSatisfaction}（${r.survey.responses} 件）`, body: '高い満足度を維持している。', action: '好評の要因を残しつつ、低評価の声を個別に確認。' });
    } else if (r.survey.avgSatisfaction < 3.5) {
      f.push({ id: 'sat-low', kind: 'warn', title: `満足度 ${r.survey.avgSatisfaction}（${r.survey.responses} 件）`, body: '満足度が低め。', action: '提供時間・接客・味のどれが要因か、提供データと突き合わせる。' });
    }
  }

  // 客層の中心
  if (r.survey.responses >= 5) {
    const topAge = Object.entries(r.survey.age).sort((a, b) => b[1] - a[1])[0];
    const topGender = Object.entries(r.survey.gender).sort((a, b) => b[1] - a[1])[0];
    if (topAge && topAge[1] > 0) {
      const gLabel = topGender && topGender[1] > 0 ? ({ male: '男性', female: '女性', other: 'その他' } as Record<string, string>)[topGender[0]] : '';
      f.push({
        id: 'demo',
        kind: 'info',
        title: `来店の中心は ${topAge[0]}代${gLabel ? '・' + gLabel : ''}`,
        body: '客層に偏りがある。',
        action: '中心層に響くメニューや時間帯販促を設計。取り込みたい層への施策も検討。',
      });
    }
  }

  // 客単価（参考）
  if (r.kpis.guests > 0) {
    f.push({
      id: 'perguest',
      kind: 'info',
      title: `客単価 ${yenS(r.kpis.perGuest)}`,
      body: `売上 ${yenS(r.kpis.sales)} / 客数 ${r.kpis.guests} 人。`,
      action: 'もう一品の提案（ドリンク・デザート）で単価を底上げ。',
    });
  }

  const order = { warn: 0, good: 1, info: 2 };
  f.sort((a, b) => order[a.kind] - order[b.kind]);
  return f;
}

export const insights = query({
  args: { period: v.union(v.literal('live'), v.literal('day'), v.literal('month')) },
  handler: async (ctx, { period }) => {
    const r = await buildReport(ctx, period);
    return { period, findings: deriveFindings(r), groups: r.kpis.groups };
  },
});

// インサイト第2層（任意・LLM要約）。集計＋findings を Anthropic に渡し「店長向けのまとめ」を自然文で返す。
// ANTHROPIC_API_KEY（Convex env・本人設定）が無ければ status:'no_key' を返してフロントは案内表示に切替。
// fetch のみなので default runtime（'use node' 不要）。コスト配慮でフロントはボタン押下のオンデマンド実行。
export const summarize = action({
  args: { period: v.union(v.literal('live'), v.literal('day'), v.literal('month')) },
  handler: async (
    ctx,
    { period },
  ): Promise<
    | { status: 'no_key' }
    | { status: 'ok'; summary: string; model: string }
    | { status: 'error'; message: string }
  > => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { status: 'no_key' as const };
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';

    const [report, ins] = await Promise.all([
      ctx.runQuery(api.analytics.report, { period }),
      ctx.runQuery(api.analytics.insights, { period }),
    ]);
    if (ins.groups === 0) {
      return { status: 'error' as const, message: 'この期間のデータがありません。' };
    }

    const periodLabel = period === 'month' ? '直近6ヶ月' : period === 'day' ? '直近14日' : '本日';
    const minOf = (ms: number | null) => (ms == null ? null : Math.round(ms / 60000));
    const data = {
      期間: periodLabel,
      売上: report.kpis.sales,
      組数: report.kpis.groups,
      客数: report.kpis.guests,
      客単価: report.kpis.perGuest,
      平均滞在分: minOf(report.kpis.avgStayMs),
      平均提供分: minOf(report.kpis.avgServeMs),
      着席から初回注文分: minOf(report.kpis.avgFirstMs),
      品切れ件数: report.kpis.soldOuts,
      クーポン: { 発行: report.coupon.issued, 利用: report.coupon.redeemed, 利用率: report.coupon.redemptionRate, リピート率: report.coupon.repeatRate },
      アンケート: { 回答数: report.survey.responses, 平均満足度: report.survey.avgSatisfaction, 男女: report.survey.gender, 年代: report.survey.age, 再来意向: report.survey.revisit },
      人気メニュー: report.dishes.slice().sort((a, b) => b.orderedCount - a.orderedCount).slice(0, 5).map((d) => ({ 名前: d.menuName, 注文数: d.orderedCount, 平均提供分: minOf(d.avgMs) })),
      時間帯: report.hourly.map((h) => ({ 時: h.hour, 注文数: h.orderedCount })),
      品切れ商品: report.soldOutByMenu.slice(0, 5),
      自動抽出した気づき: ins.findings.map((x) => ({ 種別: x.kind, 見出し: x.title, 打ち手: x.action })),
    };

    const prompt =
      'あなたは飲食店の経営を支援するアナリストです。以下は1店舗の' +
      periodLabel +
      'の集計データ（JSON）です。店長（ITに詳しくない料理人）に向けて、日本語で要約してください。\n' +
      '制約:\n' +
      '- 最初に2〜3文で全体の状況（よかった点・気になる点）。\n' +
      '- 次に「今やるべき打ち手」を重要な順に3つ、箇条書き（各1行・具体的に）。\n' +
      '- 専門用語・マークダウンの見出し記号は使わない。数値は具体的に引用する。\n' +
      '- 推測が必要な箇所は断定しない。\n\n' +
      'データ:\n' +
      JSON.stringify(data, null, 2);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        return { status: 'error' as const, message: `AI 呼び出しに失敗しました（${res.status}）。${text.slice(0, 160)}` };
      }
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const summary = (json.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (!summary) return { status: 'error' as const, message: 'AI から空の応答が返りました。' };
      return { status: 'ok' as const, summary, model };
    } catch (err) {
      return { status: 'error' as const, message: err instanceof Error ? err.message : 'AI 呼び出しでエラーが発生しました。' };
    }
  },
});

// 自由記述（アンケートのコメント）の AI ネガポジ分析＋要約。
// 各コメントをポジ/ネガ/中立に分類し件数・代表コメント・全体まとめを返す。鍵が無ければ no_key。
type Sentiment = 'positive' | 'negative' | 'neutral';
export const analyzeComments = action({
  args: { period: v.union(v.literal('live'), v.literal('day'), v.literal('month')) },
  handler: async (
    ctx,
    { period },
  ): Promise<
    | { status: 'no_key' }
    | { status: 'empty' }
    | { status: 'error'; message: string }
    | { status: 'ok'; model: string; total: number; counts: Record<Sentiment, number>; summary: string; highlights: Array<{ sentiment: Sentiment; text: string }> }
  > => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { status: 'no_key' as const };
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';

    const report = await ctx.runQuery(api.analytics.report, { period });
    const comments = report.comments.slice(0, 80); // トークン上限対策（新しい順80件）
    if (comments.length === 0) return { status: 'empty' as const };

    const list = comments.map((c, i) => `${i + 1}. ${c.text.replace(/\n/g, ' ')}`).join('\n');
    const prompt =
      'あなたは飲食店のアナリストです。以下はお客様の自由記述アンケート（番号付き）です。\n' +
      '各コメントを positive / negative / neutral のいずれかに分類し、結果を JSON のみで返してください（前後に説明文やマークダウンは付けない）。\n' +
      'JSON の形式:\n' +
      '{\n' +
      '  "counts": { "positive": 数, "negative": 数, "neutral": 数 },\n' +
      '  "summary": "全体傾向を日本語2〜3文で。良い点と改善点を具体的に。",\n' +
      '  "highlights": [ { "sentiment": "positive|negative|neutral", "text": "..." } ]\n' +
      '}\n' +
      'highlights には代表的な声を必ず3〜4件、コメントの原文ママで入れること（ポジ・ネガ両方を含める）。\n\n' +
      'コメント:\n' +
      list;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) {
        const text = await res.text();
        return { status: 'error' as const, message: `AI 呼び出しに失敗しました（${res.status}）。${text.slice(0, 160)}` };
      }
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const raw = (json.content ?? []).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('').trim();
      // JSON 部分を抽出（モデルが前後に文字を付けても拾えるように）。
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1) return { status: 'error' as const, message: 'AI の応答を解釈できませんでした。' };
      let parsed: { counts?: Partial<Record<Sentiment, number>>; summary?: string; highlights?: Array<{ sentiment?: string; text?: string }> };
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch {
        return { status: 'error' as const, message: 'AI の応答（JSON）を解析できませんでした。' };
      }
      const counts: Record<Sentiment, number> = {
        positive: Number(parsed.counts?.positive ?? 0) || 0,
        negative: Number(parsed.counts?.negative ?? 0) || 0,
        neutral: Number(parsed.counts?.neutral ?? 0) || 0,
      };
      const norm = (s: string | undefined): Sentiment => (s === 'positive' || s === 'negative' || s === 'neutral' ? s : 'neutral');
      const highlights = (parsed.highlights ?? [])
        .filter((h) => typeof h.text === 'string' && h.text.trim().length > 0)
        .slice(0, 4)
        .map((h) => ({ sentiment: norm(h.sentiment), text: (h.text as string).trim() }));
      return { status: 'ok' as const, model, total: comments.length, counts, summary: (parsed.summary ?? '').trim(), highlights };
    } catch (err) {
      return { status: 'error' as const, message: err instanceof Error ? err.message : 'AI 呼び出しでエラーが発生しました。' };
    }
  },
});

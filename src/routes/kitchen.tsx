import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { css } from '../lib/css';
import { clock, dur } from '../lib/format';

export const Route = createFileRoute('/kitchen')({
  component: KitchenPage,
});

type BoardLine = {
  _id: string;
  menuItemId: string;
  code: number | null;
  menuName: string;
  qty: number;
  orderedAt: number;
  servedAt: number | null;
  serveAsap: boolean;
};
type BoardCard = {
  sessionId: string;
  tableLabel: string;
  seats: number;
  openedAt: number;
  settleStatus: string | null;
  lines: BoardLine[];
};

function KitchenPage() {
  const { data } = useQuery(convexQuery(api.kitchen.board, {}));
  const serveItem = useMutation(api.kitchen.serveItem);
  const unserveItem = useMutation(api.kitchen.unserveItem);
  const serveAllSession = useMutation(api.kitchen.serveAllSession);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const board = (data ?? []) as BoardCard[];

  // 1卓 = 1カード。served=true で提供済みカードを構築（demo KitchenView を移植）。
  const buildCard = (sess: BoardCard, served: boolean) => {
    const agg: Record<string, { menuItemId: string; code: number | null; name: string; qty: number; asap: boolean; firstAt: number; lastServedAt: number }> = {};
    let earliest = Infinity,
      latestServed = 0,
      anyNew = false;
    for (const l of sess.lines) {
      if ((l.servedAt != null) !== served) continue;
      const k = l.menuItemId;
      if (!agg[k]) agg[k] = { menuItemId: l.menuItemId, code: l.code, name: l.menuName, qty: 0, asap: l.serveAsap, firstAt: l.orderedAt, lastServedAt: 0 };
      agg[k].qty += l.qty;
      agg[k].firstAt = Math.min(agg[k].firstAt, l.orderedAt);
      if (l.servedAt != null) agg[k].lastServedAt = Math.max(agg[k].lastServedAt, l.servedAt);
      if (!served) {
        earliest = Math.min(earliest, l.orderedAt);
        if (now - l.orderedAt < 4000) anyNew = true;
      }
      if (served && l.servedAt != null) latestServed = Math.max(latestServed, l.servedAt);
    }
    const items = Object.values(agg).sort((a, b) => a.firstAt - b.firstAt || (a.code ?? 0) - (b.code ?? 0));
    if (!items.length) return null;
    const orderAt = earliest === Infinity ? sess.openedAt : earliest;
    const ageMs = now - orderAt;
    const urgent = !served && ageMs > 8 * 60000;
    const lines = items.map((it) => {
      const lineMs = served ? Math.max(0, it.lastServedAt - it.firstAt) : now - it.firstAt;
      const lineUrgent = !served && lineMs > 8 * 60000;
      return {
        menuItemId: it.menuItemId,
        code: it.code,
        name: it.name,
        qty: it.qty,
        asap: it.asap,
        checkMark: served ? '✓' : '',
        timeText: dur(lineMs),
        timeLabel: served ? '提供' : '経過',
        timeStyle: `white-space:nowrap; flex:0 0 auto; font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; padding:1px 5px; border-radius:2px; color:${served ? '#15803d' : lineUrgent ? '#b45309' : '#64748b'}; background:${served ? '#eaf5ee' : lineUrgent ? '#fdeccd' : '#f1f5f9'};`,
        rowStyle: `display:flex; align-items:center; gap:8px; padding:8px 9px; border-radius:2px; border:1px solid ${served ? '#d7e3da' : '#cbd5e1'}; background:${served ? '#f1f6f2' : '#fff'}; cursor:pointer;`,
        nameStyle: `flex:1; min-width:0; font-size:14px; font-weight:600; color:${served ? '#94a3b8' : '#171717'}; text-decoration:${served ? 'line-through' : 'none'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`,
        checkStyle: `width:20px; height:20px; border-radius:2px; border:1.5px solid ${served ? '#15803d' : '#cbd5e1'}; background:${served ? '#15803d' : '#fff'}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; flex:0 0 auto;`,
      };
    });
    return {
      id: sess.sessionId + (served ? '_s' : '_c'),
      sessionId: sess.sessionId,
      tableLabel: sess.tableLabel,
      urgent,
      sortKey: served ? -latestServed : orderAt,
      seatedClock: clock(sess.openedAt),
      seatedDur: dur(now - sess.openedAt),
      orderClock: clock(orderAt),
      orderElapsed: dur(ageMs),
      orderElapsedStyle: `font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; color:${urgent ? '#b45309' : '#171717'};`,
      cardStyle: `display:flex; flex-direction:column; gap:9px; padding:11px; border-radius:2px; border:1px solid ${urgent ? '#f0b357' : served ? '#dbe4dd' : '#cbd5e1'}; border-left:3px solid ${served ? '#16a34a' : urgent ? '#d97706' : '#1d4ed8'}; background:#fff; opacity:${served ? 0.82 : 1}; ${anyNew ? 'animation:lampoFlash 2.4s ease-out;' : ''}`,
      lines,
    };
  };

  const cooking = board
    .map((se) => buildCard(se, false))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.sortKey - b.sortKey);
  const served = board
    .map((se) => buildCard(se, true))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.sortKey - b.sortKey);
  const unserved = board.reduce((a, se) => a + se.lines.filter((l) => l.servedAt == null).reduce((x, l) => x + l.qty, 0), 0);

  const tap = (served: boolean, sessionId: string, menuItemId: string) =>
    served
      ? unserveItem({ sessionId: sessionId as Id<'tableSessions'>, menuItemId: menuItemId as Id<'menuItems'> })
      : serveItem({ sessionId: sessionId as Id<'tableSessions'>, menuItemId: menuItemId as Id<'menuItems'> });

  return (
    <main style={css('height:100vh; display:flex; flex-direction:column; background:#f4f5f7;')}>
      <div style={css('flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 16px; background:#fff; border-bottom:1px solid #cbd5e1;')}>
        <div style={css('display:flex; align-items:center; gap:10px;')}>
          <Link to="/" style={css('font-size:12px; color:#94a3b8; text-decoration:none;')}>← 入口</Link>
          <span style={css('font-size:15px; font-weight:700; color:#171717;')}>キッチン KDS</span>
          <span style={css('font-size:11px; color:#94a3b8;')}>注文を購読・新着は自動表示</span>
        </div>
        <span style={css('font-size:11px; color:#64748b;')}>未提供 <b className="tnum" style={css('color:#1d4ed8; font-size:14px;')}>{unserved}</b> 品</span>
      </div>

      <div style={css('flex:1 1 auto; min-height:0; display:flex; padding:14px; gap:14px;')}>
        {/* 調理中 */}
        <div style={css('flex:1 1 0; min-width:0; display:flex; flex-direction:column; background:#fff; border:1px solid #cbd5e1; border-radius:2px; overflow:hidden;')}>
          <div style={css('flex:0 0 auto; display:flex; align-items:center; gap:7px; padding:9px 13px; border-bottom:1px solid #e2e8f0; background:#f0f4fb;')}>
            <span style={css('width:8px; height:8px; border-radius:50%; background:#1d4ed8;')} />
            <span style={css('font-size:12px; font-weight:700; color:#171717;')}>調理中</span>
            <span className="tnum" style={css('font-size:12px; font-weight:700; color:#1d4ed8;')}>{cooking.length}</span>
            <span style={css('flex:1;')} />
            <span style={css('font-size:10px; color:#94a3b8;')}>古い注文が上</span>
          </div>
          <div style={css('flex:1 1 auto; min-height:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px;')}>
            {cooking.length === 0 && (
              <div style={css('padding:24px 8px; text-align:center; font-size:12px; color:#94a3b8;')}>調理中の注文はありません</div>
            )}
            {cooking.map((tk) => (
              <div key={tk.id} style={css(tk.cardStyle)}>
                <div style={css('display:flex; align-items:center; justify-content:space-between; gap:8px;')}>
                  <span style={css('white-space:nowrap; font-size:17px; font-weight:700; color:#171717; line-height:1;')}>卓 {tk.tableLabel}</span>
                  <span style={css(tk.orderElapsedStyle)}>{tk.orderElapsed}</span>
                </div>
                <div style={css('display:flex; flex-direction:column; gap:3px; padding:6px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:2px; font-size:11px;')}>
                  <div style={css('white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}><span style={css('color:#94a3b8;')}>着席 </span><span className="tnum" style={css('color:#475569;')}>{tk.seatedClock}・滞在{tk.seatedDur}</span></div>
                  <div style={css('white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}><span style={css('color:#1d4ed8; font-weight:700;')}>注文 </span><span className="tnum" style={css('color:#171717; font-weight:700;')}>{tk.orderClock}・{tk.orderElapsed}経過</span></div>
                </div>
                <div style={css('display:flex; flex-direction:column; gap:6px;')}>
                  {tk.lines.map((ln) => (
                    <div key={ln.menuItemId} onClick={() => tap(false, tk.sessionId, ln.menuItemId)} style={css(ln.rowStyle)}>
                      <span style={css(ln.checkStyle)}>{ln.checkMark}</span>
                      <span className="tnum" style={css('font-size:11px; color:#94a3b8; width:34px; flex:0 0 auto;')}>{ln.code ?? ''}</span>
                      <span style={css(ln.nameStyle)}>{ln.name}</span>
                      {ln.asap && <span style={css('font-size:9px; font-weight:700; color:#1d4ed8; background:#eff6ff; border-radius:2px; padding:1px 5px;')}>アラカルト</span>}
                      <span style={css(ln.timeStyle)}>{ln.timeLabel} {ln.timeText}</span>
                      <span className="tnum" style={css('font-size:15px; font-weight:700; color:#171717; flex:0 0 auto;')}>×{ln.qty}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => serveAllSession({ sessionId: tk.sessionId as Id<'tableSessions'> })} style={css('width:100%; height:34px; padding:0 12px; border-radius:2px; border:1px solid #171717; background:#171717; color:#fff; font-size:12px; font-weight:700;')}>全品 提供済にする</button>
              </div>
            ))}
          </div>
        </div>

        {/* 提供済み */}
        <div style={css('flex:1 1 0; min-width:0; display:flex; flex-direction:column; background:#f7f9f8; border:1px solid #cbd5e1; border-radius:2px; overflow:hidden;')}>
          <div style={css('flex:0 0 auto; display:flex; align-items:center; gap:7px; padding:9px 13px; border-bottom:1px solid #e2e8f0; background:#eef5f0;')}>
            <span style={css('width:8px; height:8px; border-radius:50%; background:#16a34a;')} />
            <span style={css('font-size:12px; font-weight:700; color:#171717;')}>提供済み</span>
            <span className="tnum" style={css('font-size:12px; font-weight:700; color:#15803d;')}>{served.length}</span>
          </div>
          <div style={css('flex:1 1 auto; min-height:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px;')}>
            {served.length === 0 && (
              <div style={css('padding:24px 8px; text-align:center; font-size:12px; color:#94a3b8;')}>まだ提供済みはありません</div>
            )}
            {served.map((tk) => (
              <div key={tk.id} style={css(tk.cardStyle)}>
                <div style={css('display:flex; align-items:center; justify-content:space-between; gap:8px;')}>
                  <span style={css('white-space:nowrap; font-size:17px; font-weight:700; color:#171717; line-height:1;')}>卓 {tk.tableLabel}</span>
                  <span style={css('font-size:11px; font-weight:700; color:#15803d;')}>✓ 提供済み</span>
                </div>
                <div style={css('display:flex; flex-direction:column; gap:6px;')}>
                  {tk.lines.map((ln) => (
                    <div key={ln.menuItemId} onClick={() => tap(true, tk.sessionId, ln.menuItemId)} style={css(ln.rowStyle)}>
                      <span style={css(ln.checkStyle)}>{ln.checkMark}</span>
                      <span className="tnum" style={css('font-size:11px; color:#94a3b8; width:34px; flex:0 0 auto;')}>{ln.code ?? ''}</span>
                      <span style={css(ln.nameStyle)}>{ln.name}</span>
                      <span style={css(ln.timeStyle)}>{ln.timeLabel} {ln.timeText}</span>
                      <span className="tnum" style={css('font-size:15px; font-weight:700; color:#94a3b8; flex:0 0 auto;')}>×{ln.qty}</span>
                    </div>
                  ))}
                </div>
                <div style={css('font-size:10px; color:#94a3b8;')}>タップで調理中に戻せます</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

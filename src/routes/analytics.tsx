import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from 'convex/react';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import { css } from '../lib/css';
import { yen, dur, clock } from '../lib/format';

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
});

type Overview = {
  sessions: { id: string; label: string; openedAt: number; closedAt: number | null; firstOrderAt: number | null; qty: number; bill: number; settleStatus: string | null }[];
  groups: number;
  sales: number;
  avgServeMs: number | null;
  avgFirstMs: number | null;
  servedQty: number;
};
type MenuStat = { menuName: string; code: number | null; serveAsap: boolean; orderedCount: number; servedCount: number; pendingCount: number; avgMs: number | null; maxMs: number | null };
type Hourly = { hour: number; orderedCount: number; asapServedCount: number; avgAsapMs: number | null };

function AnalyticsPage() {
  const { data: ov } = useQuery(convexQuery(api.analytics.overview, {}));
  const { data: dishesData } = useQuery(convexQuery(api.analytics.menuServeStats, {}));
  const { data: hourlyData } = useQuery(convexQuery(api.analytics.hourlyServeLoad, {}));
  const seedHistory = useMutation(api.dev.seedHistory);
  const [seeding, setSeeding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const o = ov as Overview | undefined;
  const dishes = (dishesData ?? []) as MenuStat[];
  const hourly = (hourlyData ?? []) as Hourly[];

  const sessions = o?.sessions ?? [];
  const groups = o?.groups ?? 0;
  const sales = o?.sales ?? 0;
  const perGroup = groups > 0 ? sales / groups : 0;
  const stays = sessions.map((s) => (s.closedAt ?? now) - s.openedAt);
  const avgStay = stays.length ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : null;
  const fmt = (ms: number | null) => (ms == null ? '—' : dur(ms));

  const kpis = [
    { lbl: '売上合計', val: yen(sales), sub: '全セッション・税込' },
    { lbl: '組数', val: String(groups), sub: '来店組数' },
    { lbl: '客単価', val: groups ? yen(perGroup) : '—', sub: '売上 ÷ 組数' },
    { lbl: '平均 滞在', val: fmt(avgStay), sub: '着席 → 退店' },
    { lbl: '平均 着席→初回注文', val: fmt(o?.avgFirstMs ?? null), sub: '席についてから最初の注文' },
    { lbl: '平均 提供所要', val: fmt(o?.avgServeMs ?? null), sub: '注文 → 提供（料理ごと）' },
  ];

  const maxHour = Math.max(1, ...hourly.map((h) => h.orderedCount));
  const empty = sessions.length === 0;

  return (
    <main style={css('height:100vh; display:flex; flex-direction:column; background:#f4f5f7;')}>
      <div style={css('flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; height:48px; background:#fff; border-bottom:1px solid #cbd5e1;')}>
        <div style={css('display:flex; align-items:center; gap:12px;')}>
          <Link to="/" style={css('font-size:12px; color:#94a3b8; text-decoration:none;')}>← 入口</Link>
          <span style={css('font-size:15px; font-weight:700; color:#171717;')}>分析</span>
          <span style={css('font-size:11px; color:#94a3b8;')}>タイムスタンプから算出（実データ）</span>
        </div>
        <button
          onClick={async () => {
            if (seeding) return;
            setSeeding(true);
            try {
              await seedHistory({});
            } finally {
              setSeeding(false);
            }
          }}
          disabled={seeding}
          style={css(`white-space:nowrap; height:30px; padding:0 12px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-size:12px; font-weight:500; border-radius:2px; ${seeding ? 'opacity:.6;' : ''}`)}
        >
          {seeding ? '投入中…' : '＋ サンプル過去データ投入（14日分）'}
        </button>
      </div>

      <div style={css('flex:1 1 auto; min-height:0; overflow-y:auto; padding:20px;')}>
        <div style={css('max-width:980px; margin:0 auto; display:flex; flex-direction:column; gap:20px;')}>

          {empty && (
            <div style={css('padding:24px; text-align:center; font-size:13px; color:#94a3b8; border:1px dashed #cbd5e1; border-radius:2px; background:#fff;')}>
              まだ集計できるデータがありません。注文や会計が発生すると、ここに提供スピードや滞在時間が出ます。
            </div>
          )}

          {/* KPI */}
          <div style={css('display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px;')}>
            {kpis.map((c, i) => (
              <div key={i} style={css('border:1px solid #cbd5e1; border-radius:2px; padding:13px 15px; background:#fff;')}>
                <div style={css('font-size:11px; color:#64748b;')}>{c.lbl}</div>
                <div className="tnum" style={css('font-size:24px; font-weight:700; color:#171717; line-height:1.25;')}>{c.val}</div>
                <div style={css('font-size:10px; color:#94a3b8;')}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* 時間帯別 負荷とスピード */}
          <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
            <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569;')}>時間帯別 負荷とスピード（注文件数の棒・下はアラカルトの平均提供）</div>
            {hourly.length === 0 ? (
              <div style={css('padding:18px 14px; font-size:12px; color:#94a3b8;')}>データなし</div>
            ) : (
              <div style={css('display:flex; align-items:flex-end; gap:6px; height:172px; padding:16px 14px 12px;')}>
                {hourly.map((h) => (
                  <div key={h.hour} style={css('flex:1; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px;')}>
                    <span className="tnum" style={css('font-size:9px; color:#94a3b8;')}>{h.orderedCount}</span>
                    <div style={css(`width:100%; max-width:34px; height:${Math.max(4, Math.round((h.orderedCount / maxHour) * 100))}%; min-height:4px; background:#334155; border-radius:2px 2px 0 0;`)} />
                    <span className="tnum" style={css('font-size:9px; color:#1d4ed8; font-weight:700; white-space:nowrap;')}>{h.avgAsapMs != null ? dur(h.avgAsapMs) : ''}</span>
                    <span className="tnum" style={css('font-size:9px; color:#94a3b8;')}>{h.hour}時</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* メニュー別 提供時間 */}
          <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
            <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569;')}>メニュー別 提供時間（注文→提供・アラカルトを上に・遅い順）</div>
            <div style={css('display:grid; grid-template-columns:1fr 64px 64px 92px 80px; gap:0; padding:8px 14px; border-bottom:1px solid #eef1f4; font-size:10px; font-weight:700; color:#94a3b8;')}>
              <span>商品</span><span style={css('text-align:right;')}>提供数</span><span style={css('text-align:right;')}>待ち</span><span style={css('text-align:right;')}>平均所要</span><span style={css('text-align:right;')}>最長</span>
            </div>
            {dishes.length === 0 ? (
              <div style={css('padding:16px 14px; font-size:12px; color:#94a3b8;')}>データなし</div>
            ) : (
              dishes.map((d, i) => {
                const slow = d.avgMs != null && d.serveAsap && d.avgMs > 8 * 60000;
                return (
                  <div key={i} style={css('display:grid; grid-template-columns:1fr 64px 64px 92px 80px; gap:0; padding:9px 14px; border-bottom:1px solid #f1f5f9; align-items:center;')}>
                    <span style={css('display:flex; align-items:center; gap:8px; min-width:0;')}>
                      <span className="tnum" style={css('font-size:11px; color:#94a3b8;')}>{d.code ?? ''}</span>
                      <span style={css('font-size:13px; color:#171717; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}>{d.menuName}</span>
                      {d.serveAsap && <span style={css('flex:0 0 auto; font-size:9px; font-weight:700; color:#1d4ed8; background:#eff6ff; border-radius:2px; padding:1px 5px;')}>アラカルト</span>}
                    </span>
                    <span className="tnum" style={css('text-align:right; font-size:13px; color:#475569;')}>{d.servedCount}</span>
                    <span className="tnum" style={css(`text-align:right; font-size:13px; color:${d.pendingCount > 0 ? '#b45309' : '#cbd5e1'};`)}>{d.pendingCount}</span>
                    <span className="tnum" style={css(`text-align:right; font-size:14px; font-weight:700; color:${slow ? '#dc2626' : '#171717'};`)}>{d.avgMs != null ? dur(d.avgMs) : '—'}</span>
                    <span className="tnum" style={css('text-align:right; font-size:13px; color:#94a3b8;')}>{d.maxMs != null ? dur(d.maxMs) : '—'}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* セッション別ログ */}
          <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
            <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569;')}>セッション別ログ（卓ごと）</div>
            <div style={css('display:grid; grid-template-columns:48px 70px 1fr 1fr 56px 72px; gap:0; padding:8px 14px; border-bottom:1px solid #eef1f4; font-size:10px; font-weight:700; color:#94a3b8;')}>
              <span>卓</span><span>着席</span><span style={css('text-align:right;')}>滞在</span><span style={css('text-align:right;')}>着席→初回注文</span><span style={css('text-align:right;')}>品数</span><span style={css('text-align:right;')}>状態</span>
            </div>
            {sessions.length === 0 ? (
              <div style={css('padding:16px 14px; font-size:12px; color:#94a3b8;')}>データなし</div>
            ) : (
              sessions.map((se) => {
                const closed = se.closedAt !== null;
                return (
                  <div key={se.id} style={css('display:grid; grid-template-columns:48px 70px 1fr 1fr 56px 72px; gap:0; padding:9px 14px; border-bottom:1px solid #f1f5f9; align-items:center;')}>
                    <span style={css('font-size:14px; font-weight:700; color:#171717;')}>{se.label}</span>
                    <span className="tnum" style={css('font-size:12px; color:#475569;')}>{clock(se.openedAt)}</span>
                    <span className="tnum" style={css('text-align:right; font-size:13px; color:#171717;')}>{dur((se.closedAt ?? now) - se.openedAt)}</span>
                    <span className="tnum" style={css('text-align:right; font-size:13px; color:#171717;')}>{se.firstOrderAt != null ? dur(se.firstOrderAt - se.openedAt) : '—'}</span>
                    <span className="tnum" style={css('text-align:right; font-size:13px; color:#475569;')}>{se.qty}</span>
                    <span style={css('text-align:right;')}><span style={css(`font-size:10px; font-weight:700; padding:1px 7px; border-radius:2px; color:${closed ? '#64748b' : '#15803d'}; background:${closed ? '#eceff3' : '#e7f5ec'};`)}>{closed ? '退店済み' : '在店中'}</span></span>
                  </div>
                );
              })
            )}
          </div>

        </div>
      </div>
    </main>
  );
}

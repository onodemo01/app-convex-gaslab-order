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

type Period = 'day' | 'month' | 'live';
type Trend = { key: string; label: string; sales: number; groups: number; guests: number; dishes: number; avgStayMs: number | null; avgServeMs: number | null; soldOuts: number };
type Report = {
  period: Period;
  kpis: { sales: number; groups: number; guests: number; perGuest: number; avgStayMs: number | null; avgServeMs: number | null; avgFirstMs: number | null; soldOuts: number };
  trend: Trend[];
  hourly: { hour: number; orderedCount: number; asapServedCount: number; avgAsapMs: number | null }[];
  dishes: { menuName: string; code: number | null; serveAsap: boolean; orderedCount: number; servedCount: number; pendingCount: number; avgMs: number | null; maxMs: number | null }[];
  sessions: { id: string; label: string; openedAt: number; closedAt: number | null; firstOrderAt: number | null; qty: number; settleStatus: string | null }[];
  survey: { responses: number; avgSatisfaction: number | null; gender: { male: number; female: number; other: number }; age: Record<string, number>; revisit: { high: number; mid: number; low: number } };
};

const PERIOD_TABS: [Period, string][] = [
  ['day', '日別'],
  ['month', '月別'],
  ['live', 'ライブ（当日）'],
];

function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('day');
  const { data } = useQuery(convexQuery(api.analytics.report, { period }));
  const seedHistory = useMutation(api.dev.seedHistory);
  const [seeding, setSeeding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const r = data as Report | undefined;
  const k = r?.kpis;
  const trend = r?.trend ?? [];
  const hourly = r?.hourly ?? [];
  const dishes = r?.dishes ?? [];
  const sessions = r?.sessions ?? [];

  const periodTitle = period === 'month' ? '直近6ヶ月' : period === 'day' ? '直近14日' : '本日';
  const fmt = (ms: number | null | undefined) => (ms == null ? '—' : dur(ms));
  const maxHour = Math.max(1, ...hourly.map((h) => h.orderedCount));
  const maxTrend = Math.max(1, ...trend.map((t) => t.sales));
  const empty = (k?.groups ?? 0) === 0;
  const isLive = period === 'live';

  return (
    <main style={css('height:100vh; display:flex; flex-direction:column; background:#f4f5f7;')}>
      <div style={css('flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; height:48px; background:#fff; border-bottom:1px solid #cbd5e1;')}>
        <div style={css('display:flex; align-items:center; gap:14px;')}>
          <Link to="/" style={css('font-size:12px; color:#94a3b8; text-decoration:none;')}>← 入口</Link>
          <span style={css('font-size:15px; font-weight:700; color:#171717;')}>分析</span>
          {/* 期間タブ */}
          <div style={css('display:flex; gap:0; border:1px solid #cbd5e1; border-radius:3px; overflow:hidden;')}>
            {PERIOD_TABS.map(([key, label]) => {
              const on = period === key;
              return (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  style={css(`height:28px; padding:0 12px; border:none; font-size:12px; font-weight:${on ? 700 : 500}; background:${on ? '#171717' : '#fff'}; color:${on ? '#fff' : '#475569'}; cursor:pointer;`)}
                >
                  {label}
                </button>
              );
            })}
          </div>
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
              {isLive ? '本日のデータがまだありません。注文や会計が発生すると、ここに出ます。' : 'この期間のデータがありません。右上の「サンプル過去データ投入」で履歴を入れられます。'}
            </div>
          )}

          {/* KPI */}
          <div style={css('display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px;')}>
            <Kpi lbl="売上合計" sub={`${periodTitle}・税込`} val={yen(k?.sales ?? 0)} />
            <div style={css('border:1px solid #cbd5e1; border-radius:2px; padding:13px 15px; background:#fff;')}>
              <div style={css('font-size:11px; color:#64748b;')}>組数 / 客数</div>
              <div className="tnum" style={css('font-size:24px; font-weight:700; color:#171717; line-height:1.25;')}>{(k?.groups ?? 0).toLocaleString('ja-JP')}<span style={css('font-size:14px; color:#94a3b8;')}> / {(k?.guests ?? 0).toLocaleString('ja-JP')}</span></div>
              <div style={css('font-size:10px; color:#94a3b8;')}>来店組数・人数</div>
            </div>
            <Kpi lbl="客単価" sub="売上 ÷ 客数" val={k && k.guests ? yen(k.perGuest) : '—'} />
            <Kpi lbl="平均 滞在" sub="着席 → 退店" val={fmt(k?.avgStayMs)} />
            <Kpi lbl="平均 提供所要" sub="注文 → 提供（料理ごと）" val={fmt(k?.avgServeMs)} />
            <div style={css('border:1px solid #cbd5e1; border-radius:2px; padding:13px 15px; background:#fff;')}>
              <div style={css('font-size:11px; color:#64748b;')}>品切れ発生</div>
              <div className="tnum" style={css('font-size:24px; font-weight:700; color:#b45309; line-height:1.25;')}>{k?.soldOuts ?? 0}</div>
              <div style={css('font-size:10px; color:#94a3b8;')}>機会損失の目安</div>
            </div>
          </div>

          {/* 客層・満足度（アンケート） */}
          {r?.survey && (
            <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
              <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569;')}>客層・満足度（会計後アンケート・{r.survey.responses} 件）</div>
              {r.survey.responses === 0 ? (
                <div style={css('padding:16px 14px; font-size:12px; color:#94a3b8;')}>この期間の回答がまだありません。客スマホの会計後アンケートから集まります。</div>
              ) : (
                <div style={css('display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:18px; padding:16px 16px;')}>
                  {/* 満足度 */}
                  <div style={css('display:flex; flex-direction:column; gap:6px;')}>
                    <div style={css('font-size:11px; color:#94a3b8;')}>平均満足度</div>
                    <div style={css('display:flex; align-items:center; gap:8px;')}>
                      <span style={css('font-size:15px; letter-spacing:1px;')}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span key={n} style={css(`color:${r.survey.avgSatisfaction != null && n <= Math.round(r.survey.avgSatisfaction) ? '#f59e0b' : '#e2e8f0'};`)}>★</span>
                        ))}
                      </span>
                      <span className="tnum" style={css('font-size:20px; font-weight:700; color:#171717;')}>{r.survey.avgSatisfaction ?? '—'}</span>
                    </div>
                  </div>
                  {/* 男女比 */}
                  <SurveyBars title="男女比" rows={[['男性', r.survey.gender.male, '#3b82f6'], ['女性', r.survey.gender.female, '#ec4899'], ['その他', r.survey.gender.other, '#94a3b8']]} />
                  {/* 年代 */}
                  <SurveyBars title="年代" rows={(['10', '20', '30', '40', '50', '60'] as const).map((a) => [a === '60' ? '60〜' : a + '代', r.survey.age[a] ?? 0, '#334155'])} />
                  {/* 再来意向 */}
                  <SurveyBars title="また来たい？" rows={[['ぜひ', r.survey.revisit.high, '#15803d'], ['たぶん', r.survey.revisit.mid, '#b45309'], ['うーん', r.survey.revisit.low, '#94a3b8']]} />
                </div>
              )}
            </div>
          )}

          {/* 売上推移（日別・月別のみ） */}
          {!isLive && (
            <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
              <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569;')}>売上推移（{periodTitle}）</div>
              {trend.length === 0 ? (
                <div style={css('padding:18px 14px; font-size:12px; color:#94a3b8;')}>データなし</div>
              ) : (
                <>
                  <div style={css('display:flex; align-items:flex-end; gap:6px; height:150px; padding:16px 14px 10px;')}>
                    {trend.map((t, i) => (
                      <div key={t.key} style={css('flex:1; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px;')}>
                        <span className="tnum" style={css('font-size:9px; color:#94a3b8;')}>¥{Math.round(t.sales / 1000)}k</span>
                        <div style={css(`width:100%; max-width:34px; height:${Math.max(4, Math.round((t.sales / maxTrend) * 100))}%; min-height:4px; background:${i === trend.length - 1 ? '#1d4ed8' : '#334155'}; border-radius:2px 2px 0 0;`)} />
                        <span className="tnum" style={css('font-size:9px; color:#94a3b8; white-space:nowrap;')}>{t.label}</span>
                      </div>
                    ))}
                  </div>
                  {/* 推移テーブル（新しい順） */}
                  <div style={css('display:grid; grid-template-columns:74px 1fr 64px 84px 78px 78px 56px; gap:0; padding:8px 14px; border-top:1px solid #eef1f4; border-bottom:1px solid #eef1f4; font-size:10px; font-weight:700; color:#94a3b8;')}>
                    <span>期間</span><span /><span style={css('text-align:right;')}>売上</span><span style={css('text-align:right;')}>組数</span><span style={css('text-align:right;')}>客単価</span><span style={css('text-align:right;')}>平均提供</span><span style={css('text-align:right;')}>品切れ</span>
                  </div>
                  {trend.slice().reverse().map((t, i) => (
                    <div key={t.key} style={css(`display:grid; grid-template-columns:74px 1fr 64px 84px 78px 78px 56px; gap:0; padding:9px 14px; border-bottom:1px solid #f1f5f9; align-items:center; background:${i === 0 ? '#fafcff' : '#fff'};`)}>
                      <span style={css('font-size:12px; font-weight:700; color:#171717;')}>{t.label}</span>
                      <span />
                      <span className="tnum" style={css('text-align:right; font-size:13px; color:#171717;')}>{yen(t.sales)}</span>
                      <span className="tnum" style={css('text-align:right; font-size:13px; color:#475569;')}>{t.groups}</span>
                      <span className="tnum" style={css('text-align:right; font-size:13px; color:#475569;')}>{t.guests ? yen(Math.round(t.sales / t.guests)) : '—'}</span>
                      <span className="tnum" style={css('text-align:right; font-size:13px; color:#475569;')}>{fmt(t.avgServeMs)}</span>
                      <span className="tnum" style={css(`text-align:right; font-size:13px; color:${t.soldOuts > 0 ? '#b45309' : '#cbd5e1'};`)}>{t.soldOuts}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

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

          {/* セッション別ログ（ライブのみ） */}
          {isLive && (
            <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
              <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569;')}>セッション別ログ（本日・卓ごと）</div>
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
          )}

        </div>
      </div>
    </main>
  );
}

function SurveyBars({ title, rows }: { title: string; rows: [string, number, string][] }) {
  const total = rows.reduce((a, r) => a + r[1], 0);
  return (
    <div style={css('display:flex; flex-direction:column; gap:6px;')}>
      <div style={css('font-size:11px; color:#94a3b8;')}>{title}</div>
      <div style={css('display:flex; flex-direction:column; gap:5px;')}>
        {rows.map(([label, n, color]) => {
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <div key={label} style={css('display:grid; grid-template-columns:46px 1fr 56px; align-items:center; gap:8px;')}>
              <span style={css('font-size:11px; color:#475569;')}>{label}</span>
              <span style={css('display:block; height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden;')}>
                <span style={css(`display:block; height:100%; width:${pct}%; background:${color}; border-radius:4px;`)} />
              </span>
              <span className="tnum" style={css('font-size:11px; color:#94a3b8; text-align:right;')}>{n}（{pct}%）</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ lbl, val, sub }: { lbl: string; val: string; sub: string }) {
  return (
    <div style={css('border:1px solid #cbd5e1; border-radius:2px; padding:13px 15px; background:#fff;')}>
      <div style={css('font-size:11px; color:#64748b;')}>{lbl}</div>
      <div className="tnum" style={css('font-size:24px; font-weight:700; color:#171717; line-height:1.25;')}>{val}</div>
      <div style={css('font-size:10px; color:#94a3b8;')}>{sub}</div>
    </div>
  );
}

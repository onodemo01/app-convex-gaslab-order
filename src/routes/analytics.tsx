import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMutation, useAction } from 'convex/react';
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
  survey: { responses: number; avgSatisfaction: number | null; gender: { male: number; female: number; other: number }; age: Record<string, number>; revisit: { high: number; mid: number; low: number }; commentCount: number };
  coupon: { issued: number; redeemed: number; redemptionRate: number | null; repeatSessions: number; repeatRate: number | null };
  comments: { text: string; satisfaction: number | null; at: number }[];
};
type Sentiment = 'positive' | 'negative' | 'neutral';
type SentimentResult =
  | { status: 'ok'; model: string; total: number; counts: Record<Sentiment, number>; summary: string; highlights: { sentiment: Sentiment; text: string }[] }
  | { status: 'no_key' }
  | { status: 'empty' }
  | { status: 'error'; message: string };
type Finding = { id: string; kind: 'warn' | 'good' | 'info'; title: string; body: string; action: string };
type Insights = { period: Period; findings: Finding[]; groups: number };

const PERIOD_TABS: [Period, string][] = [
  ['day', '日別'],
  ['month', '月別'],
  ['live', 'ライブ（当日）'],
];

function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('day');
  const { data } = useQuery(convexQuery(api.analytics.report, { period }));
  const { data: insightsData } = useQuery(convexQuery(api.analytics.insights, { period }));
  const seedHistory = useMutation(api.dev.seedHistory);
  const [seeding, setSeeding] = useState(false);
  const summarize = useAction(api.analytics.summarize);
  const [summarizing, setSummarizing] = useState(false);
  type Summary = { status: 'ok'; summary: string; model: string } | { status: 'no_key' } | { status: 'error'; message: string };
  const [summary, setSummary] = useState<Summary | null>(null);
  const analyzeComments = useAction(api.analytics.analyzeComments);
  const [analyzing, setAnalyzing] = useState(false);
  const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
  useEffect(() => { setSummary(null); setSentiment(null); }, [period]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const r = data as Report | undefined;
  const ins = insightsData as Insights | undefined;
  const findings = ins?.findings ?? [];
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

          {/* インサイト（ルールベースの気づき＋打ち手） */}
          {!empty && findings.length > 0 && (
            <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
              <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569; display:flex; align-items:center; gap:8px;')}>
                <span>インサイト（{periodTitle}の気づきと打ち手）</span>
                <span style={css('font-size:10px; font-weight:500; color:#94a3b8;')}>集計から自動抽出</span>
              </div>
              <div style={css('display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:12px; padding:14px 14px;')}>
                {findings.map((fd) => (
                  <Insight key={fd.id} fd={fd} />
                ))}
              </div>
            </div>
          )}

          {/* AI まとめ（任意・第2層） */}
          {!empty && (
            <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
              <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; gap:10px;')}>
                <span style={css('font-size:12px; font-weight:700; color:#475569;')}>AI まとめ（{periodTitle}）</span>
                <button
                  onClick={async () => {
                    if (summarizing) return;
                    setSummarizing(true);
                    try {
                      setSummary((await summarize({ period })) as Summary);
                    } catch (e) {
                      setSummary({ status: 'error', message: e instanceof Error ? e.message : '呼び出しに失敗しました' });
                    } finally {
                      setSummarizing(false);
                    }
                  }}
                  disabled={summarizing}
                  style={css(`white-space:nowrap; height:28px; padding:0 12px; border:none; background:#171717; color:#fff; font-size:12px; font-weight:700; border-radius:2px; ${summarizing ? 'opacity:.6;' : ''}`)}
                >
                  {summarizing ? '生成中…' : summary ? '再生成' : 'AIでまとめる'}
                </button>
              </div>
              <div style={css('padding:14px 16px;')}>
                {!summary && !summarizing && (
                  <div style={css('font-size:12px; color:#94a3b8; line-height:1.7;')}>集計データを AI に渡して、店長向けの要約と打ち手を文章で作ります。「AIでまとめる」を押してください。</div>
                )}
                {summary?.status === 'ok' && (
                  <>
                    <div style={css('font-size:13px; color:#1e293b; line-height:1.85; white-space:pre-wrap;')}>{summary.summary}</div>
                    <div style={css('margin-top:10px; font-size:10px; color:#cbd5e1;')}>{summary.model} による生成・参考情報です</div>
                  </>
                )}
                {summary?.status === 'no_key' && (
                  <div style={css('font-size:12px; color:#b45309; line-height:1.8; border:1px solid #fcd9a6; background:#fffbeb; border-radius:2px; padding:11px 13px;')}>
                    AI 要約は未設定です。利用するには Convex 本番環境に <span style={css('font-weight:700;')}>ANTHROPIC_API_KEY</span> を設定してください（コマンド例: <span style={css('font-family:monospace; font-size:11px;')}>npx convex env set ANTHROPIC_API_KEY sk-ant-... --prod</span>）。鍵の設定はご本人が行ってください。
                  </div>
                )}
                {summary?.status === 'error' && (
                  <div style={css('font-size:12px; color:#dc2626; line-height:1.7; border:1px solid #fecaca; background:#fef2f2; border-radius:2px; padding:11px 13px;')}>{summary.message}</div>
                )}
              </div>
            </div>
          )}

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

          {/* クーポン・リピート */}
          {r?.coupon && (
            <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
              <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#475569;')}>クーポン・リピート（クーポンコード＝再来客の手がかり）</div>
              <div style={css('display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:0;')}>
                <CouponCell lbl="クーポン発行" sub={`${periodTitle}・会計完了で配布`} val={(r.coupon.issued).toLocaleString('ja-JP')} unit="枚" />
                <CouponCell lbl="クーポン利用" sub="次回来店で適用" val={(r.coupon.redeemed).toLocaleString('ja-JP')} unit="枚" />
                <CouponCell lbl="利用率" sub="利用 ÷ 発行" val={r.coupon.redemptionRate != null ? String(r.coupon.redemptionRate) : '—'} unit={r.coupon.redemptionRate != null ? '%' : ''} accent="#1d4ed8" />
                <CouponCell lbl="リピート率" sub="会計組のうちクーポン利用" val={r.coupon.repeatRate != null ? String(r.coupon.repeatRate) : '—'} unit={r.coupon.repeatRate != null ? '%' : ''} accent="#15803d" />
              </div>
              <div style={css('padding:8px 14px 10px; border-top:1px solid #eef1f4; font-size:10px; color:#94a3b8; line-height:1.6;')}>
                利用率＝期間内に配ったクーポンがどれだけ使われたか／リピート率＝この期間の会計 {(k?.groups ?? 0).toLocaleString('ja-JP')} 組のうち {r.coupon.repeatSessions.toLocaleString('ja-JP')} 組がクーポン経由の再来。
              </div>
            </div>
          )}

          {/* お客様の声（自由記述）＋ AI ネガポジ分析 */}
          {!empty && (
            <div style={css('border:1px solid #e2e8f0; border-radius:2px; overflow:hidden; background:#fff;')}>
              <div style={css('padding:10px 14px; background:#fafbfc; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; gap:10px;')}>
                <span style={css('font-size:12px; font-weight:700; color:#475569;')}>お客様の声（自由記述・{r?.comments.length ?? 0} 件）</span>
                <button
                  onClick={async () => {
                    if (analyzing) return;
                    setAnalyzing(true);
                    try {
                      setSentiment((await analyzeComments({ period })) as SentimentResult);
                    } catch (e) {
                      setSentiment({ status: 'error', message: e instanceof Error ? e.message : '呼び出しに失敗しました' });
                    } finally {
                      setAnalyzing(false);
                    }
                  }}
                  disabled={analyzing || (r?.comments.length ?? 0) === 0}
                  style={css(`white-space:nowrap; height:28px; padding:0 12px; border:none; background:${(r?.comments.length ?? 0) === 0 ? '#e2e8f0' : '#171717'}; color:${(r?.comments.length ?? 0) === 0 ? '#94a3b8' : '#fff'}; font-size:12px; font-weight:700; border-radius:2px; ${analyzing ? 'opacity:.6;' : ''}`)}
                >
                  {analyzing ? '分析中…' : sentiment ? '再分析' : 'AIでネガポジ分析'}
                </button>
              </div>

              {/* AI 分析結果 */}
              {sentiment && (
                <div style={css('padding:14px 16px; border-bottom:1px solid #eef1f4;')}>
                  {sentiment.status === 'ok' && (
                    <>
                      <SentimentBar counts={sentiment.counts} total={sentiment.total} />
                      {sentiment.summary && <div style={css('margin-top:12px; font-size:13px; color:#1e293b; line-height:1.8;')}>{sentiment.summary}</div>}
                      {sentiment.highlights.length > 0 && (
                        <div style={css('margin-top:12px; display:flex; flex-direction:column; gap:6px;')}>
                          {sentiment.highlights.map((h, i) => (
                            <div key={i} style={css('display:flex; align-items:flex-start; gap:8px;')}>
                              <span style={css(`flex:0 0 auto; font-size:10px; font-weight:700; border-radius:2px; padding:2px 6px; margin-top:1px; ${sentimentTag(h.sentiment)}`)}>{sentimentLabel(h.sentiment)}</span>
                              <span style={css('font-size:12px; color:#334155; line-height:1.6;')}>{h.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={css('margin-top:10px; font-size:10px; color:#cbd5e1;')}>{sentiment.model} による分析・参考情報です</div>
                    </>
                  )}
                  {sentiment.status === 'no_key' && (
                    <div style={css('font-size:12px; color:#b45309; line-height:1.8; border:1px solid #fcd9a6; background:#fffbeb; border-radius:2px; padding:11px 13px;')}>AI 分析は未設定です。Convex 本番に <span style={css('font-weight:700;')}>ANTHROPIC_API_KEY</span> を設定してください。</div>
                  )}
                  {sentiment.status === 'empty' && (
                    <div style={css('font-size:12px; color:#94a3b8;')}>この期間の自由記述がまだありません。</div>
                  )}
                  {sentiment.status === 'error' && (
                    <div style={css('font-size:12px; color:#dc2626; line-height:1.7; border:1px solid #fecaca; background:#fef2f2; border-radius:2px; padding:11px 13px;')}>{sentiment.message}</div>
                  )}
                </div>
              )}

              {/* 生のコメント一覧 */}
              <div style={css('padding:8px 14px 12px; max-height:260px; overflow-y:auto;')}>
                {(r?.comments.length ?? 0) === 0 ? (
                  <div style={css('padding:10px 0; font-size:12px; color:#94a3b8;')}>この期間の自由記述はまだありません。客スマホの会計後アンケートから集まります。</div>
                ) : (
                  <div style={css('display:flex; flex-direction:column; gap:8px;')}>
                    {(r?.comments ?? []).map((c, i) => (
                      <div key={i} style={css('display:flex; align-items:flex-start; gap:9px; padding:9px 11px; border:1px solid #eef1f4; border-radius:2px;')}>
                        <span style={css(`flex:0 0 auto; font-size:11px; font-weight:700; color:${c.satisfaction != null && c.satisfaction <= 2 ? '#dc2626' : c.satisfaction != null && c.satisfaction >= 4 ? '#15803d' : '#94a3b8'}; width:30px;`)}>{c.satisfaction != null ? '★' + c.satisfaction : '—'}</span>
                        <span style={css('flex:1; min-width:0; font-size:13px; color:#1e293b; line-height:1.6;')}>{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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

function sentimentLabel(s: Sentiment) {
  return s === 'positive' ? 'ポジ' : s === 'negative' ? 'ネガ' : '中立';
}
function sentimentTag(s: Sentiment) {
  return s === 'positive' ? 'color:#15803d; background:#f0fdf4;' : s === 'negative' ? 'color:#dc2626; background:#fef2f2;' : 'color:#475569; background:#f1f5f9;';
}
function SentimentBar({ counts, total }: { counts: Record<Sentiment, number>; total: number }) {
  const sum = counts.positive + counts.negative + counts.neutral || 1;
  const seg: [Sentiment, number, string][] = [
    ['positive', counts.positive, '#16a34a'],
    ['neutral', counts.neutral, '#94a3b8'],
    ['negative', counts.negative, '#dc2626'],
  ];
  return (
    <div style={css('display:flex; flex-direction:column; gap:7px;')}>
      <div style={css('display:flex; height:14px; border-radius:3px; overflow:hidden; background:#f1f5f9;')}>
        {seg.map(([s, n, color]) => (n > 0 ? <span key={s} title={`${sentimentLabel(s)} ${n}`} style={css(`width:${(n / sum) * 100}%; background:${color};`)} /> : null))}
      </div>
      <div style={css('display:flex; gap:14px;')}>
        {seg.map(([s, n, color]) => (
          <span key={s} style={css('display:flex; align-items:center; gap:5px; font-size:11px; color:#475569;')}>
            <span style={css(`width:9px; height:9px; border-radius:2px; background:${color};`)} />
            {sentimentLabel(s)} <span className="tnum" style={css('font-weight:700; color:#171717;')}>{n}</span>
            <span style={css('color:#94a3b8;')}>（{Math.round((n / sum) * 100)}%）</span>
          </span>
        ))}
        <span style={css('font-size:11px; color:#cbd5e1; margin-left:auto;')}>{total} 件を分析</span>
      </div>
    </div>
  );
}

function Insight({ fd }: { fd: Finding }) {
  const palette = {
    warn: { bar: '#f59e0b', tag: '#b45309', tagBg: '#fffbeb', tagText: '要対応' },
    good: { bar: '#16a34a', tag: '#15803d', tagBg: '#f0fdf4', tagText: '好調' },
    info: { bar: '#64748b', tag: '#475569', tagBg: '#f1f5f9', tagText: '参考' },
  }[fd.kind];
  return (
    <div style={css(`border:1px solid #eef1f4; border-left:3px solid ${palette.bar}; border-radius:2px; padding:12px 13px; display:flex; flex-direction:column; gap:6px; background:#fff;`)}>
      <div style={css('display:flex; align-items:center; gap:8px;')}>
        <span style={css(`font-size:10px; font-weight:700; color:${palette.tag}; background:${palette.tagBg}; border-radius:2px; padding:2px 7px;`)}>{palette.tagText}</span>
        <span style={css('font-size:13px; font-weight:700; color:#171717; line-height:1.4;')}>{fd.title}</span>
      </div>
      <div style={css('font-size:11px; color:#64748b; line-height:1.6;')}>{fd.body}</div>
      <div style={css('display:flex; align-items:flex-start; gap:6px; margin-top:2px; padding-top:7px; border-top:1px dashed #eef1f4;')}>
        <span style={css('font-size:10px; font-weight:700; color:#94a3b8; white-space:nowrap; padding-top:1px;')}>打ち手</span>
        <span style={css('font-size:12px; color:#334155; line-height:1.6;')}>{fd.action}</span>
      </div>
    </div>
  );
}

function CouponCell({ lbl, val, sub, unit, accent }: { lbl: string; val: string; sub: string; unit?: string; accent?: string }) {
  return (
    <div style={css('padding:14px 16px; border-right:1px solid #f1f5f9; border-bottom:1px solid #f1f5f9;')}>
      <div style={css('font-size:11px; color:#64748b;')}>{lbl}</div>
      <div className="tnum" style={css(`font-size:24px; font-weight:700; line-height:1.25; color:${accent ?? '#171717'};`)}>{val}<span style={css('font-size:13px; color:#94a3b8; font-weight:700;')}>{unit ? ' ' + unit : ''}</span></div>
      <div style={css('font-size:10px; color:#94a3b8;')}>{sub}</div>
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

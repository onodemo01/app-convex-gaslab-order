import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import { css } from '../lib/css';

export const Route = createFileRoute('/demo')({
  component: DemoPage,
});

type Table = { _id: string; label: string; seats: number; tableToken: string; guestUrl: string | null };

function DemoPage() {
  const { data } = useQuery(convexQuery(api.tables.listTables, {}));
  const seed = useMutation(api.dev.seedDemo);
  const reset = useMutation(api.dev.resetDemo);
  const simulate = useMutation(api.dev.simulate);

  const tables = (data ?? []) as Table[];
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 客スマホペインの卓を決める。清掃完了でトークンが再生成されて現在の卓が消えたら、有効な卓へ張り替える。
  useEffect(() => {
    if (tables.length === 0) return;
    if (!guestToken || !tables.some((t) => t.tableToken === guestToken)) {
      setGuestToken(tables[0].tableToken);
    }
  }, [tables, guestToken]);

  useEffect(
    () => () => {
      if (autoTimer.current) clearInterval(autoTimer.current);
    },
    [],
  );

  const guestUrl = tables.find((t) => t.tableToken === guestToken)?.guestUrl ?? null;
  const guestLabel = tables.find((t) => t.tableToken === guestToken)?.label ?? '';

  function toggleAuto() {
    if (auto) {
      if (autoTimer.current) clearInterval(autoTimer.current);
      autoTimer.current = null;
      setAuto(false);
    } else {
      setAuto(true);
      autoTimer.current = setInterval(() => void simulate({}), 2600);
      void simulate({});
    }
  }

  const btn = 'white-space:nowrap; height:30px; padding:0 12px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-size:12px; font-weight:500; border-radius:2px;';

  return (
    <main style={css('height:100vh; display:flex; flex-direction:column; background:#f4f5f7;')}>
      <div style={css('flex:0 0 auto; display:flex; align-items:center; gap:14px; padding:0 16px; height:50px; background:#fff; border-bottom:1px solid #cbd5e1;')}>
        <Link to="/" style={css('font-size:12px; color:#94a3b8; text-decoration:none;')}>← 入口</Link>
        <div style={css('display:flex; flex-direction:column; line-height:1.2; padding-right:14px; border-right:1px solid #e2e8f0;')}>
          <span style={css('font-size:13px; font-weight:700;')}>同時表示デモ</span>
          <span style={css('font-size:10px; color:#64748b;')}>客スマホ → キッチン → ホールが購読同期</span>
        </div>
        <div style={css('flex:1;')} />
        <button onClick={() => void simulate({})} style={css(btn)}>＋ デモを1手進める</button>
        <button onClick={toggleAuto} style={css(`white-space:nowrap; height:30px; padding:0 12px; border:1px solid ${auto ? '#15803d' : '#cbd5e1'}; background:${auto ? '#15803d' : '#fff'}; color:${auto ? '#fff' : '#475569'}; font-size:12px; font-weight:${auto ? 700 : 500}; border-radius:2px;`)}>
          {auto ? '自動デモ 停止' : '自動デモ 開始'}
        </button>
        <button onClick={() => void reset({})} style={css(btn)}>リセット</button>
        <button onClick={() => void seed({})} style={css(btn)}>デモ投入</button>
        <div style={css('display:flex; align-items:center; gap:6px; padding-left:12px; border-left:1px solid #e2e8f0;')}>
          <span style={css('width:7px; height:7px; border-radius:50%; background:#16a34a; animation:lampoDot 1.6s ease-in-out infinite;')} />
          <span style={css('font-size:11px; color:#64748b;')}>購読中</span>
        </div>
      </div>

      {tables.length === 0 ? (
        <div style={css('flex:1; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:13px;')}>
          卓がありません。「デモ投入」を押すか、<Link to="/" style={css('color:#1d4ed8; margin:0 4px;')}>入口</Link>でデモデータを投入してください。
        </div>
      ) : (
        <div style={css('flex:1 1 auto; min-height:0; display:flex; gap:12px; padding:12px;')}>
          <Pane title="客スマホ（卓QR）" width="404px">
            <div style={css('flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:7px 10px; border-bottom:1px solid #eef1f4; background:#fafbfc;')}>
              <span style={css('font-size:11px; color:#64748b;')}>卓</span>
              <select value={guestToken ?? ''} onChange={(e) => setGuestToken(e.target.value)} style={css('font-size:12px; border:1px solid #e2e8f0; border-radius:2px; padding:3px 6px; background:#fff; color:#475569;')}>
                {tables.map((t) => (
                  <option key={t._id} value={t.tableToken}>卓 {t.label}</option>
                ))}
              </select>
              <span style={css('font-size:10px; color:#cbd5e1;')}>選んだ卓のスマホ画面</span>
            </div>
            {guestUrl && <iframe key={guestUrl} title={`客スマホ 卓${guestLabel}`} src={guestUrl} style={{ flex: '1 1 auto', width: '100%', border: 'none', minHeight: 0 }} />}
          </Pane>

          <Pane title="キッチン KDS">
            <iframe title="キッチン KDS" src="/kitchen" style={{ flex: '1 1 auto', width: '100%', border: 'none', minHeight: 0 }} />
          </Pane>

          <Pane title="ホール（フロア）">
            <iframe title="ホール" src="/floor" style={{ flex: '1 1 auto', width: '100%', border: 'none', minHeight: 0 }} />
          </Pane>
        </div>
      )}
    </main>
  );
}

function Pane({ title, width, children }: { title: string; width?: string; children: React.ReactNode }) {
  return (
    <div style={css(`${width ? `flex:0 0 auto; width:${width};` : 'flex:1 1 0; min-width:0;'} display:flex; flex-direction:column; background:#fff; border:1px solid #cbd5e1; border-radius:2px; overflow:hidden;`)}>
      <div style={css('flex:0 0 auto; padding:8px 12px; border-bottom:1px solid #eef1f4; background:#fff; font-size:12px; font-weight:700; color:#171717;')}>{title}</div>
      {children}
    </div>
  );
}

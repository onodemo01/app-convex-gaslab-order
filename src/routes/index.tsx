import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import { css } from '../lib/css';

export const Route = createFileRoute('/')({
  component: HomePage,
});

const SCREENS: { to: string; label: string; desc: string; device: string }[] = [
  { to: '/floor', label: 'ホール（フロア）', desc: '卓の状況・呼び出し・会計', device: 'ホールiPad' },
  { to: '/kitchen', label: 'キッチン KDS', desc: '調理中／提供済み・タップで提供', device: '厨房タブレット' },
  { to: '/menu', label: '商品マスタ', desc: '価格・在庫・番号の編集', device: '管理' },
  { to: '/qr', label: '卓QRコード', desc: '各卓に貼る個別QR（印刷可）', device: '管理' },
  { to: '/analytics', label: '分析', desc: '提供スピード・滞在・時間帯別の負荷', device: '管理' },
  { to: '/demo', label: '同時表示（デモ）', desc: '全画面を1枚に・セミナー用', device: '大画面' },
];

function HomePage() {
  const { data: store } = useQuery(convexQuery(api.stores.getMyStore, {}));
  const { data: tables } = useQuery(convexQuery(api.tables.listTables, {}));
  const seed = useMutation(api.dev.seedDemo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sampleUrl = tables && tables.length > 0 ? tables[0].guestUrl : null;

  async function onSeed() {
    setBusy(true);
    setMsg(null);
    try {
      await seed({});
      setMsg('デモデータを投入しました');
    } catch {
      setMsg('投入に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={css('min-height:100vh; background:#f4f5f7; color:#171717; padding:40px 20px;')}>
      <div style={css('max-width:760px; margin:0 auto; display:flex; flex-direction:column; gap:22px;')}>
        <header style={css('display:flex; flex-direction:column; gap:4px;')}>
          <h1 style={css('font-size:22px; font-weight:700; margin:0;')}>卓注文アプリ</h1>
          <p style={css('font-size:13px; color:#64748b; margin:0;')}>
            {store ? store.name : '店舗未設定'} · 役割ごとの画面を各端末で開いて使います
          </p>
        </header>

        <div style={css('display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px;')}>
          {SCREENS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              style={css(
                'display:flex; flex-direction:column; gap:4px; padding:16px; background:#fff; border:1px solid #cbd5e1; border-radius:4px; text-decoration:none; color:#171717;',
              )}
            >
              <span style={css('font-size:15px; font-weight:700;')}>{s.label}</span>
              <span style={css('font-size:11px; color:#94a3b8;')}>{s.desc}</span>
              <span style={css('margin-top:6px; font-size:10px; font-weight:700; color:#475569; background:#f1f5f9; border-radius:2px; padding:2px 7px; width:fit-content;')}>{s.device}</span>
            </Link>
          ))}
          {sampleUrl && (
            <a
              href={sampleUrl}
              style={css(
                'display:flex; flex-direction:column; gap:4px; padding:16px; background:#171717; border:1px solid #171717; border-radius:4px; text-decoration:none; color:#fff;',
              )}
            >
              <span style={css('font-size:15px; font-weight:700;')}>客スマホ（例: {tables![0].label}）</span>
              <span style={css('font-size:11px; color:#cbd5e1;')}>卓QRから開く注文・会計画面</span>
              <span style={css('margin-top:6px; font-size:10px; font-weight:700; color:#171717; background:#fff; border-radius:2px; padding:2px 7px; width:fit-content;')}>客スマホ</span>
            </a>
          )}
        </div>

        <section style={css('display:flex; flex-direction:column; gap:8px; padding:14px 16px; background:#fff; border:1px dashed #cbd5e1; border-radius:4px;')}>
          <span style={css('font-size:12px; font-weight:700; color:#475569;')}>開発・デモ用</span>
          <div style={css('display:flex; align-items:center; gap:10px; flex-wrap:wrap;')}>
            <button
              onClick={onSeed}
              disabled={busy}
              style={css('height:34px; padding:0 14px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-size:12px; font-weight:600; border-radius:2px;')}
            >
              デモデータ投入（店舗・卓・メニュー）
            </button>
            {msg && <span style={css('font-size:12px; color:#15803d;')}>{msg}</span>}
          </div>
          <span style={css('font-size:11px; color:#94a3b8;')}>
            本番では「ホール → 設定」から店舗・卓・メニューを登録します。
          </span>
        </section>
      </div>
    </main>
  );
}

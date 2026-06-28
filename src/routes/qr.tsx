import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import qrcode from 'qrcode-generator';
import { api } from '../../convex/_generated/api';
import { css } from '../lib/css';

export const Route = createFileRoute('/qr')({
  component: QrPage,
});

type Table = {
  _id: string;
  label: string;
  seats: number;
  tableToken: string;
  guestUrl: string | null;
  occupied: boolean;
  cleaning: boolean;
};

function makeQR(text: string): string | null {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(6, 2);
  } catch {
    return null;
  }
}

const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  .qr-screen { height: auto !important; background: #fff !important; }
  .qr-grid { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; }
  .qr-card { break-inside: avoid; border-color: #000 !important; }
}
`;

function QrPage() {
  const { data } = useQuery(convexQuery(api.tables.listTables, {}));
  const { data: store } = useQuery(convexQuery(api.stores.getMyStore, {}));
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const tables = (data ?? []) as Table[];

  return (
    <main className="qr-screen" style={css('min-height:100vh; background:#f4f5f7; display:flex; flex-direction:column;')}>
      <style>{PRINT_CSS}</style>
      <div className="no-print" style={css('flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; height:48px; background:#fff; border-bottom:1px solid #cbd5e1;')}>
        <div style={css('display:flex; align-items:center; gap:12px;')}>
          <Link to="/" style={css('font-size:12px; color:#94a3b8; text-decoration:none;')}>← 入口</Link>
          <span style={css('font-size:15px; font-weight:700; color:#171717;')}>卓QRコード</span>
          <span style={css('font-size:11px; color:#94a3b8;')}>各卓に貼る個別QR・読み取るとその卓の注文画面へ</span>
        </div>
        <button onClick={() => window.print()} style={css('height:32px; padding:0 14px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:12px; font-weight:700;')}>印刷</button>
      </div>

      <div style={css('flex:1 1 auto; min-height:0; overflow-y:auto; padding:18px;')}>
        {tables.length === 0 ? (
          <div style={css('padding:30px; text-align:center; font-size:13px; color:#94a3b8;')}>
            卓がありません。<Link to="/" style={css('color:#1d4ed8;')}>入口</Link>でデモデータを投入するか、ホールの設定から登録してください。
          </div>
        ) : (
          <>
            <div className="no-print" style={css('margin-bottom:14px; font-size:12px; color:#64748b;')}>{store ? store.name : ''}・{tables.length} 卓</div>
            <div className="qr-grid" style={css('display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:16px;')}>
              {tables.map((t) => {
                const full = origin && t.guestUrl ? origin + t.guestUrl : '';
                const qr = full ? makeQR(full) : null;
                // 占有中・清掃中はQRを伏せてグレーアウト（読み取り＝新規着席を防ぐ）。
                const inUse = t.occupied || t.cleaning;
                const statusLabel = t.occupied ? '利用中' : t.cleaning ? '清掃中' : '';
                return (
                  <div key={t._id} className="qr-card" style={css(`display:flex; flex-direction:column; border:1px solid #cbd5e1; border-radius:2px; overflow:hidden; background:${inUse ? '#f1f5f9' : '#fff'};`)}>
                    <div style={css('display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 12px; border-bottom:1px solid #e2e8f0; background:#fafbfc;')}>
                      <span style={css('font-size:16px; font-weight:700; color:#171717;')}>卓 {t.label}</span>
                      {inUse ? (
                        <span style={css(`font-size:10px; font-weight:700; color:${t.occupied ? '#b45309' : '#64748b'}; background:#fff; border:1px solid #e2e8f0; border-radius:2px; padding:1px 6px;`)}>{statusLabel}</span>
                      ) : (
                        <span style={css('font-size:10px; color:#94a3b8;')}>{t.seats}名席</span>
                      )}
                    </div>
                    <div style={css('padding:16px; display:flex; flex-direction:column; align-items:center; gap:10px; position:relative;')}>
                      <div style={css('width:148px; height:148px; display:flex; align-items:center; justify-content:center; border:1px solid #eef1f4; position:relative;')}>
                        {qr ? (
                          <img src={qr} alt={`卓${t.label} QR`} style={css(`width:100%; height:100%; image-rendering:pixelated; display:block; ${inUse ? 'filter:grayscale(1); opacity:.18;' : ''}`)} />
                        ) : (
                          <span style={css('font-size:10px; color:#cbd5e1;')}>準備中…</span>
                        )}
                        {inUse && (
                          <span style={css('position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:#475569;')}>{statusLabel}</span>
                        )}
                      </div>
                      <div style={css('font-size:10px; color:#94a3b8; text-align:center; word-break:break-all; line-height:1.4;')}>{inUse ? '空席になると新しいQRに更新されます' : t.guestUrl}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="no-print" style={css('margin-top:18px; padding:13px 15px; border:1px dashed #cbd5e1; border-radius:2px; background:#fafbfc; font-size:11px; color:#64748b; line-height:1.8;')}>
              各卓に固有トークンを埋め込んだQRを印刷して卓上に設置します。客がスマホで読み取ると <b>{origin}/t/{store?.slug ?? '店舗'}/&lt;卓トークン&gt;</b> が開き、その卓のセッションが始まります。
              本番では実際の公開ドメインを指す必要があるため、デプロイ後のドメインで印刷してください。
            </div>
          </>
        )}
      </div>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { css } from '../lib/css';
import { yen } from '../lib/format';

export const Route = createFileRoute('/menu')({
  component: MenuPage,
});

type Item = {
  _id: string;
  name: string;
  category?: string;
  code?: number;
  price?: number;
  active: boolean;
  serveAsap?: boolean;
  stock?: number;
};

const GRID = 'display:grid; grid-template-columns:70px 1fr 120px 140px 84px 190px; align-items:center; gap:10px;';

function MenuPage() {
  const { data } = useQuery(convexQuery(api.menu.listMenu, {}));
  const items = (data ?? []) as Item[];

  const total = items.length;
  const soldOut = items.filter((m) => m.stock === 0).length;
  const tracked = items.filter((m) => m.stock !== undefined).length;

  // カテゴリ別にグループ化（listMenu はカテゴリ→名前でソート済み）
  const cats: string[] = [];
  for (const m of items) {
    const c = m.category ?? 'その他';
    if (!cats.includes(c)) cats.push(c);
  }

  return (
    <main style={css('height:100vh; display:flex; flex-direction:column; background:#f4f5f7;')}>
      <div style={css('flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; height:48px; background:#fff; border-bottom:1px solid #cbd5e1;')}>
        <div style={css('display:flex; align-items:center; gap:12px;')}>
          <Link to="/" style={css('font-size:12px; color:#94a3b8; text-decoration:none;')}>← 入口</Link>
          <span style={css('font-size:15px; font-weight:700; color:#171717;')}>商品マスタ</span>
          <span style={css('font-size:11px; color:#94a3b8;')}>価格・在庫の変更は客スマホ／キッチンに即反映</span>
        </div>
        <div style={css('display:flex; align-items:center; gap:10px;')}>
          <span style={css('font-size:11px; color:#64748b;')}>商品 <b className="tnum" style={css('color:#171717; font-size:13px;')}>{total}</b></span>
          <span style={css('font-size:11px; color:#64748b;')}>在庫管理 <b className="tnum" style={css('color:#171717; font-size:13px;')}>{tracked}</b></span>
          <span style={css('font-size:11px; color:#dc2626;')}>品切れ <b className="tnum" style={css('font-size:13px;')}>{soldOut}</b></span>
        </div>
      </div>

      <div style={css('flex:1 1 auto; min-height:0; overflow:auto;')}>
        <div style={css('min-width:780px;')}>
          <div style={css(GRID + ' position:sticky; top:0; z-index:1; padding:8px 16px; border-bottom:1px solid #cbd5e1; background:#f1f5f9; font-size:10px; font-weight:700; color:#64748b; letter-spacing:.03em;')}>
            <span>番号</span><span>商品名</span><span>価格（円）</span><span>在庫</span><span>状態</span><span>操作</span>
          </div>
          {items.length === 0 && (
            <div style={css('padding:30px; text-align:center; font-size:13px; color:#94a3b8;')}>
              商品がありません。<Link to="/" style={css('color:#1d4ed8;')}>入口</Link>でデモデータを投入するか、ホールの設定から登録してください。
            </div>
          )}
          {cats.map((cat) => (
            <div key={cat}>
              <div style={css('padding:8px 16px 5px; background:#fafbfc; border-bottom:1px solid #eef1f4; font-size:10px; font-weight:700; color:#94a3b8; letter-spacing:.05em;')}>{cat}</div>
              {items.filter((m) => (m.category ?? 'その他') === cat).map((m) => (
                <MenuRow key={m._id} m={m} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function MenuRow({ m }: { m: Item }) {
  const setPrice = useMutation(api.menu.setMenuItemPrice);
  const setCode = useMutation(api.menu.setMenuItemCode);
  const setStock = useMutation(api.menu.setMenuItemStock);
  const setActive = useMutation(api.menu.setMenuItemActive);
  const setServeAsap = useMutation(api.menu.setServeAsap);

  const tracked = m.stock !== undefined;
  const sold = m.stock === 0;
  const low = tracked && m.stock! > 0 && m.stock! <= 3;
  const inactive = !m.active;
  const statusLabel = inactive ? '停止中' : sold ? '品切れ' : low ? '残りわずか' : tracked ? '在庫あり' : '販売中';
  const statusFg = inactive ? '#64748b' : sold ? '#dc2626' : low ? '#b45309' : '#15803d';
  const statusBg = inactive ? '#eceff3' : sold ? '#fdecec' : low ? '#fdeccd' : '#e7f3ec';

  const id = m._id as Id<'menuItems'>;

  return (
    <div style={css(GRID + ` padding:9px 16px; border-bottom:1px solid #eef1f4; background:${sold || inactive ? '#fdfcfc' : '#fff'};`)}>
      <CommitInput
        initial={m.code != null ? String(m.code) : ''}
        placeholder="—"
        width={56}
        onCommit={(v) => setCode({ menuItemId: id, code: v === '' ? null : Number(v) })}
      />
      <div style={css('display:flex; align-items:center; gap:7px; min-width:0;')}>
        <span style={css(`font-size:14px; font-weight:600; color:${sold || inactive ? '#94a3b8' : '#171717'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`)}>{m.name}</span>
        <button
          onClick={() => setServeAsap({ menuItemId: id, serveAsap: !m.serveAsap })}
          style={css(`flex:0 0 auto; height:22px; padding:0 7px; border-radius:2px; border:1px solid ${m.serveAsap ? '#1d4ed8' : '#cbd5e1'}; background:${m.serveAsap ? '#eff6ff' : '#fff'}; color:${m.serveAsap ? '#1d4ed8' : '#94a3b8'}; font-size:10px; font-weight:700;`)}
        >
          アラカルト
        </button>
      </div>
      <div style={css('display:flex; align-items:center; gap:4px;')}>
        <span style={css('font-size:12px; color:#94a3b8;')}>¥</span>
        <CommitInput
          initial={m.price != null ? String(m.price) : ''}
          placeholder="—"
          width={74}
          onCommit={(v) => setPrice({ menuItemId: id, price: v === '' ? 0 : Number(v) })}
        />
      </div>
      <div style={css('display:flex; align-items:center; gap:5px;')}>
        {tracked ? (
          <div style={css('display:flex; align-items:center; border:1px solid #cbd5e1; border-radius:2px; overflow:hidden;')}>
            <button onClick={() => setStock({ menuItemId: id, stock: Math.max(0, m.stock! - 1) })} style={css('width:26px; height:28px; border:none; background:#fff; color:#64748b; font-size:15px; line-height:1;')}>−</button>
            <span className="tnum" style={css('width:30px; text-align:center; font-size:13px; font-weight:700; color:#171717;')}>{m.stock}</span>
            <button onClick={() => setStock({ menuItemId: id, stock: m.stock! + 1 })} style={css('width:26px; height:28px; border:none; background:#fff; color:#64748b; font-size:15px; line-height:1;')}>＋</button>
          </div>
        ) : (
          <span style={css('font-size:11px; color:#94a3b8;')}>管理なし（無制限）</span>
        )}
      </div>
      <span style={css(`font-size:10px; font-weight:700; padding:2px 8px; border-radius:2px; color:${statusFg}; background:${statusBg}; width:fit-content;`)}>{statusLabel}</span>
      <div style={css('display:flex; align-items:center; gap:6px; flex-wrap:wrap;')}>
        <button
          onClick={() => setStock({ menuItemId: id, stock: sold ? null : 0 })}
          style={css(`height:30px; padding:0 10px; border-radius:2px; border:1px solid ${sold ? '#15803d' : '#cbd5e1'}; background:${sold ? '#15803d' : '#fff'}; color:${sold ? '#fff' : '#64748b'}; font-size:11px; font-weight:700; white-space:nowrap;`)}
        >
          {sold ? '販売再開' : '品切れにする'}
        </button>
        <button
          onClick={() => setStock({ menuItemId: id, stock: tracked ? null : 10 })}
          style={css('height:30px; padding:0 9px; border-radius:2px; border:1px solid #cbd5e1; background:#fff; color:#64748b; font-size:11px; white-space:nowrap;')}
        >
          在庫管理
        </button>
        <button
          onClick={() => setActive({ menuItemId: id, active: inactive })}
          style={css(`height:30px; padding:0 9px; border-radius:2px; border:1px solid #cbd5e1; background:#fff; color:${inactive ? '#15803d' : '#94a3b8'}; font-size:11px; white-space:nowrap;`)}
        >
          {inactive ? '販売開始' : '停止'}
        </button>
      </div>
    </div>
  );
}

// 入力中はローカル保持し、フォーカスを外す/Enter で確定（サーバ反映）。
function CommitInput({
  initial,
  placeholder,
  width,
  onCommit,
}: {
  initial: string;
  placeholder?: string;
  width: number;
  onCommit: (v: string) => void;
}) {
  const [val, setVal] = useState(initial);
  useEffect(() => {
    setVal(initial);
  }, [initial]);
  return (
    <input
      value={val}
      placeholder={placeholder}
      inputMode="numeric"
      onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={() => {
        if (val !== initial) onCommit(val);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={css(`width:${width}px; height:30px; border:1px solid #cbd5e1; border-radius:2px; padding:0 8px; font-size:13px; font-variant-numeric:tabular-nums; color:#171717; background:#fff;`)}
    />
  );
}

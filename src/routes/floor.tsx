import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from 'convex/react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { css } from '../lib/css';
import { yen, dur } from '../lib/format';

export const Route = createFileRoute('/floor')({
  component: FloorPage,
});

const inputCls = 'border border-slate-300 dark:border-slate-700 px-2 py-1 bg-transparent';

function FloorPage() {
  const [tab, setTab] = useState<'floor' | 'settings'>('floor');
  return (
    <main style={css('height:100vh; display:flex; flex-direction:column; background:#f4f5f7;')}>
      <div style={css('flex:0 0 auto; display:flex; align-items:center; gap:14px; padding:0 16px; height:48px; background:#fff; border-bottom:1px solid #cbd5e1;')}>
        <Link to="/" style={css('font-size:12px; color:#94a3b8; text-decoration:none;')}>← 入口</Link>
        <span style={css('font-size:15px; font-weight:700; color:#171717;')}>ホール（フロア）</span>
        <div style={css('display:flex; gap:4px;')}>
          {([['floor', 'フロア'], ['settings', '設定']] as const).map(([k, label]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={css(`height:30px; padding:0 13px; border:1px solid ${on ? '#171717' : '#cbd5e1'}; background:${on ? '#171717' : '#fff'}; color:${on ? '#fff' : '#475569'}; font-size:12px; font-weight:${on ? 700 : 500}; border-radius:2px;`)}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === 'floor' ? (
        <KanbanFloor />
      ) : (
        <div style={css('flex:1 1 auto; min-height:0; overflow-y:auto; padding:20px;')}>
          <div className="flex flex-col gap-6 max-w-3xl mx-auto">
            <StoreSetup />
            <TablesSetup />
            <MenuSetup />
          </div>
        </div>
      )}
    </main>
  );
}

type BoardTable = {
  tableId: string;
  label: string;
  seats: number;
  status: '空席' | '着席中' | '会計中' | '会計済み' | '清掃中';
  sessionId: string | null;
  partySize: number | null;
  openedAt: number | null;
  settleStatus: 'charging' | 'succeeded' | 'failed' | null;
  billPreview: number;
  cleaning: boolean;
};

type Status = BoardTable['status'];
const TINT: Record<Status, [string, string, string]> = {
  空席: ['#f8fafc', '#cbd5e1', '#94a3b8'],
  着席中: ['#d8f1e1', '#16a34a', '#15803d'],
  会計中: ['#fdeccd', '#d97706', '#b45309'],
  会計済み: ['#eceff3', '#9aa6b5', '#64748b'],
  清掃中: ['#e8eef6', '#7c93b3', '#3f5573'],
};
const COLS: { key: Status; label: string }[] = [
  { key: '空席', label: '空席' },
  { key: '着席中', label: '着席中' },
  { key: '会計済み', label: '会計済み' },
  { key: '清掃中', label: '清掃中' },
];
const groupOf = (st: Status): Status => (st === '会計中' ? '着席中' : st);

function KanbanFloor() {
  const { data } = useQuery(convexQuery(api.sessions.floorBoard, {}));
  const [selId, setSelId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tables = (data ?? []) as BoardTable[];
  const sel = tables.find((t) => t.tableId === selId) ?? null;

  const columns = COLS.map((c) => ({
    ...c,
    dot: TINT[c.key][1],
    accent: TINT[c.key][2],
    tables: tables.filter((t) => groupOf(t.status) === c.key),
  }));

  return (
    <div style={css('flex:1 1 auto; min-height:0; display:flex;')}>
      <div style={css('flex:1 1 auto; min-width:0; overflow-x:auto; padding:14px; display:flex; gap:12px;')}>
        {columns.map((col) => (
          <div key={col.key} style={css('flex:1 1 0; min-width:160px; display:flex; flex-direction:column; min-height:0;')}>
            <div style={css('display:flex; align-items:center; gap:7px; padding:0 4px 9px;')}>
              <span style={css(`width:8px; height:8px; border-radius:50%; background:${col.dot};`)} />
              <span style={css('font-size:12px; font-weight:700; color:#171717;')}>{col.label}</span>
              <span className="tnum" style={css(`font-size:12px; font-weight:700; color:${col.accent};`)}>{col.tables.length}</span>
            </div>
            <div style={css('flex:1 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:10px; padding:8px; background:#fafbfc; border:1px solid #eef1f4; border-radius:2px;')}>
              {col.tables.length === 0 && (
                <div style={css('padding:16px 8px; text-align:center; font-size:11px; color:#cbd5e1; border:1px dashed #e2e8f0; border-radius:2px;')}>—</div>
              )}
              {col.tables.map((t) => {
                const [bg, bd, fg] = TINT[t.status];
                const empty = t.status === '空席';
                const selated = selId === t.tableId;
                return (
                  <div
                    key={t.tableId}
                    onClick={() => setSelId(t.tableId)}
                    style={css(`position:relative; display:flex; flex-direction:column; gap:5px; padding:11px 12px; min-height:84px; border-radius:2px; border:1.5px ${empty ? 'dashed' : 'solid'} ${selated ? '#171717' : bd}; background:${bg}; cursor:pointer; ${selated ? 'box-shadow:0 0 0 2px rgba(15,23,42,.08);' : ''}`)}
                  >
                    <div style={css('display:flex; align-items:center; justify-content:space-between;')}>
                      <span style={css('font-size:17px; font-weight:700; color:#171717; line-height:1;')}>{t.label}</span>
                      <span style={css(`font-size:10px; font-weight:700; padding:1px 6px; border-radius:2px; color:${empty ? '#94a3b8' : '#fff'}; background:${empty ? 'transparent' : fg};`)}>{t.status}</span>
                    </div>
                    <span style={css('font-size:10px; color:#94a3b8;')}>{t.partySize ? t.partySize + '名' : t.seats + '名席'}</span>
                    <div style={css('margin-top:auto; display:flex; align-items:center; justify-content:space-between;')}>
                      <span className="tnum" style={css('font-size:13px; font-weight:700; color:#171717;')}>{t.sessionId ? yen(t.billPreview) : ''}</span>
                      <span className="tnum" style={css('font-size:10px; color:#94a3b8;')}>{t.openedAt ? dur(now - t.openedAt) : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={css('flex:0 0 260px; border-left:1px solid #eef1f4; overflow-y:auto; padding:15px; background:#fbfcfd;')}>
        {sel ? <DetailPanel t={sel} now={now} /> : <p style={css('font-size:12px; color:#94a3b8;')}>卓を選ぶと操作できます。</p>}
      </div>
    </div>
  );
}

function DetailPanel({ t, now }: { t: BoardTable; now: number }) {
  const openSession = useMutation(api.sessions.openSession);
  const closeSession = useMutation(api.sessions.closeSession);
  const forceRelease = useMutation(api.sessions.forceReleaseSettle);
  const cleaningDone = useMutation(api.sessions.markCleaningDone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [bg, bd, fg] = TINT[t.status];

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg(err instanceof ConvexError ? String(err.data) : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={css('display:flex; flex-direction:column; gap:12px;')}>
      <div style={css('display:flex; align-items:center; justify-content:space-between;')}>
        <span style={css('font-size:20px; font-weight:700; color:#171717;')}>卓 {t.label}</span>
        <span style={css(`display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:700; padding:3px 9px; border-radius:2px; background:${bg}; border:1px solid ${bd}; color:${fg};`)}>{t.status}</span>
      </div>

      {t.sessionId && (
        <div style={css('display:flex; gap:14px; font-size:11px; color:#64748b;')}>
          <span>人数 <b className="tnum" style={css('color:#171717; font-size:13px;')}>{t.partySize ? t.partySize + '名' : '—'}</b></span>
          <span>滞在 <b className="tnum" style={css('color:#171717; font-size:13px;')}>{t.openedAt ? dur(now - t.openedAt) : '—'}</b></span>
        </div>
      )}

      {t.sessionId && <SessionLines sessionId={t.sessionId} billPreview={t.billPreview} />}

      <div style={css('display:flex; flex-direction:column; gap:8px;')}>
        {t.status === '空席' && (
          <>
            <button onClick={() => run(() => openSession({ tableId: t.tableId as Id<'tables'>, partySize: t.seats >= 4 ? 4 : 2 }), '着席の開始に失敗しました')} disabled={busy} style={css('width:100%; height:42px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:13px; font-weight:700;')}>着席を開始</button>
            <span style={css('font-size:10px; color:#cbd5e1; text-align:center;')}>客が卓QRを読むと自動で着席します</span>
          </>
        )}

        {t.status === '着席中' && (
          <>
            <button onClick={() => run(() => closeSession({ sessionId: t.sessionId as Id<'tableSessions'> }), '閉じるのに失敗しました')} disabled={busy} style={css('width:100%; height:40px; border-radius:2px; border:1px solid #cbd5e1; background:#fff; color:#64748b; font-size:12px;')}>現金・レジ会計で閉じる</button>
            <span style={css('font-size:10px; color:#cbd5e1; text-align:center;')}>カード／PayPay は客が卓QRから支払います</span>
          </>
        )}

        {t.status === '会計中' && (
          <div style={css('display:flex; flex-direction:column; gap:7px;')}>
            <div style={css('display:flex; align-items:center; gap:7px; font-size:12px; color:#b45309;')}><span style={css('animation:lampoBlink 1s infinite;')}>●</span> 会計処理中（ロック）</div>
            <button onClick={() => run(() => forceRelease({ sessionId: t.sessionId as Id<'tableSessions'> }), '解除に失敗しました')} disabled={busy} style={css('width:100%; height:36px; border-radius:2px; border:1px solid #fcd9a6; background:#fffbeb; color:#b45309; font-size:12px; font-weight:600;')}>会計ロックを解除</button>
          </div>
        )}

        {t.status === '会計済み' && (
          <>
            <div style={css('display:flex; align-items:center; gap:7px; font-size:13px; font-weight:700; color:#15803d;')}>✓ 会計済み</div>
            <button onClick={() => run(() => closeSession({ sessionId: t.sessionId as Id<'tableSessions'> }), '閉じるのに失敗しました')} disabled={busy} style={css('width:100%; height:42px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:13px; font-weight:700;')}>卓を閉じる（清掃へ）</button>
          </>
        )}

        {t.status === '清掃中' && (
          <>
            <span style={css('display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#3f5573;')}><span style={css('width:8px; height:8px; border-radius:50%; background:#7c93b3;')} />この卓は清掃中です</span>
            <button onClick={() => run(() => cleaningDone({ tableId: t.tableId as Id<'tables'> }), '更新に失敗しました')} disabled={busy} style={css('width:100%; height:42px; border-radius:2px; border:none; background:#3f5573; color:#fff; font-size:13px; font-weight:700;')}>清掃完了（空席に戻す）</button>
          </>
        )}
      </div>
      {msg && <p style={css('font-size:12px; color:#dc2626;')}>{msg}</p>}
    </div>
  );
}

function SessionLines({ sessionId, billPreview }: { sessionId: string; billPreview: number }) {
  const { data: lines } = useQuery(convexQuery(api.orders.listOrdersForStaff, { sessionId: sessionId as Id<'tableSessions'> }));
  const agg = new Map<string, { name: string; qty: number; total: number }>();
  for (const l of lines ?? []) {
    const e = agg.get(l.menuName) ?? { name: l.menuName, qty: 0, total: 0 };
    e.qty += l.qty;
    e.total += l.lineTotal ?? 0;
    agg.set(l.menuName, e);
  }
  const rows = [...agg.values()];
  return (
    <div style={css('display:flex; flex-direction:column; gap:8px;')}>
      <div style={css('font-size:11px; font-weight:700; color:#94a3b8;')}>注文明細</div>
      {rows.length === 0 ? (
        <p style={css('font-size:12px; color:#94a3b8;')}>まだ注文はありません。</p>
      ) : (
        <div style={css('display:flex; flex-direction:column; gap:5px;')}>
          {rows.map((r) => (
            <div key={r.name} style={css('display:flex; align-items:center; gap:7px; font-size:12px;')}>
              <span style={css('flex:1; min-width:0; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}>{r.name}</span>
              <span className="tnum" style={css('color:#94a3b8;')}>×{r.qty}</span>
              <span className="tnum" style={css('font-weight:700; color:#171717; width:54px; text-align:right;')}>{yen(r.total)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={css('display:flex; justify-content:space-between; align-items:baseline; padding-top:8px; border-top:1px solid #eef1f4;')}>
        <span style={css('font-size:12px; font-weight:700; color:#334155;')}>会計見込み</span>
        <span className="tnum" style={css('font-size:18px; font-weight:700; color:#171717;')}>{yen(billPreview)}</span>
      </div>
    </div>
  );
}

// ===== 設定タブ（店舗・卓・メニュー登録） =====
function StoreSetup() {
  const { data: store, isPending } = useQuery(convexQuery(api.stores.getMyStore, {}));
  const upsert = useMutation(api.stores.upsertMyStore);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await upsert({ name, slug });
      setMsg({ kind: 'ok', text: '保存しました' });
      setEditing(false);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ConvexError ? String(err.data) : '保存に失敗しました' });
    } finally {
      setBusy(false);
    }
  }
  if (isPending) return null;
  const showForm = editing || !store;
  return (
    <section className="flex flex-col gap-3 border border-slate-300 dark:border-slate-700 p-4 bg-white">
      <h2 className="text-sm font-bold text-slate-600">店舗の公開設定</h2>
      {store && !showForm && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-bold">{store.name}</span>
          <span className="font-mono text-slate-600">/t/{store.slug}/…</span>
          <button onClick={() => { setName(store.name); setSlug(store.slug); setEditing(true); setMsg(null); }} className="border border-slate-400 px-3 py-1 text-xs">変更</button>
        </div>
      )}
      {showForm && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <Field label="店名"><input required value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-48`} /></Field>
          <Field label="URL名"><input required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="gaslab" className={`${inputCls} w-48 font-mono`} /></Field>
          <button type="submit" disabled={busy} className="bg-foreground text-background px-4 py-1.5 text-sm disabled:opacity-50">{busy ? '保存中…' : '保存'}</button>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}
    </section>
  );
}

function TablesSetup() {
  const { data: tables } = useQuery(convexQuery(api.tables.listTables, {}));
  const generateTables = useMutation(api.tables.generateTables);
  const clearTables = useMutation(api.tables.clearTables);
  const [count2, setCount2] = useState(5);
  const [count4, setCount4] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const specs = [{ seats: 2, count: count2 }, { seats: 4, count: count4 }].filter((s) => s.count > 0);
      const res = await generateTables({ specs });
      setMsg({ kind: 'ok', text: `${res.created} 卓を登録しました` });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ConvexError ? String(err.data) : '登録に失敗しました' });
    } finally {
      setBusy(false);
    }
  }
  const hasTables = tables && tables.length > 0;
  return (
    <section className="flex flex-col gap-3 border border-slate-300 dark:border-slate-700 p-4 bg-white">
      <h2 className="text-sm font-bold text-slate-600">卓とQR用URL</h2>
      {hasTables ? (
        <div className="flex flex-col gap-2">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="border-b border-slate-300 text-slate-500 text-left"><th className="py-1 pr-4">卓</th><th className="py-1 pr-4">席数</th><th className="py-1">客用URL</th></tr></thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t._id} className="border-b border-slate-100"><td className="py-1.5 pr-4 font-medium">{t.label}</td><td className="py-1.5 pr-4 tabular-nums">{t.seats}</td><td className="py-1.5 font-mono text-xs break-all">{t.guestUrl}</td></tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => clearTables({}).then((r) => setMsg({ kind: 'ok', text: `${r.removed} 卓を削除` }))} disabled={busy} className="border border-slate-400 px-3 py-1 text-xs w-fit">卓を全削除</button>
        </div>
      ) : (
        <form onSubmit={onGenerate} className="flex flex-wrap items-end gap-4">
          <Field label="2名卓"><input type="number" min={0} value={count2} onChange={(e) => setCount2(Number(e.target.value))} className={`${inputCls} w-20 tabular-nums`} /></Field>
          <Field label="4名卓"><input type="number" min={0} value={count4} onChange={(e) => setCount4(Number(e.target.value))} className={`${inputCls} w-20 tabular-nums`} /></Field>
          <button type="submit" disabled={busy} className="bg-foreground text-background px-4 py-1.5 text-sm disabled:opacity-50">卓を登録</button>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}
    </section>
  );
}

function MenuSetup() {
  return (
    <section className="flex flex-col gap-3 border border-slate-300 dark:border-slate-700 p-4 bg-white">
      <h2 className="text-sm font-bold text-slate-600">商品マスタ</h2>
      <p className="text-sm text-slate-500">商品の価格・在庫・番号は <Link to="/menu" className="underline">商品マスタ画面</Link> で編集します。</p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      {children}
    </label>
  );
}

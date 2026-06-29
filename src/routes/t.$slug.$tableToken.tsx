import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useAction, useMutation } from 'convex/react';
import { useQuery } from '@tanstack/react-query';
import { convexQuery } from '@convex-dev/react-query';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { css } from '../lib/css';
import { C, yen, dateJa } from '../lib/format';

export const Route = createFileRoute('/t/$slug/$tableToken')({
  component: GuestTablePage,
  validateSearch: (s) => ({
    paid: s.paid === '1' ? true : undefined,
    canceled: s.canceled === '1' ? true : undefined,
    s: typeof s.s === 'string' ? s.s : undefined,
  }),
});

// 決済完了した会計を端末に保持しておくキー（リロード/戻るでも完了画面を維持し、新規セッションを作らない）。
function paidSessionKey(slug: string, tableToken: string): string {
  return `tablePaidSession:${slug}:${tableToken}`;
}

// 占有端末を識別する claimToken の保存キー（1卓1端末ロック。同じ端末だけが自分の会計に復帰できる）。
function tableClaimKey(slug: string, tableToken: string): string {
  return `tableClaim:${slug}:${tableToken}`;
}

// 次回クーポンコードはサーバー発行後にのみ表示（アンケート前はコードを出さない）。
function GuestTablePage() {
  const { slug, tableToken } = Route.useParams();
  const { canceled, s } = useSearch({ from: '/t/$slug/$tableToken' });
  const ensureSession = useMutation(api.sessions.ensureGuestSession);
  const [sessionId, setSessionId] = useState<Id<'tableSessions'> | null>(null);
  const [showingCompleted, setShowingCompleted] = useState(false);
  const [bootErr, setBootErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = paidSessionKey(slug, tableToken);

    // URL に s（会計セッションID）があれば、その会計に束縛する（paid 有無を問わない）。
    // 決済後URLを再読込しても新規セッションを作らず、サーバーの会計済み状態（settled/closed）を表示できる。
    if (s) {
      try {
        window.localStorage.setItem(key, s);
      } catch {
        /* localStorage 不可でもセッションIDは表示できる */
      }
      setSessionId(s as Id<'tableSessions'>);
      setShowingCompleted(true);
      return;
    }

    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      stored = null;
    }
    if (stored) {
      setSessionId(stored as Id<'tableSessions'>);
      setShowingCompleted(true);
      return;
    }

    // 占有ロック: 自端末の claimToken を送る。空席なら新規占有して claimToken を受け取り保存。
    // 占有中の別端末・清掃中・失効トークンはサーバーが ConvexError を返し、下の bootErr に出る。
    const claimKey = tableClaimKey(slug, tableToken);
    let claim: string | undefined;
    try {
      claim = window.localStorage.getItem(claimKey) ?? undefined;
    } catch {
      claim = undefined;
    }
    ensureSession({ slug, tableToken, claimToken: claim })
      .then((res) => {
        if (!cancelled) {
          setSessionId(res.sessionId);
          setShowingCompleted(false);
          if (res.claimToken) {
            try {
              window.localStorage.setItem(claimKey, res.claimToken);
            } catch {
              /* localStorage 不可でも占有は成立（再読込での復帰のみ不可） */
            }
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setBootErr(err instanceof ConvexError ? String(err.data) : '卓を開けませんでした');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, tableToken, ensureSession, s]);

  if (bootErr) {
    return (
      <Shell>
        <div style={css('padding:40px 22px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px;')}>
          <div style={css('width:44px;height:44px;border-radius:50%;background:#f1f5f9;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:22px;')}>!</div>
          <div style={css('font-size:14px; font-weight:700; color:#334155; line-height:1.7;')}>{bootErr}</div>
        </div>
      </Shell>
    );
  }
  if (!sessionId) {
    return (
      <Shell>
        <div style={css('padding:30px 18px; text-align:center; color:#94a3b8; font-size:13px;')}>卓を準備しています…</div>
      </Shell>
    );
  }

  return (
    <GuestTableContent
      slug={slug}
      tableToken={tableToken}
      sessionId={sessionId}
      canceled={canceled}
      showingCompleted={showingCompleted}
    />
  );
}

// スマホ幅のカードを中央に置く外枠。
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={css('min-height:100vh; background:#f4f5f7; display:flex; justify-content:center; padding:14px;')}>
      <div style={css('width:100%; max-width:420px; align-self:flex-start; display:flex; flex-direction:column;')}>
        <div style={css('border:1px solid #cbd5e1; background:#fff; display:flex; flex-direction:column;')}>{children}</div>
      </div>
    </main>
  );
}

type CartLine = { menuItemId: string; code: number | null; name: string; price: number; qty: number; serveAsap: boolean };

function GuestTableContent({
  slug,
  tableToken,
  sessionId,
  canceled,
  showingCompleted,
}: {
  slug: string;
  tableToken: string;
  sessionId: Id<'tableSessions'>;
  canceled?: boolean;
  showingCompleted: boolean;
}) {
  const { data: session } = useQuery(convexQuery(api.sessions.guestSession, { sessionId }));
  const { data: menu } = useQuery(convexQuery(api.menu.publicMenu, { slug }));
  const { data: orders } = useQuery(convexQuery(api.orders.listGuestOrders, { slug, tableToken, sessionId }));
  const addOrder = useMutation(api.orders.addGuestOrder);
  const recordSoldOut = useMutation(api.orders.recordSoldOut);
  const submitSurvey = useMutation(api.surveys.submit);
  const dismissSurvey = useMutation(api.surveys.dismiss);
  const redeemCoupon = useMutation(api.coupons.redeem);
  const checkout = useAction(api.stripe.createTableCheckoutSession);
  const recover = useAction(api.stripe.recoverGuestCheckout);

  const [keypad, setKeypad] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [menuRefOpen, setMenuRefOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [confirmingPay, setConfirmingPay] = useState(false);
  const [payWarnOpen, setPayWarnOpen] = useState(false);
  const [unservedPayAck, setUnservedPayAck] = useState(false);
  // 来店時のクーポン利用（再来客）。適用済みなら割引コードを保持（表示のみ）。
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponApplied, setCouponApplied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [farewell, setFarewell] = useState(false);
  const [secsLeft, setSecsLeft] = useState(5);
  // 会計後アンケート（任意）
  const [surveyDone, setSurveyDone] = useState(false);
  const [revealedCouponCode, setRevealedCouponCode] = useState<string | null>(null);
  const [revealedCouponExpiresAt, setRevealedCouponExpiresAt] = useState<number | null>(null);
  const [sat, setSat] = useState<number | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [revisit, setRevisit] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [toast, setToast] = useState<{ msg: string; kind: 'ink' | 'green' | 'amber' | 'red' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string, kind: 'ink' | 'green' | 'amber' | 'red' = 'ink') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // サーバーに記録済みのクーポン適用を UI に反映（再読込後も維持）。
  useEffect(() => {
    setCouponApplied(session?.appliedCoupon?.code ?? null);
  }, [session?.appliedCoupon?.code]);

  // サーバー記録（再読込後も維持）＋送信直後の楽観更新。
  useEffect(() => {
    if (session?.surveyResponded) setSurveyDone(true);
  }, [session?.surveyResponded]);

  useEffect(() => {
    if (session?.issuedCouponCode) setRevealedCouponCode(session.issuedCouponCode);
  }, [session?.issuedCouponCode]);

  useEffect(() => {
    if (session?.issuedCouponExpiresAt) setRevealedCouponExpiresAt(session.issuedCouponExpiresAt);
  }, [session?.issuedCouponExpiresAt]);

  // 会計が成立したか（Stripe webhook 反映後に true）。
  const settledNow = session?.settleStatus === 'succeeded' || session?.closedAt != null;

  // 会計完了 → 数秒「ありがとうございました」を見せてからお別れ画面へ切り替える
  // （可能ならタブも閉じる。スクリプトで開いたタブ以外はブラウザが閉じさせないので、お別れ画面が最終表示になる）。
  // アンケート送信/スキップで surveyDone=true → 下のカウントダウンが回り、お別れ画面へ。
  async function sendSurvey(skip: boolean) {
    try {
      if (skip) {
        const res = await dismissSurvey({ slug, sessionId });
        if (res.couponCode) setRevealedCouponCode(res.couponCode);
        if (res.expiresAt) setRevealedCouponExpiresAt(res.expiresAt);
      } else {
        const res = await submitSurvey({
          slug,
          sessionId,
          satisfaction: sat ?? undefined,
          gender: gender ?? undefined,
          ageGroup: age ?? undefined,
          revisit: revisit ?? undefined,
          comment: comment.trim() || undefined,
        });
        if (res.couponCode) setRevealedCouponCode(res.couponCode);
        if (res.expiresAt) setRevealedCouponExpiresAt(res.expiresAt);
      }
    } catch {
      /* best-effort */
    }
    setSurveyDone(true);
  }

  useEffect(() => {
    const answered = session?.surveyResponded || surveyDone;
    if (!settledNow || !answered || farewell) return;
    setSecsLeft(5);
    const iv = setInterval(() => {
      setSecsLeft((n) => {
        if (n <= 1) {
          clearInterval(iv);
          setFarewell(true);
          try {
            window.close();
          } catch {
            /* ブラウザが閉じさせない場合は無視（お別れ画面のまま） */
          }
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [settledNow, surveyDone, farewell, session?.surveyResponded]);

  const menuList = menu ?? [];
  const itemByCode = (code: string) => menuList.find((m) => m.code != null && m.code === Number(code));
  const cartQty = (menuItemId: string) => cart.filter((c) => c.menuItemId === menuItemId).reduce((a, c) => a + c.qty, 0);

  const press = (k: string) =>
    setKeypad((kp) => (k === 'C' ? '' : k === 'back' ? kp.slice(0, -1) : kp.length < 4 ? kp + k : kp));

  function addToCart(item?: (typeof menuList)[number]) {
    const it = item ?? itemByCode(keypad);
    if (!it) {
      flash('該当する番号がありません', 'red');
      return;
    }
    if (it.soldOut || (it.stock != null && it.stock - cartQty(it._id) <= 0)) {
      flash(it.name + ' は売り切れです', 'red');
      // 機会損失として記録（best-effort・分析の「品切れ発生」に集計）。
      void recordSoldOut({ slug, menuItemId: it._id as Id<'menuItems'> }).catch(() => {});
      return;
    }
    setCart((prev) => {
      const next = prev.slice();
      const ex = next.find((c) => c.menuItemId === it._id);
      if (ex) ex.qty += 1;
      else next.push({ menuItemId: it._id, code: it.code, name: it.name, price: it.price ?? 0, qty: 1, serveAsap: it.serveAsap });
      return next;
    });
    setKeypad('');
    flash(it.name + ' をカートに追加', 'ink');
  }
  const cartInc = (id: string) => {
    const it = menuList.find((m) => m._id === id);
    if (it && it.stock != null && it.stock - cartQty(id) <= 0) {
      flash('在庫が足りません', 'red');
      return;
    }
    setCart((prev) => prev.map((c) => (c.menuItemId === id ? { ...c, qty: c.qty + 1 } : c)));
  };
  const cartDec = (id: string) =>
    setCart((prev) => prev.map((c) => (c.menuItemId === id ? { ...c, qty: c.qty - 1 } : c)).filter((c) => c.qty > 0));

  async function placeOrder() {
    if (!cart.length) {
      flash('カートが空です', 'red');
      return;
    }
    setBusy(true);
    try {
      for (const c of cart) {
        await addOrder({ slug, tableToken, sessionId, menuItemId: c.menuItemId as Id<'menuItems'>, qty: c.qty });
      }
      setCart([]);
      flash('注文を送信しました（キッチンへ）', 'green');
    } catch (err) {
      flash(err instanceof ConvexError ? String(err.data) : '注文に失敗しました', 'red');
    } finally {
      setBusy(false);
    }
  }

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) {
      flash('クーポンコードを入力してください', 'red');
      return;
    }
    setBusy(true);
    try {
      const res = await redeemCoupon({ slug, sessionId, code });
      setCouponApplied(res.code);
      setCouponInput('');
      setCouponOpen(false);
      flash(res.already ? 'クーポンは適用済みです' : 'クーポンを適用しました（この会計から10%OFF）', 'green');
    } catch (err) {
      flash(err instanceof ConvexError ? String(err.data) : 'クーポンを適用できませんでした', 'red');
    } finally {
      setBusy(false);
    }
  }

  async function onPay() {
    const unservedQty = (orders ?? []).filter((o) => o.servedAt == null).reduce((a, o) => a + o.qty, 0);
    if (unservedQty > 0 && !unservedPayAck) {
      setPayWarnOpen(true);
      return;
    }
    setBusy(true);
    try {
      const res = await checkout({ sessionId, slug, tableToken });
      if (res.url) {
        window.location.assign(res.url);
      } else {
        flash('決済画面の URL が取得できませんでした。もう一度お試しください', 'red');
      }
    } catch (err) {
      const msg =
        err instanceof ConvexError
          ? String(err.data)
          : err instanceof Error
            ? err.message
            : '会計の開始に失敗しました';
      flash(msg, 'red');
    } finally {
      setBusy(false);
    }
  }
  async function onRecover() {
    setBusy(true);
    try {
      const res = await recover({ sessionId, slug, tableToken });
      flash(res.status === 'succeeded' ? 'お会計が完了していました' : '会計をキャンセルしました', 'ink');
    } catch (err) {
      flash(err instanceof Error ? err.message : '会計の取り消しに失敗しました', 'red');
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <Shell>
        <div style={css('padding:30px 18px; text-align:center; color:#94a3b8; font-size:13px;')}>読み込み中…</div>
      </Shell>
    );
  }

  const billSubtotal = session.billSubtotal ?? session.billPreview ?? 0;
  const bill = session.billPayable ?? session.billPreview ?? 0;
  const couponDiscount = session.appliedCoupon?.discountAmount ?? 0;
  const charged = session.finalChargeAmount ?? bill;
  const placed = orders ?? [];
  const unservedOrders = placed.filter((o) => o.servedAt == null);
  const unservedQty = unservedOrders.reduce((a, o) => a + o.qty, 0);

  function beginCheckout() {
    if (unservedQty > 0 && !unservedPayAck) {
      setPayWarnOpen(true);
      return;
    }
    setPayWarnOpen(false);
    setConfirmingPay(true);
  }

  function cancelCheckout() {
    setConfirmingPay(false);
    setPayWarnOpen(false);
    setUnservedPayAck(false);
  }

  function proceedDespiteUnserved() {
    setUnservedPayAck(true);
    setPayWarnOpen(false);
    setConfirmingPay(true);
  }

  const charging = session.settleStatus === 'charging';
  // 完了画面はサーバー状態（会計済み/退店済み）でも開く。?paid=1 任せにしないことで、
  // 会計済みセッションに再アクセスしても注文画面を出さない＝再注文を防ぐ。
  const completed = settledNow || showingCompleted;
  const orderable = !completed && !charging && session.canOrder;
  const effectiveStarted = started || placed.length > 0;
  const showStart = orderable && !effectiveStarted;
  const showOrder = orderable && effectiveStarted;
  const canPay = !!session.canPay && bill > 0;

  // テンキープレビュー
  const kp = keypad;
  const cells = [0, 1, 2, 3].map((i) => ({
    ch: kp[i] || '',
    boxStyle: `width:46px; height:54px; border-radius:2px; border:1px solid ${kp[i] ? '#171717' : '#e2e8f0'}; background:${kp[i] ? '#171717' : '#f8fafc'}; color:${kp[i] ? '#fff' : '#cbd5e1'}; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:700; font-variant-numeric:tabular-nums;`,
  }));
  let preview: { state: string; name: string; price: string; note: string; col: string };
  if (!kp) {
    preview = { state: 'empty', name: 'メニュー番号を入力', price: '', note: '紙メニューの4桁番号をテンキーで', col: C.faint };
  } else {
    const it = itemByCode(kp);
    if (it) {
      const sold = it.soldOut || (it.stock != null && it.stock - cartQty(it._id) <= 0);
      preview = sold
        ? { state: 'sold', name: it.name, price: yen(it.price ?? 0), note: it.soldOut ? '売り切れ' : 'カート上限に達しました', col: C.red }
        : { state: 'ok', name: it.name, price: yen(it.price ?? 0), note: it.stock == null ? '追加できます' : it.stock <= 3 ? '残りわずか・あと' + it.stock + '点' : '追加できます', col: C.green };
    } else {
      preview = { state: 'none', name: kp.length < 4 ? '…' : '該当する番号がありません', price: '', note: kp.length < 4 ? '入力中' : 'もう一度ご確認ください', col: kp.length < 4 ? C.faint : C.red };
    }
  }
  const canAdd = preview.state === 'ok';
  const previewBg = preview.state === 'ok' ? '#f0fdf4' : preview.state === 'sold' || (preview.state === 'none' && kp.length === 4) ? '#fef2f2' : '#f8fafc';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'back'];

  // メニュー番号一覧（カテゴリ別）
  const cats: string[] = [];
  for (const m of menuList) {
    const c = m.category ?? 'その他';
    if (!cats.includes(c)) cats.push(c);
  }
  const cartCount = cart.reduce((a, c) => a + c.qty, 0);
  const cartTotal = cart.reduce((a, c) => a + c.price * c.qty, 0);

  const toastBg = { ink: '#171717', green: '#15803d', amber: '#b45309', red: '#dc2626' }[toast?.kind ?? 'ink'];

  const Header = (
    <div style={css('flex:0 0 auto; padding:14px 16px 12px; border-bottom:1px solid #eef1f4;')}>
      <div style={css('font-size:16px; font-weight:700; letter-spacing:.01em; color:#171717;')}>{session.storeName}</div>
      <div style={css('display:flex; align-items:center; gap:7px; margin-top:3px;')}>
        <span style={css('font-size:12px; font-weight:700; color:#171717; background:#f1f5f9; border-radius:2px; padding:2px 7px;')}>卓 {session.tableLabel}</span>
        <span style={css('font-size:11px; color:#64748b;')}>{session.seats}名席</span>
        <span style={css('display:inline-flex; align-items:center; gap:4px; font-size:10px; color:#15803d;')}>
          <span style={css('width:6px;height:6px;border-radius:50%;background:#16a34a;animation:lampoDot 1.6s infinite;')} />接続中
        </span>
      </div>
    </div>
  );

  const surveyAnswered = !!(session?.surveyResponded || surveyDone);
  const displayCouponCode = session?.issuedCouponCode ?? revealedCouponCode;
  const displayCouponExpiresAt = session?.issuedCouponExpiresAt ?? revealedCouponExpiresAt;
  const showCouponBox = surveyAnswered && !!displayCouponCode;

  // 次回クーポン（アンケート回答/スキップ後・サーバー発行コードのみ表示）。
  const couponBox = showCouponBox ? (
    <div style={css('width:100%; margin-top:8px; border:1px dashed #f59e0b; background:#fffbeb; border-radius:4px; padding:12px 14px; display:flex; flex-direction:column; align-items:center; gap:5px;')}>
      <div style={css('font-size:11px; font-weight:700; color:#b45309; letter-spacing:.04em;')}>🎟 次回ご来店で使えるクーポン</div>
      <div style={css('font-size:15px; font-weight:800; color:#92400e;')}>次回のお会計 10%OFF</div>
      <div style={css('font-size:16px; font-weight:700; color:#171717; background:#fff; border:1px solid #fcd9a6; border-radius:3px; padding:4px 14px; letter-spacing:.14em; font-variant-numeric:tabular-nums;')}>{displayCouponCode}</div>
      {displayCouponExpiresAt != null && (
        <div style={css('font-size:11px; font-weight:700; color:#b45309;')}>有効期限：{dateJa(displayCouponExpiresAt)}まで</div>
      )}
      <div style={css('font-size:10px; color:#a16207; line-height:1.5; text-align:center;')}>
        発行から3ヶ月以内・1回限り・譲渡不可<br />次回ご注文時にこのコードを入力してください
      </div>
    </div>
  ) : surveyAnswered ? (
    <div style={css('margin-top:8px; font-size:11px; color:#94a3b8;')}>クーポンを発行しています…</div>
  ) : null;

  // 注文履歴（キッチン提供状況をリアルタイム反映）。
  const orderHistoryBlock = (
    <div style={css('border:1px solid #e6e9ee; border-radius:2px; padding:12px 13px;')}>
      <div style={css('font-size:11px; font-weight:700; color:#64748b; margin-bottom:8px; letter-spacing:.03em;')}>注文履歴</div>
      <div style={css('display:flex; flex-direction:column; gap:7px;')}>
        {placed.map((o) => {
          const served = o.servedAt != null;
          return (
            <div key={o._id} style={css('display:flex; align-items:center; gap:8px; font-size:13px;')}>
              <span style={css('flex:1; min-width:0; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}>{o.menuName}</span>
              <span className="tnum" style={css('color:#94a3b8;')}>×{o.qty}</span>
              <span style={css(`flex:0 0 auto; font-size:10px; font-weight:700; padding:2px 7px; border-radius:2px; color:${served ? '#15803d' : '#1d4ed8'}; background:${served ? '#eaf5ee' : '#eff6ff'}; border:1px solid ${served ? '#bbf7d0' : '#bfdbfe'};`)}>
                {served ? '提供済み' : '調理中'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // クーポン利用（来店時・任意）。前回もらったコードを入力して再来を記録。
  const couponEntry = (session.appliedCoupon ?? couponApplied) ? (
    <div style={css('width:100%; border:1px solid #bbf7d0; background:#f0fdf4; border-radius:4px; padding:10px 13px; display:flex; align-items:center; gap:8px;')}>
      <span style={css('font-size:14px;')}>🎟</span>
      <div style={css('flex:1; min-width:0;')}>
        <div style={css('font-size:12px; font-weight:700; color:#166534;')}>クーポン適用：この会計から10%OFF</div>
        <div style={css('font-size:10px; color:#15803d; letter-spacing:.06em;')}>{session.appliedCoupon?.code ?? couponApplied}</div>
        {couponDiscount > 0 && (
          <div style={css('font-size:11px; color:#15803d; margin-top:2px;')}>割引 {yen(couponDiscount)}（お支払い {yen(bill)}）</div>
        )}
      </div>
    </div>
  ) : (
    <div style={css('width:100%; border:1px solid #eef1f4; border-radius:4px; overflow:hidden;')}>
      <button onClick={() => setCouponOpen((p) => !p)} style={css('width:100%; display:flex; align-items:center; justify-content:space-between; padding:10px 13px; border:none; background:#fafbfc; color:#475569; font-size:12px; font-weight:700;')}>
        <span>🎟 クーポンをお持ちの方</span>
        <span style={css('color:#94a3b8;')}>{couponOpen ? '閉じる ▲' : '入力 ▼'}</span>
      </button>
      {couponOpen && (
        <div style={css('padding:11px 13px; border-top:1px solid #eef1f4; display:flex; flex-direction:column; gap:8px;')}>
          <div style={css('font-size:11px; color:#94a3b8; line-height:1.5;')}>前回お渡ししたクーポンコード（GASLAB-xxxx）を入力してください。有効期限は発行から3ヶ月・1回限りです。</div>
          <div style={css('display:flex; gap:7px;')}>
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              placeholder="GASLAB-XXXX"
              autoCapitalize="characters"
              style={css('flex:1; min-width:0; height:40px; border:1px solid #cbd5e1; border-radius:3px; padding:0 11px; font-size:14px; letter-spacing:.06em; color:#171717;')}
            />
            <button onClick={applyCoupon} disabled={busy} style={css('flex:0 0 auto; height:40px; padding:0 16px; border-radius:3px; border:none; background:#171717; color:#fff; font-size:13px; font-weight:700;')}>適用</button>
          </div>
        </div>
      )}
    </div>
  );

  // 会計後アンケート（任意・数タップ）。
  const choiceBtn = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={css(`height:32px; padding:0 11px; border-radius:3px; border:1px solid ${active ? '#171717' : '#e2e8f0'}; background:${active ? '#171717' : '#fff'}; color:${active ? '#fff' : '#475569'}; font-size:12px; font-weight:${active ? 700 : 500};`)}
    >
      {label}
    </button>
  );
  const surveyForm = (
    <div style={css('width:100%; margin-top:12px; padding-top:12px; border-top:1px dashed #e2e8f0; display:flex; flex-direction:column; gap:11px;')}>
      <div style={css('font-size:12px; font-weight:700; color:#475569;')}>アンケートにご協力ください（任意・数タップ）</div>
      <div style={css('border:1px dashed #fcd9a6; background:#fffbeb; border-radius:4px; padding:10px 12px; text-align:center;')}>
        <div style={css('font-size:11px; font-weight:700; color:#b45309;')}>🎟 回答後に次回クーポンを発行します</div>
        <div style={css('font-size:11px; color:#a16207; line-height:1.6; margin-top:4px;')}>
          送信またはスキップ後、次回ご来店で使える<br />お会計 <strong>10%OFF</strong> クーポンコードを表示します<br />
          <span style={css('font-size:10px;')}>（発行から3ヶ月以内・1回限り・譲渡不可）</span>
        </div>
      </div>
      <div style={css('display:flex; flex-direction:column; gap:5px; align-items:center;')}>
        <div style={css('font-size:11px; color:#94a3b8;')}>満足度</div>
        <div style={css('display:flex; gap:4px;')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setSat(n)} style={css(`font-size:27px; line-height:1; background:none; border:none; padding:0 2px; cursor:pointer; color:${sat != null && n <= sat ? '#f59e0b' : '#e2e8f0'};`)}>★</button>
          ))}
        </div>
      </div>
      <div style={css('display:flex; flex-direction:column; gap:5px; align-items:center;')}>
        <div style={css('font-size:11px; color:#94a3b8;')}>性別</div>
        <div style={css('display:flex; gap:6px;')}>
          {choiceBtn(gender === 'male', '男性', () => setGender('male'))}
          {choiceBtn(gender === 'female', '女性', () => setGender('female'))}
          {choiceBtn(gender === 'other', 'その他', () => setGender('other'))}
        </div>
      </div>
      <div style={css('display:flex; flex-direction:column; gap:5px; align-items:center;')}>
        <div style={css('font-size:11px; color:#94a3b8;')}>年代</div>
        <div style={css('display:flex; gap:5px; flex-wrap:wrap; justify-content:center;')}>
          {['10', '20', '30', '40', '50', '60'].map((a) => choiceBtn(age === a, a === '60' ? '60代〜' : a + '代', () => setAge(a)))}
        </div>
      </div>
      <div style={css('display:flex; flex-direction:column; gap:5px; align-items:center;')}>
        <div style={css('font-size:11px; color:#94a3b8;')}>また来たい？</div>
        <div style={css('display:flex; gap:6px;')}>
          {choiceBtn(revisit === 'high', 'ぜひ', () => setRevisit('high'))}
          {choiceBtn(revisit === 'mid', 'たぶん', () => setRevisit('mid'))}
          {choiceBtn(revisit === 'low', 'うーん', () => setRevisit('low'))}
        </div>
      </div>
      <div style={css('display:flex; flex-direction:column; gap:5px;')}>
        <div style={css('font-size:11px; color:#94a3b8; text-align:center;')}>ご意見・ご感想（任意）</div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 400))}
          placeholder="料理・接客・お店の雰囲気など、お気づきの点をご自由にどうぞ"
          rows={3}
          style={css('width:100%; box-sizing:border-box; border:1px solid #e2e8f0; border-radius:3px; padding:8px 10px; font-size:13px; line-height:1.6; color:#1e293b; resize:none; font-family:inherit;')}
        />
      </div>
      <div style={css('display:flex; gap:8px; margin-top:2px;')}>
        <button onClick={() => void sendSurvey(false)} style={css('flex:1; height:38px; border-radius:3px; border:none; background:#15803d; color:#fff; font-size:13px; font-weight:700;')}>送信する</button>
        <button onClick={() => void sendSurvey(true)} style={css('height:38px; padding:0 14px; border-radius:3px; border:1px solid #cbd5e1; background:#fff; color:#94a3b8; font-size:12px; font-weight:500;')}>スキップ</button>
      </div>
    </div>
  );

  return (
    <main style={css('min-height:100vh; background:#f4f5f7; display:flex; justify-content:center; padding:14px;')}>
      <div style={css('width:100%; max-width:420px; align-self:flex-start; display:flex; flex-direction:column;')}>
        <div style={css('display:flex; align-items:center; gap:8px; margin-bottom:8px; padding-left:2px;')}>
          <span style={css('font-size:12px; font-weight:700; color:#171717;')}>客スマホ（卓QR）</span>
          <span style={css('font-size:11px; color:#94a3b8; white-space:nowrap;')}>/t/{slug}/{tableToken}</span>
        </div>
        <div style={css('border:1px solid #cbd5e1; background:#fff; display:flex; flex-direction:column;')}>
          {Header}
          <div style={css('padding:14px 16px 18px; display:flex; flex-direction:column; gap:14px;')}>

            {canceled && !completed && (
              <div style={css('font-size:12px; color:#b45309; border:1px solid #fcd9a6; background:#fffbeb; border-radius:2px; padding:9px 11px;')}>お会計をキャンセルしました。</div>
            )}

            {/* 完了画面 */}
            {completed && (farewell ? (
              /* お別れ画面（数秒後に自動表示。可能ならタブも閉じる） */
              <div style={css('display:flex; flex-direction:column; align-items:center; gap:10px; border:1px solid #bbf7d0; background:#f0fdf4; border-radius:2px; padding:40px 16px; text-align:center;')}>
                <div style={css('width:48px;height:48px;border-radius:50%;background:#15803d;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;')}>✓</div>
                <div style={css('font-size:20px; font-weight:700; color:#166534;')}>ありがとうございました</div>
                <div style={css('font-size:12px; color:#15803d; line-height:1.7;')}>またのご来店をお待ちしております。<br />この画面は閉じていただけます。</div>
                {showCouponBox && couponBox}
              </div>
            ) : (
              <div style={css(`display:flex; flex-direction:column; align-items:center; gap:8px; border:1px solid ${settledNow ? '#bbf7d0' : '#fcd9a6'}; background:${settledNow ? '#f0fdf4' : '#fffbeb'}; border-radius:2px; padding:26px 16px; text-align:center;`)}>
                {settledNow ? (
                  <>
                    <div style={css('width:42px;height:42px;border-radius:50%;background:#15803d;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;')}>✓</div>
                    <div style={css('font-size:18px; font-weight:700; color:#166534;')}>お会計が完了しました</div>
                    <div style={css('font-size:12px; color:#15803d;')}>ご利用ありがとうございました</div>
                    <div className="tnum" style={css('margin-top:6px; font-size:16px; font-weight:700; color:#171717;')}>お支払い {yen(charged)}</div>
                    {surveyAnswered ? (
                      <>
                        {couponBox}
                        <div style={css('margin-top:8px; font-size:11px; color:#94a3b8;')}>あと {secsLeft} 秒で画面を閉じます…</div>
                      </>
                    ) : (
                      surveyForm
                    )}
                  </>
                ) : (
                  <>
                    <div style={css('white-space:nowrap; font-size:14px; font-weight:700; color:#b45309;')}>お支払いを確認しています…</div>
                    <div style={css('font-size:12px; color:#b45309; line-height:1.6;')}>この画面のままお待ちください（自動で完了します）。</div>
                  </>
                )}
              </div>
            ))}

            {/* 会計処理中 */}
            {charging && !completed && (
              <div style={css('display:flex; flex-direction:column; gap:13px;')}>
                <div style={css('display:flex; flex-direction:column; align-items:center; gap:10px; border:1px solid #fcd9a6; background:#fffbeb; border-radius:2px; padding:30px 16px; text-align:center;')}>
                  <div style={css('white-space:nowrap; font-size:13px; font-weight:700; color:#b45309;')}><span style={css('animation:lampoBlink 1s infinite;')}>●</span> 会計処理中</div>
                  <div style={css('font-size:12px; color:#b45309; line-height:1.6;')}>Stripe の決済画面でお支払いください。<br />画面が開かない場合は下のボタンを押してください。</div>
                  <div className="tnum" style={css('margin-top:4px; font-size:16px; font-weight:700; color:#171717;')}>{yen(bill)}</div>
                  <button onClick={onPay} disabled={busy} style={css('margin-top:6px; width:100%; height:44px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:14px; font-weight:700;')}>決済画面を開く</button>
                  <button onClick={onRecover} disabled={busy} style={css('height:36px; padding:0 14px; border-radius:2px; border:1px solid #fcd9a6; background:#fff; color:#b45309; font-size:12px; font-weight:600;')}>会計をやり直す</button>
                </div>
                {placed.length > 0 && orderHistoryBlock}
              </div>
            )}

            {/* スタート */}
            {showStart && (
              <div style={css('display:flex; flex-direction:column; align-items:center; gap:8px; border:1px solid #e6e9ee; background:#fff; border-radius:2px; padding:30px 18px; text-align:center;')}>
                <div style={css('font-size:11px; color:#94a3b8; letter-spacing:.08em;')}>{session.storeName}</div>
                <div style={css('font-size:20px; font-weight:700; color:#171717;')}>いらっしゃいませ</div>
                <div style={css('display:flex; align-items:center; gap:7px; margin-top:2px;')}>
                  <span style={css('font-size:12px; font-weight:700; color:#171717; background:#f1f5f9; border-radius:2px; padding:2px 8px;')}>卓 {session.tableLabel}</span>
                  <span style={css('font-size:11px; color:#64748b;')}>{session.seats}名席</span>
                </div>
                <div style={css('font-size:12px; color:#94a3b8; line-height:1.7; margin-top:6px;')}>紙メニューの4桁番号を入力して<br />ご注文いただけます。</div>
                <button onClick={() => setStarted(true)} style={css('margin-top:14px; width:100%; height:48px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:15px; font-weight:700;')}>注文を始める</button>
                <div style={css('width:100%; margin-top:12px;')}>{couponEntry}</div>
              </div>
            )}

            {/* 注文（テンキー・カート・伝票） */}
            {showOrder && (
              <div style={css('display:flex; flex-direction:column; gap:13px;')}>
                <div style={css('border:1px solid #e6e9ee; border-radius:2px; overflow:hidden;')}>
                  <div style={css('display:flex; gap:7px; padding:13px 14px 0; justify-content:center;')}>
                    {cells.map((cell, i) => (<div key={i} style={css(cell.boxStyle)}>{cell.ch}</div>))}
                  </div>
                  <div style={css(`padding:11px 14px 13px; margin-top:11px; background:${previewBg}; border-top:1px solid #eef1f4; display:flex; align-items:center; justify-content:space-between; gap:10px;`)}>
                    <div style={css('min-width:0;')}>
                      <div style={css('font-size:15px; font-weight:700; color:#171717; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}>{preview.name}</div>
                      <div style={css(`font-size:11px; font-weight:600; color:${preview.col}; margin-top:2px;`)}>{preview.note}</div>
                    </div>
                    <div className="tnum" style={css('font-size:17px; font-weight:700; color:#171717; white-space:nowrap;')}>{preview.price}</div>
                  </div>
                </div>

                <div style={css('display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;')}>
                  {keys.map((k) => {
                    const fn = k === 'C' || k === 'back';
                    return (
                      <button key={k} onClick={() => press(k)} style={css(`height:54px; border-radius:2px; border:1px solid ${fn ? '#e2e8f0' : '#d8dee6'}; background:${fn ? '#f1f5f9' : '#fff'}; color:${k === 'C' ? C.red : k === 'back' ? C.sub : C.ink}; font-size:${fn ? '18px' : '22px'}; font-weight:600; font-variant-numeric:tabular-nums;`)}>
                        {k === 'back' ? '⌫' : k}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => { if (canAdd) addToCart(); }} style={css(`width:100%; height:48px; border-radius:2px; border:none; background:${canAdd ? '#171717' : '#e2e8f0'}; color:${canAdd ? '#fff' : '#94a3b8'}; font-size:15px; font-weight:700; cursor:${canAdd ? 'pointer' : 'default'};`)}>注文追加</button>

                {cart.length > 0 && (
                  <div style={css('border:1px solid #e6e9ee; border-radius:2px; padding:12px 13px; background:#fbfcfd;')}>
                    <div style={css('display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;')}>
                      <span style={css('font-size:12px; font-weight:700; color:#334155;')}>カート（{cartCount}点）</span>
                      <span className="tnum" style={css('font-size:13px; font-weight:700; color:#171717;')}>{yen(cartTotal)}</span>
                    </div>
                    <div style={css('display:flex; flex-direction:column; gap:7px;')}>
                      {cart.map((c) => (
                        <div key={c.menuItemId} style={css('display:flex; align-items:center; gap:9px;')}>
                          <span className="tnum" style={css('font-size:11px; color:#94a3b8; width:34px;')}>{c.code ?? ''}</span>
                          <span style={css('flex:1; min-width:0; font-size:13px; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}>{c.name}</span>
                          <div style={css('display:flex; align-items:center; gap:0; border:1px solid #cbd5e1; border-radius:2px; overflow:hidden;')}>
                            <button onClick={() => cartDec(c.menuItemId)} style={css('width:26px; height:26px; border:none; background:#fff; color:#64748b; font-size:16px; line-height:1;')}>−</button>
                            <span className="tnum" style={css('width:24px; text-align:center; font-size:13px; font-weight:700;')}>{c.qty}</span>
                            <button onClick={() => cartInc(c.menuItemId)} style={css('width:26px; height:26px; border:none; background:#fff; color:#64748b; font-size:16px; line-height:1;')}>＋</button>
                          </div>
                          <span className="tnum" style={css('font-size:12px; font-weight:700; color:#171717; width:52px; text-align:right;')}>{yen(c.price * c.qty)}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={placeOrder} disabled={busy} style={css('width:100%; height:46px; margin-top:11px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:15px; font-weight:700;')}>注文する（{cartCount}点）</button>
                  </div>
                )}

                {placed.length > 0 && orderHistoryBlock}

                {placed.length > 0 && (
                  <div style={css('border:1px solid #e6e9ee; border-radius:2px; padding:12px 13px;')}>
                    <div style={css('font-size:11px; font-weight:700; color:#64748b; margin-bottom:8px; letter-spacing:.03em;')}>お会計</div>
                    <div style={css('display:flex; flex-direction:column; gap:6px;')}>
                      {couponDiscount > 0 && (
                        <>
                          <div style={css('display:flex; justify-content:space-between; align-items:baseline;')}>
                            <span style={css('font-size:12px; color:#64748b;')}>小計（税込）</span>
                            <span className="tnum" style={css('font-size:14px; color:#64748b;')}>{yen(billSubtotal)}</span>
                          </div>
                          <div style={css('display:flex; justify-content:space-between; align-items:baseline;')}>
                            <span style={css('font-size:12px; font-weight:700; color:#15803d;')}>クーポン割引（10%OFF）</span>
                            <span className="tnum" style={css('font-size:14px; font-weight:700; color:#15803d;')}>−{yen(couponDiscount)}</span>
                          </div>
                        </>
                      )}
                      <div style={css('display:flex; justify-content:space-between; align-items:baseline;')}>
                        <span style={css('font-size:12px; font-weight:700; color:#334155;')}>合計（税込）</span>
                        <span className="tnum" style={css('font-size:18px; font-weight:700; color:#171717;')}>{yen(bill)}</span>
                      </div>
                    </div>
                    {canPay && payWarnOpen && !confirmingPay && (
                      <div style={css('margin-top:11px; border:1px solid #fcd9a6; border-radius:2px; padding:13px; display:flex; flex-direction:column; gap:10px; background:#fffbeb;')}>
                        <div style={css('font-size:14px; font-weight:700; color:#b45309; text-align:center;')}>調理中の料理があります</div>
                        <div style={css('font-size:12px; color:#92400e; line-height:1.6; text-align:center;')}>
                          まだ提供されていない料理が {unservedQty} 点あります。<br />提供を待たずに会計へ進みますか？
                        </div>
                        <div style={css('display:flex; flex-direction:column; gap:5px; padding:8px 10px; background:#fff; border:1px solid #fcd9a6; border-radius:2px;')}>
                          {unservedOrders.map((o) => (
                            <div key={o._id} style={css('display:flex; align-items:center; gap:8px; font-size:12px; color:#78350f;')}>
                              <span style={css('flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}>{o.menuName}</span>
                              <span className="tnum" style={css('font-weight:700;')}>×{o.qty}</span>
                              <span style={css('font-size:10px; font-weight:700; color:#1d4ed8;')}>調理中</span>
                            </div>
                          ))}
                        </div>
                        <div style={css('display:flex; gap:8px;')}>
                          <button onClick={() => setPayWarnOpen(false)} disabled={busy} style={css('flex:1; height:48px; border-radius:2px; border:1px solid #fcd9a6; background:#fff; color:#b45309; font-size:14px; font-weight:700;')}>提供を待つ</button>
                          <button onClick={proceedDespiteUnserved} disabled={busy} style={css('flex:1; height:48px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:14px; font-weight:700;')}>このまま会計へ</button>
                        </div>
                      </div>
                    )}
                    {canPay && !confirmingPay && !payWarnOpen && (
                      <button onClick={beginCheckout} style={css('width:100%; height:50px; margin-top:11px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:15px; font-weight:700;')}>会計へ進む（{yen(bill)}）</button>
                    )}
                    {canPay && confirmingPay && (
                      <div style={css('margin-top:11px; border:1px solid #cbd5e1; border-radius:2px; padding:13px; display:flex; flex-direction:column; gap:10px; background:#fbfcfd;')}>
                        {unservedQty > 0 && (
                          <div style={css('font-size:11px; color:#b45309; line-height:1.5; text-align:center; border:1px solid #fcd9a6; background:#fffbeb; border-radius:2px; padding:8px 10px;')}>
                            調理中の料理 {unservedQty} 点を含むお会計です
                          </div>
                        )}
                        <div style={css('font-size:14px; font-weight:700; color:#171717; text-align:center;')}>このお会計でよろしいですか？</div>
                        <div style={css('display:flex; justify-content:space-between; align-items:baseline;')}>
                          <span style={css('font-size:12px; font-weight:700; color:#334155;')}>合計（税込）</span>
                          <span className="tnum" style={css('font-size:20px; font-weight:700; color:#171717;')}>{yen(bill)}</span>
                        </div>
                        <div style={css('font-size:11px; color:#94a3b8; line-height:1.6;')}>「会計する」を押すと決済画面に進みます。以降は追加のご注文ができません。</div>
                        <div style={css('display:flex; gap:8px;')}>
                          <button onClick={cancelCheckout} disabled={busy} style={css('flex:0 0 auto; height:48px; padding:0 16px; border-radius:2px; border:1px solid #cbd5e1; background:#fff; color:#64748b; font-size:14px; font-weight:600;')}>もどる</button>
                          <button onClick={onPay} disabled={busy} style={css('flex:1; height:48px; border-radius:2px; border:none; background:#171717; color:#fff; font-size:15px; font-weight:700;')}>会計する（{yen(bill)}）</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {couponEntry}

                <div style={css('border:1px solid #eef1f4; border-radius:2px; overflow:hidden;')}>
                  <button onClick={() => setMenuRefOpen((p) => !p)} style={css('width:100%; display:flex; align-items:center; justify-content:space-between; padding:11px 13px; border:none; background:#fafbfc; color:#475569; font-size:12px; font-weight:700;')}>
                    <span>メニュー番号一覧（在庫もここで確認）</span>
                    <span style={css('color:#94a3b8;')}>{menuRefOpen ? '閉じる ▲' : '開く ▼'}</span>
                  </button>
                  {menuRefOpen && (
                    <div style={css('padding:6px 10px 12px; display:flex; flex-direction:column; gap:12px; border-top:1px solid #eef1f4;')}>
                      {cats.map((cat) => (
                        <div key={cat}>
                          <div style={css('font-size:10px; font-weight:700; color:#94a3b8; letter-spacing:.05em; margin:8px 2px 6px;')}>{cat}</div>
                          <div style={css('display:flex; flex-direction:column; gap:5px;')}>
                            {menuList.filter((m) => (m.category ?? 'その他') === cat).map((m) => {
                              const sold = m.soldOut;
                              const low = !sold && m.stock != null && m.stock <= 3;
                              const stockText = m.stock == null ? '' : sold ? '売り切れ' : '残' + m.stock;
                              return (
                                <div key={m._id} onClick={() => { if (!sold) addToCart(m); }} style={css(`display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:2px; background:${sold ? '#fafbfc' : '#fff'}; border:1px solid #eef1f4; opacity:${sold ? 0.5 : 1}; cursor:${sold ? 'default' : 'pointer'};`)}>
                                  <span className="tnum" style={css('font-size:13px; font-weight:700; color:#475569; width:36px;')}>{m.code ?? '—'}</span>
                                  <span style={css('flex:1; min-width:0; font-size:13px; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;')}>{m.name}</span>
                                  <span style={css(`font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; color:${sold ? C.red : low ? C.amber : C.faint};`)}>{stockText}</span>
                                  <span className="tnum" style={css('font-size:12px; font-weight:700; color:#171717; width:48px; text-align:right;')}>{m.price != null ? yen(m.price) : '—'}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {toast && (
        <div style={css('position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:50; animation:lampoRise .18s ease-out;')}>
          <div style={css(`padding:11px 18px; border-radius:2px; background:${toastBg}; color:#fff; font-size:13px; font-weight:600; box-shadow:0 8px 24px rgba(15,23,42,.28);`)}>{toast.msg}</div>
        </div>
      )}
    </main>
  );
}

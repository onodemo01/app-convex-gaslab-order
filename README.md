# gaslab-order

卓注文アプリ（本番）。客がスマホで注文 → キッチン・ホールにリアルタイム同期 → Stripe で会計。
`table-order` の実証済みバックエンドを土台に、刷新UIを**役割別の独立画面**として再構築した。
スタック: Convex + TanStack Start + Stripe（card / PayPay）。認証は単店舗固定キオスク（ログインなし）。

## 画面（各端末で1画面）

- 客スマホ `/t/{slug}/{tableToken}` … テンキー注文・2段階会計
- キッチン `/kitchen` … KDS（調理中／提供済み・タップ提供）
- ホール `/floor` … カンバン（空席/着席中/会計済み/清掃中）
- 商品マスタ `/menu` ／ 卓QR `/qr` ／ 分析 `/analytics`
- 同時表示 `/demo`（セミナー用）／ 入口ハブ `/`

## 開発

```bash
npm install
npm run dev   # Convex(ローカル) + Vite → http://127.0.0.1:3000
```

- このリポ内で `npx convex dev` のローカルデプロイが構成済み（`.env.local`）。
- デモデータは入口の「デモデータ投入」ボタン（または `npx convex run dev:seedDemo`）。
- リセットは `npx convex run dev:resetDemo`。

## 本番公開

`docs/seminar/README.md`（簡易・テストモード手順）。
**Stripe 等のキーは Convex の env**（`.env.local` ではアクションに届かない）。


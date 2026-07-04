# 卓注文アプリ（セミナー有料特典）

GASLAB登竜門ウェビナー「テーブル注文アプリを自分のURLで公開する」の**有料特典**です。

客がスマホで注文 → キッチン・ホールにリアルタイム同期 → Stripe **テスト決済**まで動くデモアプリと、公開手順書が一式入っています。

> **このリポジトリについて**
> - GitHub 上は **public（誰でも clone 可能）** ですが、**URL は有料参加者にのみ案内**します。Peatix / connpass 以外で共有しないでください。
> - **デモ・学習向け**です。店舗の本番営業・実決済の設定は含みません。

---

## 最初に読むもの（この順で）

1. **[クローンから自分用環境をつくる.md](docs/seminar/クローンから自分用環境をつくる.md)** … GitHub から取得 → 自分専用 Convex / Stripe / Vercel の作り方
2. **[README.md](docs/seminar/README.md)** … Convex・Stripe・Vercel の詳細手順（スクショ付き）
3. （任意）**[stripe-convex-フロー.md](docs/seminar/stripe-convex-フロー.md)** … 決済と Convex の値の渡し方

セミナー当日に clone する必要はありません。**セミナー後**、上記 1 から進めてください（所要 約40〜60分）。

---

## ゴール

`https://あなたの名前.vercel.app` で、自分専用のテーブル注文デモが動く状態（Stripe は**テストモード**・実際の課金なし）。

---

## 用意するもの

- パソコン（Mac または Windows）とインターネット
- **Node.js 20 LTS 以上**（`node -v` で確認。18 でも動く場合あり）… <https://nodejs.org/>
- **Git**（clone 用）
- 無料アカウント: **Convex** / **Stripe**（テストモード）/ **Vercel**
- **GitHub アカウント** … Convex・Vercel のログイン用（clone 自体はアカウントなしでも可）

---

## クイックスタート

```bash
git clone https://github.com/onodemo01/app-convex-gaslab-order.git
cd app-convex-gaslab-order
npm install
```

あとは [クローンから自分用環境をつくる.md](docs/seminar/クローンから自分用環境をつくる.md) のステップ3以降へ。

> ⚠️ 講師デモの Convex / Stripe / Vercel は**使わない**でください。必ず**自分のアカウント**で新規作成します。

---

## 困ったとき

- 手順の詳細・トラブルシュート → [docs/seminar/README.md](docs/seminar/README.md)
- 環境変数は **Convex ダッシュボードへ手入力**（`.env.local` のコピーや講師のキー流用は不可）

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
4. （AI に任せる人）**[AIセットアップ手順.md](docs/seminar/AIセットアップ手順.md)** … Cursor / Claude Code に読ませて実行させる手順書（下の「🤖 AIエージェントに任せる場合」参照）

セミナー当日に clone する必要はありません。**セミナー後**、上記 1 から進めてください（所要 約40〜60分）。

### 統一ステップ1〜6（正本）

| ステップ | 内容 | 詳細の所在 |
|---|---|---|
| 1 | GitHub から clone | `docs/seminar/クローンから自分用環境をつくる.md` |
| 2 | `npm install` | 同上 |
| 3 | Convex（login / dev / deploy） | `docs/seminar/README.md` |
| 4 | Stripe + Convex Production env | 同上 |
| 5 | Vercel + `./scripts/deploy.sh` + `APP_BASE_URL` 更新 | 同上 |
| 6 | 注文 → キッチン同期 → テスト決済 | 同上 |

---

## ゴール

`https://あなたの名前.vercel.app` で、自分専用のテーブル注文デモが動く状態（Stripe は**テストモード**・実際の課金なし）。

---

## 用意するもの

- パソコン（Mac または Windows）とインターネット
- **Node.js 20 LTS 以上**（`node -v` で確認。18 でも動く場合あり）… <https://nodejs.org/>
- **Git**（clone 用）
- **ターミナル**
  - Mac: ターミナル
  - Windows: **Git Bash**（Git for Windows 付属）。`./scripts/deploy.sh` は PowerShell では動きません
- 無料アカウント: **Convex** / **Stripe**（テストモード）/ **Vercel**
- **GitHub アカウント** … Convex・Vercel のログイン用（clone 自体はアカウントなしでも可）

---

## クイックスタート

```bash
git clone https://github.com/onodemo01/app-convex-gaslab-order.git
cd app-convex-gaslab-order
npm install
```

あとは [README.md](docs/seminar/README.md) の**ステップ3**から進めてください（ステップ1〜2はクローン資料で完了）。

> ⚠️ 講師デモの Convex / Stripe / Vercel は**使わない**でください。必ず**自分のアカウント**で新規作成します。

---

## 🤖 AIエージェント（Cursor / Claude Code）に任せる場合

このリポジトリには、AI が読んでそのまま実行できる専用手順書
**[docs/seminar/AIセットアップ手順.md](docs/seminar/AIセットアップ手順.md)** が入っています。
エージェントに次のように指示してください：

```
docs/seminar/AIセットアップ手順.md を読んで、その手順どおりに公開までのセットアップを進めてください。
```

コマンド実行とエラー対応は AI が担当します。**あなたがやるのは3つだけ**（AI が都度案内します）：

1. ブラウザ認証の「Approve / Allow」ボタンを押す（Convex・Vercel のログイン）
2. Stripe の**テスト**キーを発行し、**Convex ダッシュボード（Production）に自分で入力**する
3. 最後の動作確認（注文 → キッチン → テスト決済）

> 🔒 **APIキー（`sk_test_...` など）は AI チャットに貼らないでください。** パスワードと同じです。
> ※ このリポジトリ直下の `AGENTS.md` を AI が自動で読むため、「セットアップして」だけでも上の手順書に誘導されます。

---

## 困ったとき

- 手順の詳細・トラブルシュート → [docs/seminar/README.md](docs/seminar/README.md)
- 環境変数は **Convex ダッシュボードへ手入力**（`.env.local` のコピーや講師のキー流用は不可）

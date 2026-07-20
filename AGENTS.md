# AGENTS.md — AIエージェント向けの入口

このリポジトリは、セミナー配布用の**卓注文デモアプリ**（Convex + Stripe テストモード + Vercel）です。
ユーザー（非エンジニアの受講者）から「セットアップして」「公開して」「環境構築して」と頼まれたら、
**[docs/seminar/AIセットアップ手順.md](docs/seminar/AIセットアップ手順.md) を読み、その手順どおりに進めてください。**

## 絶対ルール（要約 — 詳細と理由は AIセットアップ手順.md）

- **APIキーの値を扱わない**：ユーザーに聞かない・チャットに貼らせない・出力に表示しない。キー入力はユーザー自身が Convex ダッシュボード（**Production**）で行う
- **講師・デモの資源（onodemo01 の Convex / Stripe / Vercel、他人の `.env.local`）を使わない**。すべてユーザー本人のアカウントで新規作成
- **Stripe はテストモードのみ**（`sk_live_` を提案しない）
- **公開は `./scripts/deploy.sh` のみ**。`vercel --prod` はこのアプリ（SPA プレビルド方式）では全ページ 404 になるため禁止
- **ブラウザ認証（Approve / Allow）はユーザーが押す**。実行後に何をクリックするか案内して待つ
- セットアップ中に**アプリのコードを変更しない・commit / push しない・クラウド資源を削除しない**

## 資料の地図

- [README.md](README.md) — 全体の入口（人間向け）
- [docs/seminar/AIセットアップ手順.md](docs/seminar/AIセットアップ手順.md) — **AI が実行する手順書（セットアップはここ）**
- [docs/seminar/クローンから自分用環境をつくる.md](docs/seminar/クローンから自分用環境をつくる.md) — ステップ1〜2の人間向け解説
- [docs/seminar/README.md](docs/seminar/README.md) — ステップ3〜6の人間向け解説（スクショ・付録A〜H・トラブル表）

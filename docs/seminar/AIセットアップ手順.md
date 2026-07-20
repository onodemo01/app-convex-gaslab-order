# AIセットアップ手順（AIエージェント用）

このファイルは **Cursor / Claude Code などの AI コーディングエージェントが読んで実行するための手順書**です。
人間向けのスクショ付き解説は [README.md](README.md)（ステップ3〜6）と
[クローンから自分用環境をつくる.md](クローンから自分用環境をつくる.md)（ステップ1〜2）にあります。

## 使い方（人間向け・ここだけ読めばOK）

1. AI エージェントにこう指示します：

   ```
   docs/seminar/AIセットアップ手順.md を読んで、その手順どおりに公開までのセットアップを進めてください。
   ```

2. コマンド実行とエラー対応は AI が担当します。**あなたがやるのは3つだけ**（AI が都度案内します）：
   - ブラウザ認証の「Approve / Allow」ボタンを押す（Convex・Vercel のログイン）
   - Stripe の**テスト**キーを発行し、**Convex ダッシュボード（Production）に自分で入力**する
   - 最後の動作確認（注文 → キッチン → テスト決済）

3. 🔒 **APIキー（`sk_test_...` など）は AI チャットに絶対に貼らないでください。** パスワードと同じです。

---

以下は AI エージェントへの指示です。

## 絶対ルール（エージェントは変更・省略してはいけない）

1. **APIキーの値を扱わない。** `STRIPE_SECRET_KEY` などの値をユーザーに聞かない・チャットに書かせない・コマンド出力に表示させない。キーの入力は必ずユーザー自身が Convex ダッシュボードで行う。
   - `npx convex env list --prod` を**素で実行しない**（値まで出力される）。名前だけ確認する形（下記の検証コマンド）を使う。
2. **講師・デモの資源を使わない。** onodemo01 の Convex / Stripe / Vercel、他人からもらった `.env.local` は使用禁止。すべてユーザー本人のアカウントで新規作成する。
3. **Stripe はテストモードのみ。** `sk_live_` の使用を提案しない。
4. **環境変数は Convex の Production 側**に入れる（dev 側では公開アプリに効かない）。
5. **公開は `./scripts/deploy.sh` のみ。** `vercel --prod`（クラウドビルド）はこのアプリ（SPA プレビルド方式）では全ページ 404 になるため実行しない（README 付録G）。
6. **ブラウザ認証はユーザーが押す。** ログイン系コマンドを実行したら「ブラウザで何をクリックするか」を案内して完了を待つ。
7. **アプリのコードを変更しない。git commit / push しない。** クラウド資源（Convex / Vercel プロジェクト等）の削除もしない。
8. **同じエラーで3回失敗したら停止**し、「どのステップの・どのコマンドで・どんなメッセージか」を要約してユーザーに引き継ぐ（README の「うまくいかないとき」表を参照）。

## 事前チェック

```bash
node -v        # v18 以上（v20 LTS 推奨）
git --version
```

- Node.js / Git が無ければ、インストールはユーザーに依頼する（<https://nodejs.org/> の LTS、<https://git-scm.com/>）。
- **Windows の場合はシェルが Git Bash であることを確認**する（PowerShell ではステップ5の `./scripts/deploy.sh` が動かない）。VS Code の統合ターミナルなら「＋」横の ∨ → Git Bash に切り替えてもらう。

## ステップ1〜2：取得とインストール

この手順書が読めている時点で clone 済みのはず。未取得なら：

```bash
git clone https://github.com/onodemo01/app-convex-gaslab-order.git
cd app-convex-gaslab-order
```

リポジトリ直下で：

```bash
npm install
```

✅ 確認：最後に赤い `ERR!` が出ていない（黄色い `warn` は無視してよい）。

## ステップ3：Convex（バックエンド）をクラウドに作る

1. ログイン：

   ```bash
   npx convex login
   ```

   🙋 ユーザーに案内：「ブラウザが開くので **Google か GitHub のどちらか**を選んでログインし、ターミナルのコードと一致を確認して **Approve** を押してください。**この後の Vercel も同じ方法**でログインします（混ぜるとアカウントが分裂します）」。`Logged in` が出るまで待つ。

2. プロジェクト作成：

   ```bash
   npx convex dev --configure new --project gaslab-order --once
   ```

   - `--once` を付けると設定＋1回のプッシュで自動終了する（`Ctrl+C` 不要）。
   - Team を聞かれたら：候補が1つならそのまま Enter。複数あるか、対話に答えられない実行環境の場合は、ユーザーに team の **slug**（[dashboard.convex.dev](https://dashboard.convex.dev) 左上／Settings で確認・英数字とハイフンのみ）を確認して次で実行：

     ```bash
     npx convex dev --configure new --team TEAM_SLUG --project gaslab-order --once
     ```

   - リージョンを聞かれたら既定の `US East (N. Virginia)` のまま Enter。

3. 本番デプロイ（後で Vercel が使う）：

   ```bash
   npx convex deploy
   ```

   ✅ 確認：`Deployed Convex functions` が出る。

## ステップ4：Stripe テストキー（人間パート — AI は案内役に徹する）

AI はここでコマンドを実行しない。ユーザーに以下を依頼して完了を待つ：

1. <https://dashboard.stripe.com> を開き、右上が**「テスト環境／テストモード」**になっているか確認（無料登録がまだなら <https://stripe.com/jp> から）
2. **開発者 → API キー** で**シークレットキー**（`sk_test_` で始まる）を表示してコピー
3. <https://dashboard.convex.dev> で `gaslab-order` を開き、上部のデプロイ切替で **「Production」** を選ぶ（ここが最大のつまずきポイント。`Production` の文字を目で確認）
4. **Settings → Environment Variables → Add** で次の2つを登録：
   - `STRIPE_SECRET_KEY` ＝ コピーした `sk_test_...`
   - `APP_BASE_URL` ＝ いまは仮で `http://localhost:3000`（ステップ5で AI が本物の URL に更新する）

ユーザーの完了報告を受けたら、AI が**名前だけ**を検証する（値は表示しない）：

```bash
npx convex env list --prod | cut -d= -f1
```

✅ 確認：`STRIPE_SECRET_KEY` と `APP_BASE_URL` の2行（変数名のみ）が出る。

## ステップ5：Vercel に公開

1. CLI 準備：

   ```bash
   npm install -g vercel   # 権限エラーなら以降すべて npx vercel で代替可
   vercel login
   ```

   🙋 ユーザーに案内：「**Convex と同じ方法**（Google なら Google）を選び、ブラウザの **Authorize Device** でコードを確認して **Allow** を押してください」

2. アカウント確認：

   ```bash
   npx vercel whoami
   ```

   出たユーザー名を提示し、「このアカウントで公開してよいか」をユーザーに確認する。

3. プロジェクト作成：

   ```bash
   vercel link
   ```

   - `Set up and deploy?` → **Yes** ／ `Link to existing project?` → **No**（新規）／ 名前は `gaslab-order` などでよい。残りの質問は既定のままでよい。

4. 公開（アカウントガード付き。`<whoamiの結果>` は手順2の値に置き換え）：

   ```bash
   EXPECTED_VERCEL_USER=<whoamiの結果> ./scripts/deploy.sh
   ```

   - Windows は Git Bash で実行すること。
   - ✅ 確認：最後に `✅ デプロイ完了: https://〇〇.vercel.app` が出る。この URL を控える。

5. `APP_BASE_URL` を本物の URL に更新（公開 URL は秘密情報ではないので AI が実行してよい。**末尾スラッシュなし**）：

   ```bash
   npx convex env set APP_BASE_URL https://〇〇.vercel.app --prod
   npx convex env get APP_BASE_URL --prod   # 更新後の URL だけを表示して確認
   ```

6. 疎通確認：

   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://〇〇.vercel.app/
   ```

   ✅ 確認：`200` が返る。

## ステップ6：動作確認（ユーザーと一緒に）

ユーザーに以下を依頼する：

1. 公開 URL をブラウザで開き、入口画面の下の**「デモデータ投入」**を押す
2. タブを2つ開く — タブA:「客スマホ（例: A1）」／ タブB:「キッチン KDS」。タブAで注文（メニュー番号 例 `2003` → 注文追加 → 注文する）→ **タブBに即時に注文が出れば成功**
3. テスト決済：客スマホで「会計へ進む」→「会計する」→ カード `4242 4242 4242 4242`・有効期限 `12/34`・CVC `123` で支払い
   - ⚠️ **管理画面プレビュー（iframe）内では Stripe 決済は開かず真っ白になるが正常**。新しいタブで直接 URL を開くか、実機のスマホで QR を読んで行う
4. 決済後に「会計済み」へ切り替わらない場合：ページ再読込 → README の「うまくいかないとき」表 → 付録A（Webhook・推奨）

## 完了条件（done の定義）

- [ ] 公開 URL が HTTP 200
- [ ] `npx convex env list --prod | cut -d= -f1` に `STRIPE_SECRET_KEY` と `APP_BASE_URL` が並ぶ
- [ ] ユーザーが「注文 → キッチン同期 → テスト決済成功（会計済み）」を確認した

完了したら、公開 URL を提示し、**Webhook（README 付録A）は人に使わせる運用では実質必須（推奨）**であることを伝えて終了する。

## トラブル時

[README.md](README.md) の「🆘 うまくいかないとき」表を参照。同じエラーで3回失敗したら停止してユーザーに引き継ぐ（絶対ルール8）。

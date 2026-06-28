#!/usr/bin/env bash
#
# sorte-order 本番デプロイ（SPA・プレビルド方式）
# ------------------------------------------------------------
# このアプリは TanStack Start の SPA。Vercel には SSR アダプタが無いため、
#   1) 手元で Convex 本番へデプロイ＋クライアントを本番URLでビルド（npx convex deploy --cmd）
#   2) .vercel/output を SPA 用に組み立て直す
#   3) プレビルド成果物だけアップ（Convex Deploy Key 不要・vercel.json 無改変）
# を1コマンドにまとめたもの。詳細: docs/sessions/2026-06-28-本番デプロイとSPA化.md
#
# 使い方:
#   ./scripts/deploy.sh
# 前提:
#   - npx convex login 済み / vercel login 済み / vercel link 済み
#   - どこから実行してもOK（自動で repo 直下へ移動）
# 任意の環境変数:
#   PUBLIC_URL  最後の動作検証に使う公開URL（既定: https://sorte-order.vercel.app）
#
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://sorte-order.vercel.app}" # 検証用の公開URL
SHELL_HTML="_shell.html"                                   # SPA shell のファイル名

# --- repo 直下へ移動（このスクリプトの1つ上） ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "▶ [1/4] Convex 本番へデプロイ＋クライアントを本番URLでビルド"
# -y で dev→prod 確認をスキップ。convex がプロジェクトの prod を自動選択し、
# --cmd の npm run build に本番 VITE_CONVEX_URL を注入する（prod名のハードコード不要）。
npx convex deploy --cmd 'npm run build' -y

# ビルド出力の健全性チェック（SPA モードが無効だと shell が出ない）。
if [ ! -f "dist/client/$SHELL_HTML" ]; then
  echo "✖ dist/client/$SHELL_HTML が無い。SPA モード（vite.config.ts の spa:{enabled:true}）が有効か確認。" >&2
  exit 1
fi

echo "▶ [2/4] .vercel/output を SPA 用に組み立て直す（静的をルート直下＋SPAフォールバック）"
rm -rf .vercel/output
mkdir -p .vercel/output/static
cp -R dist/client/. .vercel/output/static/
cat > .vercel/output/config.json <<JSON
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/$SHELL_HTML" }
  ]
}
JSON

echo "▶ [3/4] プレビルド成果物を本番公開"
vercel deploy --prebuilt --prod --yes

echo "▶ [4/4] 公開URLの検証（主要ルートが 200 か）"
fail=0
for p in / /floor /kitchen /menu /qr /analytics /demo "/t/sorte/verifytoken"; do
  code="$(curl -sS -o /dev/null -w "%{http_code}" "$PUBLIC_URL$p" || echo "000")"
  printf "   %-22s -> %s\n" "$p" "$code"
  [ "$code" = "200" ] || fail=1
done

if [ "$fail" -ne 0 ]; then
  echo "✖ 200 以外のルートあり。上のコードを確認（PUBLIC_URL=$PUBLIC_URL）。" >&2
  exit 1
fi

echo ""
echo "✅ デプロイ完了: $PUBLIC_URL"
echo "   （Stripe テスト決済まで通すには Convex prod の STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET を本人が設定）"

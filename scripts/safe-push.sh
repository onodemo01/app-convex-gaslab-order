#!/usr/bin/env bash
#
# push 事故防止ラッパー
# ----------------------
# 使い方:
#   EXPECTED_GITHUB_USER=your-gh-user ./scripts/safe-push.sh
#   EXPECTED_GITHUB_USER=your-gh-user ./scripts/safe-push.sh origin main
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

REMOTE="${1:-origin}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD)}"

if [ -z "${EXPECTED_GITHUB_USER:-}" ]; then
  echo "✖ EXPECTED_GITHUB_USER が未指定です。" >&2
  echo "  例: EXPECTED_GITHUB_USER=your-gh-user ./scripts/safe-push.sh" >&2
  exit 1
fi

# push で必要な最低限の事前チェック（GitHub は必須、Vercel は任意）
EXPECTED_VERCEL_USER="${EXPECTED_VERCEL_USER:-}" \
EXPECTED_GITHUB_USER="$EXPECTED_GITHUB_USER" \
  "$SCRIPT_DIR/preflight-accounts.sh"

if ! git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "✖ ブランチ '$BRANCH' が見つかりません。" >&2
  exit 1
fi

if ! git rev-parse --verify "@{u}" >/dev/null 2>&1; then
  echo "⚠ upstream が未設定です。初回 push は '-u' が必要です。" >&2
  echo "  実行: git push -u $REMOTE $BRANCH" >&2
  exit 1
fi

echo "▶ push 実行: $REMOTE $BRANCH"
git push "$REMOTE" "$BRANCH"
echo "✅ push 完了"

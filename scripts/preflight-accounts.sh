#!/usr/bin/env bash
#
# アカウント事故防止の事前チェック
# ----------------------------------
# 使い方:
#   EXPECTED_GITHUB_USER=your-gh-user EXPECTED_VERCEL_USER=your-vercel-user ./scripts/preflight-accounts.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "▶ アカウント事前チェック"

if ! command -v gh >/dev/null 2>&1; then
  echo "✖ gh CLI が見つかりません。GitHub CLI をインストールしてください。" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "✖ npx が見つかりません。Node.js をインストールしてください。" >&2
  exit 1
fi

ACTUAL_GITHUB_USER="$(gh api user --jq '.login' 2>/dev/null || true)"
if [ -z "$ACTUAL_GITHUB_USER" ]; then
  echo "✖ GitHub のログイン状態を確認できません。先に 'gh auth login' を実行してください。" >&2
  exit 1
fi
echo "   GitHub user: $ACTUAL_GITHUB_USER"

if [ -n "${EXPECTED_GITHUB_USER:-}" ] && [ "$ACTUAL_GITHUB_USER" != "$EXPECTED_GITHUB_USER" ]; then
  echo "✖ GitHub アカウント不一致: 実際='$ACTUAL_GITHUB_USER' / 期待='$EXPECTED_GITHUB_USER'" >&2
  echo "  対処: gh auth switch --user $EXPECTED_GITHUB_USER" >&2
  exit 1
fi

ACTUAL_VERCEL_USER="$(npx vercel whoami 2>/dev/null | tr -d '\r' || true)"
if [ -z "$ACTUAL_VERCEL_USER" ]; then
  echo "✖ Vercel のログイン状態を確認できません。先に 'vercel login' を実行してください。" >&2
  exit 1
fi
echo "   Vercel user: $ACTUAL_VERCEL_USER"

if [ -n "${EXPECTED_VERCEL_USER:-}" ] && [ "$ACTUAL_VERCEL_USER" != "$EXPECTED_VERCEL_USER" ]; then
  echo "✖ Vercel アカウント不一致: 実際='$ACTUAL_VERCEL_USER' / 期待='$EXPECTED_VERCEL_USER'" >&2
  echo "  対処: vercel logout && vercel login" >&2
  exit 1
fi

echo "✅ 事前チェックOK"

import type { MutationCtx, QueryCtx } from './_generated/server';

// WorkOS を外し、単一店舗固定の教材構成にした。
// orgId は引き続きサーバ側で決定する（フロントから店舗IDを受け取らない規律は維持）。
// 1 デプロイ = 1 店舗。複数店舗が必要になったらここで認証を復活させる。
export const DEMO_ORG_ID = 'demo-store';

// スタッフ操作の店舗ID。固定値を返す（ログイン不要）。
// 引数の ctx は呼び出し側の互換のために受けるだけで使わない。
export async function requireOrgId(_ctx?: QueryCtx | MutationCtx): Promise<string> {
  return DEMO_ORG_ID;
}

import type { CSSProperties } from 'react';

/**
 * 刷新デザイン（restrant-orders/app）の inline style 文字列をそのまま React の
 * style オブジェクトに変換するヘルパ。"display:flex; gap:8px;" → {display:'flex', gap:'8px'}。
 * デザイン原本の style 文字列を一字一句コピーでき、見た目を完全一致させる。
 */
export function css(decl: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const part of decl.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const rawKey = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!rawKey || value === '') continue;
    const key = rawKey.startsWith('--')
      ? rawKey
      : rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  return out as CSSProperties;
}

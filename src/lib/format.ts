// 表示ヘルパ（restrant-orders/app から移植）。全画面・全端末で共通。
export const yen = (n: number) => '¥' + Number(n).toLocaleString('ja-JP');

export const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
};

export const clock = (ms: number) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

export const dateJa = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

// 配色（刷新デザインの C）
export const C = {
  ink: '#171717',
  sub: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  line2: '#cbd5e1',
  panel: '#fff',
  green: '#15803d',
  amber: '#b45309',
  red: '#dc2626',
  blue: '#1d4ed8',
};

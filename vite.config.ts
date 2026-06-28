import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import * as dotenv from 'dotenv';

// Load .env.local (TanStack Start/Vite convention)
dotenv.config({ path: '.env.local', quiet: true });
// Also load .env as fallback
dotenv.config({ quiet: true });

export default defineConfig({
  server: {
    // localhost が IPv4(127.0.0.1) に解決されても繋がるよう明示バインド。
    // 既定だと環境により IPv6([::1]) のみになり ERR_CONNECTION_REFUSED になることがある。
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 3000,
  },
  plugins: [
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    // Vercel には TanStack Start の SSR アダプタが無いため、SPA モードで静的出力にする。
    // 当アプリはサーバー専用機能（createServerFn 等）を持たず、データは全て Convex への
    // クライアント接続。SSR 不要なので SPA 化が最も堅実（全ルートをクライアントで解決）。
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
});

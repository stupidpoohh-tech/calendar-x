import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 개발 서버에서 슬래시 없는 `/tide` 를 `/tide/` 로 넘긴다.
 * mpa 모드는 디렉터리 인덱스를 자동으로 찾지 않아 `/tide` 가 404 가 된다.
 * 배포(Cloudflare Pages)에서는 같은 일을 public/_redirects 가 한다.
 */
const tideDevRoute = {
  name: 'tide-dev-route',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/tide' || req.url?.startsWith('/tide?')) {
        req.url = '/tide/' + req.url.slice('/tide'.length);
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), tideDevRoute],
  // 페이지가 둘이다. SPA fallback 을 끄지 않으면 /tide 요청이 루트 index.html 로
  // 떨어져 잔고캘린더 대신 캘린더X 가 뜬다.
  appType: 'mpa',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // 캘린더X 와 잔고캘린더는 HTML 도 번들도 따로다.
      input: { main: entry('./index.html'), tide: entry('./tide/index.html') },
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/test/rules.test.ts', 'node_modules/**'],
    css: false,
  },
});

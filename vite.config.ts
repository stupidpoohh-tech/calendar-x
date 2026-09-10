import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 테스트는 UTC 가 아닌 시간대에서 돈다.
 *
 * 이 앱의 날짜는 전부 벽시계 문자열이라, "순간에서 날짜를 뽑을 때 UTC 로 환산한다"
 * 같은 결함은 UTC 기기에서는 아예 드러나지 않는다. CI 컨테이너가 대개 UTC 이므로
 * 여기서 한 번 못박아, 어디서 돌리든 같은 시간대에서 판정하게 한다.
 * (설정 모듈이 워커보다 먼저 평가되므로 워커가 이 값을 물려받는다.)
 */
process.env.TZ ??= 'Asia/Seoul';

/**
 * 슬래시 없는 `/tide` 를 `/tide/` 로 넘긴다.
 *
 * mpa 모드는 디렉터리 인덱스를 자동으로 찾지 않아 `/tide` 가 404 가 된다.
 * 배포(Cloudflare Pages)에서는 같은 일을 public/_redirects 가 하지만,
 * dev 와 preview 는 그 파일을 읽지 않는다. 둘 다 걸어 두지 않으면
 * `npm run preview` — 빌드 결과를 확인하는 유일한 로컬 수단 — 가 하필
 * 이 커밋이 고치려는 바로 그 주소에서 404 를 낸다.
 */
type Middlewares = { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void };

const rewriteTide = (server: { middlewares: Middlewares }) => {
  server.middlewares.use((req, _res, next) => {
    if (req.url === '/tide' || req.url?.startsWith('/tide?')) {
      req.url = '/tide/' + req.url.slice('/tide'.length);
    }
    next();
  });
};

const tideRoute = {
  name: 'tide-route',
  configureServer: rewriteTide,
  configurePreviewServer: rewriteTide,
};

export default defineConfig({
  plugins: [react(), tideRoute],
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
    // 에뮬레이터가 필요한 것들은 npm run test:rules 가 따로 돌린다.
    exclude: ['src/test/*.emulator.test.ts', 'src/test/rules.test.ts', 'node_modules/**'],
    css: false,
  },
});

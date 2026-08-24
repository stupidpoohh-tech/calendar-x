/**
 * dist/index.html 을 dist/tide/index.html 로 복사한다.
 *
 * SPA 하나로 /tide 를 서빙하는 방법은 세 가지가 있는데
 *   a) Cloudflare Pages 의 SPA 자동 fallback
 *   b) _redirects 의 rewrite (200)
 *   c) 실제 파일을 놓기
 * 앞 두 가지는 배포 캐시·룰 순서에 따라 안 잡히는 사례를 실측했다.
 * (c) 가 유일하게 확실하다 — 파일이 있으면 그대로 서빙한다.
 *
 * main.tsx 가 window.location.pathname 을 보고 앱 갈래를 정하므로
 * dist/tide/index.html 은 dist/index.html 과 바이트 단위로 같아도 된다.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist');
const src = resolve(root, 'index.html');
if (!existsSync(src)) {
  console.error('dist/index.html 을 찾을 수 없습니다. vite build 가 성공했는지 확인하세요.');
  process.exit(1);
}
const dst = resolve(root, 'tide', 'index.html');
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`postbuild: ${dst}`);

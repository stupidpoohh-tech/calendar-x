/**
 * tide-over.stupidpoohh.workers.dev 를 calendar-x.pages.dev/tide 로 리다이렉트한다.
 *
 * 이관 후 옛 URL 로 오는 사람이 새 위치로 자동으로 옮겨가게 하는 최소 워커.
 * 경로 · 쿼리 · 프래그먼트(#tide=… 백업 링크)를 통째로 넘겨 준다 —
 * 그래야 예전에 공유했던 백업 링크가 새 도메인에서도 그대로 열린다.
 *
 * 배포:
 *   기존 tide-over Worker 프로젝트의 src/index.ts 를 이 파일 내용으로 교체하고
 *   `npx wrangler deploy` (혹은 대시보드 Quick Edit) 하나면 끝난다.
 *   KV / R2 등 다른 바인딩이 있었다면 함께 지운다 — 이제 필요 없다.
 */

const TARGET_ORIGIN = 'https://calendar-x.pages.dev';

export default {
  async fetch(request) {
    const src = new URL(request.url);
    // 옛 앱의 모든 경로를 /tide 로 몰아 준다. 옛 앱은 라우팅이 없었으므로
    // 어떤 경로로 들어오든 잔고캘린더 하나였다.
    const dst = new URL('/tide', TARGET_ORIGIN);
    dst.search = src.search;
    dst.hash = src.hash;
    return Response.redirect(dst.toString(), 301);
  },
};

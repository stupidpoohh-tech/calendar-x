# tide-over → 캘린더X 리다이렉트

옛 잔고캘린더(`tide-over.stupidpoohh.workers.dev`)에 접속하는 사람이
새 위치(`calendar-x.pages.dev/tide`)로 자동으로 옮겨가게 하는 최소 워커.

## 왜 필요한가

- 이관 후에도 예전 URL 을 눌러 오는 사람이 있다 (북마크 · 공유 링크)
- 잔고캘린더 원본은 백업 링크에 상태 전체를 URL 프래그먼트로 담는다 —
  그 링크로 오는 사람이 새 도메인에서도 즉시 복원되도록 프래그먼트를 그대로 넘겨야 한다
- 그 두 가지만 하는 워커면 충분하다

## 배포하는 법 (두 가지 중 하나)

### 방법 A — Cloudflare 대시보드 Quick Edit (터미널 필요 없음)

1. Cloudflare 대시보드 → **Workers & Pages**
2. `tide-over` 워커 선택
3. 오른쪽 위 **Edit code** (Quick edit)
4. 편집창 전체를 지우고 [`worker.js`](./worker.js) 내용을 통째로 붙여넣기
5. **Save and deploy**
6. 옛 URL 을 열어 `calendar-x.pages.dev/tide` 로 리다이렉트되는지 확인

기존 KV · R2 · Analytics 바인딩이 붙어 있으면 대시보드에서 지운다 — 이 워커는
저장소가 필요 없다.

### 방법 B — wrangler CLI

```bash
cd path/to/tide-over
# src/index.ts 를 이 워커의 worker.js 내용으로 대체
npx wrangler deploy
```

## 확인 목록

- [ ] `https://tide-over.stupidpoohh.workers.dev/` → `https://calendar-x.pages.dev/tide` (301)
- [ ] 프래그먼트가 유지되는가: `.../workers.dev/#tide=ABC` → `.../pages.dev/tide#tide=ABC`
- [ ] 캘린더X 새 위치에서 백업 링크 복원 다이얼로그가 뜬다

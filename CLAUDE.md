# 캘린더X

할 일과 아이디어와 돈을 같은 날짜 위에서 관리하는 캘린더 웹앱.
상용 캘린더의 기능 과잉을 덜어내고, 실제로 쓰는 동작만 남긴다.
이전 이름은 Dada Calendar. Firebase 프로젝트 ID(`dada-calendar-524ec`)와 백업 파일의
`app` 문자열은 호환을 위해 옛 이름을 유지한다.

## 이 앱이 답하려는 질문

1. 오늘 무엇을 해야 하는가
2. 떠오른 것을 어디에 적어 두는가
3. **다음 입금까지 이 돈으로 며칠 버티는가**

3번이 차별점이다. 투두이스트·노션·뱅크샐러드를 각각 이기려 하면 이길 수 없지만,
세 축이 하나의 타임라인을 공유하는 제품은 드물다.

원래는 "이 달 말 예상 잔고" 로 답했는데, 예측이 잘 맞지 않는 것을 사용자가 여러 번
경험했다. 그래서 형제 앱 tide-over 의 원칙을 흡수했다 — **예측하지 않는다.**
표시하는 숫자는 "예상 잔고" 가 아니라 "이 날까지 쓸 수 있는 한도" 다.

## 구조 — 하나의 타임라인, 네 개의 렌즈

**탭은 컬렉션이 아니라 필터다.** 모든 항목은 `entry` 하나이고 `kind` 로만 갈린다.

| 렌즈 | kind | 용도 |
|------|------|------|
| 전체 | (없음) | 세 축을 한 화면에. 오늘 패널 + 통합 캘린더 |
| TODO | `task` | 할 일. 기간·중요·긴급·상태 |
| 💡 | `idea` | 아이디어 단문 |
| 가계부 | `money` | 예정 입출금 + 잔고 + 대출 + 현금흐름 |

축 간 이동은 `kind` 필드 하나를 바꾸는 일이다 (`convertKind`).
아이디어 → 할 일 승격이 이 구조의 핵심 이점이다.

## 기술 스택

- Vite + React 18 + TypeScript (strict, `noUncheckedIndexedAccess`)
- Firebase Auth (이메일/비밀번호) + Firestore
- 배포: Cloudflare Pages. Firebase config 는 `VITE_FIREBASE_*` 환경변수
- 테스트: vitest (도메인) + `@firebase/rules-unit-testing` (보안 규칙)

## 파일 구조

```
src/domain/     순수 함수만. React 를 import 하지 않는다
  types.ts        도메인 타입
  constants.ts    COLORS, LENSES, MONEY_TYPES, STATUSES
  date.ts         날짜 유틸. 시간대 의존은 todayISO() 하나뿐
  entry.ts        생성 · 파생 필드 · kind 변환
  recurrence.ts   반복 전개 (저장하지 않는 가상 항목)
  tide.ts         "며칠 버티나" 계산. tide-over 흡수. 한도·정산·요약
  money.ts        최소 단위 정수 <-> 표시 문자열
  filters.ts      렌즈 · 필터
src/data/       Firestore 접근
  firebase.ts     초기화. 오프라인 지속성 ON
  repo.ts         구독 · 쓰기 · 배치
  converters.ts   문서 <-> 도메인 (읽기는 전부 방어적으로)
  backup.ts       내보내기 · 가져오기
  migrate.ts      이관 전 items -> 신규 스키마
src/ui/         화면 컴포넌트 (App: 렌즈 화면, TideBar: 며칠 버티나 카드,
                balanceEditor: 잔고 편집 상태 + 조각. 카드가 소유한다)
src/pages/Tide/ /tide 독립 서브페이지 (익명 · localStorage). tide-over 이식판
                main.tsx 가 별도 진입점. tide/index.html 이 이걸 부른다
src/app/        셸과 상태 훅
src/styles/     tokens.css (디자인 토큰) + app.css (전 컴포넌트 스타일)
firestore.rules 보안 규칙
```

## Firestore 데이터 구조

```
users/{uid}/entries/{id}    일정 · 아이디어 · 지출 통합
users/{uid}/accounts/{id}   잔고 (계좌 단위)
users/{uid}/debts/{id}      대출 1건 = 1문서
users/{uid}/pins/{id}       고정 메모
users/{uid}/items/{id}      이관 전 구조. 읽기 전용
```

`entry` 의 파생 필드는 **손으로 채우지 않는다.** 항상 `withDerived()` 를 거친다.

- `ymSpan: YearMonth[]` — 항목이 걸친 모든 달. `array-contains-any` 로 월 단위 조회
- `isRecurring: boolean` — `recurrence` 에서 파생

## 지켜야 할 것

**한글 IME.** Enter 핸들러에는 반드시 `e.nativeEvent.isComposing` 체크가 있어야 한다.
없으면 조합 중 Enter 가 두 번 발화해 입력이 사라진다.

**날짜는 문자열.** 전부 `'YYYY-MM-DD'` / `'HH:mm'` 벽시계 값이다. UTC 인스턴트로
저장하지 않는다. 8월 20일 14시 회의는 어디서 보든 8월 20일 14시다.
패딩 없는 값(`2026-5-3`)이 섞이면 `normalizeDate()` 로 맞춘다.

**금액은 최소 단위 정수.** `amountMinor`. KRW 는 원 단위. 실수를 쓰지 않는다.

**tide 계산은 필터와 무관하다.** 필터로 항목을 가렸다고 한도가 늘어나면 안 된다.

**과거 지출은 입력하지 않는다.** 잔고를 옮겨 적는 순간 그 사이의 변동 지출이
정산된 것으로 본다 (`domain/tide.ts` 의 `settle`). 잔고에는 `asOf`(날짜)와
`checkedAt`(ISO datetime) 을 함께 둔다 — checkedAt 이 정산의 기준점이다.

**한도의 끝점은 "다음 예정 입금 전날"이다.** 급여일 같은 별도 필드는 없다. 급여도
그냥 예정 입금이고, 주급(7일마다)도 같은 규칙으로 돈다. 다음 입금이 없으면 30일 뒤로
폴백한다. 기간 예산(span)은 흐름이라 "다음 입금" 에서 제외한다 — 안 그러면 끝점이
매일 내일이 된다.

**기간 예산은 표시(총액)와 계산(하루 몫)이 다르다.** 목록에는 총액 한 줄로 보이지만,
계산은 일할 몫이 기준이라 기간 중간에 잔고를 다시 적어도 정산이 어긋나지 않는다.
한도(`limitOn`)만 예외 — 기간에 들어서는 순간 남은 몫 전체를 예약한다.

**오늘 이전에 지나간 발생분은 한도를 못 건드린다.** 이미 잔고에 반영된 값이라
`limitOn` 은 `(오늘, d]` 만 더한다. 과거 항목을 지워도 한도가 변하지 않는 게 정상이다.

**반복 전개분은 저장하지 않는다.** id 가 `원본id@YYYY-MM-DD` 형태이고,
편집·삭제는 `baseIdOf()` 로 원본을 향한다.

**렌즈 강조색을 배경으로 쓸 때는 `--on-lens` 를 짝으로 쓴다.** 강조색은 다크에서
밝아지므로 흰 글자를 고정하면 다크 모드에서 흰 배경에 흰 글자가 된다.

**한 렌즈에 카드는 하나다.** 전체 렌즈는 오늘 카드, 가계부 렌즈는 며칠 버티나 카드.
대출·고정 메모는 그 카드 **안쪽에** 접힌 줄로 들어간다(`TideBar` 의 children). 카드를
여럿 세우면 모바일에서 캘린더가 화면 두 번 아래로 밀린다.

**금액은 카드에 하나만 적는다.** 잔고를 따로 적지 않는다 — 예정된 입출금이 없는 구간은
한도가 곧 잔고라 같은 숫자가 두 번 뜨고, 남은 날이 하루면 하루 몫까지 같아져 세 번 뜬다.
큰 숫자를 누르면 그 자리에서 잔고를 고치고(`useBalanceEditor`), 그 아래에는 금액 없이
"언제 적은 값인지"(`BalanceNote`)만 남긴다. 하루 몫은 남은 날이 2일 이상일 때만 적는다.

**떠 있는 표면은 `--bg-elev`.** 다크에서 `--bg`(#0a0a0a)는 페이지 `--bg-soft`(#141414)보다
어두워서, 모달에 쓰면 배경에 잠겨 투명하게 보인다.

## 사실 정정 — 이전 CLAUDE.md 의 오류

이전 문서는 "비표준 doc ID(`__pins__`, `__balance__`)나 비표준 필드를 쓰면 보안 규칙에서
조용히 거부된다"고 적었고, 그래서 `title` 을 `'::balance::'` 로 쓰는 우회를 썼다.

**규칙은 doc ID 를 보지 않는다.** `__x__` 형태는 Firestore 예약어라 클라이언트 SDK
단계에서 `INVALID_ARGUMENT` 로 거부된다. 규칙을 아무리 열어도 통과하지 않는다.
에뮬레이터 테스트(`src/test/rules.test.ts`)로 확인했다. 따라서 그 우회는 처음부터
필요하지 않았고, 지금은 걷어냈다.

## 설계 원칙

- **기능 추가보다 제거를 우선 검토한다.** 방향은 계속 덜어내는 쪽이다.
- **가계부는 거래를 자동으로 가져오지 않는다.** 전부 수동 입력이다.
  본격 가계부 앱은 따로 쓰고, 여기서는 미래 현금 흐름만 눈으로 확인한다.
  단, 입력한 값으로 하는 **계산은 한다.** 예상 잔고를 사람이 암산할 이유가 없다.
- **캘린더는 항목을 숨기지 않는다.** "+N개 더" 대신 개수에 따라 바 높이를 압축해
  전부 표시한다 (4개 이하 일반, 5~7개 중간, 8개 이상 색상 띠만).
- **조용히 실패하지 않는다.** 건너뛴 항목은 이유와 함께 보고한다.

## 개발

```bash
npm run dev            # 개발 서버
npm run check          # 타입 + 린트 + 테스트
npm run test:rules     # 보안 규칙 (에뮬레이터 자동 기동, Java 필요)
npm run emulators      # Auth + Firestore 에뮬레이터
```

규칙을 고쳤으면 `npm run test:rules` 를 돌린 뒤 배포한다.

## 형제 앱

- **/tide (잔고캘린더)** — 계정 없는 익명 서브페이지. localStorage 만. 배포 위치는
  같은 도메인(`calendar-x.pages.dev/tide`)이지만 데이터는 공유하지 않는다.
  **HTML 도 번들도 따로다** (`tide/index.html` + `src/pages/Tide/main.tsx`,
  vite `rollupOptions.input` 에 두 엔트리). 예전에는 앱 하나가 `location.pathname` 을
  보고 갈래를 정했는데, 배포 환경에서 정적 파일 · _redirects · 캐시 중 무엇이 먼저
  잡히느냐에 따라 /tide 에서 캘린더X 가 떴다. 지금은 두 앱이 서로를 대신 띄울 수 없고,
  잔고캘린더 번들에는 Firebase 가 들어가지도 않는다.
  옛 URL(`tide-over.stupidpoohh.workers.dev`)은 리다이렉트 워커로 넘어온다
  (`docs/tide-over-worker/`).
- **clear-week** — 종이 주간 플래너. `entries` 컬렉션에 `kind === 'task'` 로 새 항목만
  오간다. clear-week 의 `CAL.entryDoc()` 이 이쪽 firestore.rules 요구사항을 이미 채운다.

## 남은 일

`docs/ASSESSMENT.md` 의 Phase 3 이후. 소셜 로그인, 계정 삭제, 이용약관·개인정보처리방침,
랜딩 페이지, PWA, 에러 추적, 요금제.

## 커뮤니케이션

- 격식 있는 표준어, 입니다 경어체. 과한 높임과 인터넷 말투는 쓰지 않는다.
- 사과문이나 자기비판 없이 지적을 반영한 결과물을 낸다. 변론하지 않는다.
- 막연한 칭찬 대신 구체적 관찰로 답한다.
- 정리 요청("정리해줘", "통합해줘")에는 취사선택 없이 전부 살린다. 이견은 맨 끝에 별항으로.

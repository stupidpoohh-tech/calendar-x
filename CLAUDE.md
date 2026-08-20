# Dada Calendar

할 일과 아이디어와 돈을 같은 날짜 위에서 관리하는 캘린더 웹앱.
상용 캘린더의 기능 과잉을 덜어내고, 실제로 쓰는 동작만 남긴다.

## 이 앱이 답하려는 질문

1. 오늘 무엇을 해야 하는가
2. 떠오른 것을 어디에 적어 두는가
3. **언제 잔고가 바닥나는가**

3번이 차별점이다. 투두이스트·노션·뱅크샐러드를 각각 이기려 하면 이길 수 없지만,
세 축이 하나의 타임라인을 공유하는 제품은 드물다.

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
  cashflow.ts     현금흐름 예측
  money.ts        최소 단위 정수 <-> 표시 문자열
  filters.ts      렌즈 · 필터
src/data/       Firestore 접근
  firebase.ts     초기화. 오프라인 지속성 ON
  repo.ts         구독 · 쓰기 · 배치
  converters.ts   문서 <-> 도메인 (읽기는 전부 방어적으로)
  backup.ts       내보내기 · 가져오기
  migrate.ts      이관 전 items -> 신규 스키마
src/ui/         화면 컴포넌트
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

**현금흐름은 필터와 무관하게 계산한다.** 필터로 항목을 가렸다고 잔고가 늘어나면 안 된다.

**잔고의 `asOf` 는 그 날 "시작" 시점의 사실이다.** 그 이전 항목을 다시 빼지 않고,
그 날 예정된 항목은 반영한다. 마감으로 잡으면 당일 예정분이 조용히 사라진다.

**들어올 돈 / 나갈 돈은 총액이다.** 하루의 순변동으로 세면 입금과 지출이 같은 날일 때
"들어올 돈"이 지출만큼 깎여 보인다.

**반복 전개분은 저장하지 않는다.** id 가 `원본id@YYYY-MM-DD` 형태이고,
편집·삭제는 `baseIdOf()` 로 원본을 향한다.

**렌즈 강조색을 배경으로 쓸 때는 `--on-lens` 를 짝으로 쓴다.** 강조색은 다크에서
밝아지므로 흰 글자를 고정하면 다크 모드에서 흰 배경에 흰 글자가 된다.

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

## 남은 일

`docs/ASSESSMENT.md` 의 Phase 3 이후. 소셜 로그인, 계정 삭제, 이용약관·개인정보처리방침,
랜딩 페이지, PWA, 에러 추적, 요금제.

## 커뮤니케이션

- 격식 있는 표준어, 입니다 경어체. 과한 높임과 인터넷 말투는 쓰지 않는다.
- 사과문이나 자기비판 없이 지적을 반영한 결과물을 낸다. 변론하지 않는다.
- 막연한 칭찬 대신 구체적 관찰로 답한다.
- 정리 요청("정리해줘", "통합해줘")에는 취사선택 없이 전부 살린다. 이견은 맨 끝에 별항으로.

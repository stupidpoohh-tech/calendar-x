# Dada Calendar

할 일과 아이디어와 돈을 **같은 날짜 위에서** 관리하는 캘린더.

세 가지를 따로 관리하면 오늘 무엇을 해야 하고 이번 달에 얼마가 남는지를 한 번에 볼 수 없습니다.
이 앱은 셋을 하나의 타임라인에 올리고, 잔고와 예정 입출금을 합쳐 **언제 잔고가 바닥나는지**를 계산합니다.

## 구조

하나의 `entry` 모델에 `kind: 'task' | 'idea' | 'money'` 를 둡니다.
화면의 탭은 별도 컬렉션이 아니라 이 `kind` 에 대한 **렌즈(필터)** 입니다.

| 렌즈 | 보이는 것 |
|------|----------|
| 전체 | 세 축을 한 화면에. 오늘 패널 + 통합 캘린더 |
| TODO | 할 일. 기간·중요·긴급·상태·반복 |
| 💡 | 아이디어 단문. 한 번의 탭으로 할 일 승격 |
| 가계부 | 예정 입출금 7종 + 잔고 + 대출 + **현금흐름 예측** |

```
src/
  domain/     순수 도메인. 날짜 · 반복 전개 · 현금흐름 · 필터 (전부 테스트됨)
  data/       Firestore 접근. 변환 · 구독 · 백업 · 이관
  ui/         화면 컴포넌트
  app/        셸과 상태 훅
  styles/     디자인 토큰과 앱 스타일
firestore.rules   보안 규칙 (에뮬레이터로 테스트)
docs/ASSESSMENT.md 이관 전 진단과 설계 근거
```

## 시작하기

```bash
npm install
cp .env.example .env      # Firebase 콘솔 값을 채웁니다
npm run dev
```

Firebase 없이 로컬에서만 돌리려면 에뮬레이터를 씁니다.

```bash
npm run emulators         # 별도 터미널
cp .env.emulator .env
npm run dev
```

## 명령

| 명령 | 하는 일 |
|------|--------|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 (`dist/`) |
| `npm run check` | 타입 검사 + 린트 + 테스트 |
| `npm test` | 단위 테스트 |
| `npm run test:rules` | 보안 규칙 테스트 (Firestore 에뮬레이터 자동 기동, Java 필요) |
| `npm run emulators` | Auth + Firestore 에뮬레이터 |

## 배포

Cloudflare Pages 기준.

- 빌드 명령: `npm run build`
- 출력 디렉터리: `dist`
- 환경 변수: `.env.example` 의 `VITE_FIREBASE_*` 여섯 개

Firebase 웹 config 는 클라이언트 번들에 포함되며 공개되어도 무방합니다.
**실제 보안 경계는 `firestore.rules` 입니다.** 규칙을 바꿨으면 배포 전에
`npm run test:rules` 로 확인하고 `firebase deploy --only firestore:rules` 로 올립니다.

## 이관 전 데이터

예전 구조(`users/{uid}/items`)에 데이터가 남아 있으면 로그인 후 **설정**에 안내가 뜹니다.
누르면 `entries` / `accounts` / `debts` / `pins` 로 옮깁니다.
**원본 `items` 는 지우지 않습니다.** 결과를 확인한 뒤 직접 정리하세요.

예전 형식(`{ items: [...] }`)의 JSON 백업 파일도 **백업 파일 가져오기**로 그대로 읽습니다.

## 아직 없는 것

상용 서비스로 열기 전에 필요한 항목은 `docs/ASSESSMENT.md` 4장에 정리돼 있습니다.
요약하면 소셜 로그인, 계정 삭제, 이용약관·개인정보처리방침, 랜딩 페이지, PWA, 에러 추적입니다.

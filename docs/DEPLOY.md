# 배포와 이관 절차

처음 한 번만 하는 설정입니다. 순서대로 따라가면 됩니다.
**3단계까지는 되돌릴 수 있고, 4단계부터 실제 데이터에 영향을 줍니다.**

---

## 준비 — 레포를 로컬에 받기

```bash
git clone https://github.com/stupidpoohh-tech/calendar-x.git
cd calendar-x
git checkout claude/calendar-migration-commercialization-k4ipzg
npm install
```

Node 20 이상이 필요합니다. `node -v` 로 확인하세요.

---

## 1단계 — `VITE_FIREBASE_*` 가 무엇인가

### 무엇인가

앱이 **"어느 Firebase 프로젝트에 연결할지"** 를 알려주는 문자열 6개입니다.

예전 구조에서는 이 값들이 `index.html` 안에 그대로 적혀 있었습니다.

```js
// 예전 index.html — 코드 안에 직접 박혀 있었다
const firebaseConfig = {
  apiKey: "AIzaSy...",
  projectId: "dada-calendar-524ec",
  ...
};
```

이제는 코드 밖에서 주입합니다. 이유는 하나입니다 —
**같은 코드로 개발용 프로젝트와 실서비스 프로젝트를 나눠 쓸 수 있게 하기 위해서입니다.**
개발하다 실수로 실제 데이터를 지우는 사고를 막는 가장 값싼 방법입니다.

### 비밀이 아닙니다

이 값들은 브라우저가 받는 번들에 그대로 들어갑니다. 누구나 볼 수 있고, 그래도 괜찮습니다.
Firebase 웹 config 는 원래 공개값입니다.

**실제 보안 경계는 `firestore.rules` 입니다.** 그래서 3단계가 중요합니다.

### 값

기존 프로젝트(`dada-calendar-524ec`)의 값입니다. 그대로 쓰면 됩니다.

| 변수 이름 | 값 |
|---|---|
| `VITE_FIREBASE_API_KEY` | `AIzaSyDwcPMMGmYFjFqcb-3yJcbYeMhJgLGXz84` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `dada-calendar-524ec.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `dada-calendar-524ec` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `dada-calendar-524ec.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `727492344826` |
| `VITE_FIREBASE_APP_ID` | `1:727492344826:web:355d8c4f6286c98e05c243` |

직접 확인하려면: **Firebase 콘솔 → 프로젝트 설정(⚙️) → 일반 → 내 앱 → SDK 설정 및 구성 → 구성**

### 값이 없으면 어떻게 되나

**빌드는 통과합니다.** 대신 앱이 열릴 때 흰 화면 대신 이런 화면이 뜹니다.

> **앱을 시작할 수 없습니다**
> Firebase 설정이 없습니다: VITE_FIREBASE_API_KEY, …

빠진 변수 이름을 그대로 알려주므로, 이 화면이 보이면 해당 변수를 채우면 됩니다.

---

## 2단계 — 로컬에서 먼저 띄워 보기

배포하기 전에 내 컴퓨터에서 되는지 확인합니다. 여기서 되면 배포도 됩니다.

```bash
cp .env.example .env
```

`.env` 파일을 열어 위 표의 값 6개를 채웁니다. 이렇게 됩니다.

```
VITE_FIREBASE_API_KEY=AIzaSyDwcPMMGmYFjFqcb-3yJcbYeMhJgLGXz84
VITE_FIREBASE_AUTH_DOMAIN=dada-calendar-524ec.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=dada-calendar-524ec
VITE_FIREBASE_STORAGE_BUCKET=dada-calendar-524ec.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=727492344826
VITE_FIREBASE_APP_ID=1:727492344826:web:355d8c4f6286c98e05c243
VITE_USE_EMULATOR=0
```

`.env` 는 `.gitignore` 에 있어서 레포에 올라가지 않습니다.

```bash
npm run dev
```

http://localhost:5173 에 로그인 화면이 뜨면 성공입니다.
기존 이메일·비밀번호로 로그인해 보세요. **아직 화면은 비어 있습니다.**
새 구조(`entries`)를 읽는데 데이터는 아직 예전 구조(`items`)에 있기 때문입니다.
이건 정상이고, 4단계에서 옮깁니다.

로그인 자체가 안 되면 3단계로 넘어가지 말고 여기서 원인을 잡으세요.

---

## 3단계 — Firestore 보안 규칙 올리기

### 먼저 알아 둘 것

새 앱은 `entries` · `accounts` · `debts` · `pins` 컬렉션을 씁니다.
지금 콘솔에 있는 규칙은 이 컬렉션들을 모릅니다. **규칙을 올리기 전에는 새 앱이 저장을 못 합니다.**

그리고 반대 방향의 영향이 하나 있습니다.

> ⚠️ **규칙을 올리는 순간, 예전 앱은 저장이 안 됩니다.**
> 새 규칙은 예전 `items` 컬렉션을 **읽기·삭제만** 허용하고 쓰기는 막습니다.
> 예전 앱을 아직 쓰고 계시다면, 규칙을 올린 뒤로는 화면에 보이기는 해도 저장이 되지 않습니다.

이관이 끝날 때까지 예전 앱도 쓰고 싶다면, 규칙을 올리기 **전에** `firestore.rules` 에서
이 한 줄만 잠시 바꾸세요.

```
      match /items/{itemId} {
        allow read, delete: if isOwner(uid);
-       allow create, update: if false;
+       allow create, update: if isOwner(uid);   // 이관 끝나면 false 로 되돌린다
      }
```

이관을 마친 뒤 `false` 로 되돌리고 다시 올리면 됩니다.

### 방법 A — Firebase 콘솔에 붙여넣기 (터미널 필요 없음)

이쪽이 더 쉽고, 문법 오류를 게시 전에 잡아 줍니다.

1. https://console.firebase.google.com 접속
2. **dada-calendar-524ec** 프로젝트 선택
3. 왼쪽 메뉴 **빌드 → Firestore Database**
4. 상단 **규칙** 탭
5. 편집창의 기존 내용을 **전체 선택 후 삭제**하고, 이 레포의 `firestore.rules` 파일 내용을 그대로 붙여넣습니다
6. 오른쪽 위 **게시**

문법 오류가 있으면 편집창이 빨간 줄로 표시하고 게시 버튼이 눌리지 않습니다.
게시 후 1분 안에 적용됩니다.

`firestore.rules` 파일은 GitHub 에서도 볼 수 있습니다 —
레포 → `firestore.rules` → 오른쪽 위 **Copy raw file** 버튼.

### 방법 B — 터미널에서 명령으로

터미널을 쓰는 방법입니다. 콘솔 방법과 결과는 같습니다.

**터미널이 무엇인가**: 명령을 글로 입력하는 창입니다.

- macOS — `⌘ + Space` 를 누르고 `터미널` 또는 `Terminal` 을 입력해 실행
- Windows — 시작 메뉴에서 `PowerShell` 검색해 실행

**해야 할 일**: 레포를 받아 둔 폴더로 이동한 다음 명령을 실행합니다.

```bash
cd calendar-x          # 레포를 받아 둔 폴더로 이동
npx firebase login     # 브라우저가 열립니다. Firebase 계정으로 로그인
npx firebase deploy --only firestore:rules
```

`npx` 는 "이 프로젝트에 설치된 도구를 실행하라"는 뜻입니다.
`npm install` 을 이미 했다면 `firebase` 도구가 프로젝트 안에 들어와 있고,
`npx` 가 그것을 찾아서 실행합니다. 따로 설치할 것은 없습니다.

`cd` 로 이동할 폴더를 모르겠다면, 파인더/탐색기에서 `calendar-x` 폴더를
터미널 창으로 끌어다 놓으면 경로가 자동으로 입력됩니다 (`cd ` 를 먼저 친 뒤에).

> ⚠️ **반드시 `firestore:rules` 라고 쓰세요.**
> `--only firestore` 로 하면 인덱스 설정까지 함께 배포되어,
> 콘솔에서 만들어 둔 인덱스가 이 레포의 빈 `firestore.indexes.json` 으로 덮어써질 수 있습니다.

### 안 올렸을 때의 모습

앱을 열면 화면 위에 이 배너가 뜹니다.

> ⚠️ **보안 규칙이 아직 배포되지 않았습니다**
> Firestore 가 `entries` · `accounts` · `debts` · `pins` 컬렉션을 막고 있습니다.
> `npx firebase deploy --only firestore:rules`

이관을 눌러도 **한 건도 옮기지 못했습니다** 라는 안내가 뜨고 아무것도 저장되지 않습니다.
데이터가 사라진 것이 아니라 예전 `items` 컬렉션에 그대로 있는 상태입니다.

### 확인

**Firebase 콘솔 → Firestore Database → 규칙** 탭을 열어
`match /entries/{entryId}` 같은 줄이 보이면 올라간 것입니다.

배포 전에 규칙이 의도대로 동작하는지 직접 확인하려면 (Java 필요):

```bash
npm run test:rules
```

---

## 4단계 — GitHub 에 `main` 브랜치 만들기

지금 레포에는 작업 브랜치 하나뿐입니다. Cloudflare Pages 의 프로덕션 브랜치로 쓰기엔
이름이 길고 성격도 맞지 않으니 `main` 을 만듭니다.

```bash
git checkout claude/calendar-migration-commercialization-k4ipzg
git checkout -b main
git push -u origin main
```

그다음 **GitHub → 레포 → Settings → General → Default branch** 를 `main` 으로 바꿉니다.

---

## 5단계 — Cloudflare Pages 연결

### 프로젝트 만들기

1. Cloudflare 대시보드 → 왼쪽 **Workers & Pages**
2. **Create** → **Pages** 탭 → **Connect to Git**
3. GitHub 계정을 연결하고 `stupidpoohh-tech/calendar-x` 선택 → **Begin setup**

### 빌드 설정

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Framework preset | `Vite` (없으면 `None`) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 비워 둠 |

### 환경 변수

같은 화면의 **Environment variables** 에서 1단계의 값 6개를 넣습니다.
**Production 과 Preview 양쪽에 모두** 넣어야 미리보기 배포도 동작합니다.

여기에 하나 더 넣기를 권합니다.

| 변수 | 값 | 이유 |
|---|---|---|
| `NODE_VERSION` | `22` | Cloudflare 기본 Node 버전이 낮으면 빌드가 실패합니다 |

### 배포

**Save and Deploy** 를 누르면 빌드가 돌고 `https://<프로젝트명>.pages.dev` 주소가 나옵니다.
이후로는 `main` 에 push 할 때마다 자동으로 다시 배포됩니다.

---

## 6단계 — Firebase 에 배포 주소 등록하기 ★

**이걸 빼먹으면 배포는 됐는데 로그인이 안 됩니다.**
Firebase Auth 는 등록된 도메인에서만 로그인을 허용합니다.

**Firebase 콘솔 → Authentication → Settings(설정) → 승인된 도메인 → 도메인 추가**

- `<프로젝트명>.pages.dev` 를 추가합니다
- 나중에 커스텀 도메인을 붙이면 그것도 추가합니다

빼먹었을 때의 증상: 로그인 버튼을 눌러도 반응이 없고,
브라우저 콘솔에 `auth/unauthorized-domain` 이 찍힙니다.

---

## 7단계 — 기존 데이터 이관

여기부터 실제 데이터를 다룹니다. **원본은 지우지 않으므로 되돌릴 수 있습니다.**

1. 배포된 주소(`https://<프로젝트명>.pages.dev`)에 접속합니다
2. **기존 이메일·비밀번호로 로그인**합니다
   같은 Firebase 프로젝트라 계정이 그대로 있습니다.
   비밀번호가 기억나지 않으면 로그인 화면의 **비밀번호를 잊으셨나요?** 를 쓰면 됩니다
3. 화면은 비어 있습니다. 정상입니다
4. 우측 상단 **⚙️ → 설정**
5. **이관 전 데이터 N건** 안내가 보입니다 → **새 구조로 옮기기**
6. 미리보기가 뜹니다. 건수를 확인하세요

   > 일정·아이디어·가계부 N건 · 잔고 1건 · 대출 N건 · 고정 메모 N건

   건너뛴 항목이 있으면 이유와 함께 함께 표시됩니다
7. **옮기기**

### 끝나면 바로 할 것

**설정 → JSON으로 백업 내려받기.**
이제 이 기능이 실제로 동작합니다(예전 앱에서는 빈 파일을 받았습니다).
파일 하나를 손에 들고 있는 편이 안전합니다.

### 길이가 긴 항목

제목이 500자, 메모가 20,000자, 태그가 50개를 넘는 항목은 저장 한도에 맞춰 잘립니다.
미리보기에 **길이 조정 N건** 으로 표시되고, 어떤 이유로 잘렸는지 함께 나옵니다.
잘린 원본은 `items` 에 그대로 남아 있습니다.

### 일부만 옮겨졌다면

**N건을 옮겼고, M건이 남았습니다** 라는 안내가 뜨면서 실패한 문서와 이유를 알려줍니다.
남은 항목의 원본도 `items` 에 그대로 있으므로, 원인을 고친 뒤 **다시 옮기기** 를 누르면 됩니다.
이관은 몇 번을 눌러도 같은 결과를 냅니다.

### 확인 목록

| 확인할 것 | 어디서 |
|---|---|
| 잔고 금액이 맞는가 | 가계부 렌즈 상단 |
| 대출이 건수대로 나뉘었는가 | 가계부 렌즈 → 대출 현황 |
| 반복 일정이 여러 번 나타나는가 | TODO 렌즈 캘린더 |
| 고정 메모가 남아 있는가 | TODO 렌즈 상단 |
| 가계부 금액과 날짜가 맞는가 | 가계부 렌즈 캘린더 |
| 월말 예상 잔고가 그럴듯한가 | 가계부 렌즈 맨 위 |

### 되돌리려면

예전 `items` 컬렉션은 그대로 있습니다.
Firebase 콘솔 → Firestore → `users/{내 uid}/items` 에서 확인할 수 있습니다.
정리는 결과를 충분히 확인한 뒤 직접 하세요. **급할 것 없습니다.**

이관은 몇 번을 눌러도 같은 결과를 냅니다(문서 id 를 원본에서 파생시킵니다).
한 번 옮기고 나면 안내가 **이관 완료** 로 바뀌고, 필요하면 **다시 옮기기** 로 재실행할 수 있습니다.

---

## 문제가 생기면

| 증상 | 원인 | 조치 |
|---|---|---|
| **앱을 시작할 수 없습니다** + 변수 이름 목록 | 환경 변수 누락 | Cloudflare Pages → Settings → Environment variables 에서 해당 변수 추가 후 재배포 |
| **보안 규칙이 아직 배포되지 않았습니다** 배너 | 규칙 미배포 | 3단계. 배너에 적힌 명령을 그대로 실행하면 됩니다 |
| 이관을 눌렀는데 **한 건도 옮기지 못했습니다** | 규칙 미배포 | 3단계 |
| 로그인 버튼이 반응 없음, 콘솔에 `auth/unauthorized-domain` | 배포 도메인 미등록 | 6단계 |
| 항목을 저장하면 사라짐 | 규칙 미배포 | 3단계 |
| 데이터를 불러오지 못했습니다 (화면 상단 빨간 띠) | 규칙 또는 네트워크 | 띠에 적힌 메시지를 확인. `permission-denied` 면 3단계 |
| Cloudflare 빌드 실패 — Node 관련 | Node 버전이 낮음 | `NODE_VERSION=22` 환경 변수 추가 |
| 예전 앱에서 저장이 안 됨 | 정상입니다 | 새 규칙이 `items` 쓰기를 막습니다. 3단계의 경과 조치 참고 |

---

## 이후

`docs/ASSESSMENT.md` 4장(상용화 격차)과 Phase 3 항목이 남아 있습니다.
소셜 로그인, 계정 삭제, 이용약관·개인정보처리방침, 랜딩 페이지, PWA, 에러 추적입니다.

특히 **개인정보처리방침은 국내에서 서비스를 열 때 법적으로 필요합니다.**
남에게 계정을 열어 주기 전에 준비하세요.

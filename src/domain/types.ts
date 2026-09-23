/**
 * 도메인 타입.
 *
 * 이전 구조는 모든 것을 `items` 한 컬렉션의 단일 스키마에 담고, 잔고·대출 같은 특수
 * 데이터는 title 을 '::balance::' 로 표시한 뒤 값을 memo 에 문자열로 넣는 우회를 썼다.
 * 그 결과 대출 목록 전체가 한 문서에 들어가 다중 기기에서 덮어쓰기가 발생했다. (F-05)
 * 여기서는 entry / account / debt / pin 을 각각의 컬렉션으로 분리한다.
 */

/** 'YYYY-MM-DD' */
export type DateISO = string;
/** 'HH:mm' */
export type TimeHM = string;
/** 'YYYY-MM' */
export type YearMonth = string;

export type EntryKind = 'task' | 'idea' | 'money';

export type ColorId =
  | 'red' | 'orange' | 'amber' | 'green'
  | 'cyan' | 'blue' | 'violet' | 'pink';

export type TaskStatus = 'planned' | 'in-progress' | 'done';

/**
 * 가계부 항목의 유형.
 *
 * ── 새로 만들 때 고르는 것은 둘뿐이다 ──────────────────────────
 *
 * `income`(들어올 돈) · `expense`(나갈 돈). 나머지는 **읽기 전용 legacy** 다.
 *
 * 예전에는 일곱 가지가 한 목록에 섞여 있었는데 서로 다른 개념이었다 — 돈의 방향
 * (income · expense), 지출의 목적(repay), 목적+우선순위(priority), 기간 예산(living),
 * 떼어 둔 돈(save), 그리고 **앱이 계산해야 할 결과**(free). 사용자가 "이건 생활비인가
 * 나갈 돈인가 세이브인가" 를 고민해야 했고, 가용은 계산값과 입력값이라는 두 개의
 * 진실을 만들었다.
 *
 * 지금은 역할이 나뉘어 있다.
 *   흐름   income · expense          (이 타입)
 *   예산   Budget                    (`budgets` 컬렉션)
 *   확보   Reserve                   (`reserves` 컬렉션)
 *   결과   가용 한도                  (`limitOn` 이 계산한다. 입력할 수 없다)
 *
 * legacy 값은 **지우지 않는다.** 이미 저장된 데이터가 그대로 읽히고 지금까지와 똑같이
 * 계산돼야 하기 때문이다. 새 입력 화면에만 뜨지 않는다 (`NEW_MONEY_TYPES`).
 */
export type MoneyType = NewMoneyType | LegacyMoneyType;

/** 새로 만들 때 고를 수 있는 유형. */
export type NewMoneyType = 'income' | 'expense';

/** 읽기 전용. 이미 저장된 데이터에만 남아 있다. */
export type LegacyMoneyType = 'repay' | 'priority' | 'living' | 'save' | 'free';

export type RepeatFreq = 'daily' | 'weekly' | 'monthly';

/** RFC 5545 RRULE 의 실용적 부분집합. 이 앱이 실제로 쓰는 것만 담는다. */
export interface Recurrence {
  freq: RepeatFreq;
  /** 1 = 매일/매주/매월, 2 = 격일/격주/격월 */
  interval: number;
  /** 포함 종료일. null 이면 count 또는 전개 상한이 끝을 정한다. */
  until: DateISO | null;
  /** 최초 발생을 1로 세는 총 발생 횟수. null 이면 제한 없음. */
  count: number | null;
}

export interface TaskFields {
  status: TaskStatus;
  important: boolean;
  urgent: boolean;
  /** 리스트 뷰의 수동 정렬 위치. 작을수록 위. */
  order: number;
}

export interface MoneyFields {
  type: MoneyType;
  /**
   * 통화의 최소 단위 정수. KRW 는 원, USD 는 센트.
   * 부동소수 오차를 원천 차단하기 위해 실수를 쓰지 않는다.
   */
  amountMinor: number;
  /** ISO 4217. 현재는 'KRW' 고정이지만 확장 여지를 둔다. */
  currency: string;
  /** 이 지출/입금을 발생시킨 할 일. 축 간 연결의 핵심 필드. */
  linkedEntryId: string | null;
  /**
   * 이 지출이 어느 생활비 예산에서 나가는가.
   *
   * `linkedEntryId` 를 재사용하지 않는다 — 그쪽은 "이 돈을 쓰게 만든 할 일" 이고
   * 이쪽은 "이 돈이 어느 주머니에서 나가는가" 다. 뜻이 다른 두 관계다.
   *
   * 값이 있고 그 예산의 기간 안에 있으면 일반 지출 합계에서 빠지고 예산 안에서 세어진다
   * (`domain/budget.ts`). 반복 항목은 연결하지 않는다 — 주머니 하나에 몇 번 들어갈지가
   * 애매해지고, 그 애매함을 규칙으로 덮을 만한 쓸모가 없다.
   */
  budgetId: string | null;
  /**
   * 이 지출이 어느 대출을 갚는가. legacy `repay` 를 대신한다.
   *
   * 계산은 일반 지출과 같다. 대출 잔액을 자동으로 깎지 않는다 — 가계부는 거래를
   * 자동으로 가져오지 않는다는 원칙 그대로, 대출 회차는 사용자가 직접 적는다.
   */
  debtId: string | null;
  /**
   * 먼저 갚기로 표시한 항목. legacy `priority` 를 대신한다.
   * 계산에 영향을 주지 않는 표시값이다.
   */
  priority: boolean;
}

/**
 * 일정·아이디어·지출을 모두 담는 단일 모델.
 * 탭(렌즈)은 kind 에 대한 필터일 뿐, 별도 컬렉션이 아니다.
 */
export interface Entry {
  id: string;
  kind: EntryKind;

  title: string;
  note: string;
  color: ColorId;
  tags: string[];
  location: string;

  startDate: DateISO;
  startTime: TimeHM | null;
  /** 기간형이 아니면 null. 렌더링 시에는 startDate 로 폴백한다. */
  endDate: DateISO | null;
  endTime: TimeHM | null;

  /**
   * 반복 규칙. 할 일뿐 아니라 가계부 항목에도 붙는다.
   * 월세·구독료 같은 반복 지출이 없으면 현금흐름 예측이 성립하지 않기 때문이다.
   */
  recurrence: Recurrence | null;

  /**
   * 이 항목이 걸쳐 있는 모든 달. Firestore array-contains 로 월 단위 조회를 한다.
   * 전 항목 무제한 구독(F-06)을 없애는 인덱스 키다.
   */
  ymSpan: YearMonth[];
  /** recurrence 에서 파생. 반복 항목은 월 조회로 잡히지 않으므로 별도 질의한다. */
  isRecurring: boolean;

  task: TaskFields | null;
  money: MoneyFields | null;
  /**
   * 회복 표식. 이 값이 있으면 Recovery Event 다.
   *
   * Recovery 는 네 번째 축이 아니라 `task` 위에 얹힌 표식이다. kind 를 늘리면 렌즈·필터·
   * 보안 규칙이 전부 따라 늘어나는데, 실제로 캘린더에 존재하는 Recovery 는 언제나 한 건
   * 뿐이라 그만한 구조를 세울 이유가 없다.
   */
  recovery: RecoveryFields | null;

  /**
   * 화면용으로 펼친 가상 발생분 표시. **저장되지 않는다.**
   *
   * `entryToDoc` 이 이 필드를 쓰지 않고 `entryFromDoc` 이 읽지 않으므로, 이 값이 켜진
   * 항목은 오직 `expandEntry()` 가 방금 만든 것뿐이다 — 사용자 데이터로는 들어올 수
   * 없다. 그래서 금액 계산이 이 표식 하나만 보고 "화면용 목록이 잘못 들어왔다" 를
   * 확실하게 판정할 수 있다.
   *
   * 계산에 발생분을 넣으면 tide 가 그것을 또 한 번 반복 전개해 같은 입출금을
   * 여러 번 센다. 그 사고를 타입이 아니라 값으로 막는 자리다.
   */
  virtual?: true;

  createdAt: string;
  updatedAt: string;
}

/**
 * 잔고. 이전 '::balance::' 우회를 대체한다. 계좌 단위로 여러 개를 둘 수 있다.
 *
 * 날짜(`asOf`)와 시각(`checkedAt`)을 함께 두는데, **둘의 역할이 다르다.**
 *
 * - `asOf` — 정산 구간의 **경계**. 예정 항목은 `startDate` 만 갖고 시각이 없으므로
 *   정산은 애초에 날짜 단위로만 정확할 수 있다. 벽시계 날짜라 시간대에 흔들리지 않는다.
 * - `checkedAt` — **순서**. 하루에 두 번 적거나 계좌가 여럿일 때 어느 기록이 가장
 *   최근인지 고르는 데만 쓴다. 여기서 날짜를 뽑아 쓰지 않는다 — UTC 로 환산되어
 *   한국 시간 오전에는 하루가 밀린다 (`localDateOf` 참고).
 */
export interface Account {
  id: string;
  name: string;
  balanceMinor: number;
  currency: string;
  /** 이 잔고가 사실이었던 날짜. 화면 표시이자 정산 구간의 시작이다. */
  asOf: DateISO;
  /** 잔고를 옮겨 적은 순간 (ISO datetime). 가장 최근 기록을 고르는 데만 쓴다. */
  checkedAt: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 대출 1건 = 1문서. 이전에는 배열 전체가 한 문서의 memo 에 들어갔다. (F-05) */
export interface Debt {
  id: string;
  name: string;
  balanceMinor: number;
  monthlyMinor: number;
  /** 연이율(%). 입력하지 않으면 null. */
  rate: number | null;
  currentRound: number;
  totalRounds: number;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 생활비 — 기간 동안 쓰라고 미리 확보한 총액.
 *
 * 기간형 지출(`living`)과 다르다. 기간형 지출은 예산 70만과 실제 점심 1만 2천을 적으면
 * 71만 2천이 나가는 것으로 셌다. 예산은 그렇지 않다 — 70만을 확보해 두고 그 안에서
 * 1만 2천을 쓰면 68만 8천이 남는다. 나가는 돈의 총량은 여전히 70만이다.
 *
 * 그래서 가용 한도에 대한 몫은 `max(총 예산, 쓴 돈)` 이다. 예산 안에서 쓰는 동안 한도는
 * 움직이지 않고, 예산을 넘긴 만큼만 더 깎인다.
 */
export interface Budget {
  id: string;
  name: string;
  /** 포함 시작일. */
  startDate: DateISO;
  /** 포함 종료일. */
  endDate: DateISO;
  /** 이 기간에 쓰기로 확보한 총액. 최소 단위 정수. */
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 세이브 — 잔고에는 있지만 쓰지 않기로 떼어 둔 돈.
 *
 * legacy `save` 항목은 `sign: 0` 이라 아무 데도 반영되지 않는 참고 숫자였다. 이제는
 * **잔고는 그대로 두고 가용 한도에서만 빠진다.** 날짜가 없다 — 특정 날에 일어나는
 * 사건이 아니라 지금 묶여 있는 상태다.
 */
export interface Reserve {
  id: string;
  name: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/** 렌즈별 고정 메모. 날짜를 갖지 않으므로 entry 가 아니다. */
export interface Pin {
  id: string;
  lens: EntryKind;
  text: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 회복(Recovery).
 *
 * "휴식을 기록하는 기능이 아니라, 휴식을 빚지 않게 관리하는 기능." 그래서 여기에는
 * 피로도도 점수도 없다. 있는 것은 간격 하나와 놓친 횟수 하나뿐이다.
 *
 * 반복 일정(`Recurrence`)을 쓰지 않는 이유: 반복은 규칙에서 몇 달치를 펼쳐 보여 주지만,
 * 회복의 다음 날짜는 "마지막으로 실제로 쉰 날 + 간격" 이라 미리 펼칠 수가 없다.
 * 그래서 예정일은 규칙에 값으로 들고 있다가, 코앞에 왔을 때 한 건만 만든다.
 */

/** 회복 단위. 하루 중 어느 구간을 끌 것인가. */
export type RecoveryWindowId = 'evening' | 'afternoon' | 'day';

/** Rule 이 소유하는 OFF 옵션 정의. 사용자가 이름을 바꾸거나 지울 수 있다. */
export interface RecoveryOption {
  id: string;
  label: string;
  order: number;
}

/**
 * 개별 회차에 박제된 OFF 항목.
 *
 * label 을 함께 들고 있는 것이 핵심이다. 설정에서 옵션 이름을 바꾸거나 지워도
 * 지난 회차가 "무엇을 끄고 쉬었는지" 를 잃지 않는다. (id 만 두면 지운 순간 뜻이 사라진다)
 */
export interface RecoveryOptionSnapshot {
  id: string;
  label: string;
}

/** Entry 에 붙는 회복 표식. */
export interface RecoveryFields {
  /** 이 회차에 끌 항목. 생성 시점 Rule 기본값의 사본이고, 회차별로 고칠 수 있다. */
  options: RecoveryOptionSnapshot[];
  /** 밀린 회복을 갚는 회차인가. 완료하면 debtCount 가 하나 줄어든다. */
  repayment: boolean;
  /** 옮긴 횟수. 옮기기는 빚이 아니므로 세기만 하고 아무것도 하지 않는다. */
  movedCount: number;
}

/**
 * 회복 규칙. 사용자당 하나이고 `users/{uid}` 문서의 `recovery` 필드에 산다.
 *
 * Entry 와 분리한 이유는 이것이 일정이 아니라 상태이기 때문이다. 캘린더에 올라가는
 * 것은 `activeEntryId` 가 가리키는 한 건뿐이다.
 */
export interface RecoveryRule {
  enabled: boolean;
  /** 완료일로부터 며칠 뒤에 다음 회복을 둘 것인가. */
  intervalDays: number;
  window: RecoveryWindowId;
  /** 예정일 며칠 전에 실제 Event 를 만들 것인가. 0 이면 당일. */
  generationHorizonDays: number;
  /** 마지막으로 회복을 완료한 날. 다음 간격의 기준점이다. */
  lastCompletedAt: DateISO | null;
  /**
   * 다음 예정일. null 이면 예정이 없다 —
   * 아직 켜지 않았거나, 빚이 남아 "다시 잡기" 를 기다리는 중이다.
   */
  nextDueAt: DateISO | null;
  /**
   * 지금 캘린더에 올라가 있는 Recovery Event 의 id.
   *
   * 이 값이 중복 생성을 막는다. 캘린더 항목 구독은 보고 있는 달 주변만 받으므로
   * "이미 만들었나" 를 항목 목록으로 판정하면, 사용자가 먼 달을 열어 둔 사이에
   * 같은 회차가 한 번 더 만들어진다.
   */
  activeEntryId: string | null;
  /** 놓친 회복 횟수. 시간도 점수도 아니다. */
  debtCount: number;
  /** 새 회차에 기본값으로 들어가는 메모. */
  defaultMemo: string;
  /** 새 회차에 기본으로 켜 둘 옵션. */
  defaultOptionIds: string[];
  options: RecoveryOption[];
}

/** 백업이 담는 네 컬렉션. 전체 교체는 이 넷 모두에 똑같이 적용된다. */
export type BackupCollection = 'entries' | 'accounts' | 'debts' | 'pins' | 'budgets' | 'reserves';

export type ThemePref = 'system' | 'light' | 'dark';
/** 글씨 크기. 'auto' 는 브라우저·OS 설정을 따른다는 뜻이다. */
export type FontScale = 'auto' | 'sm' | 'md' | 'lg';
export type WeekStart = 'mon' | 'sun';
export type LensId = EntryKind | 'all';
export type ViewId = 'calendar' | 'list';

/** 기기에 남는 UI 설정. 사용자 데이터가 아니므로 Firestore 에 올리지 않는다. */
export interface Prefs {
  theme: ThemePref;
  fontScale: FontScale;
  lens: LensId;
  view: ViewId;
  weekStart: WeekStart;
  pinCollapsed: Partial<Record<LensId, boolean>>;
  debtsCollapsed: boolean;
  /** 생활비 · 세이브 줄. 대출과 따로 접는다. */
  budgetsCollapsed: boolean;
  todayCollapsed: boolean;
  todayMoneyCollapsed: boolean;
  moneyCardCollapsed: boolean;
}

export interface Filters {
  colors: Set<ColorId>;
  tags: Set<string>;
  status: TaskStatus | 'all';
  important: boolean;
  urgent: boolean;
  q: string;
}

// ---------- 같이 보기 (SharedBoard) ----------

/**
 * 공유 보드 — 내 TODO 를 상대와 함께 보는 자리.
 *
 * **개인 데이터를 직접 공유하지 않는다.** `users/{uid}` 아래에는 아이디어·가계부·회복이
 * 함께 살고 있어, 그 경로를 상대에게 열면 TODO 하나를 보여 주려고 전부를 열게 된다.
 * 그래서 공유용 자료는 최상위 `sharedBoards/{boardId}` 에 따로 둔다.
 *
 * `memberUids` 에는 **소유자도 들어 있다.** 읽기 규칙이 `uid in memberUids` 한 줄로
 * 끝나고, 화면도 "내가 속한 보드" 를 `array-contains` 한 번으로 찾는다.
 */
export interface SharedBoard {
  id: string;
  ownerUid: string;
  /** 소유자 + 초대를 수락한 사용자. */
  memberUids: string[];
  /**
   * 화면에 보일 이름. 계정 정보에서 만든다 (`displayName` 또는 이메일).
   * 관계(애인 · 가족)를 값으로 박아 두지 않는다 — 같은 구조를 누구와도 쓴다.
   */
  memberNames: Record<string, string>;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 초대장. `sharedInvites/{code}` 에 사는 **별도 문서**다.
 *
 * 초대받은 사람은 아직 member 가 아니라 보드 문서를 읽을 수 없다. 그래서 "어느 보드에
 * 들어가면 되는가" 만 담은 문서를 따로 두고, 그 문서의 id 자체가 초대 코드가 된다.
 * 로그인한 사용자만 읽을 수 있고, **코드를 모르면 찾을 수도 없다** (목록 조회는 막혀
 * 있다). 보드 내용은 여기 들어가지 않는다.
 */
export interface SharedInvite {
  code: string;
  boardId: string;
  ownerUid: string;
  /** 초대 화면에 보일 보드 이름. 소유자의 이메일은 넣지 않는다. */
  boardName: string;
  createdAt: string;
}

/** 공유 항목이 원본에서 물려받는 값. 여기 없는 필드는 공유되지 않는다. */
export interface SharedSource {
  title: string;
  note: string;
  startDate: DateISO;
  endDate: DateISO | null;
  startTime: TimeHM | null;
  status: TaskStatus;
  important: boolean;
  urgent: boolean;
  /**
   * 원본이 반복 항목인가.
   *
   * 공유 화면은 반복을 발생분으로 펼치지 않는다 — 표식만 보여 준다. 펼친 사본마다
   * override 를 두면 "어느 회차를 고쳤는가" 가 생기고, 그것은 이 범위가 아니다.
   */
  recurring: boolean;
}

/** 공유 화면에서 고칠 수 있는 필드. `recurring` 은 원본의 성질이라 뺀다. */
export type SharedOverridableField =
  'title' | 'note' | 'startDate' | 'endDate' | 'startTime' | 'status' | 'important' | 'urgent';

/**
 * 공유 화면에서만 바뀐 값.
 *
 * **키가 있으면 덮고, 없으면 원본을 따라간다.** 그래서 `undefined` 를 값으로 넣지 않는다 —
 * `endDate: null`("기간 없음으로 고쳤다")과 "안 고쳤다" 가 구분되어야 한다.
 */
export type SharedOverrides = Partial<Pick<SharedSource, SharedOverridableField>>;

/**
 * 공유 보드의 TODO 한 건.
 *
 * 원본을 복사해 두고 덮어쓰는 방식이 아니다. **원본 스냅샷(`source`) + 공유 화면에서
 * 고친 값(`overrides`)** 으로 표시값을 만든다 (`sharedView`). 그래서 원본의 날짜가
 * 바뀌면 제목만 고쳐 둔 항목도 새 날짜를 따라간다.
 */
export interface SharedTodoItem {
  /** 원본이 있으면 **원본 entry 의 id 와 같다.** 그래야 갱신이 덮어쓰기 한 번으로 끝난다. */
  id: string;
  sourceEntryId: string | null;
  /** 원본에서 마지막으로 받아 온 값. 공유 화면에서만 만든 항목은 null. */
  source: SharedSource | null;
  overrides: SharedOverrides;
  /** 공유 화면에서만 만든 항목. 개인 TODO 에는 없다. */
  localOnly: boolean;
  /** 원본은 두고 공유 화면에서만 감췄다. */
  hidden: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 공유 보드의 고정메모. 개인 `Pin` 과 **다른 자료다** — 뜻도 경로도 권한도 다르다. */
export interface SharedPin {
  id: string;
  text: string;
  order: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 공유 보드의 D-Day.
 *
 * 저장하는 것은 제목과 날짜뿐이다. 'D-23' 같은 문자열을 저장하면 다음 날 거짓이 된다
 * (`domain/dday.ts` 가 표시할 때 계산한다).
 */
export interface SharedDday {
  id: string;
  title: string;
  date: DateISO;
  order: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

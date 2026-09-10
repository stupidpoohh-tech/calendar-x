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

export type MoneyType =
  | 'income' | 'expense' | 'repay' | 'priority'
  | 'living' | 'save' | 'free';

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
 * tide 계산은 잔고를 "언제 확인했나"의 시각까지 필요하다 (정산 diff 를 그
 * 시점부터 오늘까지 지나간 예정과 비교하기 때문). 그래서 날짜(asOf)와
 * 시각(checkedAt)을 함께 둔다 — asOf 는 화면 표시용, checkedAt 은 계산용.
 */
export interface Account {
  id: string;
  name: string;
  balanceMinor: number;
  currency: string;
  /** 이 잔고가 사실이었던 날짜. 화면 표시와 월 조회에 쓴다. */
  asOf: DateISO;
  /** 잔고를 옮겨 적은 시각 (ISO datetime). 정산 diff 기준점. */
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
export type BackupCollection = 'entries' | 'accounts' | 'debts' | 'pins';

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

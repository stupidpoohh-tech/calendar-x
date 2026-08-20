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

  createdAt: string;
  updatedAt: string;
}

/** 잔고. 이전 '::balance::' 우회를 대체한다. 계좌 단위로 여러 개를 둘 수 있다. */
export interface Account {
  id: string;
  name: string;
  balanceMinor: number;
  currency: string;
  /** 이 잔고가 사실이었던 날짜. 현금흐름 예측의 시작점이 된다. */
  asOf: DateISO;
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

export type ThemePref = 'system' | 'light' | 'dark';
export type WeekStart = 'mon' | 'sun';
export type LensId = EntryKind | 'all';
export type ViewId = 'calendar' | 'list';

/** 기기에 남는 UI 설정. 사용자 데이터가 아니므로 Firestore 에 올리지 않는다. */
export interface Prefs {
  theme: ThemePref;
  lens: LensId;
  view: ViewId;
  weekStart: WeekStart;
  pinCollapsed: Partial<Record<LensId, boolean>>;
  debtsCollapsed: boolean;
}

export interface Filters {
  colors: Set<ColorId>;
  tags: Set<string>;
  status: TaskStatus | 'all';
  important: boolean;
  urgent: boolean;
  q: string;
}

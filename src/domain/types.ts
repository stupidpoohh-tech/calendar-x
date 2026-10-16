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

  /*
    ── 아래는 실제 거래(원장)를 위한 필드다 ─────────────────────────

    모두 **선택 필드**다. 이 필드들이 생기기 전의 문서·백업·테스트 자료에는 없고, 없으면
    지금까지와 똑같이 계산돼야 한다. 읽는 쪽은 언제나 `domain/ledger.ts` 의 접근자
    (`moneyStatusOf` · `moneyFlowOf` …)를 거친다 — 필드를 직접 읽으면 `undefined` 를
    잘못 해석하는 자리가 생긴다. 저장 계층(`converters`)은 늘 채워서 쓴다.
  */

  /** 예정인가, 실제로 일어난 거래인가. 없으면 예정이다 — 기존 항목은 전부 예정이다. */
  status?: MoneyStatus;
  /**
   * 돈의 성격. 방향(`type`)과 별개다.
   *
   * 현금흐름과 소비 통계가 갈리는 자리다 — 카드 사용은 소비지만 그날 현금은 안 나가고,
   * 카드 대금은 현금이 나가지만 소비가 아니다. 없으면 `normal`.
   */
  flow?: MoneyFlow;
  /** 결산 · 통계용 분류. 한도 계산에는 쓰지 않는다. */
  categoryId?: string | null;
  /** 결제수단. 자유 입력이다. 계산에 쓰지 않는다. */
  method?: string | null;
  /**
   * 이 실제 거래가 빠져나간(들어온) 계좌.
   *
   * 계좌가 여럿이고 잔고 기준일이 서로 다르면, 이 값 없이는 거래가 잔고에 이미 들어
   * 있는지 판정할 수 없다. 모를 때 "반영됐다" 고 넘겨짚지 않는다 (`balanceInclusion`).
   */
  accountId?: string | null;
  /**
   * 이 실제 거래가 확정한 예정 회차.
   *
   * 예정 문서는 확정할 때 건드리지 않는다. 연결은 **실제 거래 쪽에만** 있고, 계산과
   * 화면은 이 값을 보고 그 회차를 건너뛴다. 확정 취소는 이 문서 하나를 지우는 것이다.
   */
  plannedRef?: PlannedRef | null;
  /**
   * 가계부 달력에 그 날의 주요 거래로 띄운다(사용자가 고른 것). 자동 기준(10만 원)보다
   * 앞서고, 하루에 한 건만 뜬다(`daySummary.pickMajor`). 계산에 쓰지 않는 표시값이다.
   */
  highlight?: boolean;
  /**
   * 사용자가 "생활비 외 지출" 로 **명시**했다. `budgetId` 가 비어 있는 거래는 둘로 갈린다 —
   * 이 값이 true 면 일부러 생활비 밖에 둔 것이고, 아니면 아직 사용처를 정하지 않은 것이다.
   * 미연결 경고(`unlinkedSpendingFor`)는 정하지 않은 것만 보여 주고, 자동 선택은 이 값을
   * 덮지 않는다. 계산에는 쓰지 않는다 — 생활비 몫은 언제나 `budgetId` 로만 정해진다.
   */
  outsidePocket?: boolean;
  /**
   * 이 지출을 어느 세이브에서 썼는가 (Financial Core P3). 없으면 연결 없음.
   *
   * **세이브 원본 금액(`Reserve.amountMinor`)을 깎지 않는다.** 세이브의 사용액 · 남은 금액은 이 연결이 걸린
   * **실제** 거래에서 매번 센다(`budget.reserveUsageOf`) — 거래를 고치거나 지우거나 되살려도 세이브와 어긋날
   * 자리가 없다. 예정에도 걸 수 있지만 확정하기 전에는 사용액에 넣지 않는다(확정하면 실제 거래가 이어받는다).
   *
   * 일반 지출(`flow: 'normal'`)에만 건다. 수입 · 대출 · 이체 · 카드 대금은 소비가 아니고, 카드 사용은 대금과의
   * 관계가 P4 의 몫이라 걸지 않는다. 생활비 주머니(`budgetId`)와 함께 걸리지 않는다 — 사용처는 하나다.
   */
  reserveId?: string | null;
}

/** 예정 · 실제. */
export type MoneyStatus = 'planned' | 'actual';

/**
 * 돈의 성격.
 *
 *   normal         일반 수입 · 지출
 *   loanPrincipal  대출 원금 상환 — 현금은 나가지만 소비가 아니다
 *   loanInterest   대출 이자 — 현금이 나가고, 소비가 아니라 금융비용이다
 *   transfer       저축 · 계좌 간 이체 — 소비가 아니다
 *   cardSpend      신용카드 사용 — 소비지만 **그날 현금은 나가지 않는다**
 *   cardPayment    신용카드 대금 납부 — 현금은 나가지만 소비로 또 세지 않는다
 */
export type MoneyFlow =
  | 'normal' | 'loanPrincipal' | 'loanInterest' | 'transfer' | 'cardSpend' | 'cardPayment';

/** 실제 거래가 가리키는 예정 회차. 반복이 아니면 `date` 는 그 예정의 날짜다. */
export interface PlannedRef {
  /** 예정 원본의 id. 반복 전개분 id(`원본@날짜`)가 아니라 원본 그 자체다. */
  entryId: string;
  /** 확정한 회차의 날짜 — 실제 거래 날짜와 다를 수 있다. */
  date: DateISO;
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
   * 같이 보기에 올리지 않는 항목.
   *
   * 기본은 **공유**다 — 없으면 올라간다. opt-in 으로 두면 보드가 비어 기능이 죽고,
   * 사람은 "올리기" 를 누르는 것을 잊는다. 대신 빼는 길이 반드시 있어야 한다:
   * 선물 준비 · 면접 · 병원처럼 상대에게 보이면 안 되는 할 일이 실제로 있고,
   * 그것이 자동으로 올라가는 것은 기능 결함이 아니라 사고다.
   *
   * 켜면 이미 올라간 공유 항목도 다음 맞추기에서 내려간다.
   */
  keepPrivate?: boolean;

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
  /**
   * 이 잔고에 **이미 들어 있는**, 기준일 당일의 실제 거래.
   *
   * 기준일보다 앞선 거래는 날짜만으로 잔고에 들어 있다고 볼 수 있지만, 같은 날 거래는
   * 잔고를 적기 전에 났는지 뒤에 났는지를 날짜로도 생성 시각으로도 알 수 없다. 그래서
   * 사용자가 잔고를 적을 때 직접 고른 목록을 둔다. 기준일이 바뀌면 의미가 없어진다.
   * 없으면 빈 목록이다 — 고르지 않은 거래를 "반영됐다" 고 넘겨짚지 않는다.
   */
  reflectedEntryIds?: string[];
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
  /** 지금 실제로 확보하고 있는 금액. 보호를 끄거나 보관해도 이 값은 그대로다. */
  amountMinor: number;
  currency: string;
  /*
    ── 아래는 나중에 생긴 필드다 (P1) ───────────────────────────────
    모두 선택이다. 이 필드가 없던 시절의 문서 · 백업에는 없고, 없으면 지금까지와 똑같이
    계산돼야 한다. 읽는 쪽은 `budget.ts` 의 `reserveProtects` 를 거친다.
  */
  /**
   * 가용 한도에서 뺄 것인가. **없으면 true** — 예전 세이브는 모두 한도에서 빠지고 있었다.
   * false 는 "한도에 포함" 이고, 세이브와 금액은 그대로 남는다. 잔고 · 예상 잔고와 무관하다.
   */
  protected?: boolean;
  /** 목표 금액. 표시용이고 어떤 계산에도 들어가지 않는다. */
  targetAmountMinor?: number | null;
  /** 목표 날짜. 표시용이고 어떤 계산에도 들어가지 않는다. */
  targetDate?: DateISO | null;
  /**
   * 보관한 순간(ISO). 값이 있으면 일반 목록에서 빠지고 한도 보호도 풀린다. 금액은 지우지 않는다 —
   * 보관 해제하면 같은 금액 · 같은 보호 설정으로 돌아온다.
   */
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 이미 있는 세이브를 고치는 부분 쓰기 — **바꾼 칸만** 담는다.
 *
 * 문서 전체를 다시 쓰면 열어 둔 편집 창의 옛 값이 다른 기기에서 방금 바꾼 칸(보호 · 금액)을
 * 덮는다. 바꾼 칸만 merge 로 쓰면 바꾸지 않은 칸은 서버 값이 남는다
 * (`pendingWrites` 의 `reservePatch`). 새 세이브를 만들 때만 문서 전체를 쓴다.
 */
export type ReservePatch = Partial<Pick<
  Reserve, 'name' | 'amountMinor' | 'protected' | 'targetAmountMinor' | 'targetDate' | 'archivedAt'
>>;

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
  /**
   * 마지막으로 완료한 회차의 항목 id.
   *
   * **되돌리기 한 번을 위해서만 둔다.** 완료는 항목의 상태만 바꾸는 것이 아니라 빚과
   * 다음 예정일까지 옮기므로, 잘못 체크했을 때 체크만 풀면 규칙이 앞서 나간 채로 남는다.
   * 이 값이 "지금 풀고 있는 것이 방금 완료한 그 회차인가" 를 가른다 — 다음 회차가 이미
   * 만들어졌으면(`activeEntryId`) 되돌리지 않는다.
   */
  completedEntryId: string | null;
  /** 그 완료 **직전**의 `lastCompletedAt`. 되돌리면 이 값으로 돌아간다. */
  prevCompletedAt: DateISO | null;
  /** 새 회차에 기본값으로 들어가는 메모. */
  defaultMemo: string;
  /** 새 회차에 기본으로 켜 둘 옵션. */
  defaultOptionIds: string[];
  options: RecoveryOption[];
}

// ---------- 가계부 결산 (카테고리 · 정산 기간 · 카테고리 예산) ----------

/**
 * 거래 카테고리. 수입과 지출을 따로 관리한다.
 *
 * **지우지 않고 보관한다** (`archived`). 거래는 `money.categoryId` 로 가리키므로,
 * 카테고리 문서를 지우면 지난 거래가 "미분류" 로 떨어져 지난 결산이 바뀐다. 보관한
 * 카테고리는 새 입력에서 고르는 자리에서만 빠지고, 지난 기록과 통계에는 이름 그대로 남는다.
 */
export interface Category {
  id: string;
  /** 수입 카테고리인가 지출 카테고리인가. 거래의 흐름(`money.type`)과 짝이다. */
  kind: 'income' | 'expense';
  name: string;
  order: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 정산 기간의 열쇠. 그 기간의 날이 **더 많이 든 달**의 `YYYY-MM` 이다.
 *
 * 정산 시작일이 25일이면 `2026-10` 은 9/25 ~ 10/24 다. 시작일을 바꿔도 기간별 예산은
 * 지워지지 않고 같은 이름의 기간을 따라간다 (`domain/period.ts`).
 */
export type PeriodKey = YearMonth;

/**
 * 카테고리 예산 한 줄.
 *
 *   default  기본 예산. `period` 기간**부터** 적용된다. 다음 default 가 나올 때까지 이어진다
 *   period   그 기간 하나만의 예산. default 보다 앞선다
 *
 * 기본 예산을 바꾸는 것은 **새 default 를 하나 더 쓰는 것**이다 — 앞 기간들은 앞의 default
 * 를 그대로 보므로 소급되지 않는다. `amountMinor: null` 은 "이 기간(부터)은 예산 없음" 이다.
 *
 * 문서 id 는 `카테고리id~scope~period` 로 정해진다 (`categoryBudgetId`). 같은 자리를
 * 두 번 만들 수 없다.
 *
 * 생활비 주머니(`Budget`)와는 다른 기능이다. 이것은 비교 · 결산용이고 한도에서 미리
 * 빼지 않는다.
 */
export interface CategoryBudget {
  id: string;
  categoryId: string;
  scope: 'default' | 'period';
  period: PeriodKey;
  amountMinor: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/** 달 번호 '01' ~ '12'. 연간 예산의 월별 배분 열쇠다. */
export type MonthNo = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12';

/**
 * 연간 카테고리 예산 (Financial Core P2) — 미용 · 여행 · 명절처럼 특정 달에 몰리는 지출을 한 해 단위로 계획한다.
 *
 * **소비 계획이다. 돈이 나가는 사건이 아니다.** 잔고 · 예상 잔고 · 가용 한도 · 생활비 · 세이브 어느 계산에도
 * 들어가지 않는다. 미래 특정 날에 실제로 돈이 나가면 그것은 예정 거래로 따로 적는다.
 *
 *   연간 예산   amountMinor        그 해(1/1 ~ 12/31, 달력 연도) 이 카테고리에 쓰기로 한 총액
 *   월별 배분   monthAllocations   그 총액을 어느 달에 쓸 계획인지. 선택이고, 합은 총액 이하. 나머지는 미배분
 *   실제 사용   (원장에서 센다)     그 해의 실제 지출 — `ledgerStats` 의 소비 기준(소비 + 대출 이자)
 *
 * 월간 카테고리 예산(`CategoryBudget`)과 **다른 컬렉션**이다(`annualBudgets`). 월간 문서에 범위를 하나 더하면,
 * 그 값을 모르는 예전 앱이 모르는 범위를 'default' 로 읽어 연간 금액을 매월 예산으로 보여 준다
 * (`categoryBudgetFromDoc`). 문서 id 는 `카테고리id~연도`(`annualBudgetId`) — 한 해 한 카테고리에 한 장이다.
 *
 * 문서가 있는 해에는 그 카테고리를 연간으로 관리한다. 그 해의 월간 예산 문서는 지우지 않고 남겨 두며,
 * 연간 예산을 지우면(월간으로 되돌리면) 그대로 다시 보인다 — `annualBudget.ts` 머리 주석.
 */
export interface AnnualBudget {
  id: string;
  categoryId: string;
  /** 달력 연도. */
  year: number;
  /** 연간 총액. 0 이상의 최소 단위 정수. */
  amountMinor: number;
  /** 월별 배분. 키가 없는 달은 배분 없음. 값은 1 이상의 정수이고 합은 `amountMinor` 이하다. */
  monthAllocations: Partial<Record<MonthNo, number>>;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 정산 기간 메모 — 분석 화면의 "기간 돌아보기". 그 기간을 돌아보며 적는 글(반성 · 다짐).
 * 기간 하나에 한 장이고 문서 id 가 곧 기간 열쇠다 — 같은 기간에 두 장이 생기면 어느 쪽이
 * 그 달의 글인지 알 수 없다. 규칙이 `id == period` 를 강제한다.
 * 정산 시작일을 바꾸면 기간 경계는 움직이지만 이름(열쇠)은 그대로라 글은 같은 이름의 기간에 남는다.
 */
export interface LedgerNote {
  id: PeriodKey;
  period: PeriodKey;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** 가계부 설정. `users/{uid}` 문서의 `ledger` 필드에 산다. */
export interface LedgerSettings {
  /** 매월 정산 시작일 1~31. 그 달에 없는 날이면 말일로 당긴다. */
  settleDay: number;
}

/** 백업이 담는 컬렉션. */
export type BackupCollection =
  | 'entries' | 'accounts' | 'debts' | 'pins' | 'budgets' | 'reserves'
  | 'categories' | 'categoryBudgets' | 'ledgerNotes' | 'annualBudgets';

export type ThemePref = 'system' | 'light' | 'dark';
/** 글씨 크기. 'auto' 는 브라우저·OS 설정을 따른다는 뜻이다. */
export type FontScale = 'auto' | 'sm' | 'md' | 'lg';
export type WeekStart = 'mon' | 'sun';
export type LensId = EntryKind | 'all';
export type ViewId = 'calendar' | 'list';

/** 기기에 남는 UI 설정. 사용자 데이터가 아니므로 Firestore 에 올리지 않는다. */
/**
 * 최상위 공간. 렌즈보다 위다.
 *
 *   me      내 캘린더 · 노트 · 가계부
 *   shared  둘이 함께 보는 보드
 *
 * 공유를 렌즈 칸 하나로 만들지 않는 이유는 축이 다섯 개라는 뜻이 되기 때문이고,
 * 공간으로 올리는 이유는 그것이 **다른 자료를 보는 다른 화면**이기 때문이다.
 */
export type SpaceId = 'me' | 'shared';

/** 공유 보드 안의 탭. 캘린더 · 리스트 · 노트 셋이다. */
export type SharedTabId = 'calendar' | 'list' | 'notes';

export interface Prefs {
  theme: ThemePref;
  fontScale: FontScale;
  /** 마지막으로 있던 공간. 재진입하면 여기로 돌아온다. */
  space: SpaceId;
  lens: LensId;
  /** 공유 공간의 마지막 탭. 개인 렌즈와 **따로** 기억한다. */
  sharedTab: SharedTabId;
  view: ViewId;
  /**
   * 같이 보기 화면의 보기 방식.
   *
   * 개인 화면(`view`)과 따로 둔다. 공유 화면에서 리스트로 바꿨다고 돌아간 내 TODO 까지
   * 리스트가 되면, 고친 적 없는 화면이 바뀐 것으로 보인다.
   */
  sharedView: ViewId;
  weekStart: WeekStart;
  pinCollapsed: Partial<Record<LensId, boolean>>;
  debtsCollapsed: boolean;
  /** 생활비 · 세이브 줄. 대출과 따로 접는다. */
  budgetsCollapsed: boolean;
  todayCollapsed: boolean;
  todayMoneyCollapsed: boolean;
  moneyCardCollapsed: boolean;
}

/**
 * 가계부 렌즈 안의 보기. 렌즈 바로 아래 한 줄이고, 고른 보기의 본문 하나만 그린다.
 * 마지막 보기는 세션 동안만 기억한다 — 앱을 새로 열면 현금흐름부터 시작한다.
 */
export type LedgerTabId = 'history' | 'cashflow' | 'budget' | 'stats';

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
  /**
   * 달력에서 항목을 가르는 값.
   *
   * 원본의 색을 그대로 물려받는다 — 내 달력에서 빨강이던 일이 공유 화면에서 파랑이면
   * 같은 일로 읽히지 않는다. 공유 화면에서 따로 고칠 수도 있다 (둘이 쓰는 기준이
   * 내 기준과 다를 수 있다).
   */
  color: ColorId;
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
  'title' | 'note' | 'color' | 'startDate' | 'endDate' | 'startTime' | 'status' | 'important' | 'urgent';

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
  /**
   * 마지막으로 `overrides` 를 고친 사람.
   *
   * 양방향이라 "공유 화면에서 수정됨" 만으로는 누가 고쳤는지 알 수 없다 — 내 항목을
   * 상대가 고쳤는지 내가 고쳤는지가 달라야 읽힌다. 고친 자리가 없으면 빈 문자열.
   */
  overriddenBy: string;
  /** 공유 화면에서만 만든 항목. 개인 TODO 에는 없다. */
  localOnly: boolean;
  /**
   * 이 항목을 감춘 사람들.
   *
   * **보드 전체가 아니라 사람별이다.** "이건 나한테 안 보였으면" 은 개인 취향인데,
   * 보드 값 하나로 두면 내가 감춘 순간 상대의 자기 할 일이 상대 화면에서도 사라진다.
   * 규칙이 "자기 uid 만 넣고 뺄 수 있다" 로 막는다.
   */
  hiddenBy: string[];
  /**
   * 이 항목을 보드에 올린 사람.
   *
   * 원본이 있는 항목은 **그 원본의 주인**이다. 양방향에서 이 값이 "누가 이 항목을
   * 맞추고 지울 책임이 있는가" 를 정한다 — 남의 몫까지 맞추면 상대가 올린 것을
   * "원본이 없다" 고 보고 지운다.
   */
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

/**
 * 함께 할 것 — 목록 하나.
 *
 * 일정과 다르다. 날짜도 마감도 우선순위도 없고, 하나씩 완료해 가는 목록이다.
 * 목록 이름을 하드코딩하지 않는다 — '게임' · '갈 곳' 은 예시이고, 무엇을 모을지는
 * 쓰는 사람이 정한다.
 */
export interface SharedCollection {
  id: string;
  title: string;
  order: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 함께 할 것 — 항목 하나.
 *
 * **목록 문서 아래가 아니라 보드 아래 평평하게 둔다** (`collectionId` 로 가리킨다).
 * 중첩하면 목록마다 리스너를 하나씩 붙이거나 `collectionGroup` 을 써야 하는데,
 * 후자는 이름이 `items` 인 공유 일정 컬렉션까지 함께 걸린다.
 */
export interface SharedCollectionItem {
  id: string;
  collectionId: string;
  title: string;
  completed: boolean;
  /** 완료한 순간. 되돌리면 null 이다. */
  completedAt: string | null;
  order: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 메모 — 게시판처럼 쌓이는 글 한 건.
 *
 * 용도를 가르지 않는다. 편지 · 준비물 · 예약 정보 · 서로에게 남기는 말이 같은 구조를
 * 쓴다. 분류를 만들면 어디에 적어야 하는지를 매번 고민하게 되고, 그러면 안 적는다.
 *
 * **고정메모는 별도 시스템이 아니다.** 이 글 중 하나를 `pinned` 로 세워 보드 위에
 * 한 줄로 띄운다.
 */
export interface SharedNote {
  id: string;
  /** 제목은 선택이다. 없으면 본문 첫 줄이 제목 자리를 대신한다. */
  title: string | null;
  body: string;
  pinned: boolean;
  authorUid: string;
  createdAt: string;
  updatedAt: string;
}

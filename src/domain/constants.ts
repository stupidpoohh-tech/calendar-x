import type {
  ColorId, EntryKind, LensId, MoneyType, NewMoneyType, RepeatFreq, TaskStatus,
} from './types';

export interface ColorDef { id: ColorId; hex: string; label: string }

export const COLORS: readonly ColorDef[] = [
  { id: 'red',    hex: '#ef4444', label: '레드' },
  { id: 'orange', hex: '#f97316', label: '오렌지' },
  { id: 'amber',  hex: '#eab308', label: '앰버' },
  { id: 'green',  hex: '#22c55e', label: '그린' },
  { id: 'cyan',   hex: '#06b6d4', label: '시안' },
  { id: 'blue',   hex: '#3b82f6', label: '블루' },
  { id: 'violet', hex: '#8b5cf6', label: '바이올렛' },
  { id: 'pink',   hex: '#ec4899', label: '핑크' },
];

export const COLOR_BY_ID: Record<ColorId, ColorDef> =
  Object.fromEntries(COLORS.map((c) => [c.id, c])) as Record<ColorId, ColorDef>;

export const DEFAULT_COLOR: ColorId = 'blue';

export function colorHex(id: ColorId | undefined | null): string {
  return (id && COLOR_BY_ID[id]?.hex) || COLOR_BY_ID[DEFAULT_COLOR].hex;
}

/**
 * 렌즈. 이전의 "탭"이다.
 *
 * 탭은 서로 격리된 3개의 캘린더였지만, 렌즈는 하나의 타임라인을 보는 방식이다.
 * 'all' 렌즈가 세 축을 한 화면에 올린다.
 */
export interface LensDef {
  id: LensId;
  label: string;
  title: string;
  /** CSS 변수명. 토큰에서 라이트/다크 값을 각각 정의한다. */
  accentVar: string;
  kind: EntryKind | null;
}

export const LENSES: readonly LensDef[] = [
  { id: 'all',   label: '전체',   title: '전체',      accentVar: '--lens-all',   kind: null },
  { id: 'task',  label: 'TODO',   title: '할 일',     accentVar: '--lens-task',  kind: 'task' },
  { id: 'idea',  label: '💡',     title: '아이디어',  accentVar: '--lens-idea',  kind: 'idea' },
  { id: 'money', label: '가계부', title: '가계부',    accentVar: '--lens-money', kind: 'money' },
];

export const LENS_BY_ID: Record<LensId, LensDef> =
  Object.fromEntries(LENSES.map((l) => [l.id, l])) as Record<LensId, LensDef>;

export const KIND_LABEL: Record<EntryKind, string> = {
  task: '할 일',
  idea: '아이디어',
  money: '가계부',
};

export interface MoneyTypeDef {
  id: MoneyType;
  label: string;
  color: string;
  /** 현금흐름에서의 부호. 잔고를 늘리면 +1, 줄이면 -1, 영향 없으면 0. */
  sign: 1 | -1 | 0;
  /** 기간형이면 시작일~종료일에 걸쳐 표시한다. */
  ranged: boolean;
  defaultColor: ColorId;
  hint: string;
  /**
   * 새 입력 화면에서 고를 수 없는 옛 종류.
   *
   * **계산에서는 빼지 않는다.** 이미 저장된 문서가 이 값을 들고 있고, 목록에서 지우면
   * `converters` 가 모르는 값을 'expense' 로 떨어뜨려 입금이 지출이 되거나
   * (`save` · `free`) 잔고에 영향이 없던 항목이 잔고를 깎는다.
   * 사라지는 것은 고르는 자리뿐이다.
   */
  legacy?: true;
}

export const MONEY_TYPES: readonly MoneyTypeDef[] = [
  { id: 'income',   label: '들어올 돈', color: '#22c55e', sign:  1, ranged: false, defaultColor: 'green',  hint: '입금 예정' },
  { id: 'expense',  label: '나갈 돈',   color: '#ef4444', sign: -1, ranged: false, defaultColor: 'red',    hint: '지출 예정' },
  { id: 'repay',    label: '갚을 거',   color: '#f97316', sign: -1, ranged: false, defaultColor: 'orange', hint: '상환 예정', legacy: true },
  { id: 'priority', label: '우선 상환', color: '#8b5cf6', sign: -1, ranged: false, defaultColor: 'violet', hint: '먼저 갚을 것', legacy: true },
  { id: 'living',   label: '생활비',    color: '#3b82f6', sign: -1, ranged: true,  defaultColor: 'blue',   hint: '기간에 걸쳐 나가는 돈', legacy: true },
  { id: 'save',     label: '세이브',    color: '#06b6d4', sign:  0, ranged: false, defaultColor: 'cyan',   hint: '떼어 두는 돈 — 잔고에서 빠지지 않음', legacy: true },
  { id: 'free',     label: '가용',      color: '#6b7280', sign:  0, ranged: true,  defaultColor: 'blue',   hint: '쓸 수 있는 여유 — 참고용', legacy: true },
];

/**
 * 새로 만들 때 고를 수 있는 것. 흐름 두 갈래뿐이다.
 *
 * 나머지 뜻(생활비 · 세이브 · 대출 상환)은 종류가 아니라 **연결**로 표현한다 —
 * `budgetId` · Reserve 문서 · `debtId`. 종류 하나에 여러 뜻을 욱여넣으면
 * "생활비이면서 대출 상환" 같은 것을 적을 자리가 없어진다.
 */
export const NEW_MONEY_TYPES: readonly MoneyTypeDef[] =
  MONEY_TYPES.filter((t) => !t.legacy);

export const NEW_MONEY_TYPE_IDS: readonly NewMoneyType[] = ['income', 'expense'];

export const MONEY_TYPE_BY_ID: Record<MoneyType, MoneyTypeDef> =
  Object.fromEntries(MONEY_TYPES.map((t) => [t.id, t])) as Record<MoneyType, MoneyTypeDef>;

export interface StatusDef { id: TaskStatus; label: string; dot: string }

export const STATUSES: readonly StatusDef[] = [
  { id: 'planned',     label: '예정',   dot: '#a3a3a3' },
  { id: 'in-progress', label: '진행중', dot: '#3b82f6' },
  { id: 'done',        label: '완료',   dot: '#22c55e' },
];

export const STATUS_BY_ID: Record<TaskStatus, StatusDef> =
  Object.fromEntries(STATUSES.map((s) => [s.id, s])) as Record<TaskStatus, StatusDef>;

export const REPEAT_OPTIONS: readonly { id: RepeatFreq | 'none'; label: string }[] = [
  { id: 'none',    label: '반복 없음' },
  { id: 'daily',   label: '매일' },
  { id: 'weekly',  label: '매주' },
  { id: 'monthly', label: '매월' },
];

export const DEFAULT_CURRENCY = 'KRW';

/** 반복 항목을 캘린더에 펼칠 때의 안전 상한. 무기한 반복이 메모리를 먹는 것을 막는다. */
export const MAX_RECURRENCE_OCCURRENCES = 400;

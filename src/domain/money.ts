import { DEFAULT_CURRENCY } from './constants';

/** 통화별 소수 자릿수. KRW 는 0 이라 최소 단위가 곧 원이다. */
const MINOR_DIGITS: Record<string, number> = { KRW: 0, JPY: 0, USD: 2, EUR: 2 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

/** 사용자 입력 문자열을 최소 단위 정수로. '1,200원' → 1200 */
export function parseAmountToMinor(input: string, currency = DEFAULT_CURRENCY): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** minorDigits(currency));
}

export function minorToInput(minor: number, currency = DEFAULT_CURRENCY): string {
  const d = minorDigits(currency);
  return d === 0 ? String(minor) : (minor / 10 ** d).toFixed(d);
}

export function formatMoney(minor: number, currency = DEFAULT_CURRENCY): string {
  const d = minorDigits(currency);
  const value = minor / 10 ** d;
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(value);
  } catch {
    return `${value.toLocaleString('ko-KR')} ${currency}`;
  }
}

/** 축약 없이 숫자만. 카드 안에서 통화 기호를 따로 둘 때 쓴다. */
export function formatAmount(minor: number, currency = DEFAULT_CURRENCY): string {
  const d = minorDigits(currency);
  return (minor / 10 ** d).toLocaleString('ko-KR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** 부호를 붙인 표기. 현금흐름 표에서 쓴다. */
export function formatSigned(minor: number, currency = DEFAULT_CURRENCY): string {
  const sign = minor > 0 ? '+' : minor < 0 ? '−' : '';
  return sign + formatAmount(Math.abs(minor), currency);
}

/**
 * 달력 셀처럼 좁은 자리에 쓰는 축약 표기 — `4.7만` · `5천` · `−35만`.
 * 잔고캘린더가 날짜별 한도를 이렇게 적는다.
 *
 * 만·천 단위는 원화 셈법이라 소수 자리를 쓰는 통화에는 옮길 수 없다.
 * 그런 통화에서는 축약하지 않고 평소 표기로 물러난다.
 */
export function compactAmount(minor: number, currency = DEFAULT_CURRENCY): string {
  if (minorDigits(currency) !== 0) return formatSigned(minor, currency);
  const abs = Math.abs(minor);
  const sign = minor < 0 ? '−' : '';
  if (abs >= 10_000_000) return `${sign}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`;
  if (abs >= 10_000) return `${sign}${trimTenth(abs / 10_000)}만`;
  if (abs >= 1_000) return `${sign}${trimTenth(abs / 1_000)}천`;
  return `${sign}${abs}`;
}

function trimTenth(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

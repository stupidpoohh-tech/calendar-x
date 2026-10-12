/** 가계부 상세 화면이 함께 쓰는 판정과 표기. */
import { parseDate } from '../domain/date';
import type { FeedState } from '../app/useStore';

/** 숫자를 내도 되는가. 아니면 그 이유. */
export function feedVerdict(feed: FeedState): { ok: true; caveat: string | null } | { ok: false; message: string } {
  if (feed.status === 'error') return { ok: false, message: '거래를 불러오지 못했습니다. 지어낸 합계를 보여 주지 않기 위해 비워 둡니다.' };
  if (!feed.ready) return { ok: false, message: '거래를 불러오는 중입니다.' };
  if (feed.fromCache && feed.empty) {
    return { ok: false, message: '이 기기에 저장된 자료가 비어 있어 "거래 없음" 인지 "아직 못 받았는지" 를 가릴 수 없습니다. 연결되면 다시 셉니다.' };
  }
  return { ok: true, caveat: feed.fromCache ? '이 기기에 저장된 자료 기준입니다. 다른 기기에서 적은 것은 아직 빠져 있을 수 있습니다.' : null };
}

export function dayLabel(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
}

/**
 * 공유 보드 문서 ↔ 도메인.
 *
 * 두 가지를 못 박는다.
 *   1. **갱신 쓰기는 `overrides` · `hidden` 을 담지 않는다.** 담으면 원본을 고칠 때마다
 *      상대가 고쳐 둔 값과 감춰 둔 상태가 되살아난다. 그 사고를 여기서 잡는다.
 *   2. **모르는 override 는 기본값으로 바꾸지 않고 버린다.** 바꾸면 끝낸 일이 예정으로
 *      되살아나고, 고치지 않은 날짜가 바뀐다.
 */
import { describe, expect, it } from 'vitest';
import {
  sharedBoardFromDoc, sharedDdayFromDoc, sharedItemFromDoc, sharedItemToDoc,
  sharedPinFromDoc, sharedSourcePatch,
} from './sharedConverters';
import type { SharedSource } from '../domain/types';

const source: SharedSource = {
  title: '병원 예약',
  note: '',
  color: 'blue',
  startDate: '2026-09-25',
  endDate: null,
  startTime: null,
  status: 'planned',
  important: false,
  urgent: false,
  recurring: false,
};

describe('갱신 쓰기의 모양', () => {
  it('overrides · hidden 을 담지 않는다', () => {
    const patch = sharedSourcePatch('task-a', source, 'owner', '2026-09-23T00:00:00.000Z');
    expect(Object.keys(patch).sort()).toEqual([
      'createdBy', 'localOnly', 'source', 'sourceEntryId', 'updatedAt',
    ]);
    expect('overrides' in patch).toBe(false);
    expect('hidden' in patch).toBe(false);
  });

  it('원본 entry 를 가리킨다', () => {
    const patch = sharedSourcePatch('task-a', source, 'owner', '2026-09-23T00:00:00.000Z');
    expect(patch.sourceEntryId).toBe('task-a');
    expect(patch.localOnly).toBe(false);
  });

  it('항목 전체 쓰기는 세 필드를 모두 담는다 — 공유 화면의 편집이 쓰는 길이다', () => {
    const doc = sharedItemToDoc({
      id: 'task-a', sourceEntryId: 'task-a', source,
      overrides: { title: '병원 전화하기' }, localOnly: false, hidden: true,
      createdBy: 'owner', createdAt: '', updatedAt: '',
    });
    expect(doc.overrides).toEqual({ title: '병원 전화하기' });
    expect(doc.hidden).toBe(true);
  });
});

describe('항목 읽기', () => {
  it('세 필드가 없는 문서가 정상이다 — 갱신 쓰기가 담지 않기 때문이다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a', source, createdBy: 'owner', updatedAt: '',
    });
    expect(item.overrides).toEqual({});
    expect(item.hidden).toBe(false);
    expect(item.localOnly).toBe(false);
  });

  it('원본도 표식도 없으면 공유 화면 전용 항목으로 읽는다', () => {
    const item = sharedItemFromDoc('local-1', { overrides: { title: '장보기' } });
    expect(item.localOnly).toBe(true);
    expect(item.sourceEntryId).toBe(null);
  });

  it('모르는 상태 override 는 버린다 — 끝낸 일을 예정으로 되살리지 않는다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a',
      source: { ...source, status: 'done' },
      overrides: { status: 'zzz' },
    });
    expect('status' in item.overrides).toBe(false);
    expect(item.source?.status).toBe('done');
  });

  it('깨진 날짜 override 는 버린다 — 고치지 않은 날짜를 바꾸지 않는다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a', source, overrides: { startDate: '어제' },
    });
    expect('startDate' in item.overrides).toBe(false);
  });

  it('패딩 없는 날짜 override 는 맞춰 읽는다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a', source, overrides: { startDate: '2026-9-3' },
    });
    expect(item.overrides.startDate).toBe('2026-09-03');
  });

  it('endDate · startTime 의 null 은 "고쳤다" 는 뜻이라 살린다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a',
      source: { ...source, endDate: '2026-09-28', startTime: '14:00' },
      overrides: { endDate: null, startTime: null },
    });
    expect(item.overrides.endDate).toBe(null);
    expect(item.overrides.startTime).toBe(null);
  });

  it('모르는 색 override 는 버려 원본 색을 따라가게 둔다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a',
      source: { ...source, color: 'pink' },
      overrides: { color: 'ultraviolet' },
    });
    expect('color' in item.overrides).toBe(false);
    expect(item.source?.color).toBe('pink');
  });

  /*
    원본 쪽 색은 다르다. 뜻이 바뀌는 값이 아니라 보이는 값이라, 거절해서 항목이
    통째로 안 보이는 것보다 기본색으로 그리는 편이 낫다.
  */
  it('모르는 색이 원본에 있으면 기본색으로 그린다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a', source: { ...source, color: 'ultraviolet' },
    });
    expect(item.source?.color).toBe('blue');
  });

  it('숫자로 적힌 제목 override 는 버린다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a', source, overrides: { title: 12 },
    });
    expect('title' in item.overrides).toBe(false);
  });

  it('뒤집힌 기간은 기간이 아니다', () => {
    const item = sharedItemFromDoc('task-a', {
      sourceEntryId: 'task-a',
      source: { ...source, endDate: '2026-09-01' },
    });
    expect(item.source?.endDate).toBe(null);
  });

  it('source 가 통째로 깨져 있으면 null 로 읽는다 — 던지지 않는다', () => {
    const item = sharedItemFromDoc('task-a', { sourceEntryId: 'task-a', source: 'nope' });
    expect(item.source).toBe(null);
  });
});

describe('보드 · 메모 · D-Day 읽기', () => {
  it('소유자가 member 목록에서 빠져 있으면 메워 준다', () => {
    const board = sharedBoardFromDoc('b1', { ownerUid: 'me', memberUids: ['you'], name: '같이 보기' });
    expect(board.memberUids).toEqual(['me', 'you']);
  });

  it('이름표는 문자열인 항목만 남긴다', () => {
    const board = sharedBoardFromDoc('b1', {
      ownerUid: 'me', memberUids: ['me'], memberNames: { me: 'me@example.com', you: 7 },
    });
    expect(board.memberNames).toEqual({ me: 'me@example.com' });
  });

  it('메모 본문이 없으면 빈 문자열이다', () => {
    expect(sharedPinFromDoc('memo', {}).text).toBe('');
  });

  it('D-Day 날짜가 깨져 있으면 오늘로 메우지 않는다 — 매일 D-Day 가 된다', () => {
    expect(sharedDdayFromDoc('d1', { title: '여행', date: '언젠가' }).date).toBe('');
  });
});

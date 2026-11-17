/**
 * 월별 메모 — 노트 화면 맨 위의 목표 · 결과 한 장.
 *
 * 여기서 보는 것은 셋이다.
 *   1. 칸이 둘이고 왼쪽이 목표 · 오른쪽이 결과다(순서가 바뀌면 적어 둔 뜻이 바뀐다)
 *   2. 구독을 받기 전에는 고치지 못한다(빈 칸으로 저장하면 서버의 글을 덮는다)
 *   3. 저장은 그 달의 문서 한 장이고, 바꾸지 않았으면 쓰지 않는다
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedState } from '../app/useStore';
import type { MonthNote } from '../domain/types';
import { MonthNotePanel } from './MonthNotePanel';

afterEach(cleanup);

const LIVE: FeedState = { status: 'live', ready: true, empty: false, fromCache: false, pending: false };
const LOADING: FeedState = { status: 'loading', ready: false, empty: true, fromCache: false, pending: false };
/** 캐시가 비어 "없음" 을 확정할 수 없는 상태. */
const UNCONFIRMED: FeedState = { status: 'cache', ready: true, empty: true, fromCache: true, pending: false };

const NOTE: MonthNote = {
  id: '2026-11', month: '2026-11', goal: '이사 준비', result: '계약 완료',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-30T00:00:00.000Z',
};

function panel(note: MonthNote | null, feed: FeedState = LIVE, month = '2026-11') {
  const onSave = vi.fn();
  render(<MonthNotePanel month={month} note={note} feed={feed} onSave={onSave} />);
  return { onSave };
}

const boxes = () => screen.getAllByRole('textbox') as HTMLTextAreaElement[];

describe('월별 메모', () => {
  it('보고 있는 달의 목표 · 결과를 왼쪽 · 오른쪽으로 보여 준다', () => {
    panel(NOTE);
    expect(screen.getByText('2026년 11월')).toBeTruthy();
    const caps = screen.getAllByText(/^(목표|결과)$/).map((e) => e.textContent);
    expect(caps).toEqual(['목표', '결과']);
    expect(screen.getByText('이사 준비')).toBeTruthy();
    expect(screen.getByText('계약 완료')).toBeTruthy();
  });

  it('적은 글이 없으면 칸마다 무엇을 적는 자리인지 말한다', () => {
    panel(null);
    expect(screen.getByText('이 달에 하려는 것을 적어 두세요.')).toBeTruthy();
    expect(screen.getByText('달을 마치며 적습니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '적기' })).toBeTruthy();
  });

  it('구독을 아직 못 받았으면 고치지 못한다', () => {
    panel(null, LOADING);
    expect(screen.queryByRole('button', { name: /적기|고치기/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('불러오는 중');
  });

  it('캐시가 비어 "없음" 을 확정할 수 없어도 고치지 못한다', () => {
    panel(null, UNCONFIRMED);
    expect(screen.queryByRole('button', { name: /적기|고치기/ })).toBeNull();
  });

  it('두 칸을 함께 그 달의 문서 한 장으로 저장한다', () => {
    const { onSave } = panel(null);
    fireEvent.click(screen.getByRole('button', { name: '적기' }));
    const [goal, result] = boxes();
    fireEvent.change(goal!, { target: { value: '주 3회 달리기' } });
    fireEvent.change(result!, { target: { value: '8회 달렸다' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as MonthNote;
    expect([saved.id, saved.month, saved.goal, saved.result])
      .toEqual(['2026-11', '2026-11', '주 3회 달리기', '8회 달렸다']);
  });

  it('한 칸만 고쳐도 다른 칸은 그대로 실린다', () => {
    const { onSave } = panel(NOTE);
    fireEvent.click(screen.getByRole('button', { name: '고치기' }));
    fireEvent.change(boxes()[1]!, { target: { value: '계약 완료 · 잔금만 남음' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const saved = onSave.mock.calls[0]![0] as MonthNote;
    expect(saved.goal).toBe('이사 준비');
    expect(saved.result).toBe('계약 완료 · 잔금만 남음');
    // 처음 적은 때는 그대로 두고 고친 때만 올린다.
    expect(saved.createdAt).toBe(NOTE.createdAt);
    expect(saved.updatedAt).not.toBe(NOTE.updatedAt);
  });

  it('바꾸지 않고 저장하면 쓰지 않는다', () => {
    const { onSave } = panel(NOTE);
    fireEvent.click(screen.getByRole('button', { name: '고치기' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('빈 칸으로 열어 그대로 저장해도 빈 문서를 만들지 않는다', () => {
    const { onSave } = panel(null);
    fireEvent.click(screen.getByRole('button', { name: '적기' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('취소하면 고친 값을 버리고 저장된 글로 돌아간다', () => {
    const { onSave } = panel(NOTE);
    fireEvent.click(screen.getByRole('button', { name: '고치기' }));
    fireEvent.change(boxes()[0]!, { target: { value: '다른 목표' } });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('이사 준비')).toBeTruthy();
  });

  it('달을 옮기면 그 달의 글을 본다', () => {
    panel(null, LIVE, '2026-12');
    expect(screen.getByText('2026년 12월')).toBeTruthy();
  });
});

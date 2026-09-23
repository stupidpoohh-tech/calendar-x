import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalendarScreen } from './CalendarScreen';
import type { State } from '../lib/types';
import { base64UrlEncode, decodeBackup, encodeBackup } from '../lib/backup';
import { loadState, saveState } from '../lib/storage';
import { headlineLimit } from '../lib/calc';

const initial: State = {
  balance: { amount: 3_000_000, checkedAt: '2026-09-23T00:00:00Z' },
  entries: [], budgets: [], reserves: [],
};
function App() {
  const loaded = loadState();
  const [state, setState] = useState(loaded.status === 'ok' ? loaded.state : initial);
  return <CalendarScreen state={state} today="2026-09-23" onSave={(s) => { saveState(s); setState(s); }} />;
}
const change = (label: string, value: string) =>
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장' }));
afterEach(() => { cleanup(); localStorage.clear(); });

describe('예산 화면 → 계산 → 저장 → 복원', () => {
  it('예산과 세이브 생성, 연결 지출, 수정·삭제, 새로고침·백업 왕복', () => {
    const app = render(<App />);
    fireEvent.click(screen.getByText('생활비 · 세이브'));
    fireEvent.click(screen.getByRole('button', { name: '생활비 예산 추가' }));
    change('금액', '700000');
    save();
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,300,000원');
    fireEvent.click(screen.getByRole('button', { name: '세이브 추가' }));
    change('이름', '비상금'); change('금액', '200000'); save();
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,100,000원');
    fireEvent.click(screen.getByRole('button', { name: '생활비에서 사용' }));
    change('금액', '12000'); change('내용', '점심');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '추가' }));
    expect(screen.getByText('예산 700,000원 · 사용 12,000원')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,100,000원');
    // 월 이동으로 계산값이 달라지지 않는다.
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,100,000원');
    app.unmount();
    render(<App />);
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,100,000원');
    const loaded = loadState();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') throw new Error('저장 실패');
    const restored = decodeBackup(encodeBackup(loaded.state));
    expect(restored.ok && headlineLimit(restored.state, '2026-09-23')).toBe(2_100_000);
    fireEvent.click(screen.getByText('생활비 · 세이브 · 2건'));
    fireEvent.click(screen.getByRole('button', { name: '비상금 세이브 수정' }));
    change('금액', '300000'); save();
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,000,000원');
    fireEvent.click(screen.getByRole('button', { name: '생활비 예산 삭제' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('사용 기록은 남으며');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,688,000원');
    const after = loadState();
    expect(after.status === 'ok' && after.state.entries[0]?.name).toBe('점심');
  });
  it('예산 기간 밖으로 날짜를 고치면 별도 지출임을 알리고 저장한다', () => {
    saveState({ ...initial, budgets: [{ id: 'b', name: '생활비', start: '2026-09-01', end: '2026-09-30', amount: 700_000 }] });
    render(<App />);
    fireEvent.click(screen.getByText('생활비 · 세이브 · 1건'));
    fireEvent.click(screen.getByRole('button', { name: '생활비에서 사용' }));
    change('날짜', '2026-10-01'); change('금액', '12000'); change('내용', '점심');
    expect(screen.getByRole('status')).toHaveTextContent('별도 입출금');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '추가' }));
    expect(screen.getByRole('button', { name: '통장 잔고 다시 적기' })).toHaveTextContent('2,288,000원');
  });
  it('검증 실패 백업은 저장 원문을 변경하지 않는다', () => {
    saveState(initial);
    const before = localStorage.getItem('tideover.state');
    const bad = { v: 5, s: { ...initial, entries: [{ id: 'a', name: '오류', amount: -10, kind: 'expense', schedule: { type: 'once', date: '2026-02-30' } }] } };
    expect(decodeBackup(base64UrlEncode(JSON.stringify(bad))).ok).toBe(false);
    expect(localStorage.getItem('tideover.state')).toBe(before);
  });
});


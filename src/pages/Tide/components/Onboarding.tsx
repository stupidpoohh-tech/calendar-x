import { useState } from 'react';
import { type Entry, type State, makeInitialState, newId } from '../lib/types';
import { MoneyInput } from './MoneyInput';
import { WipedNotice } from './WipedNotice';

type Props = {
  wasWiped: boolean;
  onStart: (state: State) => void;
  onRestoreLink: (payload: string) => void;
};

export function Onboarding({ wasWiped, onStart, onRestoreLink }: Props) {
  const [amount, setAmount] = useState(0);
  const [payday, setPayday] = useState(25);
  const [salary, setSalary] = useState(0);

  function start() {
    /**
     * 급여일은 별도 설정이 아니라 '급여'라는 예정 입금으로 저장된다.
     * 금액을 비워두면 0원 — 주기 계산에는 영향 없이 기준일 역할만 한다.
     */
    const entries: Entry[] = [
      {
        id: newId(),
        name: '급여',
        amount: salary,
        kind: 'income',
        schedule: { type: 'monthly', day: payday },
      },
    ];
    onStart(makeInitialState(amount, entries));
  }

  return (
    <div className="screen">
      {wasWiped && <WipedNotice onRestoreLink={onRestoreLink} />}

      <section className="card">
        <h2 className="card__title">두 가지만 알려주세요</h2>
        <p className="muted">
          지금 통장에 있는 돈과 급여일. 나머지 예정 지출·수입은 나중에 달력이나 설정에서 추가하면
          됩니다.
        </p>

        <label className="field">
          <span className="field__label">지금 통장 잔고</span>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </label>

        <label className="field field--inline">
          <span className="field__label">급여일 · 매달</span>
          <input
            type="number"
            min={1}
            max={31}
            inputMode="numeric"
            value={payday}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 31) setPayday(n);
            }}
          />
          <span className="field__suffix">일</span>
        </label>

        <label className="field">
          <span className="field__label">월급 (선택 — 나중에 설정에서 넣어도 됩니다)</span>
          <MoneyInput value={salary} onChange={setSalary} />
        </label>

        <button type="button" className="primary-btn" disabled={amount <= 0} onClick={start}>
          시작하기
        </button>
      </section>
    </div>
  );
}

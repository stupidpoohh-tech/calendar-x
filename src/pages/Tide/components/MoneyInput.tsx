import { useEffect, useState } from 'react';

export function parseWon(text: string): number {
  const negative = text.trim().startsWith('-') || text.trim().startsWith('−');
  const digits = text.replace(/[^0-9]/g, '');
  if (digits === '') return 0;
  const n = Number(digits);
  return negative ? -n : n;
}

function format(n: number): string {
  return n.toLocaleString('ko-KR');
}

type Props = {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
};

export function MoneyInput({
  id,
  value,
  onChange,
  allowNegative = false,
  autoFocus,
  placeholder,
  ...rest
}: Props) {
  const [text, setText] = useState(() => (value === 0 ? '' : format(value)));

  // 바깥에서 값이 바뀐 경우(복원 등)에만 입력창을 다시 맞춘다.
  useEffect(() => {
    if (parseWon(text) !== value) setText(value === 0 ? '' : format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="money-input">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder ?? '0'}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          const next = parseWon(raw);
          const clamped = !allowNegative && next < 0 ? -next : next;
          setText(clamped === 0 && raw.replace(/[^0-9-−]/g, '') === '' ? '' : format(clamped));
          onChange(clamped);
        }}
        {...rest}
      />
      <span className="money-input__unit" aria-hidden="true">
        원
      </span>
    </div>
  );
}

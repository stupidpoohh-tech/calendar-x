import { useState } from 'react';
import { readBackupFromHash } from '../lib/backup';

type Props = {
  onRestoreLink: (payload: string) => void;
};

/**
 * localStorage는 비었는데 백업 이력이 남아 있는 경우.
 * 브라우저가 저장소를 비웠거나 사용자가 기록을 지운 것이므로,
 * "처음 오셨군요"가 아니라 "지워졌습니다"라고 말해야 한다.
 */
export function WipedNotice({ onRestoreLink }: Props) {
  const [link, setLink] = useState('');

  return (
    <section className="card card--alert">
      <h2 className="card__title">이전 데이터가 지워졌습니다</h2>
      <p>
        이 기기에서 백업 링크를 만든 기록은 남아 있는데, 저장된 데이터가 없습니다. 브라우저가
        저장소를 비웠을 수 있습니다. <b>백업 링크가 있으면 열어주세요.</b>
      </p>
      <RestoreField
        value={link}
        onChange={setLink}
        onSubmit={() => {
          const payload = extractPayload(link);
          if (payload) {
            onRestoreLink(payload);
            setLink('');
          }
        }}
      />
    </section>
  );
}

export function RestoreField({
  value,
  onChange,
  onSubmit,
  label = '백업 링크 붙여넣기',
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  label?: string;
}) {
  return (
    <div className="restore-field">
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          type="text"
          value={value}
          placeholder="https://…#b=…"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <button type="button" className="primary-btn" disabled={!value.trim()} onClick={onSubmit}>
        복원
      </button>
    </div>
  );
}

/** 링크 전체를 붙여넣든 해시 조각만 붙여넣든 payload를 꺼낸다. */
export function extractPayload(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const hashAt = text.indexOf('#');
  if (hashAt !== -1) return readBackupFromHash(text.slice(hashAt));
  if (text.startsWith('b=')) return readBackupFromHash(`#${text}`);
  return text;
}

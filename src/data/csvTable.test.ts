import { describe, expect, it } from 'vitest';
import { CsvError, decodeText, parseCsv } from './csvTable';

describe('CSV', () => {
  it('따옴표 안의 쉼표 · 줄바꿈 · "" 와 CRLF', () => {
    const text = '일자,구분,금액,설명\r\n2026.03.25,지출,"12,000","회식, 2차"\r\n2026.03.26,지출,4800,"말한 ""그것""\n둘째 줄"\r\n';
    expect(parseCsv(text)).toEqual([
      ['일자', '구분', '금액', '설명'],
      ['2026.03.25', '지출', '12,000', '회식, 2차'],
      ['2026.03.26', '지출', '4800', '말한 "그것"\n둘째 줄'],
    ]);
  });

  it('마지막 줄바꿈이 없어도, 빈 칸이 끝에 있어도', () => {
    expect(parseCsv('a,b,\n1,,')).toEqual([['a', 'b', ''], ['1', '', '']]);
  });

  it('닫히지 않은 따옴표는 거절한다', () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow(CsvError);
  });

  it('UTF-8(BOM 포함)과 EUC-KR 을 가린다', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('일자')]);
    expect(decodeText(utf8)).toBe('일자');
    // '일자' 의 EUC-KR 바이트.
    expect(decodeText(new Uint8Array([0xc0, 0xcf, 0xc0, 0xda]))).toBe('일자');
  });
});

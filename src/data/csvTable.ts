/**
 * CSV 를 글자 표로 읽는다. 엑셀 내보내기와 같은 열 이름이면 같은 길로 들어간다.
 *
 * 인코딩은 UTF-8 을 먼저 시도하고, 깨지면 EUC-KR 로 읽는다 — 국내 가계부 앱과 엑셀의
 * "CSV 로 저장" 이 아직 EUC-KR 을 내는 경우가 많다. 어느 쪽도 아니면 추측하지 않는다.
 */

export class CsvError extends Error {}

export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      text = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
    } catch {
      throw new CsvError('글자 인코딩을 알 수 없습니다. UTF-8 또는 EUC-KR 로 저장해 주세요.');
    }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** RFC 4180. 따옴표 안의 쉼표 · 줄바꿈 · "" 를 받는다. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === ',') { endCell(); i++; continue; }
    if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch; i++;
  }
  if (quoted) throw new CsvError('따옴표가 닫히지 않은 칸이 있습니다.');
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * 엑셀(.xlsx) 첫 시트를 글자 표로 읽는다.
 *
 * 다른 가계부에서 내보낸 파일을 옮겨 오기 위한 것이라 **읽기만** 한다. 라이브러리를
 * 들이지 않는다 — xlsx 는 zip 안의 XML 몇 개이고, 필요한 것은 압축 풀기
 * (`DecompressionStream`)와 XML 해석(`DOMParser`) 둘뿐인데 둘 다 브라우저에 있다.
 *
 * 값은 셀에 적힌 그대로의 글자로 돌려준다. 숫자 셀은 저장된 숫자 문자열이고(서식이 붙은
 * "3,405,940" 이 아니라 "3405940"), 날짜 서식의 숫자 셀은 엑셀 일련번호다. 뜻을 붙이는
 * 일은 읽는 쪽(`domain/ledgerImport.ts`)이 한다.
 *
 * 못 읽는 모양(암호 · zip64 · 모르는 압축)은 추측하지 않고 이유와 함께 던진다.
 */

export class XlsxError extends Error {}

/** 가계부 한 파일로는 넉넉한 상한. 칸 주소가 엉뚱하게 크면 배열을 키우기 전에 멈춘다. */
const MAX_ROWS = 100_000;
const MAX_COLS = 200;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  localOffset: number;
}

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;

function centralDirectory(b: Uint8Array): ZipEntry[] {
  // 끝 레코드(EOCD)는 마지막 22바이트 + 주석(최대 64KB) 안에 있다.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('엑셀 파일이 아닙니다 (zip 구조를 찾지 못했습니다).');
  const count = u16(b, eocd + 10);
  let at = u32(b, eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new XlsxError('너무 큰 파일(zip64)은 읽지 못합니다.');

  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(b, at) !== 0x02014b50) throw new XlsxError('엑셀 파일의 목록이 깨져 있습니다.');
    const nameLen = u16(b, at + 28);
    const extraLen = u16(b, at + 30);
    const commentLen = u16(b, at + 32);
    out.push({
      flags: u16(b, at + 8),
      method: u16(b, at + 10),
      compressedSize: u32(b, at + 20),
      localOffset: u32(b, at + 42),
      name: new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen)),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  void writer.write(new Uint8Array(data)).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function readEntry(b: Uint8Array, e: ZipEntry): Promise<string> {
  if (e.flags & 1) throw new XlsxError('암호가 걸린 파일은 읽지 못합니다.');
  const at = e.localOffset;
  if (u32(b, at) !== 0x04034b50) throw new XlsxError('엑셀 파일 안의 항목이 깨져 있습니다.');
  const start = at + 30 + u16(b, at + 26) + u16(b, at + 28);
  const raw = b.subarray(start, start + e.compressedSize);
  let bytes: Uint8Array;
  if (e.method === 0) bytes = raw;
  else if (e.method === 8) bytes = await inflateRaw(raw);
  else throw new XlsxError(`모르는 압축 방식(${e.method})이라 읽지 못합니다.`);
  return new TextDecoder().decode(bytes);
}

function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new XlsxError(`엑셀 파일의 ${what} 을(를) 읽지 못했습니다.`);
  }
  return doc;
}

/** 네임스페이스 접두어와 무관하게 이름으로 찾는다. */
const byName = (root: Element | Document, local: string) => Array.from(root.getElementsByTagNameNS('*', local));
const childrenNamed = (el: Element, local: string) => Array.from(el.children).filter((c) => c.localName === local);

/** 공유 문자열. 서식이 섞인 글(r/t)은 이어 붙이고, 발음 표기(rPh)는 뺀다. */
function sharedStrings(doc: Document): string[] {
  return byName(doc, 'si').map((si) => {
    const direct = childrenNamed(si, 't');
    if (direct.length > 0) return direct.map((t) => t.textContent ?? '').join('');
    return childrenNamed(si, 'r').flatMap((r) => childrenNamed(r, 't')).map((t) => t.textContent ?? '').join('');
  });
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 첫 시트의 경로. 통합 문서가 가리키는 순서를 따르고, 못 찾으면 sheet1. */
async function firstSheetPath(b: Uint8Array, files: Map<string, ZipEntry>): Promise<string> {
  const wbEntry = files.get('xl/workbook.xml');
  const relEntry = files.get('xl/_rels/workbook.xml.rels');
  if (wbEntry && relEntry) {
    const wb = parseXml(await readEntry(b, wbEntry), '통합 문서');
    const first = byName(wb, 'sheet')[0];
    const rid = first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      ?? first?.getAttribute('r:id');
    if (rid) {
      const rels = parseXml(await readEntry(b, relEntry), '연결 정보');
      const target = byName(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
      if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    }
  }
  return 'xl/worksheets/sheet1.xml';
}

/** 첫 시트를 행 × 열 글자 표로. 빈 칸은 ''. */
export async function readXlsxTable(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const files = new Map(centralDirectory(b).map((e) => [e.name, e] as const));
  const sheetPath = await firstSheetPath(b, files);
  const sheetEntry = files.get(sheetPath);
  if (!sheetEntry) throw new XlsxError('엑셀 파일에 시트가 없습니다.');
  const ssEntry = files.get('xl/sharedStrings.xml');
  const strings = ssEntry ? sharedStrings(parseXml(await readEntry(b, ssEntry), '공유 문자열')) : [];
  const sheet = parseXml(await readEntry(b, sheetEntry), '시트');

  const rows: string[][] = [];
  for (const row of byName(sheet, 'row')) {
    const at = Number(row.getAttribute('r')) - 1;
    const cells: string[] = [];
    for (const c of childrenNamed(row, 'c')) {
      const col = columnIndex(c.getAttribute('r') ?? '');
      if (col < 0) continue;
      if (col >= MAX_COLS) throw new XlsxError(`열이 너무 많습니다 (${MAX_COLS}열까지 읽습니다).`);
      const t = c.getAttribute('t');
      const v = childrenNamed(c, 'v')[0]?.textContent ?? '';
      let value: string;
      if (t === 's') {
        const s = strings[Number(v)];
        if (s === undefined) throw new XlsxError(`시트의 ${c.getAttribute('r')} 칸이 없는 문자열을 가리킵니다.`);
        value = s;
      } else if (t === 'inlineStr') {
        value = childrenNamed(c, 'is').flatMap((is) => byName(is, 't')).map((x) => x.textContent ?? '').join('');
      } else {
        value = v;
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    const index = Number.isInteger(at) && at >= 0 ? at : rows.length;
    if (index >= MAX_ROWS) throw new XlsxError(`행이 너무 많습니다 (${MAX_ROWS.toLocaleString('ko-KR')}행까지 읽습니다).`);
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  return rows;
}

/**
 * 테스트용 엑셀 파일 만들기. 실제 이관 파일은 개인 자료라 저장소에 두지 않고, 같은
 * 모양(공유 문자열 · 글자 셀 · 첫 시트)을 여기서 만든다.
 */
import { deflateRawSync } from 'node:zlib';

const enc = new TextEncoder();

function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export interface ZipFile { name: string; text: string; store?: boolean }

export function zip(files: readonly ZipFile[], opts: { encrypted?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const data = f.store ? raw : new Uint8Array(deflateRawSync(raw));
    const method = f.store ? 0 : 8;
    const crc = crc32(raw);
    const flags = opts.encrypted ? 1 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, flags, true);
    cd.setUint16(10, method, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((t, p) => t + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = (i: number) => String.fromCharCode(65 + i);

/** 받은 이관 파일과 같은 모양 — 모든 칸이 공유 문자열이다. */
export function xlsxOf(rows: readonly (readonly string[])[], opts: { store?: boolean } = {}): Uint8Array {
  const strings: string[] = [];
  const idx = (s: string) => {
    const at = strings.indexOf(s);
    if (at >= 0) return at;
    strings.push(s);
    return strings.length - 1;
  };
  const sheetRows = rows.map((r, ri) =>
    `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="s"><v>${idx(v)}</v></c>`).join('')}</row>`,
  ).join('');
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zip([
    { name: 'xl/workbook.xml', text: `<?xml version="1.0"?><workbook ${ns} ${rns}><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`, store: opts.store },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>', store: opts.store },
    { name: 'xl/worksheets/sheet1.xml', text: `<?xml version="1.0"?><worksheet ${ns}><sheetData>${sheetRows}</sheetData></worksheet>`, store: opts.store },
    { name: 'xl/sharedStrings.xml', text: `<?xml version="1.0"?><sst ${ns}>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`, store: opts.store },
  ]);
}

export const HEADER = ['일자', '구분', '금액', '수단', '설명', '카테고리', '메모'] as const;

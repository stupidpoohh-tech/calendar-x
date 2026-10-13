/**
 * 엑셀 읽기 — 받은 이관 파일의 모양(공유 문자열 셀)과 그 밖에 흔한 셀 모양.
 */
import { describe, expect, it } from 'vitest';
import { HEADER, xlsxOf, zip } from '../test/xlsxFixture';
import { readXlsxTable, XlsxError } from './xlsx';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

describe('엑셀 읽기', () => {
  const rows = [
    [...HEADER],
    ['2026.03.25', '수입', '3,405,940', '-', '회사', '월급', ''],
    ['2026.03.25', '지출', '9,871', '-', '초밥 & 국', '배달', ''],
  ];

  it('공유 문자열 셀을 글자 그대로 읽는다 — 압축된 것도, 압축하지 않은 것도', async () => {
    expect(await readXlsxTable(xlsxOf(rows))).toEqual(rows);
    expect(await readXlsxTable(xlsxOf(rows, { store: true }))).toEqual(rows);
  });

  it('숫자 · 바로 적은 글자 · 빈 칸 · 서식 섞인 글자(발음 표기는 뺀다)', async () => {
    const file = zip([
      { name: 'xl/sharedStrings.xml', text: `<sst ${NS}><si><r><t>점</t></r><r><t>심</t></r><rPh><t>ジョム</t></rPh></si></sst>` },
      {
        name: 'xl/worksheets/sheet1.xml',
        text: `<worksheet ${NS}><sheetData>`
          + '<row r="1"><c r="A1"><v>46106</v></c><c r="C1" t="inlineStr"><is><t>바로</t></is></c><c r="D1" t="s"><v>0</v></c></row>'
          + '<row r="3"><c r="B3" t="str"><v>식</v></c></row>'
          + '</sheetData></worksheet>',
      },
    ]);
    expect(await readXlsxTable(file)).toEqual([['46106', '', '바로', '점심'], [], ['', '식']]);
  });

  it('첫 시트는 통합 문서가 가리키는 것이다 — 파일 이름 순서가 아니다', async () => {
    const rns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const file = zip([
      { name: 'xl/workbook.xml', text: `<workbook ${NS} ${rns}><sheets><sheet name="내역" sheetId="2" r:id="rId9"/><sheet name="요약" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Target="/xl/worksheets/sheet2.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', text: `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>요약</t></is></c></row></sheetData></worksheet>` },
      { name: 'xl/worksheets/sheet2.xml', text: `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>내역</t></is></c></row></sheetData></worksheet>` },
    ]);
    expect(await readXlsxTable(file)).toEqual([['내역']]);
  });

  it('못 읽는 것은 이유와 함께 던진다', async () => {
    await expect(readXlsxTable(new TextEncoder().encode('일자,구분,금액'))).rejects.toThrow(XlsxError);
    await expect(readXlsxTable(xlsxOf(rows, { store: true }).slice(0, 0))).rejects.toThrow(/zip/);
    const locked = zip([{ name: 'xl/worksheets/sheet1.xml', text: `<worksheet ${NS}/>` }], { encrypted: true });
    await expect(readXlsxTable(locked)).rejects.toThrow(/암호/);
    const huge = zip([{ name: 'xl/worksheets/sheet1.xml', text: `<worksheet ${NS}><sheetData><row r="900000"><c r="A900000"><v>1</v></c></row></sheetData></worksheet>` }]);
    await expect(readXlsxTable(huge)).rejects.toThrow(/행이 너무 많습니다/);
  });
});

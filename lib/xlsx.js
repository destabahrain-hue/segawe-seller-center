import { zip } from './zip.js';

/**
 * Penulis .xlsx tanpa dependensi apa pun.
 *
 * Alasannya bukan gaya-gayaan: pustaka Excel di npm sering ditandai
 * bercelah keamanan, dan Railway MENOLAK build kalau ada dependensi
 * bercelah — persis jebakan yang dulu bikin deploy gagal berkali-kali.
 * File yang dihasilkan memakai inline string, jadi tidak perlu
 * sharedStrings dan tetap dibuka normal oleh Excel maupun Google Sheets.
 */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;').replace(/\u0000-\u0008|\u000B|\u000C|\u000E-\u001F/g, '');

const kolomHuruf = (i) => {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

function sel(nilai, baris, kolom) {
  const ref = `${kolomHuruf(kolom)}${baris}`;
  if (nilai === null || nilai === undefined || nilai === '') return `<c r="${ref}"/>`;
  if (typeof nilai === 'number' && Number.isFinite(nilai)) return `<c r="${ref}"><v>${nilai}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(nilai)}</t></is></c>`;
}

function sheetXml(header, rows) {
  const lebar = header.map((h, i) => {
    let m = String(h).length;
    for (const r of rows.slice(0, 200)) m = Math.max(m, String(r[i] ?? '').length);
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(m + 2, 9), 46)}" customWidth="1"/>`;
  }).join('');

  const barisXml = [
    `<row r="1" s="1">${header.map((h, i) => sel(h, 1, i)).join('')}</row>`,
    ...rows.map((r, ri) => `<row r="${ri + 2}">${header.map((_, ci) => sel(r[ci], ri + 2, ci)).join('')}</row>`),
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${lebar}</cols>
<sheetData>${barisXml}</sheetData>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7EAF2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

/** Bangun berkas .xlsx satu lembar. Kembaliannya Buffer. */
export function buatXlsx({ nama = 'Sheet1', header = [], rows = [] }) {
  return zip([
    { nama: '[Content_Types].xml', isi:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { nama: '_rels/.rels', isi:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { nama: 'xl/workbook.xml', isi:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(nama).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>` },
    { nama: 'xl/_rels/workbook.xml.rels', isi:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { nama: 'xl/styles.xml', isi: STYLES },
    { nama: 'xl/worksheets/sheet1.xml', isi: sheetXml(header, rows) },
  ]);
}

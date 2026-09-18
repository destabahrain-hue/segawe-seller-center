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

/**
 * Nilai sel boleh berupa angka, teks, atau objek { v, s }.
 *
 * `s` adalah nomor gaya di cellXfs:
 *   0 biasa   1 judul kolom (tebal + arsir)   2 tebal
 *   3 angka #,##0   4 persen 0,0%   5 angka tebal   6 judul besar
 *
 * Bentuk objek ditambahkan untuk laporan keuangan, yang menaruh nilai
 * di sel tertentu dengan tebal dan format berbeda-beda — bukan tabel
 * seragam seperti ekspor pesanan.
 */
function sel(nilai, baris, kolom) {
  const ref = `${kolomHuruf(kolom)}${baris}`;
  let v = nilai, gaya = 0;
  if (v && typeof v === 'object' && !Array.isArray(v)) { gaya = v.s || 0; v = v.v; }
  const sAttr = gaya ? ` s="${gaya}"` : '';

  if (v === null || v === undefined || v === '') return `<c r="${ref}"${sAttr}/>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

/**
 * Pembungkus supaya penyusun laporan tidak perlu menghafal nomor gaya.
 *
 * `rp` dipakai untuk semua nilai uang: formatnya akuntansi Rupiah,
 * sama seperti template. Kelompok margin/iklan/gross masing-masing
 * punya warna latarnya sendiri mengikuti berkas Excel yang sudah ada.
 */
export const G = {
  tebal:      (v) => ({ v, s: 2 }),
  angka:      (v) => ({ v, s: 3 }),
  persen:     (v) => ({ v, s: 4 }),
  angkaTebal: (v) => ({ v, s: 5 }),
  judulBesar: (v) => ({ v, s: 6 }),
  judul:      (v) => ({ v, s: 7 }),

  kepala:     (v) => ({ v, s: 8 }),     // tebal + garis
  kotak:      (v) => ({ v, s: 9 }),     // biasa + garis
  rp:         (v) => ({ v, s: 10 }),    // rupiah + garis

  margin:     (v) => ({ v, s: 11 }),
  marginRp:   (v) => ({ v, s: 12 }),
  marginPct:  (v) => ({ v, s: 13 }),

  iklan:      (v) => ({ v, s: 14 }),
  iklanRp:    (v) => ({ v, s: 15 }),
  iklanPct:   (v) => ({ v, s: 16 }),

  gross:      (v) => ({ v, s: 17 }),
  grossRp:    (v) => ({ v, s: 18 }),
  grossPct:   (v) => ({ v, s: 19 }),

  catatan:    (v) => ({ v, s: 20 }),    // abu-abu kecil
  ungu:       (v) => ({ v, s: 21 }),    // kepala ALL STORE
  garisBawah: (v) => ({ v, s: 22 }),
};

/** Ambil nilai mentah dari sel yang mungkin berbentuk objek { v, s }. */
const isiSel = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x.v : x);

/**
 * `header` boleh kosong. Kalau kosong, tidak ada baris judul dan tidak
 * ada pane beku — barisnya ditulis apa adanya mulai baris 1.
 *
 * Itu yang dibutuhkan lembar SUMMARRY dan REKAPITULASI, yang menaruh
 * nilai di sel tertentu dan tidak punya baris judul sama sekali.
 */
function sheetXml(header, rows, lebarKolom, gabung) {
  const adaHeader = header && header.length > 0;
  const jumlahKolom = Math.max(
    adaHeader ? header.length : 0,
    ...rows.map((r) => (r ? r.length : 0)), 1);

  const lebar = Array.from({ length: jumlahKolom }, (_, i) => {
    if (lebarKolom && lebarKolom[i]) {
      return `<col min="${i + 1}" max="${i + 1}" width="${lebarKolom[i]}" customWidth="1"/>`;
    }
    let m = adaHeader ? String(header[i] ?? '').length : 8;
    for (const r of rows.slice(0, 300)) m = Math.max(m, String(isiSel(r?.[i]) ?? '').length);
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(m + 2, 9), 46)}" customWidth="1"/>`;
  }).join('');

  const geser = adaHeader ? 2 : 1;
  const barisXml = [
    ...(adaHeader
      ? [`<row r="1" s="1">${header.map((h, i) => sel({ v: h, s: 1 }, 1, i)).join('')}</row>`]
      : []),
    ...rows.map((r, ri) => {
      const n = ri + geser;
      const isi = Array.from({ length: jumlahKolom },
        (_, ci) => sel(r?.[ci], n, ci)).join('');
      return `<row r="${n}">${isi}</row>`;
    }),
  ].join('');

  /**
   * Sel tergabung. Excel menuntut daftarnya ditulis SESUDAH sheetData;
   * kalau ditaruh sebelum, berkasnya dianggap rusak dan Excel menolak
   * membukanya tanpa pesan yang jelas.
   */
  const gabungXml = gabung && gabung.length
    ? `<mergeCells count="${gabung.length}">${gabung.map((g) => `<mergeCell ref="${g}"/>`).join('')}</mergeCells>`
    : '';

  const pane = adaHeader
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
<cols>${lebar}</cols>
<sheetData>${barisXml}</sheetData>
${gabungXml}
</worksheet>`;
}

/**
 * Tabel gaya.
 *
 * Warna dan garisnya diambil dari berkas Excel yang sudah dipakai
 * Prima, bukan dipilih sendiri: hijau muda E2EFD9 untuk baris Margin,
 * oranye F7CAAC untuk Total Iklan, hijau A8D08D untuk Gross Profit,
 * ungu 7030A0 untuk kepala blok ALL STORE.
 *
 * numFmt 166 adalah format akuntansi Rupiah yang sama persis dengan
 * template — termasuk perataan simbol Rp di tepi kiri sel.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="#,##0"/>
<numFmt numFmtId="165" formatCode="0.0%"/>
<numFmt numFmtId="166" formatCode="_-[$Rp-3809]* #,##0_-;\\-[$Rp-3809]* #,##0_-;_-[$Rp-3809]* &quot;-&quot;_-;_-@_-"/>
<numFmt numFmtId="167" formatCode="0%"/>
</numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><b/><sz val="25"/><name val="Calibri"/></font>
<font><b/><sz val="13"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF808080"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7EAF2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFD9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7CAAC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFA8D08D"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF7030A0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="23">
<xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0"   fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0"   fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0"   fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0"   fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0"   fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0"   fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0"   fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0"   fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0"   fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="1" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0"   fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0"   fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0"   fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
</styleSheet>`;

/** Bangun berkas .xlsx satu lembar. Kembaliannya Buffer. */
export function buatXlsx({ nama = 'Sheet1', header = [], rows = [] }) {
  return buatXlsxBanyak([{ nama, header, rows }]);
}

/**
 * Bangun .xlsx BEBERAPA lembar sekaligus.
 *
 * Dibuat untuk laporan keuangan, yang bentuknya dua lembar seperti
 * berkas Excel yang sudah dipakai: SUMMARRY dan REKAPITULASI.
 *
 * buatXlsx() yang lama dibiarkan dan sekarang memanggil fungsi ini,
 * supaya seluruh ekspor yang sudah ada — pesanan, SKU, retur — tidak
 * ikut berubah perilakunya.
 *
 * Tetap tanpa dependensi. Pustaka Excel di npm sering ditandai bercelah
 * dan Railway menolak build-nya; itu sudah pernah menghabiskan waktu
 * berkali-kali dan tidak perlu diulang demi dua lembar.
 */
export function buatXlsxBanyak(lembar) {
  const daftar = (lembar || []).filter(Boolean);
  if (!daftar.length) throw new Error('Tidak ada lembar untuk ditulis');

  const nomor = daftar.map((_, i) => i + 1);

  return zip([
    { nama: '[Content_Types].xml', isi:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${nomor.map((n) => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
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
<sheets>${daftar.map((L, i) => `<sheet name="${esc(L.nama || `Sheet${i + 1}`).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>` },
    { nama: 'xl/_rels/workbook.xml.rels', isi:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${nomor.map((n) => `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`).join('')}
<Relationship Id="rId${daftar.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { nama: 'xl/styles.xml', isi: STYLES },
    ...daftar.map((L, i) => ({
      nama: `xl/worksheets/sheet${i + 1}.xml`,
      isi: sheetXml(L.header || [], L.rows || [], L.lebar, L.gabung),
    })),
  ]);
}

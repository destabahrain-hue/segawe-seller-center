import { ensureSchema } from '@/lib/db';
import { peranSekarang, bolehRute, bolehUang } from '@/lib/auth';
import { laporanBulanan, KOLOM_MASUK, KOLOM_KELUAR } from '@/lib/laporan-stok';
import { buatXlsxBanyak } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';

/** Ekspor Excel laporan stok bulanan — tiga lembar, bentuknya seperti sheet lama. */
export async function GET(req) {
  const peran = await peranSekarang();
  if (!bolehRute(peran, '/gudang')) return new Response('Tidak punya akses ke Gudang', { status: 403 });
  await ensureSchema();
  const bulan = new URL(req.url).searchParams.get('bulan') || '';
  const uang = bolehUang(peran);
  let L;
  try { L = await laporanBulanan(bulan, { denganNilai: uang }); }
  catch (e) { return new Response(e.message, { status: 400 }); }

  const A = (v) => ({ v, s: 3 });
  const hari = Array.from({ length: L.hari }, (_, i) => String(i + 1));
  const ringkas = {
    nama: 'Ringkasan',
    header: ['Master SKU', 'Supplier', 'Sisa bulan lalu',
             ...KOLOM_MASUK.map(([, t]) => `Masuk ${t}`), 'Total masuk',
             ...KOLOM_KELUAR.map(([, t]) => `Keluar ${t}`), 'Total keluar',
             'Koreksi', 'Sisa akhir', ...(uang ? ['HPP', 'Nilai persediaan'] : [])],
    rows: [
      ...L.baris.map((b) => [b.code, b.supplier || '', A(b.awal),
        ...KOLOM_MASUK.map(([k]) => A(b.masukPer[k])), A(b.masuk),
        ...KOLOM_KELUAR.map(([k]) => A(b.keluarPer[k])), A(b.keluar),
        A(b.koreksi), { v: b.akhir, s: 5 }, ...(uang ? [A(b.hpp), A(b.nilai)] : [])]),
      [{ v: 'TOTAL', s: 2 }, '', { v: L.total.awal, s: 5 },
        ...KOLOM_MASUK.map(([k]) => ({ v: L.baris.reduce((a, b) => a + b.masukPer[k], 0), s: 5 })), { v: L.total.masuk, s: 5 },
        ...KOLOM_KELUAR.map(([k]) => ({ v: L.baris.reduce((a, b) => a + b.keluarPer[k], 0), s: 5 })), { v: L.total.keluar, s: 5 },
        { v: L.total.koreksi, s: 5 }, { v: L.total.akhir, s: 5 }, ...(uang ? ['', { v: L.total.nilai, s: 5 }] : [])],
    ],
  };
  const kisi = (nama, kunci, total) => ({
    nama,
    header: ['Master SKU', 'Sisa bulan lalu', ...hari, total],
    rows: L.baris.map((b) => [b.code, A(b.awal), ...b[kunci].map((x) => (x ? A(x) : '')),
                              { v: b[kunci].reduce((a, x) => a + x, 0), s: 5 }]),
  });
  const buf = buatXlsxBanyak([ringkas, kisi('Masuk per tanggal', 'masukHarian', 'Total masuk'),
                              kisi('Keluar per tanggal', 'keluarHarian', 'Total keluar')]);
  return new Response(buf, { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="laporan-stok-${bulan}.xlsx"`,
  } });
}

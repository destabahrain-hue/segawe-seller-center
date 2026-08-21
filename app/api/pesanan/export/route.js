import { NextResponse } from 'next/server';
import { ensureSchema, log, q } from '@/lib/db';
import { barisEkspor, barisEksporPilihan, cariStatus, kunciStatus, cariBasis, waktuDari } from '@/lib/orders';
import { TEMPLATE_BAWAAN, kunciSah } from '@/lib/kolom-ekspor';
import { buatXlsx } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  await ensureSchema();
  const u = new URL(req.url);
  // Sama seperti layar: status boleh lebih dari satu, dipisah koma.
  const kunci = kunciStatus(u.searchParams.get('status') || 'baru');
  const status = kunci.length > 1 ? kunci : kunci[0];
  const waktu = waktuDari({
    w: u.searchParams.get('w'),
    r: u.searchParams.get('r'),
    dari: u.searchParams.get('dari'),
    sampai: u.searchParams.get('sampai'),
  });
  const opsi = {
    status,
    shopId: u.searchParams.get('toko') || null,
    kadaluarsa: u.searchParams.get('kadaluarsa') || null,
    kurir: u.searchParams.get('kurir') || null,
    cari: u.searchParams.get('cari') || null,
    cetak: u.searchParams.get('cetak') || null,
    urut: u.searchParams.get('urut') || null,
    arah: u.searchParams.get('arah') || null,
    waktu,
  };

  /**
   * Template menentukan susunan kolom.
   *
   * Tanpa parameter `tpl`, yang dipakai susunan lama — supaya tautan ekspor
   * yang sudah tersimpan di mana pun tetap menghasilkan berkas yang sama
   * seperti sebelumnya.
   */
  const tpl = u.searchParams.get('tpl');
  let header, rows, jumlah, namaTpl = null;

  if (tpl) {
    let kunci = null;
    const bawaan = TEMPLATE_BAWAAN.find((t) => t.kode === tpl);
    if (bawaan) { kunci = bawaan.kunci; namaTpl = bawaan.nama; }
    else {
      const r = await q('SELECT nama, kunci FROM export_template WHERE id = $1', [Number(tpl)]);
      if (r.length) { kunci = kunciSah(r[0].kunci); namaTpl = r[0].nama; }
    }
    if (!kunci?.length) {
      return NextResponse.json({ ok: false, error: 'Template tidak ditemukan' }, { status: 404 });
    }
    ({ header, rows, jumlah } = await barisEksporPilihan(opsi, kunci));
  } else {
    ({ header, rows, jumlah } = await barisEkspor(opsi));
  }
  const label = kunci.map((k) => cariStatus(k).label).join(' + ');
  const cap = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
    .replace(/[-: ]/g, '').slice(0, 14);
  // Rentangnya ikut ditulis di nama berkas. Tanpa itu, tiga ekspor bulan
  // berbeda mendarat di folder Unduhan dengan nama yang mirip semua dan
  // tidak ada cara membedakannya selain dibuka satu per satu.
  const potong = waktu
    ? '-' + cariBasis(waktu.basis)[0] + '-'
      + [waktu.dari, new Date(waktu.sampai.getTime() - 1)]
          .map((d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d))
          .join('_sd_')
    : '';
  const capTpl = namaTpl ? '-' + namaTpl.replace(/[^A-Za-z0-9]+/g, '-') : '';
  const nama = `Pesanan-${label.replace(/\s+/g, '-')}${capTpl}${potong}-${cap}.xlsx`;

  const buf = buatXlsx({ nama: label.slice(0, 31), header, rows });
  await log('ekspor', `Ekspor ${jumlah} baris dari halaman "${label}"`
    + (waktu ? ` — ${cariBasis(waktu.basis)[1].toLowerCase()} ${waktu.label}` : ''));

  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nama}"`,
      'Cache-Control': 'no-store',
    },
  });
}

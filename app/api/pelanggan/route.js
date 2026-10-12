import { ensureSchema } from '@/lib/db';
import { peranSekarang, bolehRute } from '@/lib/auth';
import { daftarPelanggan } from '@/lib/pelanggan';
import { rentang } from '@/lib/rentang';
import { buatXlsx } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Unduh Data Pelanggan sesuai saringan yang sedang dipakai. */
export async function GET(req) {
  const peran = await peranSekarang();
  if (!bolehRute(peran, '/pelanggan')) return new Response('Tidak punya akses', { status: 403 });
  await ensureSchema();

  const s = new URL(req.url).searchParams;
  const r = rentang(s.get('r') || '30h', s.get('dari') || null, s.get('sampai') || null);
  const d = await daftarPelanggan({
    dari: r.dari, sampai: r.sampai, shopId: s.get('toko') || null,
    cari: s.get('q') || '', tab: s.get('tab') || 'semua',
    urut: 'belanja', arah: 'desc', limit: 10000, offset: 0,
  });

  const A = (v) => ({ v, s: 3 });
  const buf = buatXlsx({
    nama: 'Pelanggan',
    header: ['Pelanggan', 'Sidik', 'Toko', 'Pesanan', 'Batal', 'Rasio batal',
             'Total belanja', 'Rata-rata', 'Pertama', 'Terakhir'],
    rows: d.baris.map((b) => [
      b.username || '', b.pembeli_id, b.toko,
      A(b.pesanan), A(b.batal), A(b.pesanan ? (b.batal / b.pesanan) : 0),
      A(b.belanja), A(b.rata),
      b.pertama ? new Date(b.pertama).toISOString().slice(0, 10) : '',
      b.terakhir ? new Date(b.terakhir).toISOString().slice(0, 10) : '',
    ]),
  });
  return new Response(buf, { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="data-pelanggan-${r.label.replace(/\s+/g, '-').toLowerCase()}.xlsx"`,
  } });
}

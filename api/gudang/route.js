import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sesi, peranSekarang, bolehRute, bolehUang, bolehKoreksiStok } from '@/lib/auth';
import { catatMutasi, batalkanBatch, perluMaster, JENIS } from '@/lib/gudang';

export const dynamic = 'force-dynamic';

/**
 * Middleware hanya memeriksa sesi sah, tidak memeriksa peran — jadi izin
 * halaman Gudang diperiksa di sini. Harga beli (yang sekaligus jadi HPP)
 * hanya diterima dari peran yang boleh melihat angka rupiah.
 */
async function izin() {
  const peran = await peranSekarang();
  if (!bolehRute(peran, '/gudang')) return { tolak: NextResponse.json(
    { ok: false, error: 'Tidak punya akses ke Gudang' }, { status: 403 }) };
  const s = sesi();
  return { peran, oleh: s?.nama || 'tidak diketahui', master: await bolehKoreksiStok() };
}

const hanyaMaster = () => NextResponse.json(
  { ok: false, error: 'Akunmu tidak diizinkan mengoreksi atau membatalkan catatan stok' }, { status: 403 });

export async function POST(req) {
  const { tolak, peran, oleh, master } = await izin();
  if (tolak) return tolak;
  try {
    await ensureSchema();
    const b = await req.json();

    // Bentuk lama (satu SKU) tetap diterima supaya tidak ada yang rusak.
    const jenisLama = { in: 'supplier', out: 'lain_keluar', adjust: 'opname' };
    const jenis = b.jenis || jenisLama[b.direction] || 'supplier';
    const baris = Array.isArray(b.baris) ? b.baris
      : [{ master_sku_id: b.master_sku_id, qty: b.qty, harga: b.unit_cost }];

    if (!JENIS[jenis]) throw new Error('Jenis mutasi tidak dikenal');
    if (perluMaster(jenis) && !master) return hanyaMaster();

    const r = await catatMutasi({
      jenis, tanggal: b.tanggal || b.moved_at || null,
      supplier: b.supplier || (jenis === 'supplier' && !b.baris ? '(tanpa nama)' : null),
      catatan: b.catatan || b.note || null,
      baris, oleh, bolehHarga: bolehUang(peran),
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  const { tolak, oleh, master } = await izin();
  if (tolak) return tolak;
  if (!master) return hanyaMaster();
  try {
    const { batch_id } = await req.json();
    if (!batch_id) return NextResponse.json({ ok: false, error: 'batch_id wajib' }, { status: 400 });
    const n = await batalkanBatch(batch_id, oleh);
    return NextResponse.json({ ok: true, dihapus: n });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

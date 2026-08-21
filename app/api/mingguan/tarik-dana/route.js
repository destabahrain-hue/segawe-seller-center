import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { tarikEscrow, sapuCairToko } from '@/lib/sync';
import { tokoAktif } from '@/lib/tokens';
import { belumCair } from '@/lib/mingguan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Tarik ulang rincian dana untuk pesanan yang tanggal pencairannya kosong.
 * Sekali tekan mengerjakan satu putaran per toko; sisanya dilanjutkan
 * penjadwal atau dengan menekan lagi.
 */
export async function POST() {
  try {
    await ensureSchema();
    const sebelum = await belumCair();
    const toko = await tokoAktif();

    let diperbarui = 0, tanggalCair = 0;
    const gagal = [];
    for (const t of toko) {
      // Tanggal cair lebih dulu: itu yang menentukan pesanan masuk minggu
      // mana. Rincian komisi menyusul dan tidak menghalangi laporan tampil.
      try {
        const c = await sapuCairToko(t.shop_id, { potongan: 6, hariPerPotong: 7 });
        tanggalCair += c.terisi;
      } catch (e) {
        gagal.push(`${t.shop_name || t.shop_id} (tanggal cair): ${e.message}`);
      }
      try {
        diperbarui += await tarikEscrow(t.shop_id, { batas: 120 });
      } catch (e) {
        gagal.push(`${t.shop_name || t.shop_id}: ${e.message}`);
      }
    }

    const sesudah = await belumCair();
    return NextResponse.json({
      ok: true,
      diperbarui,
      tanggalCair,
      sebelum: Number(sebelum?.jumlah || 0),
      sisa: Number(sesudah?.jumlah || 0),
      gagal: gagal.slice(0, 3),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

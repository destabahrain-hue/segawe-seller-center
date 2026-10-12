import { NextResponse } from 'next/server';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { bacaBonus, ganti } from '@/lib/bonus-iklan';

export const dynamic = 'force-dynamic';

/**
 * Unggah ekspor Riwayat Transaksi Shopee Ads.
 *
 * Berkasnya menyebutkan ID Toko dan rentang tanggal sendiri, jadi tidak
 * ada yang perlu dipilih di layar — toko dan periodenya diambil dari
 * isi berkas. Itu juga menutup satu jalan salah: mengunggah berkas toko
 * A sambil layar menampilkan toko B tidak mungkin salah mendarat.
 *
 * Bisa menerima beberapa berkas sekaligus (bonus saldo dan proteksi
 * ROAS diekspor terpisah), dan tiap berkas diproses sendiri-sendiri
 * supaya satu berkas rusak tidak menggagalkan yang lain.
 */
export async function POST(req) {
  if (!bolehUang(await peranSekarang())) {
    return NextResponse.json(
      { ok: false, error: 'Tidak punya akses ke data keuangan' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const berkas = form.getAll('file').filter((f) => f && f.arrayBuffer);
    if (!berkas.length) {
      return NextResponse.json({ ok: false, error: 'Berkas belum dipilih' }, { status: 400 });
    }

    const hasil = [];
    for (const f of berkas) {
      const nama = f.name || 'berkas';
      try {
        const teks = new TextDecoder('utf-8').decode(await f.arrayBuffer());
        const baca = bacaBonus(teks);
        const n = await ganti(baca);
        hasil.push({
          nama, ok: true,
          shopId: baca.shopId,
          periode: baca.periode,
          baris: n,
          total: baca.total,
          perJenis: baca.perJenis,
        });
      } catch (e) {
        hasil.push({ nama, ok: false, error: e.message });
      }
    }

    return NextResponse.json({
      ok: true,
      hasil,
      total: hasil.filter((h) => h.ok).reduce((a, h) => a + h.total, 0),
      gagal: hasil.filter((h) => !h.ok).length,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

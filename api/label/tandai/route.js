import { NextResponse } from 'next/server';
import { ensureSchema, q, log } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Tandai label benar-benar sudah tercetak.
 *
 * Dipisah dari pembuatan PDF dengan sengaja. "PDF berhasil dibuat" bukan
 * "kertasnya keluar" — printer bisa macet, kertas habis, atau orangnya
 * membatalkan di dialog cetak. Kalau angkanya naik di saat PDF jadi,
 * penjaga resi kembar ikut berbohong: pesanan ditandai sudah dicetak
 * padahal labelnya tidak pernah ada di meja.
 */
export async function POST(req) {
  try {
    await ensureSchema();
    const { order_sn } = await req.json();
    const sns = (Array.isArray(order_sn) ? order_sn : String(order_sn || '').split(','))
      .map((x) => String(x).trim()).filter(Boolean);
    if (!sns.length) {
      return NextResponse.json({ ok: false, error: 'Tidak ada pesanan' }, { status: 400 });
    }

    /**
     * printed_at ikut diisi di sini.
     *
     * Bug yang lama luput: saat print_count dipindah ke endpoint ini,
     * printed_at tidak ikut. Akibatnya kolom itu hanya terisi lewat Scan &
     * Kirim atau tandai manual — jadi penyaring "Waktu resi dicetak" buta
     * terhadap resi yang benar-benar dicetak dari aplikasi ini.
     *
     * Paling terasa pada pesanan instan/sameday: resinya dicetak sebelum
     * Pack dan tidak pernah discan, jadi printed_at-nya TIDAK PERNAH
     * terisi sama sekali dan pesanan itu hilang dari penyaring.
     *
     * COALESCE dipakai supaya cetak ulang tidak menggeser tanggalnya —
     * yang dicari orang adalah kapan resi PERTAMA kali keluar.
     */
    const r = await q(
      `UPDATE orders SET print_count = COALESCE(print_count,0) + 1,
              printed_at = COALESCE(printed_at, now())
        WHERE order_sn = ANY($1::text[])
        RETURNING order_sn`, [sns]);

    // Pesanan TikTok memakai kolom kembarannya sendiri di tiktok_orders.
    const tt = await q(
      `UPDATE tiktok_orders SET cetak_count = COALESCE(cetak_count,0) + 1,
              dicetak_at = COALESCE(dicetak_at, now())
        WHERE order_id = ANY($1::text[])
        RETURNING order_id`, [sns]);

    await log('label', `${r.length + tt.length} pesanan ditandai sudah dicetak`
      + (tt.length ? ` (${tt.length} TikTok)` : ''));
    return NextResponse.json({ ok: true, ditandai: r.length + tt.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { tokenHidup } from '@/lib/tokens';
import { call } from '@/lib/shopee';
import { EP } from '@/lib/endpoints';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ── Kenapa Laporan Mingguan kosong ──
 *
 * Laporan mingguan berdiri di atas satu kolom: order_escrow.release_at.
 * Kalau kolom itu kosong, laporannya kosong total. Nama field waktu
 * pencairan di balasan Shopee sempat ditebak di lib/sync.js, dan tebakan
 * itu tidak bisa dibuktikan benar atau salah dari layar mana pun.
 *
 * Endpoint ini menjawabnya langsung: ia memanggil get_escrow_detail
 * memakai token toko yang SUDAH HIDUP di aplikasi, lalu menampilkan
 * balasan Shopee APA ADANYA. Jadi tidak perlu lagi mencari shop_id dan
 * access_token sendiri untuk API Test Tool, dan tidak ada risiko keliru
 * memakai lingkungan sandbox.
 *
 * Pakai: /api/diagnosa-escrow
 *        /api/diagnosa-escrow?order_sn=2508XXXXXXXX
 */
export async function GET(req) {
  try {
    await ensureSchema();
    const u = new URL(req.url);
    const minta = u.searchParams.get('order_sn');

    // Keadaan kolom release_at sekarang — ini yang menentukan isi laporan.
    const [keadaan] = await q(`
      SELECT COUNT(*)::int                                                  AS baris_escrow,
             COUNT(*) FILTER (WHERE COALESCE(escrow_amount,0) > 0)::int     AS ada_nilai,
             COUNT(*) FILTER (WHERE release_at IS NOT NULL)::int            AS ada_tanggal_cair,
             MIN(release_at)                                                AS cair_terawal,
             MAX(release_at)                                                AS cair_terakhir
        FROM order_escrow`);

    // Pesanan contoh: yang nilainya sudah ada tapi tanggal cairnya kosong.
    // Itulah kasus yang sedang menghalangi laporan mingguan.
    const contoh = minta
      ? await q(`SELECT o.id, o.order_sn, o.shop_id, o.status FROM orders o
                  WHERE o.order_sn = $1 LIMIT 1`, [minta])
      : await q(`SELECT o.id, o.order_sn, o.shop_id, o.status
                   FROM orders o JOIN order_escrow e ON e.order_id = o.id
                  WHERE COALESCE(e.escrow_amount,0) > 0 AND e.release_at IS NULL
                    AND o.status = 'COMPLETED'
                  ORDER BY o.created_time DESC LIMIT 1`);

    if (!contoh.length) {
      return NextResponse.json({
        ok: true, keadaan,
        catatan: 'Tidak ada pesanan COMPLETED yang nilainya ada tapi tanggal cairnya kosong. '
               + 'Sebutkan order_sn secara langsung untuk memeriksa satu pesanan tertentu.',
      });
    }

    const o = contoh[0];
    const token = await tokenHidup(o.shop_id);
    const json = await call(EP.escrowDetail, {
      accessToken: token, shopId: o.shop_id, params: { order_sn: o.order_sn },
    });

    const r = json.response || {};
    const inc = r.order_income || {};

    /**
     * Semua field yang isinya MIRIP stempel waktu, dari mana pun letaknya.
     * Ini inti diagnosanya: dari sini ketahuan nama asli field waktu
     * pencairan, tanpa perlu menebak lagi.
     */
    const stempel = [];
    const telusur = (obj, awalan) => {
      for (const [k, v] of Object.entries(obj || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v)) { telusur(v, `${awalan}${k}.`); continue; }
        const n = Number(v);
        const miripWaktu = Number.isFinite(n) && n > 1e9 && n < 4e9;
        if (miripWaktu || /time|date|release|payout/i.test(k)) {
          stempel.push({
            field: `${awalan}${k}`, nilai: v,
            terbaca: miripWaktu
              ? new Date(n * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
              : null,
          });
        }
      }
    };
    telusur(r, '');

    return NextResponse.json({
      ok: true,
      keadaan,
      pesanan: { order_sn: o.order_sn, shop_id: String(o.shop_id), status: o.status },
      // Yang dicari lib/sync.js sekarang, supaya langsung terlihat mana yang meleset.
      tebakan_sekarang: {
        'response.escrow_release_time': r.escrow_release_time ?? null,
        'order_income.escrow_release_time': inc.escrow_release_time ?? null,
        'response.payout_time': r.payout_time ?? null,
        'response.release_time': r.release_time ?? null,
        'order_income.release_time': inc.release_time ?? null,
      },
      kandidat_stempel_waktu: stempel,
      kunci_tingkat_atas: Object.keys(r),
      kunci_order_income: Object.keys(inc),
      mentah: json,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, detail: e.response || null },
      { status: 500 });
  }
}

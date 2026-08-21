import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { pratinjauPack } from '@/lib/kirim';
import { antrikan, jalankanAntrean } from '@/lib/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAKS = 1000;   // pengaman kewarasan, bukan batas teknis

async function ambilRows(ids) {
  return q(
    `SELECT o.id, o.order_sn, o.shop_id, o.package_number, o.carrier, o.ship_arranged_at,
            o.tracking_no, s.shop_name
     FROM orders o LEFT JOIN shops s ON s.shop_id = o.shop_id
     WHERE o.id = ANY($1::bigint[])
     ORDER BY o.shop_id, o.carrier NULLS LAST, o.created_time`, [ids]);
}

export async function POST(req) {
  try {
    await ensureSchema();
    const { ids, pratinjau = false, pilihan = null } = await req.json();
    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ ok: false, error: 'Tidak ada pesanan dipilih' }, { status: 400 });
    }
    if (ids.length > MAKS) {
      return NextResponse.json({ ok: false, error: `Maksimal ${MAKS} pesanan sekali proses` }, { status: 400 });
    }

    const rows = await ambilRows(ids);
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: 'Pesanan tidak ditemukan' }, { status: 404 });
    }
    /**
     * Sudah punya nomor resi = permintaan logistiknya sudah ada di Shopee,
     * walau ship_arranged_at di sini kebetulan masih kosong (mis. pesanan
     * lama sebelum aturan ini berlaku, atau diatur lewat Seller Centre).
     * Memaksakan Pack pada pesanan begini ditolak Shopee dengan
     * "Package ... not eligible for rescheduling" — jadi disaring lebih awal
     * dan dikatakan apa adanya, bukan dibiarkan gagal satu per satu.
     */
    const sudahAdaResi = (r) => String(r.tracking_no || '').trim() !== '';
    const belum = rows.filter((r) => !r.ship_arranged_at && !sudahAdaResi(r));
    const dilewatiResi = rows.filter((r) => !r.ship_arranged_at && sudahAdaResi(r)).length;
    if (!belum.length) {
      return NextResponse.json({
        ok: false,
        error: dilewatiResi > 0
          ? `${dilewatiResi} pesanan sudah punya nomor resi — pengirimannya sudah diatur di Shopee, `
            + 'jadi tidak perlu di-Pack lagi. Segarkan halaman; pesanan ini akan pindah sendiri '
            + 'ke tab Sedang dikemas.'
          : 'Semua pesanan yang dipilih sudah pernah di-Pack.',
      }, { status: 400 });
    }

    if (pratinjau) {
      return NextResponse.json({
        ok: true, pratinjau: true,
        dilewati: rows.length - belum.length,
        dilewatiResi,
        grup: await pratinjauPack(belum),
      });
    }

    if (!pilihan || typeof pilihan !== 'object') {
      return NextResponse.json({ ok: false, error: 'Pilihan jemput belum ditentukan' }, { status: 400 });
    }

    // Dikerjakan lewat antrean supaya jumlahnya tidak dibatasi oleh
    // batas waktu satu permintaan web. Beberapa dijalankan langsung agar
    // kamu segera melihat hasil pertamanya.
    const peta = new Map(belum.map((r) => [r.order_sn, r]));
    let diantrikan = 0;
    // ID tugas dikembalikan supaya layar bisa MENUNGGU hasilnya, bukan
    // sekadar melapor "sudah diantrikan" lalu meninggalkan kegagalan
    // tersembunyi di halaman Antrean.
    const jobIds = [];
    for (const [orderSn, pil] of Object.entries(pilihan)) {
      const r = peta.get(orderSn);
      if (!r) continue;
      const job = await antrikan('pack_pesanan', {
        shopId: r.shop_id,
        payload: { order_sn: orderSn, pilihan: { ...pil, package_number: r.package_number } },
      });
      if (job?.id) jobIds.push(String(job.id));
      diantrikan++;
    }

    // Jatahnya dinaikkan karena tugas kini dikerjakan per toko secara
    // bersamaan — yang membatasi sekarang jumlah toko, bukan jumlah pesanan.
    const langsung = await jalankanAntrean({ maks: 40, budgetMs: 25000 });
    return NextResponse.json({
      ok: true,
      diantrikan,
      jobIds,
      dilewati: rows.length - belum.length,
      dilewatiResi,
      langsung,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

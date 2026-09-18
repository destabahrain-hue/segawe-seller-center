import { NextResponse } from 'next/server';
import { ensureSchema, q, one } from '@/lib/db';
import { rentang } from '@/lib/rentang';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * ── Kenapa kolom Iklan di laporan SKU kosong ──
 *
 * Rute ini TIDAK MENGUBAH APA PUN kecuali diminta dengan ?tarik=1.
 *
 * Dibuat setelah dua kali menebak dan dua kali meleset. Daripada menebak
 * ketiga kalinya, rantainya diperiksa langsung, langkah demi langkah, dan
 * yang dilaporkan adalah tempat rantainya putus:
 *
 *   1. Tabel ad_spend_item ada isinya atau tidak
 *   2. item_id yang ada di situ, muncul di order_items periode ini atau tidak
 *   3. kalau muncul, kode SKU-nya apa
 *   4. kode itu ada di daftar kode laporan SKU atau tidak
 *
 * Kalau berhenti di langkah 1, masalahnya penarikan — bukan pemetaan, dan
 * tidak ada gunanya mengutak-atik SQL laporan.
 *
 * Pakai:
 *   /api/diagnosa-iklan-sku                → 30 hari terakhir, semua toko
 *   /api/diagnosa-iklan-sku?r=7h
 *   /api/diagnosa-iklan-sku?toko=64712993
 *   /api/diagnosa-iklan-sku?tarik=1&toko=64712993   → PAKSA tarik 3 hari
 */
export async function GET(req) {
  try {
    await ensureSchema();
    const u = new URL(req.url).searchParams;
    const r = rentang(u.get('r') || '30h', u.get('dari'), u.get('sampai'));
    const toko = u.get('toko') ? Number(u.get('toko')) : null;

    const hasil = { periode: r.label || `${r.dari} s/d ${r.sampai}`, toko: toko || 'semua toko' };

    // ── Langkah 0: tabelnya sudah ada? ──────────────────────────────
    const tabel = await one(
      `SELECT to_regclass('public.ad_spend_item') IS NOT NULL AS ada`);
    hasil.langkah_0_tabel_ada = !!tabel?.ada;
    if (!tabel?.ada) {
      hasil.kesimpulan = 'Tabel ad_spend_item BELUM ADA. Skema belum ter-migrasi — '
        + 'pastikan db/schema.sql versi baru ikut ter-deploy.';
      return NextResponse.json(hasil, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ── Langkah 1: ada isinya? ──────────────────────────────────────
    const isi = await q(
      `SELECT a.shop_id, s.shop_name, a.sumber,
              COUNT(*)::int AS baris,
              COUNT(DISTINCT a.item_id)::int AS item,
              COALESCE(SUM(a.expense),0)::bigint AS pokok,
              MIN(a.day) AS terawal, MAX(a.day) AS terakhir
         FROM ad_spend_item a
         LEFT JOIN shops s ON s.shop_id = a.shop_id
        WHERE ($1::bigint IS NULL OR a.shop_id = $1)
        GROUP BY a.shop_id, s.shop_name, a.sumber
        ORDER BY 6 DESC`, [toko]);
    hasil.langkah_1_isi_tabel = {
      total_baris_seluruh_tabel: isi.reduce((n, x) => n + x.baris, 0),
      per_toko_dan_sumber: isi,
    };
    if (!isi.length) {
      hasil.kesimpulan = 'Tabel ad_spend_item KOSONG — penarikan belum pernah '
        + 'berhasil. Ini bukan masalah pemetaan. Jalankan ulang '
        + '/api/diagnosa-iklan-sku?tarik=1&toko=<shop_id> untuk melihat '
        + 'pesan kegagalan penarikannya secara langsung.';
      return NextResponse.json(hasil, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ── Langkah 2: di dalam PERIODE laporan, ada isinya? ────────────
    const dalamPeriode = await one(
      `SELECT COUNT(*)::int AS baris, COUNT(DISTINCT item_id)::int AS item,
              COALESCE(SUM(expense),0)::bigint AS pokok
         FROM ad_spend_item
        WHERE day >= ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
          AND day <= (($2::timestamptz AT TIME ZONE 'Asia/Jakarta') - interval '1 second')::date
          AND ($3::bigint IS NULL OR shop_id = $3)`, [r.dari, r.sampai, toko]);
    hasil.langkah_2_dalam_periode = dalamPeriode;
    if (!Number(dalamPeriode?.baris)) {
      hasil.kesimpulan = 'Tabelnya ada isinya, tapi TIDAK ADA yang jatuh di periode '
        + 'laporan ini. Lihat terawal/terakhir di langkah 1 — kemungkinan besar '
        + 'periode laporannya di luar rentang data yang sudah ditarik.';
      return NextResponse.json(hasil, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ── Langkah 3: item_id-nya ketemu di pesanan periode ini? ───────
    const jodoh = await q(
      `WITH iklan AS (
         SELECT shop_id, item_id, SUM(expense) AS pokok
           FROM ad_spend_item
          WHERE day >= ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
            AND day <= (($2::timestamptz AT TIME ZONE 'Asia/Jakarta') - interval '1 second')::date
            AND ($3::bigint IS NULL OR shop_id = $3)
          GROUP BY shop_id, item_id
       ),
       jual AS (
         SELECT o.shop_id, oi.item_id,
                COALESCE(ms.code, NULLIF(TRIM(oi.model_sku),''),
                         NULLIF(TRIM(oi.item_sku),''), '(tanpa SKU)') AS code,
                SUM(oi.qty * oi.price) AS omzet
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           LEFT JOIN sku_mapping mm ON mm.shop_id = o.shop_id AND mm.shop_sku = oi.model_sku
           LEFT JOIN sku_mapping mi ON mi.shop_id = o.shop_id AND mi.shop_sku = oi.item_sku
           LEFT JOIN master_sku ms ON ms.id = COALESCE(mm.master_sku_id, mi.master_sku_id)
          WHERE o.created_time >= $1 AND o.created_time < $2
            AND ($3::bigint IS NULL OR o.shop_id = $3)
            AND COALESCE(o.status,'') NOT IN ('CANCELLED','UNPAID')
            AND oi.item_id IS NOT NULL
          GROUP BY 1,2,3
       )
       SELECT i.shop_id, i.item_id, i.pokok::bigint AS pokok,
              j.code, j.omzet::bigint AS omzet,
              p.name AS nama_katalog
         FROM iklan i
         LEFT JOIN jual j ON j.shop_id = i.shop_id AND j.item_id = i.item_id
         LEFT JOIN products p ON p.shop_id = i.shop_id AND p.item_id = i.item_id
        ORDER BY i.pokok DESC
        LIMIT 25`, [r.dari, r.sampai, toko]);

    const ketemu = jodoh.filter((x) => x.code);
    hasil.langkah_3_jodoh_item = {
      diperiksa: jodoh.length,
      ketemu_di_pesanan: ketemu.length,
      tidak_ketemu: jodoh.length - ketemu.length,
      // item_id ada di sini apa adanya supaya bisa dicocokkan manual
      // dengan Seller Centre kalau angkanya tetap tidak masuk akal.
      contoh: jodoh.slice(0, 15),
    };

    // ── Langkah 4: kode itu ada di daftar kode laporan SKU? ─────────
    const kodeIklan = [...new Set(ketemu.map((x) => x.code))];
    let cocokKode = [];
    if (kodeIklan.length) {
      cocokKode = await q(
        `SELECT DISTINCT
                COALESCE(ms.code, NULLIF(TRIM(oi.model_sku),''),
                         NULLIF(TRIM(oi.item_sku),''), '(tanpa SKU)') AS code
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           LEFT JOIN sku_mapping mm ON mm.shop_id = o.shop_id AND mm.shop_sku = oi.model_sku
           LEFT JOIN sku_mapping mi ON mi.shop_id = o.shop_id AND mi.shop_sku = oi.item_sku
           LEFT JOIN master_sku ms ON ms.id = COALESCE(mm.master_sku_id, mi.master_sku_id)
          WHERE o.created_time >= $1 AND o.created_time < $2
            AND ($3::bigint IS NULL OR o.shop_id = $3)
            AND COALESCE(o.status,'') NOT IN ('CANCELLED','UNPAID')`,
        [r.dari, r.sampai, toko]);
    }
    const daftarKode = new Set(cocokKode.map((x) => x.code));
    hasil.langkah_4_kode = {
      kode_dari_iklan: kodeIklan.slice(0, 15),
      kode_yang_ada_di_laporan: kodeIklan.filter((k) => daftarKode.has(k)).length,
      kode_yang_TIDAK_ada: kodeIklan.filter((k) => !daftarKode.has(k)).slice(0, 10),
    };

    // ── Kesimpulan ──────────────────────────────────────────────────
    if (!ketemu.length) {
      hasil.kesimpulan = 'Biaya iklan tersimpan, tapi TIDAK SATU PUN item_id-nya '
        + 'muncul di pesanan periode ini. Kalau produknya jelas laku, berarti '
        + 'order_items.item_id tidak terisi — periksa contoh di langkah 3.';
    } else if (hasil.langkah_4_kode.kode_yang_ada_di_laporan === 0) {
      hasil.kesimpulan = 'Item-nya ketemu di pesanan, tapi kodenya tidak ada satu pun '
        + 'yang cocok dengan kode di laporan. Ini murni soal pemetaan kode.';
    } else {
      hasil.kesimpulan = 'Rantainya utuh — biaya iklan SEHARUSNYA muncul di laporan. '
        + 'Kalau kolomnya masih kosong, periksa apakah halaman laporan sudah memakai '
        + 'versi kode yang baru (deploy belum selesai atau cache halaman).';
    }

    // ── Opsional: paksa tarik, untuk melihat pesan galatnya langsung ─
    if (u.get('tarik') === '1') {
      const { tarikIklanItem } = await import('@/lib/iklan-item');
      const target = toko || Number(isi[0]?.shop_id);
      try {
        hasil.penarikan_paksa = await tarikIklanItem(target, { hariKeBelakang: 3 });
      } catch (e) {
        hasil.penarikan_paksa = { gagal: e.message, kode: e.shopeeCode || null };
      }
    }

    return NextResponse.json(hasil, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, stack: String(e.stack || '').slice(0, 600) },
      { status: 500 });
  }
}

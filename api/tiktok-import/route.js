import { NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { bacaIncome, bacaPesanan, gabung, bulanDariPeriode } from '@/lib/tiktok-import';

export const dynamic = 'force-dynamic';

/**
 * Hitung HPP untuk daftar (sku, tanggal, qty) dari Master SKU.
 *
 * Penautan SKU dua lapis: kode Master SKU dulu, baru alias di
 * sku_mapping. Seller SKU TikTok kebetulan memakai kode yang sama
 * persis dengan Master SKU, tapi alias tetap dicoba supaya SKU yang
 * dinamai lain tidak langsung dianggap tak tertaut.
 *
 * Paket diuraikan ke komponennya — sama seperti lib/report.js dan
 * lib/keuangan.js. Tanpa itu, paket bundling terbaca bermodal nol,
 * kesalahan yang sudah pernah membuat laba sebulan meleset Rp 469 juta.
 */
async function hitungHpp(butir) {
  if (!butir.length) return { perSku: [], totalHpp: 0, takTertaut: [] };

  const rows = await q(`
    WITH inp AS (
      SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[]) AS t(sku, tgl, qty)
    ),
    tertaut AS (
      SELECT i.sku, COALESCE(i.tgl, CURRENT_DATE) AS tgl, i.qty, m.msku
      FROM inp i
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (SELECT id FROM master_sku
            WHERE UPPER(TRIM(code)) = UPPER(TRIM(i.sku)) LIMIT 1),
          (SELECT master_sku_id FROM sku_mapping
            WHERE UPPER(TRIM(shop_sku)) = UPPER(TRIM(i.sku))
              AND master_sku_id IS NOT NULL LIMIT 1)
        ) AS msku
      ) m ON TRUE
    ),
    daun AS (
      SELECT t.sku, t.tgl,
             COALESCE(c.child_id, t.msku)  AS daun_id,
             t.qty * COALESCE(c.qty, 1)    AS daun_qty
      FROM tertaut t
      LEFT JOIN master_sku ms ON ms.id = t.msku
      LEFT JOIN master_sku_component c ON c.parent_id = ms.id AND ms.kind = 'paket'
    ),
    qty_sku AS (
      SELECT sku, SUM(qty) AS qty, BOOL_OR(msku IS NULL) AS tak_tertaut
      FROM tertaut GROUP BY sku
    ),
    hpp_sku AS (
      SELECT sku, SUM(daun_qty * hpp_pada(daun_id, tgl)) AS hpp
      FROM daun GROUP BY sku
    )
    SELECT s.sku, s.qty, s.tak_tertaut, COALESCE(h.hpp, 0) AS hpp
    FROM qty_sku s LEFT JOIN hpp_sku h ON h.sku = s.sku
    ORDER BY COALESCE(h.hpp, 0) DESC, s.sku`,
    [butir.map((b) => b.sku), butir.map((b) => b.tgl), butir.map((b) => b.qty)]);

  const perSku = rows.map((r) => ({
    sku: r.sku,
    qty: Number(r.qty) || 0,
    hpp: Number(r.hpp) || 0,
    takTertaut: !!r.tak_tertaut,
  }));

  return {
    perSku,
    totalHpp: perSku.reduce((a, x) => a + x.hpp, 0),
    // SKU yang tidak tertaut ATAU tertaut tapi HPP-nya nol. Keduanya
    // sama-sama membuat modal hilang dari laporan, jadi dilaporkan
    // bersama — bedanya cuma penyebabnya.
    takTertaut: perSku.filter((x) => x.takTertaut || x.hpp === 0),
  };
}

export async function POST(req) {
  if (!bolehUang(await peranSekarang())) {
    return NextResponse.json(
      { ok: false, error: 'Tidak punya akses ke data keuangan' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const fIncome  = form.get('income');
    const fPesanan = form.get('pesanan');
    if (!fIncome?.arrayBuffer) {
      return NextResponse.json({ ok: false, error: 'Berkas income belum dipilih' }, { status: 400 });
    }

    const income = bacaIncome(Buffer.from(await fIncome.arrayBuffer()));

    // Berkas pesanan boleh belum ada. Kalau begitu penjualan dan iklan
    // tetap terbaca, tapi HPP nol — dan layar HARUS menyebutkannya,
    // karena laporan tanpa modal terlihat sangat untung.
    let sambung = null, hpp = { perSku: [], totalHpp: 0, takTertaut: [] };
    if (fPesanan?.arrayBuffer) {
      const perPesanan = bacaPesanan(Buffer.from(await fPesanan.arrayBuffer()));
      sambung = gabung(income, perPesanan);
      hpp = await hitungHpp(sambung.butir);
    }

    return NextResponse.json({
      ok: true,
      bulan: bulanDariPeriode(income.periode),
      periodeTeks: income.periodeTeks,
      jumlahPesanan: income.jumlahPesanan,
      penjualan: income.penjualan,
      iklanPokok: income.iklanPokok,
      ppn: income.ppn,
      iklan: income.iklan,
      rincianIklan: income.rincianIklan,
      adaPesanan: !!sambung,
      cakupanNilai: sambung?.cakupanNilai ?? null,
      pesananKetemu: sambung?.pesananKetemu ?? null,
      hilangBernilai: sambung?.hilangBernilai ?? [],
      hpp: hpp.totalHpp,
      perSku: hpp.perSku,
      takTertaut: hpp.takTertaut,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

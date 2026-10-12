import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { sesi, peranSekarang, bolehUang } from '@/lib/auth';
import { rincianJenisTiktok, keuanganTiktok, tarikTransaksiTiktok } from '@/lib/tiktok-keuangan';

export const maxDuration = 60;

export const dynamic = 'force-dynamic';

/**
 * Pencocokan Keuangan TikTok dengan berkas income TikTok Seller Center.
 *
 * Menampilkan jumlah per `type` transaksi pada rentang tanggal cair, dan
 * ke kelompok mana tiap type dimasukkan (pesanan / iklan / lain). Kalau
 * total iklan di sini tidak sama dengan jumlah baris iklan GMV Max di
 * berkas income bulan yang sama, pembagian type-nya yang perlu diubah —
 * satu tempat saja, JENIS_SQL di lib/tiktok-keuangan.js.
 *
 * ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD (sampai eksklusif). Bawaan: bulan ini.
 */
export async function GET(req) {
  if (!sesi()) return NextResponse.json({ ok: false, error: 'Belum masuk' }, { status: 401 });
  if (!bolehUang(await peranSekarang())) {
    return NextResponse.json({ ok: false, error: 'Peranmu tidak boleh melihat angka rupiah' }, { status: 403 });
  }
  await ensureSchema();
  const u = new URL(req.url);
  const kini = new Date(Date.now() + 7 * 3600 * 1000);
  const awal = `${kini.getUTCFullYear()}-${String(kini.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const n = new Date(Date.UTC(kini.getUTCFullYear(), kini.getUTCMonth() + 1, 1));
  const akhir = n.toISOString().slice(0, 10);
  const dari = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('dari') || '') ? u.searchParams.get('dari') : awal;
  const sampai = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('sampai') || '') ? u.searchParams.get('sampai') : akhir;

  const bagian = {};
  const coba = async (k, f) => { try { bagian[k] = await f(); } catch (e) { bagian[k] = { galat: e.message }; } };

  /**
   * ?coba=1 — tarik transaksi SEKARANG juga (maks ±25 detik) untuk toko
   * TikTok pertama, lalu tampilkan hasil atau pesan galat TikTok apa
   * adanya. Hanya GET ke TikTok; tidak mengubah apa pun di sana.
   */
  if (u.searchParams.get('coba') === '1') {
    await coba('coba_tarik', async () => {
      const toko = await q(`SELECT shop_id, shop_name FROM tiktok_shops
                             WHERE status = 'active' ORDER BY shop_name LIMIT 1`);
      if (!toko.length) return { galat: 'tidak ada toko TikTok aktif' };
      const r = await tarikTransaksiTiktok(toko[0].shop_id, { detik: 25 });
      return { toko: toko[0].shop_name, ...r };
    });
  }

  // Jejak penarikan otomatis: catatan penjadwal, tugas antrean, dan log galat.
  await coba('jejak', async () => ({
    jadwal: await q(`SELECT nama, last_run, last_note FROM jadwal
                      WHERE nama IN ('tiktok_keuangan','sinkron') ORDER BY nama`),
    antrean: await q(`SELECT id, kind, status, attempts, last_error, created_at, finished_at
                        FROM jobs WHERE kind IN ('tiktok_statement','tiktok_transaksi')
                       ORDER BY id DESC LIMIT 8`),
    log_galat: await q(`SELECT created_at, message FROM activity_log
                         WHERE kind = 'tiktok' ORDER BY id DESC LIMIT 8`),
  }));
  await coba('penarikan', () => q(`
    SELECT s.shop_id, t.shop_name,
           COUNT(*)::int AS statement,
           COUNT(*) FILTER (WHERE s.tx_ditarik_at IS NULL)::int AS belum_ditarik,
           MIN(s.statement_time) AS terawal, MAX(s.statement_time) AS terakhir,
           (SELECT COUNT(*) FROM tiktok_statement_tx x WHERE x.shop_id = s.shop_id)::int AS transaksi
      FROM tiktok_statements s LEFT JOIN tiktok_shops t ON t.shop_id = s.shop_id
     GROUP BY s.shop_id, t.shop_name`));
  await coba('per_jenis', () => rincianJenisTiktok(dari, sampai));
  await coba('ringkasan', () => keuanganTiktok(dari, sampai));
  await coba('cocok_statement', () => q(`
    -- Jumlah settlement transaksi harus sama dengan settlement statement-nya.
    SELECT s.shop_id,
           SUM(s.settlement_amount) AS menurut_statement,
           SUM(x.jml)               AS menurut_transaksi
      FROM tiktok_statements s
      LEFT JOIN (SELECT statement_id, SUM(settlement_amount) AS jml
                   FROM tiktok_statement_tx GROUP BY statement_id) x ON x.statement_id = s.statement_id
     WHERE s.tx_ditarik_at IS NOT NULL
       AND (s.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
       AND (s.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date
     GROUP BY s.shop_id`, [dari, sampai]));

  /**
   * Selisih statement vs transaksinya, dipecah per komponen.
   *
   * Hasil pertama (Sep 2026) menunjukkan jumlah transaksi LEBIH BESAR
   * ±Rp 25,8 jt daripada uang yang benar-benar dibayar statement, padahal
   * tidak ada satu pun transaksi berjenis iklan. Dugaan terkuat: potongan
   * iklan GMV Max dikenakan di tingkat STATEMENT, bukan sebagai baris
   * transaksi. Bagian ini memperlihatkan komponen mana yang menyerap
   * selisihnya, supaya tidak ditebak.
   */
  await coba('selisih_statement', async () => {
    const SQL_X = `SELECT statement_id,
                          SUM(settlement_amount) AS settlement, SUM(revenue_amount) AS revenue,
                          SUM(fee_amount) AS fee, SUM(shipping_cost_amount) AS shipping_cost,
                          SUM(adjustment_amount) AS adjustment, SUM(net_sales_amount) AS net_sales,
                          COUNT(*)::int AS baris
                     FROM tiktok_statement_tx GROUP BY statement_id`;
    const RENTANG = `st.tx_ditarik_at IS NOT NULL
       AND (st.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
       AND (st.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date`;
    const total = await q(`
      WITH x AS (${SQL_X})
      SELECT COUNT(*)::int AS statement,
             COUNT(*) FILTER (WHERE st.settlement_amount <> x.settlement)::int AS tidak_sama,
             SUM(st.settlement_amount) AS st_settlement,       SUM(x.settlement)    AS tx_settlement,
             SUM(st.revenue_amount)    AS st_revenue,          SUM(x.revenue)       AS tx_revenue,
             SUM(st.fee_amount)        AS st_fee,              SUM(x.fee)           AS tx_fee,
             SUM(st.shipping_cost_amount) AS st_shipping_cost, SUM(x.shipping_cost) AS tx_shipping_cost,
             SUM(st.adjustment_amount) AS st_adjustment,       SUM(x.adjustment)    AS tx_adjustment,
             SUM(st.net_sales_amount)  AS st_net_sales,        SUM(x.net_sales)     AS tx_net_sales
        FROM tiktok_statements st JOIN x ON x.statement_id = st.statement_id
       WHERE ${RENTANG}`, [dari, sampai]);
    const terbesar = await q(`
      WITH x AS (${SQL_X})
      SELECT st.statement_id, st.statement_time, st.payment_status, st.tx_jumlah, x.baris,
             st.settlement_amount AS st_settlement, x.settlement AS tx_settlement,
             st.settlement_amount - x.settlement AS selisih,
             st.revenue_amount AS st_revenue, x.revenue AS tx_revenue,
             st.fee_amount AS st_fee, x.fee AS tx_fee,
             st.shipping_cost_amount AS st_shipping_cost, x.shipping_cost AS tx_shipping_cost,
             st.adjustment_amount AS st_adjustment, x.adjustment AS tx_adjustment,
             st.net_sales_amount AS st_net_sales, x.net_sales AS tx_net_sales
        FROM tiktok_statements st JOIN x ON x.statement_id = st.statement_id
       WHERE ${RENTANG}
       ORDER BY ABS(st.settlement_amount - x.settlement) DESC LIMIT 8`, [dari, sampai]);
    return { total: total[0] || null, terbesar };
  });

  /**
   * Statement yang TIDAK punya transaksi — sumber potongan yang kini dibaca
   * sebagai iklan GMV Max. Tanggal & nominalnya bisa dicocokkan satu per satu
   * dengan baris "Pembayaran GMV untuk Iklan TikTok" di berkas income.
   */
  await coba('statement_tanpa_transaksi', () => q(`
    SELECT s.statement_id, s.statement_time, s.payment_status,
           s.settlement_amount, s.revenue_amount, s.fee_amount,
           s.adjustment_amount, s.shipping_cost_amount, s.net_sales_amount
      FROM tiktok_statements s
     WHERE s.tx_ditarik_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM tiktok_statement_tx x WHERE x.statement_id = s.statement_id)
       AND (s.statement_time AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
       AND (s.statement_time AT TIME ZONE 'Asia/Jakarta')::date <  $2::date
     ORDER BY s.statement_time`, [dari, sampai]));

  return NextResponse.json({ ok: true, dari, sampai, ...bagian });
}

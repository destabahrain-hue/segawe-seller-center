import { q } from './db';
import { PPN_IKLAN as tarifPpn } from './report';
import { opexBulan, opexProrata, tokoManualBulan, awalBulan, urutkanJenis } from './opex';
import { bonusPeriode } from './bonus-iklan';

/**
 * ── Laporan Keuangan (mingguan & bulanan) ──
 *
 * Bentuknya mengikuti laporan Excel yang sudah dipakai Prima, jadi
 * angkanya bisa disandingkan baris per baris:
 *
 *     Penjualan − HPP = Gross Profit
 *     − Potongan Iklan − beban operasional = NETT PROFIT
 *
 * Tidak ada baris "Biaya Platform". Itu bukan kelalaian: Penjualan di
 * sini adalah uang yang BENAR-BENAR diterima (escrow), yang sudah
 * dipotong seluruh komisi dan biaya layanan Shopee. Menambahkan baris
 * biaya platform akan memotongnya dua kali.
 *
 * Periode memakai TANGGAL DANA DILEPAS, bukan tanggal pesanan — sama
 * seperti lib/mingguan.js dan sama seperti Excel. Pesanan yang dananya
 * belum cair belum masuk laporan mana pun, dan itu disengaja: laporan
 * keuangan tidak boleh berisi taksiran.
 */

/**
 * Ringkasan per toko untuk rentang tanggal bebas.
 *
 * Kembarannya ringkasMinggu() di lib/mingguan.js dan HARUS memberi
 * angka yang sama untuk rentang satu minggu. Bedanya cuma cara memilih
 * periode: yang di sana mengunci ke kunci minggu, yang di sini menerima
 * rentang apa pun supaya bisa dipakai bulanan.
 *
 * `sampai` bersifat EKSKLUSIF — untuk September, kirim 1 Sep dan 1 Okt.
 */
export async function ringkasPeriode(dari, sampai, { bonus = null } = {}) {
  const TGL = `(e.release_at AT TIME ZONE 'Asia/Jakarta')::date`;
  const rows = await q(`
    WITH baris AS (
      SELECT o.shop_id, s.shop_name, o.id AS order_id,
             e.escrow_bersih AS escrow_amount,
             SUM(oi.qty * oi.price) AS subtotal
      FROM order_escrow e
      JOIN orders o ON o.id = e.order_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN shops s ON s.shop_id = o.shop_id
      WHERE e.release_at IS NOT NULL
        AND ${TGL} >= $1::date AND ${TGL} < $2::date
        AND COALESCE(e.escrow_amount,0) > 0
      GROUP BY o.shop_id, s.shop_name, o.id, e.escrow_bersih
    ),
    hpp AS (
      /**
       * HPP yang menguraikan PAKET ke komponennya.
       *
       * Sebelumnya blok ini memanggil hpp_pada() langsung ke master SKU.
       * Untuk SKU ber-kind='paket' itu selalu mengembalikan NOL, karena
       * HPP paket memang TIDAK PERNAH diinput manual — dijumlah dari
       * komponen. Akibatnya paket bundling terbaca bermodal Rp 0 dan
       * laba terlihat jauh lebih besar dari kenyataan. Pada Agustus 2026
       * itu Rp 469 juta HPP yang hilang dari satu bulan saja.
       *
       * Penautan SKU juga lewat DUA jalur terpisah (model_sku dan
       * item_sku), bukan satu COALESCE. Dengan satu COALESCE, baris yang
       * model_sku-nya terisi tapi tidak tertaut tidak pernah mencoba
       * item_sku, dan SKU-nya hilang begitu saja.
       *
       * Keduanya menyalin lib/report.js, yang sudah benar sejak awal.
       */
      WITH dasar AS (
        SELECT o.id AS order_id, o.shop_id, o.created_time,
               oi.id AS oi_id, oi.qty,
               NULLIF(TRIM(oi.model_sku),'') AS model_sku,
               NULLIF(TRIM(oi.item_sku),'')  AS item_sku
        FROM order_escrow e
        JOIN orders o ON o.id = e.order_id
        JOIN order_items oi ON oi.order_id = o.id
        WHERE e.release_at IS NOT NULL AND ${TGL} >= $1::date AND ${TGL} < $2::date
          AND COALESCE(e.escrow_amount,0) > 0
      ),
      tertaut AS (
        SELECT d.*, COALESCE(mm.master_sku_id, mi.master_sku_id) AS msku
        FROM dasar d
        LEFT JOIN sku_mapping mm ON mm.shop_id = d.shop_id AND mm.shop_sku = d.model_sku
        LEFT JOIN sku_mapping mi ON mi.shop_id = d.shop_id AND mi.shop_sku = d.item_sku
      ),
      daun AS (
        SELECT t.order_id, t.created_time, t.oi_id, t.msku,
               COALESCE(c.child_id, t.msku) AS daun_id,
               t.qty * COALESCE(c.qty, 1)   AS daun_qty
        FROM tertaut t
        LEFT JOIN master_sku ms ON ms.id = t.msku
        LEFT JOIN master_sku_component c ON c.parent_id = ms.id AND ms.kind = 'paket'
      )
      SELECT order_id,
             SUM(daun_qty * hpp_pada(daun_id,
                   (created_time AT TIME ZONE 'Asia/Jakarta')::date)) AS hpp,
             -- Penjaga dihitung per BARIS PESANAN (oi_id), bukan per daun,
             -- supaya satu paket tak tertaut tidak terhitung berkali-kali.
             COUNT(DISTINCT oi_id) FILTER (WHERE daun_id IS NULL) AS tanpa_hpp
      FROM daun
      GROUP BY order_id
    ),
    iklan AS (
      SELECT shop_id, COALESCE(SUM(expense),0) AS kotor
      FROM ad_spend
      WHERE day >= $1::date AND day < $2::date
      GROUP BY shop_id
    )
    SELECT b.shop_id, MIN(b.shop_name) AS shop_name,
           COUNT(DISTINCT b.order_id)::int    AS pesanan,
           SUM(b.escrow_amount)               AS penjualan,
           COALESCE(SUM(h.hpp), 0)            AS hpp,
           COALESCE(SUM(h.tanpa_hpp), 0)::int AS baris_tanpa_hpp,
           COALESCE(MAX(i.kotor), 0)          AS iklan_kotor
    FROM baris b
    LEFT JOIN hpp   h ON h.order_id = b.order_id
    LEFT JOIN iklan i ON i.shop_id  = b.shop_id
    GROUP BY b.shop_id
    ORDER BY SUM(b.escrow_amount) DESC`, [dari, sampai]);

  return rows.map((r) => {
    const penjualan  = Number(r.penjualan) || 0;
    const hpp        = Number(r.hpp) || 0;
    const beban      = Math.abs(Number(r.iklan_kotor) || 0);
    /**
     * Bonus dikurangkan SESUDAH PPN: (beban x 1,11) - bonus.
     * Rebate iklan TIDAK dikenai PPN, jadi ia tidak boleh mengurangi
     * dasar pengenaan pajaknya. Kalau ditulis (beban - bonus) x 1,11,
     * hasilnya meleset 11% dari nilai bonusnya.
     *
     * Bonus tidak ada di API mana pun — sudah dibuktikan lewat seluruh
     * kategori Ads dan 500 baris dompet penjual. Angkanya diketik di
     * halaman Beban Operasional.
     */
    const bonusToko  = bonus?.get(String(r.shop_id)) || 0;
    const ppn        = beban * tarifPpn();
    const iklan      = Math.max(beban + ppn - bonusToko, 0);
    const margin     = penjualan - hpp;
    return {
      shopId: String(r.shop_id),
      nama: r.shop_name || `Toko ${r.shop_id}`,
      manual: false,
      pesanan: Number(r.pesanan) || 0,
      penjualan, hpp, margin, bebanIklan: beban, bonus: bonusToko,
      iklanKotor: beban, ppn, iklan,
      grossProfit: margin - iklan,
      barisTanpaHpp: Number(r.baris_tanpa_hpp) || 0,
    };
  });
}

/**
 * Susun laporan keuangan lengkap untuk satu periode.
 *
 * mode 'bulan'  → opex angka sesungguhnya, toko manual ikut
 * mode 'minggu' → opex dibagi rata per hari, toko manual TIDAK ikut
 *
 * Toko manual sengaja tidak ikut di mingguan: datanya diketik bulanan
 * dan tidak punya rincian tanggal cair, jadi memaksakannya masuk hanya
 * akan membuat angka mingguan menyesatkan tanpa ada yang menyadari.
 */
export async function laporanKeuangan({ dari, sampai, mode = 'bulan' }) {
  const bulanan = mode === 'bulan';

  // Bonus dibaca lebih dulu karena ringkasPeriode membutuhkannya untuk
  // menghitung iklan; bulanan pakai angka bulan itu, mingguan prorata.
  // Bonus tersimpan PER HARI, jadi rentang apa pun dapat angka nyata —
  // bulanan maupun mingguan, tanpa pembagian rata.
  const bonus = await bonusPeriode(dari, sampai);

  const [tokoApi, manual, ox, prorata] = await Promise.all([
    ringkasPeriode(dari, sampai, { bonus }),
    bulanan ? tokoManualBulan(dari) : Promise.resolve([]),
    bulanan ? opexBulan(dari) : Promise.resolve({ baris: [], total: 0 }),
    bulanan ? Promise.resolve(0) : opexProrata(dari, sampai),
  ]);

  // Toko manual disetarakan bentuknya dengan toko API supaya tabel per
  // toko tidak perlu tahu bedanya. Penanda `manual` tetap dibawa supaya
  // layar bisa menandainya — pembaca berhak tahu angka mana yang
  // diketik tangan.
  const tokoManual = manual.map((m) => {
    const penjualan = Number(m.penjualan) || 0;
    const hpp       = Number(m.hpp) || 0;
    const iklan     = Number(m.iklan) || 0;
    const margin    = penjualan - hpp;
    return {
      shopId: `manual-${m.id}`, nama: m.nama, manual: true,
      pesanan: 0, penjualan, hpp, margin, bebanIklan: iklan, bonus: 0,
      iklanKotor: iklan / (1 + tarifPpn()), ppn: iklan - iklan / (1 + tarifPpn()),
      iklan, grossProfit: margin - iklan, barisTanpaHpp: 0,
    };
  });

  const toko = [...tokoApi, ...tokoManual]
    .sort((a, b) => b.penjualan - a.penjualan);

  const t = toko.reduce((a, x) => ({
    bonus:      a.bonus      + (x.bonus || 0),
    pesanan:    a.pesanan    + x.pesanan,
    penjualan:  a.penjualan  + x.penjualan,
    hpp:        a.hpp        + x.hpp,
    iklanKotor: a.iklanKotor + x.iklanKotor,
    ppn:        a.ppn        + x.ppn,
    iklan:      a.iklan      + x.iklan,
    barisTanpaHpp: a.barisTanpaHpp + x.barisTanpaHpp,
  }), { bonus: 0, pesanan: 0, penjualan: 0, hpp: 0, iklanKotor: 0, ppn: 0, iklan: 0, barisTanpaHpp: 0 });

  t.grossProfit = t.penjualan - t.hpp;

  // Baris beban, urut seperti sheet SUMMARRY. Untuk mingguan hanya ada
  // satu baris gabungan, karena membagi tiap pos per hari lalu
  // menampilkannya satu-satu memberi kesan presisi yang tidak ada.
  const beban = bulanan
    ? urutkanJenis(ox.baris).map((b) => ({
        jenis: b.jenis, nominal: Number(b.nominal) || 0, catatan: b.catatan }))
    : (prorata > 0
        ? [{ jenis: 'Beban operasional (prorata harian)', nominal: prorata, catatan: null }]
        : []);

  const totalOpex = beban.reduce((a, b) => a + b.nominal, 0);
  const nett = t.grossProfit - t.iklan - totalOpex;

  const persen = (x) => (t.penjualan ? (x / t.penjualan) * 100 : 0);

  return {
    dari, sampai, mode,
    toko,
    total: {
      ...t,
      totalOpex, nett,
      marginKotor: persen(t.grossProfit),
      persenIklan: persen(t.iklan),
      persenOpex:  persen(totalOpex),
      marginNett:  persen(nett),
    },
    beban: beban.map((b) => ({ ...b, persen: persen(b.nominal) })),
    // Laporan keuangan tanpa opex bukan laporan keuangan — halaman
    // WAJIB memperingatkan kalau bulannya belum diisi.
    opexKosong: bulanan && ox.baris.length === 0,
    adaManual: tokoManual.length > 0,
  };
}

/** Dua belas bulan terakhir, untuk pemilih periode. */
export function daftarBulan(jumlah = 12) {
  const out = [];
  const kini = new Date();
  for (let i = 0; i < jumlah; i++) {
    const d = new Date(Date.UTC(kini.getUTCFullYear(), kini.getUTCMonth() - i, 1));
    const n = new Date(Date.UTC(kini.getUTCFullYear(), kini.getUTCMonth() - i + 1, 1));
    out.push({ dari: awalBulan(d), sampai: awalBulan(n) });
  }
  return out;
}

/**
 * Rincian per pesanan per SKU — isi lembar LAPORAN PENGHASILAN.
 *
 * Satu baris untuk tiap SKU di tiap pesanan yang dananya cair pada
 * periode ini.
 *
 * UANG MASUK DIBAGI PROPORSIONAL. Shopee hanya memberi satu angka dana
 * cair per PESANAN, bukan per SKU. Untuk pesanan berisi beberapa barang,
 * angka itu dibagi menurut porsi harga jual tiap barisnya. Jadi kolom
 * Uang Masuk pada baris tunggal adalah angka nyata, sedangkan pada
 * pesanan multi-SKU adalah pembagian — dan itu satu-satunya cara,
 * karena rinciannya tidak pernah ada.
 *
 * HPP paket dijumlah dari komponennya, sama seperti ringkasPeriode.
 */
export async function detailPeriode(dari, sampai) {
  const TGL = `(e.release_at AT TIME ZONE 'Asia/Jakarta')::date`;
  const rows = await q(`
    WITH baris AS (
      SELECT o.shop_id, s.shop_name, o.order_sn, o.id AS order_id, oi.id AS oi_id,
             (o.created_time AT TIME ZONE 'Asia/Jakarta')::date AS tgl,
             oi.qty,
             oi.qty * oi.price AS subtotal,
             e.escrow_bersih,
             COALESCE(mm.master_sku_id, mi.master_sku_id) AS msku,
             COALESCE(NULLIF(TRIM(oi.model_sku),''), NULLIF(TRIM(oi.item_sku),'')) AS sku_toko
      FROM order_escrow e
      JOIN orders o       ON o.id = e.order_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN shops s   ON s.shop_id = o.shop_id
      LEFT JOIN sku_mapping mm ON mm.shop_id = o.shop_id
            AND mm.shop_sku = NULLIF(TRIM(oi.model_sku),'')
      LEFT JOIN sku_mapping mi ON mi.shop_id = o.shop_id
            AND mi.shop_sku = NULLIF(TRIM(oi.item_sku),'')
      WHERE e.release_at IS NOT NULL
        AND ${TGL} >= $1::date AND ${TGL} < $2::date
        AND COALESCE(e.escrow_amount,0) > 0
    ),
    tot AS (
      SELECT order_id, SUM(subtotal) AS subtotal_pesanan FROM baris GROUP BY order_id
    )
    SELECT b.shop_name, b.order_sn,
           COALESCE(ms.code, b.sku_toko, '(tak tertaut)') AS sku,
           b.tgl, b.qty,
           ROUND(b.escrow_bersih * b.subtotal
                 / NULLIF(t.subtotal_pesanan, 0))         AS uang_masuk,
           COALESCE(hh.hpp_satuan, 0)                     AS hpp_satuan
    FROM baris b
    JOIN tot t ON t.order_id = b.order_id
    LEFT JOIN master_sku ms ON ms.id = b.msku
    LEFT JOIN LATERAL (
      SELECT CASE WHEN ms2.kind = 'paket' THEN (
               SELECT SUM(c.qty * hpp_pada(c.child_id, b.tgl))
               FROM master_sku_component c WHERE c.parent_id = ms2.id)
             ELSE hpp_pada(b.msku, b.tgl) END AS hpp_satuan
      FROM master_sku ms2 WHERE ms2.id = b.msku
    ) hh ON TRUE
    ORDER BY b.shop_name NULLS LAST, b.order_sn, b.oi_id`, [dari, sampai]);

  return rows.map((r) => {
    const qty = Number(r.qty) || 0;
    const uang = Number(r.uang_masuk) || 0;
    const hppSatuan = Number(r.hpp_satuan) || 0;
    const hppTotal = hppSatuan * qty;
    return {
      toko: r.shop_name || '—',
      orderSn: r.order_sn,
      sku: r.sku,
      tanggal: r.tgl instanceof Date ? r.tgl.toISOString().slice(0, 10) : String(r.tgl),
      qty, uang, hppSatuan, hppTotal,
      margin: uang - hppTotal,
    };
  });
}

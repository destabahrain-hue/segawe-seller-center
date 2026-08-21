import { q } from './db';

/**
 * ── Days of Supply (DOS) ──
 *
 * DOS = berapa hari lagi stok yang ada cukup, kalau penjualan berjalan
 * seperti biasa. Gunanya bukan angkanya, tapi pemicunya: kalau waktu
 * tunggu supplier 14 hari dan DOS tinggal 12, itu artinya terlambat.
 *
 * Sumber permintaannya stock_moves ref_type='order' — bukan order_items —
 * karena di situ paket bundling SUDAH diuraikan ke komponennya. Kalau
 * dihitung dari pesanan mentah, komponen yang laris lewat bundling akan
 * terlihat adem padahal sedang terkuras.
 *
 * ── Jebakan yang ditangani di sini ──
 *
 * Hari-hari KOSONG STOK tidak boleh ikut membagi. Barang yang habis 10
 * hari dan terjual nol di hari-hari itu akan terlihat "permintaannya
 * rendah", lalu sistem menyarankan pesan sedikit, lalu habis lagi —
 * lingkaran yang memperparah dirinya sendiri. Karena itu rata-rata
 * dibagi HANYA dengan jumlah hari yang stoknya ada, yang direkonstruksi
 * mundur dari buku besar.
 */

/** Bawaan; bisa diubah lewat environment variable tanpa menyentuh kode. */
export const BAWAAN = {
  leadTime: Number(process.env.DOS_LEAD_TIME_HARI || 14),  // waktu tunggu supplier
  aman:     Number(process.env.DOS_SAFETY_HARI || 7),      // cadangan pengaman
  target:   Number(process.env.DOS_TARGET_HARI || 45),     // stok ideal setelah pesanan datang
};

/**
 * Hitung DOS untuk semua Master SKU.
 *
 * Dikembalikan dua jendela sekaligus — 7 hari dan 30 hari — karena satu
 * jendela selalu menipu. Flash sale sehari bisa menjual stok sebulan;
 * kalau hanya melihat 7 hari, sistem akan panik tanpa alasan. Kalau hanya
 * 30 hari, tren naik yang baru mulai tidak akan terlihat sampai terlambat.
 */
export async function hitungDOS({ leadTime = BAWAAN.leadTime, aman = BAWAAN.aman,
                                  target = BAWAAN.target } = {}) {
  const rows = await q(`
    WITH hari AS (
      SELECT generate_series(
               (now() AT TIME ZONE 'Asia/Jakarta')::date - 29,
               (now() AT TIME ZONE 'Asia/Jakarta')::date,
               interval '1 day')::date AS d
    ),
    -- Saldo sekarang, sama rumusnya dengan halaman Gudang.
    saldo AS (
      SELECT master_sku_id AS sku,
             SUM(CASE WHEN direction = 'in'  THEN qty
                      WHEN direction = 'out' THEN -qty
                      ELSE qty END) AS kini
        FROM stock_moves GROUP BY 1
    ),
    -- Pergerakan diringkas per SKU per hari.
    gerak AS (
      SELECT master_sku_id AS sku,
             (moved_at AT TIME ZONE 'Asia/Jakarta')::date AS d,
             SUM(CASE WHEN direction = 'in'  THEN qty
                      WHEN direction = 'out' THEN -qty
                      ELSE qty END) AS net,
             SUM(CASE WHEN direction = 'out' AND ref_type = 'order' THEN qty ELSE 0 END) AS jual
        FROM stock_moves
       GROUP BY 1, 2
    ),
    -- Tiap SKU dikawinkan dengan seluruh 30 hari, supaya hari tanpa
    -- pergerakan pun tetap punya baris dan bisa dinilai ada-tidaknya stok.
    kisi AS (
      SELECT ms.id AS sku, h.d,
             COALESCE(g.net, 0)  AS net,
             COALESCE(g.jual, 0) AS jual,
             COALESCE(s.kini, 0) AS kini
        FROM master_sku ms
        CROSS JOIN hari h
        LEFT JOIN gerak g ON g.sku = ms.id AND g.d = h.d
        LEFT JOIN saldo s ON s.sku = ms.id
    ),
    -- Saldo akhir tiap hari direkonstruksi MUNDUR dari saldo sekarang:
    -- saldo akhir hari d = saldo kini dikurangi seluruh pergerakan
    -- sesudah hari d.
    riwayat AS (
      SELECT sku, d, jual, kini,
             kini - (SUM(net) OVER (PARTITION BY sku ORDER BY d DESC
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - net) AS tutup
        FROM kisi
    ),
    ringkas AS (
      SELECT sku,
             SUM(jual) FILTER (WHERE d > (now() AT TIME ZONE 'Asia/Jakarta')::date - 7)::int  AS jual7,
             SUM(jual)::int AS jual30,
             -- Hari dianggap "ada stok" kalau saldo akhirnya masih positif
             -- ATAU memang ada penjualan hari itu (habis di tengah hari).
             COUNT(*) FILTER (WHERE (tutup > 0 OR jual > 0)
                                AND d > (now() AT TIME ZONE 'Asia/Jakarta')::date - 7)::int  AS ada7,
             COUNT(*) FILTER (WHERE tutup > 0 OR jual > 0)::int                              AS ada30
        FROM riwayat GROUP BY sku
    )
    SELECT ms.id, ms.code, ms.name, ms.kind, ms.unit, ms.reorder_at,
           COALESCE(s.kini, 0)::int AS saldo,
           COALESCE(r.jual7, 0)  AS jual7,
           COALESCE(r.jual30, 0) AS jual30,
           COALESCE(r.ada7, 0)   AS ada7,
           COALESCE(r.ada30, 0)  AS ada30
      FROM master_sku ms
      LEFT JOIN saldo s   ON s.sku = ms.id
      LEFT JOIN ringkas r ON r.sku = ms.id
     ORDER BY ms.name`);

  return rows.map((r) => {
    const saldo = Number(r.saldo) || 0;
    // Pembaginya jumlah hari yang stoknya ADA, bukan panjang jendela.
    const rata7  = r.ada7  > 0 ? Number(r.jual7)  / Number(r.ada7)  : 0;
    const rata30 = r.ada30 > 0 ? Number(r.jual30) / Number(r.ada30) : 0;

    /**
     * Untuk memutuskan kapan memesan, dipakai yang LEBIH TINGGI dari dua
     * rata-rata. Salah menebak terlalu cepat cuma berarti gudang penuh
     * sebentar; salah menebak terlalu lambat berarti kehabisan barang
     * yang sedang laku — dan itu jauh lebih mahal.
     */
    const rata = Math.max(rata7, rata30);
    const dos7  = rata7  > 0 ? saldo / rata7  : null;
    const dos30 = rata30 > 0 ? saldo / rata30 : null;
    const dos   = rata    > 0 ? saldo / rata   : null;

    const titikPesan = Math.ceil(rata * (leadTime + aman));
    // Ambang manual di Master SKU tetap dihormati: yang lebih dulu memicu
    // yang menang, jadi angka yang sudah kamu tetapkan tidak dikalahkan
    // diam-diam oleh perhitungan.
    const ambang = Math.max(titikPesan, Number(r.reorder_at) || 0);

    /**
     * Saran jumlah pesan.
     *
     * Dasarnya menutup lead time + target isi. Tapi kalau yang memicu
     * justru AMBANG MANUAL — misalnya barang laku 1/hari dengan ambang
     * 500 — perhitungan target akan menghasilkan nol, dan layar jadi
     * bertentangan dengan dirinya sendiri: "Saatnya pesan" tapi saran
     * kosong. Jadi saran minimal mengembalikan stok ke ambangnya.
     */
    const saranTarget = rata > 0
      ? Math.max(0, Math.ceil(rata * (leadTime + target) - saldo))
      : 0;

    let status = 'aman';
    if (saldo <= 0) status = 'habis';
    else if (rata === 0) status = 'diam';                 // tidak ada penjualan 30 hari
    else if (saldo <= ambang) status = 'pesan';
    else if (dos !== null && dos <= (leadTime + aman) * 1.5) status = 'waspada';

    const saran = (status === 'pesan' || status === 'habis')
      ? Math.max(saranTarget, ambang - saldo, 0)
      : saranTarget;

    /**
     * Tren hanya dinilai kalau seminggu terakhir memang PUNYA hari
     * berstok. Barang yang habis sepuluh hari akan tampak "permintaannya
     * turun" padahal ia tidak punya kesempatan terjual — dan itu justru
     * barang yang paling perlu segera dipesan.
     */
    const trenSah = Number(r.ada7) >= 3 && rata30 > 0;

    return {
      ...r,
      saldo, rata7, rata30, rata,
      dos7, dos30, dos,
      titikPesan, ambang, saran, status,
      naik: trenSah && rata7 > rata30 * 1.3,
      turun: trenSah && rata7 < rata30 * 0.7,
    };
  });
}

/** Ringkasan untuk kartu di atas halaman. */
export function ringkasDOS(baris) {
  return {
    habis:    baris.filter((b) => b.status === 'habis').length,
    pesan:    baris.filter((b) => b.status === 'pesan').length,
    waspada:  baris.filter((b) => b.status === 'waspada').length,
    diam:     baris.filter((b) => b.status === 'diam').length,
  };
}

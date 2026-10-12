import { ensureSchema, q, one, log } from './db';

/**
 * ── Penjadwal internal ──
 *
 * Sinkronisasi dijalankan sendiri oleh server, tidak menunggu cron dari luar.
 * Alasannya pengalaman Ad Storm: cron-job.org pernah gagal 502 saat ada
 * banyak deploy berturut-turut, dan kegagalannya baru diketahui lewat email.
 * Penjadwal di dalam proses tidak punya titik gagal itu.
 *
 * /api/cron tetap ada sebagai jalur cadangan — boleh dipakai bersamaan,
 * kunci giliran di bawah mencegah keduanya jalan berbarengan.
 */
const MENIT = () => Math.max(Number(process.env.SYNC_INTERVAL_MENIT || 5), 1);
let hidup = false;

/**
 * Ambil giliran lewat satu UPDATE bersyarat. Kalau ada instance lain
 * (atau cron luar) yang baru saja jalan, baris tidak ikut terpilih dan
 * putaran ini dilewati — jadi tidak pernah dobel.
 */
async function ambilGiliran(nama, detik) {
  await q(`INSERT INTO jadwal (nama) VALUES ($1) ON CONFLICT (nama) DO NOTHING`, [nama]);
  const r = await one(
    `UPDATE jadwal SET last_run = now()
     WHERE nama = $1
       AND (last_run IS NULL OR last_run < now() - make_interval(secs => $2))
     RETURNING nama`, [nama, detik]);
  return !!r;
}

async function catat(nama, teks) {
  await q(`UPDATE jadwal SET last_note = $2 WHERE nama = $1`, [nama, String(teks).slice(0, 400)])
    .catch(() => {});
}

export async function sekaliPutaran({ paksa = false } = {}) {
  await ensureSchema();
  const detik = MENIT() * 60 - 20;   // toleransi 20 detik agar tidak terlewat
  if (!paksa && !(await ambilGiliran('sinkron', detik))) return { dilewati: true };

  const ringkas = [];
  try {
    const { jalankanAntrean } = await import('./queue');
    const a = await jalankanAntrean({ maks: 40, budgetMs: 15000 });
    ringkas.push(`antrean ${a.selesai} selesai`);
  } catch (e) { ringkas.push(`antrean gagal: ${e.message}`); }

  try {
    const { sinkronSemua } = await import('./sync');
    const s = await sinkronSemua({ hariKeBelakang: 3 });   // 3 hari, disaring update_time
    const p = s.reduce((n, x) => n + (x.pesanan || 0), 0);
    const gagal = s.filter((x) => !x.ok).length;
    ringkas.push(`${p} pesanan${gagal ? `, ${gagal} toko gagal` : ''}`);
  } catch (e) { ringkas.push(`sinkron gagal: ${e.message}`); }

  try {
    // Tanggal pencairan datang dari endpoint terpisah (get_escrow_list) dan
    // riwayatnya panjang, jadi disapu sedikit-sedikit tiap putaran. Tanpa
    // ini Laporan Mingguan tidak akan pernah terisi.
    const { sapuCairSemua } = await import('./sync');
    const c = await sapuCairSemua({ potongan: 2, hariPerPotong: 7 });
    const t = c.reduce((n, x) => n + (x.terisi || 0), 0);
    const g = c.filter((x) => !x.ok).length;
    if (t || g) ringkas.push(`tanggal cair ${t}${g ? `, ${g} toko gagal` : ''}`);
  } catch (e) { ringkas.push(`tanggal cair gagal: ${e.message}`); }

  try {
    // Retur: sapuan maju tiap putaran (retur baru punya tenggat), plus
    // satu potong riwayat mundur supaya lama-lama habis sendiri tanpa
    // perlu ditekan manual berulang kali.
    const { sapuReturSemua } = await import('./retur');
    const rt = await sapuReturSemua();
    const nRt = rt.reduce((a, x) => a + (x.tersimpan || 0), 0);
    const gRt = rt.filter((x) => !x.ok).length;
    if (nRt || gRt) ringkas.push(`retur ${nRt}${gRt ? `, ${gRt} toko gagal` : ''}`);
  } catch (e) { ringkas.push(`retur gagal: ${e.message}`); }

  try {
    const { tarikLogistikSemua } = await import('./logistik');
    const l = await tarikLogistikSemua();
    const r = l.reduce((a, x) => a + (x.resi || 0), 0);
    const j = l.reduce((a, x) => a + (x.jejak || 0), 0);
    if (r || j) ringkas.push(`${r} resi, ${j} jejak`);
  } catch (e) { ringkas.push(`logistik gagal: ${e.message}`); }

  try {
    const { tarikIklanSemua } = await import('./iklan');
    const i = await tarikIklanSemua({ hariKeBelakang: 3 });
    const okI = i.filter((x) => x.ok).length;
    if (i.length) ringkas.push(`iklan ${okI}/${i.length} toko`);
  } catch (e) { ringkas.push(`iklan gagal: ${e.message}`); }

  /**
   * Biaya iklan PER PRODUK punya giliran sendiri, sejam sekali.
   *
   * Sengaja tidak ikut putaran 5 menit: endpoint Ads batas lajunya jauh
   * lebih ketat (panggilan keenam dengan jeda 350ms sudah ditolak), dan
   * sekali tarik butuh belasan panggilan per toko dengan jeda 1,5 detik.
   * Menjalankannya tiap 5 menit akan menghabiskan jatah laju tanpa guna —
   * angka iklan tidak berubah secepat itu.
   */
  try {
    if (await ambilGiliran('iklan-item', 3600 - 60)) {
      const { tarikIklanItemSemua } = await import('./iklan-item');
      const ii = await tarikIklanItemSemua({ hariKeBelakang: 3 });
      const okII = ii.filter((x) => x.ok).length;
      if (ii.length) ringkas.push(`iklan/produk ${okII}/${ii.length} toko`);
    }
  } catch (e) { ringkas.push(`iklan/produk gagal: ${e.message}`); }

  /**
   * Sidik pembeli & pembersihan data pribadi.
   *
   * Urutannya penting dan dijaga di dua tempat: sidik diisi lebih dulu di
   * sini, dan pembersihan di lib/pembeli.js menolak menyentuh baris yang
   * sidiknya masih kosong. Kalau username dihapus duluan, riwayat
   * pelanggan untuk pesanan itu hilang selamanya.
   */
  try {
    const { isiPembeliId, isiPembeliIdRetur, bersihkanPrivasi } = await import('./pembeli');
    const sd = await isiPembeliId({ batas: 3000 });
    await isiPembeliIdRetur({ batas: 1000 });
    if (sd.terisi) ringkas.push(`sidik pembeli ${sd.terisi}${sd.sisa ? ` (sisa ${sd.sisa})` : ''}`);
    // Pembersihan hanya sekali sehari, dan baru jalan kalau sidik sudah
    // tuntas — supaya penarikan riwayat lama yang masih berjalan tidak
    // keburu kehilangan usernamenya.
    if (!sd.sisa && await ambilGiliran('privasi', 24 * 3600 - 300)) {
      const br = await bersihkanPrivasi({ batas: 20000 });
      if (br.pesanan || br.retur) {
        ringkas.push(`privasi ${br.pesanan} pesanan${br.retur ? `, ${br.retur} retur` : ''}`
          + (br.sisa ? ` (sisa ${br.sisa})` : ''));
      }
    }
  } catch (e) { ringkas.push(`privasi gagal: ${e.message}`); }

  // TikTok: tarik pesanan 3 hari terakhir. Ringan, karena line_items ikut
  // di hasil pencarian — tidak ada panggilan detail per pesanan.
  try {
    const { putarTiktok } = await import('./tiktok-sync');
    const tt = await putarTiktok({ hari: 3 });
    if (tt.length) ringkas.push(`tiktok: ${tt.join('; ')}`);
  } catch (e) { /* toko TikTok belum tentu ada; jangan menggagalkan putaran */ }

  /**
   * Statement & transaksi TikTok SEJAM SEKALI. Dulu statement hanya
   * ditarik saat tombol "Tarik" ditekan, jadi Laporan Keuangan TikTok akan
   * berhenti di hari terakhir seseorang ingat menekannya. Statement terbit
   * sehari sekali, jadi sejam sekali sudah jauh dari cukup.
   */
  try {
    if (await ambilGiliran('tiktok_keuangan', 3600 - 60)) {
      const catatanTt = [];
      const { tokoTiktok } = await import('./tiktok');
      const { tarikStatementTiktok } = await import('./tiktok-sync');
      const { tarikTransaksiTiktok } = await import('./tiktok-keuangan');
      for (const t of (await tokoTiktok()).filter((x) => x.status === 'active')) {
        try {
          await tarikStatementTiktok(t.shop_id, { halaman: 2, detik: 15 });
          const tx = await tarikTransaksiTiktok(t.shop_id, { detik: 30 });
          const teks = `tiktok keuangan ${t.shop_name || t.shop_id}: ${tx.statement} statement, `
            + `${tx.baris} transaksi${tx.sisa ? `, sisa ${tx.sisa}` : ''}`
            + (tx.meleset ? `, ${tx.meleset} tidak cocok jumlahnya` : '')
            + (tx.galat ? `, GALAT: ${tx.galat}` : '');
          ringkas.push(teks); catatanTt.push(teks);
        } catch (e) {
          ringkas.push(`tiktok keuangan gagal: ${e.message}`);
          catatanTt.push(`GAGAL ${t.shop_name || t.shop_id}: ${e.message}`);
        }
      }
      // Catatan sendiri, karena catatan 'sinkron' tertimpa tiap 5 menit —
      // hasil penarikan yang cuma sejam sekali tidak boleh hilang begitu.
      await catat('tiktok_keuangan', catatanTt.join(' · ') || 'tidak ada toko TikTok aktif');
    }
  } catch (e) {
    await catat('tiktok_keuangan', `GAGAL sebelum mulai: ${e.message}`).catch(() => {});
  }

  try {
    const { putarSemua } = await import('./boost');
    const b = await putarSemua();
    if (b.length) ringkas.push(`boost ${b.length} toko`);
  } catch (e) { ringkas.push(`boost gagal: ${e.message}`); }

  await catat('sinkron', ringkas.join(' · '));
  return { dilewati: false, ringkas: ringkas.join(' · ') };
}

export function mulaiPenjadwal() {
  if (hidup) return;
  hidup = true;
  const jeda = MENIT() * 60 * 1000;

  // Jangan langsung jalan saat server baru hidup — beri waktu koneksi DB siap.
  setTimeout(() => { sekaliPutaran().catch((e) => console.error('[penjadwal]', e.message)); }, 25000);
  setInterval(() => { sekaliPutaran().catch((e) => console.error('[penjadwal]', e.message)); }, jeda);

  console.log(`[penjadwal] hidup, tiap ${MENIT()} menit`);
  log('penjadwal', `Penjadwal internal hidup, tiap ${MENIT()} menit`).catch(() => {});
}

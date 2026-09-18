import { NextResponse } from 'next/server';
import { ensureSchema, q, one } from '@/lib/db';
import { call, tidur } from '@/lib/shopee';
import { EP, JEDA_MS } from '@/lib/endpoints';
import { tokenHidup, tokoAktif } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * ── Kenapa retur terbaca dari Shopee tapi tabelnya kosong ──
 *
 * Rute ini TIDAK MENGUBAH APA PUN.
 *
 * Yang sudah pasti dari pemeriksaan sebelumnya:
 *   - get_return_list JALAN. Tanpa saringan waktu, retur asli terbaca dan
 *     nama fieldnya cocok dengan yang ditulis simpanRetur().
 *   - Batas rentangnya 15 hari, dinyatakan Shopee sendiri lewat error_param.
 *   - Tabel returns tetap 0 baris walau sapuan mengaku selesai untuk 8 toko.
 *   - Rexy punya retur 11 dan 19 Juli 2026 — di dalam wilayah yang SUDAH
 *     disapu — tapi sapuan menemukan nol.
 *
 * Yang diuji di sini, dan ini yang menentukan bentuk perbaikannya:
 *
 *   A. Apakah saringan create_time benar-benar mengembalikan retur yang
 *      ada di dalam jendelanya? Diuji dengan cara yang tidak bisa meleset:
 *      ambil retur sungguhan beserta create_time-nya dari panggilan tanpa
 *      saringan, lalu minta jendela sempit tepat di sekitar tanggal itu.
 *      Kalau return_sn yang sama tidak muncul, saringannya yang rusak dan
 *      seluruh mesin pemotong 15-hari sia-sia.
 *
 *   B. Seberapa dalam paginasi tanpa saringan bisa menembus? Kalau bisa
 *      menembus seluruh riwayat, saringan waktu tidak dibutuhkan sama
 *      sekali — cukup halaman demi halaman, dan itu jauh lebih sederhana
 *      sekaligus menutup lubang riwayat sebelum Mei 2026.
 *
 * Pakai:
 *   /api/diagnosa-retur?toko=1521612241     → Rexy, paling sedikit returnya
 *   /api/diagnosa-retur?toko=1522345014     → Medcare
 *   /api/diagnosa-retur?halaman=15          → uji paginasi lebih dalam
 */

const HARI = 86400;
const ringkas = (x) => {
  try { return JSON.parse(JSON.stringify(x)); } catch { return String(x); }
};
/** Detik unix → tanggal. Menolak Infinity dan NaN: Math.min/max atas
 *  daftar kosong menghasilkan Infinity, dan new Date(Infinity) melempar
 *  galat yang menjatuhkan seluruh rute sebelum hasil ujinya sempat
 *  ditampilkan. Itu yang terjadi di versi sebelumnya. */
const tglBaca = (detik) => {
  const n = Number(detik);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Detik terkecil/terbesar dari daftar, atau null kalau daftarnya kosong. */
const rentangWaktu = (daftar) => {
  const angka = daftar.map((x) => Number(x.create_time)).filter((n) => Number.isFinite(n) && n > 0);
  return angka.length ? { min: Math.min(...angka), maks: Math.max(...angka) } : null;
};

async function ambil(shopId, token, params) {
  try {
    const json = await call(EP.returList, { accessToken: token, shopId, params });
    const resp = json.response || {};
    const daftar = Array.isArray(resp.return) ? resp.return : [];
    return { ok: true, daftar, more: resp.more ?? null };
  } catch (e) {
    return { ok: false, pesan: e.message, kode: e.shopeeCode || null, detail: ringkas(e.respons) };
  } finally {
    await tidur(JEDA_MS);
  }
}

export async function GET(req) {
  try {
    await ensureSchema();
    const u = new URL(req.url).searchParams;
    const pilih = u.get('toko') ? Number(u.get('toko')) : null;
    const maksHalaman = Math.min(Math.max(Number(u.get('halaman')) || 8, 1), 30);

    const toko = await tokoAktif();
    const t = pilih ? toko.find((x) => Number(x.shop_id) === pilih) : toko[0];
    if (!t) return NextResponse.json({ ok: false, error: 'Toko tidak ketemu' }, { status: 400 });

    const shopId = Number(t.shop_id);
    const token = await tokenHidup(shopId);
    const hasil = {
      toko: { shop_id: shopId, nama: t.shop_name },
      isi_tabel_returns: await one(
        `SELECT COUNT(*)::int AS baris FROM returns WHERE shop_id = $1`, [shopId]),
    };

    /**
     * ── B0. Batas page_size ──
     *
     * page_size 100 memulangkan NOL baris TANPA GALAT, sementara 50
     * memulangkan data. Shopee tidak menolak, cuma diam-diam kosong —
     * jenis kegagalan yang paling berbahaya karena terlihat seperti
     * "memang tidak ada retur". Diuji tiap kali supaya batasnya
     * terdokumentasi dari perilaku nyata, bukan dari dokumentasi.
     */
    hasil.B0_batas_page_size = {};
    for (const ukuran of [20, 50, 100]) {
      const r = await ambil(shopId, token, { page_no: 1, page_size: ukuran });
      hasil.B0_batas_page_size[`page_size_${ukuran}`] = r.ok
        ? { jumlah: r.daftar.length, more: r.more }
        : { gagal: r.pesan, kode: r.kode };
    }

    // ── B. Paginasi tanpa saringan waktu ────────────────────────────
    // page_size DIPAKU 50. Jangan dinaikkan: lihat B0 di atas.
    const UKURAN = 50;
    const semua = [];
    const halaman = [];
    const snTerlihat = new Set();
    for (let hal = 1; hal <= maksHalaman; hal++) {
      const r = await ambil(shopId, token, { page_no: hal, page_size: UKURAN });
      if (!r.ok) {
        halaman.push({ halaman: hal, gagal: r.pesan, kode: r.kode });
        break;
      }
      const baru = r.daftar.filter((x) => x.return_sn && !snTerlihat.has(x.return_sn));
      for (const x of r.daftar) if (x.return_sn) snTerlihat.add(x.return_sn);
      semua.push(...r.daftar);
      halaman.push({
        halaman: hal,
        jumlah: r.daftar.length,
        baru: baru.length,
        more: r.more,
        create_time_awal: tglBaca(r.daftar[0]?.create_time),
        create_time_akhir: tglBaca(r.daftar[r.daftar.length - 1]?.create_time),
      });
      if (!r.more || !r.daftar.length) break;
    }
    hasil.B_paginasi_tanpa_saringan = {
      halaman_diambil: halaman.length,
      total_baris: semua.length,
      return_sn_unik: snTerlihat.size,
      // Kalau baris terus datang tapi return_sn unik berhenti bertambah,
      // berarti Shopee memutar halaman yang sama — paginasinya buntu.
      halaman,
      terlama: tglBaca(rentangWaktu(semua)?.min),
      terbaru: tglBaca(rentangWaktu(semua)?.maks),
    };

    // ── A. Uji saringan create_time pada retur yang SUDAH DIKETAHUI ──
    const contoh = semua
      .filter((x) => Number(x.create_time) > 0)
      .sort((a, b) => a.create_time - b.create_time);
    const pilihUji = [];
    if (contoh.length) {
      pilihUji.push(contoh[0]);
      if (contoh.length > 2) pilihUji.push(contoh[Math.floor(contoh.length / 2)]);
      if (contoh.length > 1) pilihUji.push(contoh[contoh.length - 1]);
    }

    hasil.A_uji_saringan = [];
    for (const c of pilihUji) {
      const t0 = Number(c.create_time);
      // Jendela 7 hari, retur ini tepat di tengahnya. Jauh di bawah batas
      // 15 hari, jadi tidak mungkin ditolak karena lebar.
      const dari = t0 - 3 * HARI;
      const sampai = t0 + 4 * HARI;
      const r = await ambil(shopId, token, {
        page_no: 1, page_size: UKURAN,
        create_time_from: dari, create_time_to: sampai,
      });
      hasil.A_uji_saringan.push({
        return_sn_yang_dicari: c.return_sn,
        create_time: tglBaca(t0),
        jendela: `${tglBaca(dari)} s/d ${tglBaca(sampai)}`,
        ok: r.ok,
        pesan: r.pesan, kode: r.kode,
        jumlah_dikembalikan: r.ok ? r.daftar.length : null,
        KETEMU: r.ok ? r.daftar.some((x) => x.return_sn === c.return_sn) : null,
        sn_yang_dikembalikan: r.ok ? r.daftar.slice(0, 10).map((x) => x.return_sn) : null,
      });
    }

    // Uji tambahan: jendela yang sama persis, tapi dengan create_time_to
    // dibuat jauh lebih besar dari create_time_from secara terbalik —
    // untuk memastikan urutan parameternya tidak tertukar di kode kita.
    if (pilihUji.length) {
      const t0 = Number(pilihUji[pilihUji.length - 1].create_time);
      const r = await ambil(shopId, token, {
        page_no: 1, page_size: UKURAN,
        create_time_from: t0 - 14 * HARI, create_time_to: t0,
      });
      hasil.A_uji_batas_persis = {
        keterangan: 'jendela 14 hari yang BERAKHIR tepat di create_time retur itu',
        return_sn_yang_dicari: pilihUji[pilihUji.length - 1].return_sn,
        ok: r.ok, pesan: r.pesan, kode: r.kode,
        jumlah_dikembalikan: r.ok ? r.daftar.length : null,
        KETEMU: r.ok
          ? r.daftar.some((x) => x.return_sn === pilihUji[pilihUji.length - 1].return_sn)
          : null,
      };
    }

    const ujiOk = hasil.A_uji_saringan.filter((x) => x.ok);
    const ujiKetemu = ujiOk.filter((x) => x.KETEMU);
    hasil.kesimpulan = !hasil.A_uji_saringan.length
      ? 'TIDAK ADA uji saringan yang dijalankan, karena paginasi tidak memulangkan '
        + 'satu pun retur untuk diuji. Periksa B0 dulu — kalau page_size tertentu '
        + 'memulangkan nol tanpa galat, itu masalahnya, bukan saringan waktunya.'
      : !ujiOk.length
      ? 'Semua uji saringan ditolak — lihat kode galatnya.'
      : ujiKetemu.length === ujiOk.length
        ? 'Saringan create_time BEKERJA. Berarti sapuan menemukan nol bukan karena '
          + 'saringannya, melainkan karena wilayah yang disapu salah — batas bawahnya '
          + 'MIN(orders.created_time) yang cuma sampai Mei 2026, jauh lebih muda '
          + 'daripada riwayat retur yang sebenarnya.'
        : ujiKetemu.length === 0
          ? 'Saringan create_time TIDAK mengembalikan retur yang jelas ada di dalam '
            + 'jendelanya. Seluruh mesin pemotong 15-hari sia-sia; penarikan harus '
            + 'pindah ke paginasi tanpa saringan.'
          : 'Saringan bekerja SEBAGIAN — periksa uji mana yang gagal, kemungkinan '
            + 'ada batas usia data yang tidak disebutkan di dokumentasi.';

    return NextResponse.json(hasil, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e.message, stack: String(e.stack || '').slice(0, 600) },
      { status: 500 });
  }
}

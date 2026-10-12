import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { call, tidur } from '@/lib/shopee';
import { EP } from '@/lib/endpoints';
import { tokenHidup, tokoAktif } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * ── Banding hari-per-hari: GMV Max vs belanja toko ──
 *
 * Rute ini TIDAK MENGUBAH APA PUN. Baca saja.
 *
 * Kenapa ada: hasil diagnosa sebelumnya menunjukkan pola yang terlalu rapi
 * untuk kebetulan. Empat toko dengan skala belanja jauh berbeda semuanya
 * melaporkan belanja GMV Max sekitar 13–14,5% dari belanja tokonya, pada
 * permintaan rentang TUJUH hari. 1/7 = 14,3%.
 *
 * Dugaan yang diuji: get_gms_item_performance MENGABAIKAN rentang dan hanya
 * memulangkan satu hari, walau start_date & end_date diterima tanpa protes.
 * Kalau benar, belanja GMV Max tidak hilang — cuma terbaca sehari, dan
 * perbaikannya sederhana (panggil per hari, seperti backfill hourly dulu).
 *
 * Sekalian menutup satu lubang lain: bentuk MENTAH balasan
 * get_all_cpc_ads_daily_performance belum pernah dilihat langsung. Selama ini
 * isinya cuma disapu longgar oleh penebak array, jadi angka "belanja_toko"
 * yang dipakai sebagai pembanding sendiri belum pernah diverifikasi. Kalau
 * pembandingnya salah, seluruh kesimpulan ikut salah.
 *
 * Yang dilakukan, untuk SATU toko:
 *   1. adsDaily rentang penuh — balasan mentah ikut ditampilkan
 *   2. GMS rentang penuh (satu panggilan)
 *   3. GMS per hari (satu panggilan tiap hari), lalu dijumlahkan
 *   4. Ketiganya dibandingkan, dan kesimpulannya ditulis otomatis
 *
 * Pakai:
 *   /api/diagnosa-iklan-harian?shop_id=95236895          → G Hunter, 7 hari
 *   /api/diagnosa-iklan-harian?shop_id=1522345014&hari=7 → Medcare (yang 100%)
 *   /api/diagnosa-iklan-harian?shop_id=64712993          → Humaira (tanpa GMS)
 */

const JEDA_ADS = 1500;
const MUNDUR = [3000, 8000, 20000];

const tglShopee = (d) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.day}-${p.month}-${p.year}`;
};

const ringkas = (x) => {
  try { return JSON.parse(JSON.stringify(x)); } catch { return String(x); }
};

const angka = (...c) => {
  for (const x of c) {
    const n = Number(x);
    if (Number.isFinite(n) && x !== null && x !== undefined && x !== '') return n;
  }
  return 0;
};

const rupiah = (n) => Math.round(Number(n) || 0);

async function panggilAds(fn) {
  let terakhir = null;
  for (let i = 0; i <= MUNDUR.length; i++) {
    try {
      const hasil = await fn();
      await tidur(JEDA_ADS);
      return hasil;
    } catch (e) {
      terakhir = e;
      const batas = e.kind === 'rate_limit' || String(e.shopeeCode || '').includes('rate_limit');
      if (!batas || i === MUNDUR.length) break;
      await tidur(MUNDUR[i]);
    }
  }
  await tidur(JEDA_ADS);
  throw terakhir;
}

async function coba(fn) {
  try {
    return { ok: true, balasan: await panggilAds(fn) };
  } catch (e) {
    return { ok: false, pesan: e.message, kode: e.shopeeCode || null, detail: ringkas(e.respons) || null };
  }
}

function cariArray(obj, kunci, dalam = 0) {
  if (!obj || dalam > 5) return null;
  if (Array.isArray(obj)) {
    return obj.some((x) => x && typeof x === 'object' && kunci in x) ? obj : null;
  }
  if (typeof obj !== 'object') return null;
  for (const v of Object.values(obj)) {
    const hasil = cariArray(v, kunci, dalam + 1);
    if (hasil) return hasil;
  }
  return null;
}

/** Satu panggilan GMS. Dipakai untuk rentang penuh maupun satu hari. */
async function gms(shopId, token, start_date, end_date) {
  const r = await coba(() => call(EP.adsGmsItem, {
    accessToken: token, shopId,
    body: { start_date, end_date, offset: 0, limit: 100 },
  }));
  if (!r.ok) return { ok: false, pesan: r.pesan, kode: r.kode };
  const resp = r.balasan?.response || {};
  const list = cariArray(resp, 'item_id') || [];
  return {
    ok: true,
    campaign_id: resp.campaign_id ?? null,
    item: list.length,
    expense: rupiah(list.reduce((s, b) => s + angka(b?.report?.expense), 0)),
    ada_halaman_lagi: resp.has_next_page ?? null,
  };
}

/** Dua angka dianggap sama kalau selisihnya di bawah 1%. */
const miripDengan = (a, b) => {
  if (!a && !b) return true;
  const besar = Math.max(Math.abs(a), Math.abs(b));
  return besar ? Math.abs(a - b) / besar < 0.01 : true;
};

export async function GET(req) {
  try {
    await ensureSchema();
    const u = new URL(req.url).searchParams;

    const toko = await tokoAktif();
    const shopId = Number(u.get('shop_id')) || Number(toko[0]?.shop_id);
    const namaToko = toko.find((t) => Number(t.shop_id) === shopId)?.shop_name || null;
    if (!shopId) return NextResponse.json({ ok: false, error: 'Tidak ada toko' }, { status: 400 });

    const hari = Math.min(Math.max(Number(u.get('hari')) || 7, 2), 14);
    const kini = new Date();
    const mulai = new Date(kini.getTime() - (hari - 1) * 86400000);
    const start_date = tglShopee(mulai);
    const end_date = tglShopee(kini);

    const token = await tokenHidup(shopId);

    // ── 1. Belanja toko, rentang penuh, DENGAN balasan mentah ───────
    const rDaily = await coba(() => call(EP.adsDaily, {
      accessToken: token, shopId, params: { start_date, end_date },
    }));
    let tokoPerHari = [];
    let tokoTotal = 0;
    let bentukMentah = null;
    if (rDaily.ok) {
      const resp = rDaily.balasan?.response ?? rDaily.balasan;
      // Dipotong supaya balasan rute ini tetap terbaca, tapi cukup panjang
      // untuk melihat BENTUKNYA — itu inti pemeriksaan ini.
      bentukMentah = JSON.stringify(ringkas(resp)).slice(0, 2500);
      const b = cariArray(resp, 'expense') || cariArray(resp, 'date') || [];
      tokoPerHari = b.map((x) => ({
        tanggal: x.date ?? x.day ?? x.stat_date ?? null,
        expense: rupiah(angka(x.expense, x.total_expense, x.cost)),
      }));
      tokoTotal = tokoPerHari.reduce((s, x) => s + x.expense, 0);
    }

    // ── 2. GMS rentang penuh ────────────────────────────────────────
    const gmsRentang = await gms(shopId, token, start_date, end_date);

    // ── 3. GMS per hari ─────────────────────────────────────────────
    const gmsHarian = [];
    let gmsJumlahHarian = 0;
    for (let i = 0; i < hari; i++) {
      const d = tglShopee(new Date(mulai.getTime() + i * 86400000));
      const h = await gms(shopId, token, d, d);
      if (h.ok) {
        gmsHarian.push({ tanggal: d, item: h.item, expense: h.expense, campaign_id: h.campaign_id });
        gmsJumlahHarian += h.expense;
      } else {
        gmsHarian.push({ tanggal: d, gagal: h.pesan, kode: h.kode });
      }
    }

    // ── 4. Kesimpulan otomatis ──────────────────────────────────────
    const rentangExp = gmsRentang.ok ? gmsRentang.expense : 0;
    const samaDenganSalahSatuHari = gmsHarian.some((h) => h.expense !== undefined
      && h.expense > 0 && miripDengan(h.expense, rentangExp));
    const nilaiHarian = gmsHarian.filter((h) => h.expense !== undefined).map((h) => h.expense);
    const hariBerbelanja = nilaiHarian.filter((x) => x > 0).length;

    const temuan = [];
    if (!gmsRentang.ok) {
      temuan.push(`GMS gagal untuk toko ini (${gmsRentang.kode}). Belanja Rp `
        + `${rupiah(tokoTotal).toLocaleString('id-ID')} berarti berasal dari jenis iklan `
        + 'lain yang tidak punya campaign produk — bagian ini tidak akan pernah '
        + 'bisa dipetakan ke SKU lewat endpoint GMS.');
    } else {
      if (samaDenganSalahSatuHari && hariBerbelanja > 1) {
        temuan.push('TERBUKTI: angka rentang penuh sama dengan angka SATU HARI, '
          + 'padahal ada beberapa hari yang berbelanja. Jadi GMS mengabaikan '
          + 'rentang. Perbaikannya: selalu panggil per hari, jangan pernah '
          + 'memakai rentang panjang.');
      } else if (miripDengan(gmsJumlahHarian, rentangExp)) {
        temuan.push('Jumlah per hari SAMA dengan angka rentang penuh — rentang '
          + 'dihormati Shopee. Dugaan "cuma terbaca sehari" GUGUR, dan selisih '
          + 'terhadap belanja toko berarti memang jenis iklan lain.');
      } else {
        temuan.push('Jumlah per hari BERBEDA dari angka rentang penuh — Shopee '
          + 'menghitung ulang atribusi per rentang. Kalau begitu, biaya harian '
          + 'per item tidak bisa dipercaya begitu saja dan harus disimpan '
          + 'dengan rentang yang tetap.');
      }
      if (miripDengan(gmsJumlahHarian, tokoTotal)) {
        temuan.push('Jumlah GMS per hari MENUTUP belanja toko — artinya seluruh '
          + 'belanja toko ini memang GMV Max produk, dan biaya iklan per SKU '
          + 'bisa dibangun penuh untuk toko ini.');
      } else if (tokoTotal) {
        const pct = Number(((gmsJumlahHarian / tokoTotal) * 100).toFixed(1));
        temuan.push(`Setelah dijumlah per hari, GMS menutup ${pct}% belanja toko. `
          + `Sisa Rp ${rupiah(tokoTotal - gmsJumlahHarian).toLocaleString('id-ID')} `
          + 'berasal dari iklan di luar GMV Max produk.');
      }
    }

    return NextResponse.json({
      ok: true,
      toko: { shop_id: shopId, nama: namaToko },
      periode: `${start_date} s/d ${end_date} (${hari} hari)`,
      catatan: 'Rute ini tidak mengubah data apa pun. Aman diulang.',

      belanja_toko: {
        ok: rDaily.ok,
        pesan: rDaily.pesan,
        total: rupiah(tokoTotal),
        jumlah_baris_terbaca: tokoPerHari.length,
        per_hari: tokoPerHari,
        // Ini yang belum pernah dilihat langsung. Kalau jumlah_baris_terbaca
        // bukan sebanyak hari yang diminta, berarti penebak array selama ini
        // mengambil array yang salah dan angka pembandingnya keliru.
        bentuk_mentah_dipotong: bentukMentah,
      },

      gms_rentang_penuh: gmsRentang,
      gms_per_hari: gmsHarian,
      gms_jumlah_per_hari: rupiah(gmsJumlahHarian),

      banding: {
        gms_rentang_penuh: rupiah(rentangExp),
        gms_jumlah_per_hari: rupiah(gmsJumlahHarian),
        belanja_toko: rupiah(tokoTotal),
        hari_yang_berbelanja: hariBerbelanja,
        rentang_sama_dengan_satu_hari: samaDenganSalahSatuHari,
      },

      temuan,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { ensureSchema, q } from '@/lib/db';
import { call, tidur } from '@/lib/shopee';
import { EP } from '@/lib/endpoints';
import { tokenHidup, tokoAktif } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * ── Diagnosa: bisakah biaya iklan dipetakan ke PRODUK? ──
 *
 * Rute ini TIDAK MENGUBAH APA PUN. Semua panggilannya baca saja.
 *
 * Versi 4. Titik beratnya PINDAH ke GMV Max, setelah diketahui bahwa seluruh
 * toko beriklan GMV Max dan iklan manual praktis tidak dipakai lagi.
 *
 * Yang mendorong versi ini: angkanya tidak masuk akal.
 *   - G Hunter: get_gms_item_performance melaporkan Rp 3,17jt untuk 7 hari,
 *     padahal belanja toko itu berkisar jutaan PER HARI.
 *   - Humaira, pembelanja terbesar, malah balas "campaign tidak ditemukan"
 *     padahal endpoint level toko jelas melaporkan belanja Rp 29,5jt.
 *
 * Dugaan yang diuji di sini: panggilan get_gms_item_performance TANPA
 * campaign_id hanya mengembalikan SATU campaign — perhatikan balasannya
 * punya `campaign_id` tunggal di tingkat atas, bukan daftar. Kalau benar,
 * masalahnya bukan pemetaan item (itu sudah terbukti jalan) melainkan cara
 * MENDAFTAR seluruh campaign GMV Max milik satu toko.
 *
 * Tiga hal yang diperiksa per toko:
 *   1. campaign_id apa yang dikembalikan get_gms_item_performance tanpa
 *      diberi campaign_id — versi sebelumnya tidak menyimpan field ini,
 *      itu sebabnya dugaan di atas belum bisa dibuktikan.
 *   2. Apakah get_gms_campaign_performance mau dipanggil tanpa campaign_id,
 *      dan apakah ia mengembalikan lebih dari satu campaign. Ini satu-satunya
 *      kandidat pendaftar campaign GMV Max yang belum pernah dicoba.
 *   3. Selisih antara belanja GMS dan belanja level toko pada rentang yang
 *      sama — ini yang mengukur seberapa besar bagian yang hilang.
 *
 * Pakai:
 *   /api/diagnosa-iklan-item?gms=1                 → periksa SEMUA toko (mulai di sini)
 *   /api/diagnosa-iklan-item?gms=1&hari=3
 *   /api/diagnosa-iklan-item?gms=1&shop_id=64712993  → satu toko saja, balasan MENTAH
 *   /api/diagnosa-iklan-item?daftar=1
 *   /api/diagnosa-iklan-item?shop_id=...           → bedah iklan manual (versi lama)
 */

/** Jeda khusus endpoint Ads — terukur dari penolakan nyata, bukan tebakan. */
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

async function coba(nama, fn) {
  try {
    return { nama, ok: true, balasan: await panggilAds(fn) };
  } catch (e) {
    return {
      nama, ok: false, pesan: e.message,
      kode: e.shopeeCode || null,
      detail: ringkas(e.respons) || null,
    };
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

const potong = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const URUT_STATUS = { ongoing: 0, paused: 1, scheduled: 1, ended: 2, closed: 3 };
const peringkat = (s) => {
  const v = URUT_STATUS[String(s || '').toLowerCase()];
  return v === undefined ? 2 : v;
};

/** Belanja level toko — dipakai sebagai pembanding kebenaran. */
async function belanjaToko(shopId, token, start_date, end_date) {
  const r = await coba('adsDaily', () => call(EP.adsDaily, {
    accessToken: token, shopId, params: { start_date, end_date },
  }));
  if (!r.ok) return { ok: false, pesan: r.pesan, total: 0 };
  const b = cariArray(r.balasan?.response, 'expense')
    || cariArray(r.balasan?.response, 'date') || [];
  return {
    ok: true,
    total: rupiah(b.reduce((s, x) => s + angka(x.expense, x.total_expense, x.cost), 0)),
  };
}

export async function GET(req) {
  try {
    await ensureSchema();
    const u = new URL(req.url).searchParams;

    const toko = await tokoAktif();
    if (!toko.length) {
      return NextResponse.json({ ok: false, error: 'Tidak ada toko aktif' }, { status: 400 });
    }
    if (u.get('daftar')) {
      return NextResponse.json({ ok: true, toko: toko.map((t) => ({ shop_id: t.shop_id, nama: t.shop_name })) });
    }

    const hari = Math.min(Math.max(Number(u.get('hari')) || 7, 1), 28);
    const kini = new Date();
    const mulai = new Date(kini.getTime() - (hari - 1) * 86400000);
    const start_date = tglShopee(mulai);
    const end_date = tglShopee(kini);
    const pilihShop = Number(u.get('shop_id')) || null;

    // ══ MODE GMS ═══════════════════════════════════════════════════
    if (u.get('gms')) {
      const target = pilihShop
        ? toko.filter((t) => Number(t.shop_id) === pilihShop)
        : toko;
      const mentah = !!pilihShop; // satu toko → tampilkan balasan apa adanya
      const hasil = [];

      for (const t of target) {
        const shopId = Number(t.shop_id);
        const baris = { shop_id: shopId, nama: t.shop_name };

        let token = null;
        try {
          token = await tokenHidup(shopId);
        } catch (e) {
          hasil.push({ ...baris, status: 'token bermasalah', pesan: e.message });
          continue;
        }

        // ── 1. item_performance TANPA campaign_id ──────────────────
        const item = await coba('get_gms_item_performance tanpa campaign_id', () =>
          call(EP.adsGmsItem, {
            accessToken: token, shopId,
            body: { start_date, end_date, offset: 0, limit: 100 },
          }));

        if (item.ok) {
          const resp = item.balasan?.response || {};
          const list = cariArray(resp, 'item_id') || [];
          baris.item_performance = {
            status: 'BERHASIL',
            // INI yang tidak disimpan di versi sebelumnya, dan justru
            // field inilah yang membuktikan apakah balasannya cuma satu
            // campaign atau seluruh campaign toko.
            campaign_id_yang_dikembalikan: resp.campaign_id ?? null,
            jumlah_item: list.length,
            total_menurut_shopee: resp.total ?? null,
            ada_halaman_lagi: resp.has_next_page ?? null,
            total_expense: rupiah(list.reduce((s, b) => s + angka(b?.report?.expense), 0)),
          };
          if (mentah) baris.item_performance.balasan_mentah = ringkas(resp);
        } else {
          const kode = String(item.kode || '');
          baris.item_performance = {
            status: kode.includes('not_found') ? 'campaign tidak ditemukan'
              : kode.includes('whitelist') ? 'PERLU WHITELIST SHOPEE' : 'gagal',
            kode, pesan: item.pesan, detail: item.detail,
          };
        }

        // ── 2. campaign_performance TANPA campaign_id ──────────────
        //    Kandidat satu-satunya untuk MENDAFTAR campaign GMV Max.
        const camp = await coba('get_gms_campaign_performance tanpa campaign_id', () =>
          call(EP.adsGmsCampaign, {
            accessToken: token, shopId,
            body: { start_date, end_date, offset: 0, limit: 100 },
          }));

        if (camp.ok) {
          const resp = camp.balasan?.response || {};
          const daftar = cariArray(resp, 'campaign_id')
            || (resp.campaign_id ? [resp] : []);
          baris.campaign_performance = {
            status: 'BERHASIL',
            jumlah_campaign_dikembalikan: daftar.length,
            campaign_id: daftar.map((c) => c.campaign_id).slice(0, 20),
            total_expense: rupiah(daftar.reduce(
              (s, c) => s + angka(c?.report?.expense, c?.expense), 0)),
            bentuk_satu_baris: ringkas(daftar[0]) || null,
          };
          if (mentah) baris.campaign_performance.balasan_mentah = ringkas(resp);
        } else {
          baris.campaign_performance = {
            status: 'gagal', kode: camp.kode, pesan: camp.pesan, detail: camp.detail,
          };
        }

        // ── 3. Pembanding: belanja level toko ──────────────────────
        const toko7 = await belanjaToko(shopId, token, start_date, end_date);
        const gmsTotal = baris.item_performance?.total_expense || 0;
        baris.pembanding = {
          belanja_toko: toko7.total,
          belanja_gms_terbaca: gmsTotal,
          selisih: rupiah(toko7.total - gmsTotal),
          persen_terbaca: toko7.total
            ? Number(((gmsTotal / toko7.total) * 100).toFixed(1)) : null,
        };

        hasil.push(baris);
      }

      return NextResponse.json({
        ok: true,
        periode: `${start_date} s/d ${end_date} (${hari} hari)`,
        yang_dicari: [
          'campaign_id_yang_dikembalikan — kalau setiap toko cuma mengembalikan '
          + 'SATU campaign_id, terbukti panggilan tanpa campaign_id memang hanya '
          + 'melihat satu campaign, dan sisanya tidak pernah ikut terhitung.',
          'jumlah_campaign_dikembalikan pada campaign_performance — kalau lebih '
          + 'dari satu, di situlah daftar campaign GMV Max bisa didapat, lalu '
          + 'item_performance dipanggil ulang per campaign_id.',
          'persen_terbaca — seberapa besar belanja yang berhasil ditangkap. '
          + 'Angka kecil di sini menjelaskan kenapa totalnya tidak masuk akal.',
        ],
        per_toko: hasil,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ══ MODE IKLAN MANUAL (dipertahankan dari versi 3) ═════════════
    const shopId = pilihShop || Number(toko[0].shop_id);
    const namaToko = toko.find((t) => Number(t.shop_id) === shopId)?.shop_name || null;
    const maks = Math.min(Math.max(Number(u.get('maks')) || 200, 1), 1000);
    const token = await tokenHidup(shopId);
    const langkah = [];

    const list = await coba('get_product_level_campaign_id_list ad_type=all', () =>
      call(EP.adsCampaignList, {
        accessToken: token, shopId, params: { ad_type: 'all', offset: 0, limit: 5000 },
      }));
    const semuaId = list.ok
      ? (cariArray(list.balasan?.response, 'campaign_id') || []).map((b) => b.campaign_id)
      : [];
    langkah.push({ nama: list.nama, ok: list.ok, pesan: list.pesan, ringkas: { jumlah_campaign: semuaId.length } });
    if (!semuaId.length) {
      return NextResponse.json({ ok: true, toko: { shop_id: shopId, nama: namaToko }, langkah });
    }

    const detail = [];
    const gagalSetting = [];
    for (const grup of potong(semuaId, 100)) {
      const r = await coba('setting_info', () => call(EP.adsCampaignSetting, {
        accessToken: token, shopId,
        params: { campaign_id_list: grup.join(','), info_type_list: '1,2,3,4' },
      }));
      if (!r.ok) { gagalSetting.push({ jumlah: grup.length, pesan: r.pesan, kode: r.kode }); continue; }
      for (const b of (cariArray(r.balasan?.response, 'campaign_id') || [])) {
        const ci = b.common_info || {};
        detail.push({
          campaign_id: b.campaign_id,
          status: ci.campaign_status || null,
          placement: ci.campaign_placement || null,
          item_ids: Array.isArray(ci.item_id_list) ? ci.item_id_list : [],
        });
      }
    }

    const sebaranStatus = {};
    for (const d of detail) {
      const s = d.status || '(kosong)';
      sebaranStatus[s] = (sebaranStatus[s] || 0) + 1;
    }
    langkah.push({
      nama: 'setting_info — SELURUH campaign manual',
      ok: !!detail.length,
      ringkas: {
        campaign_terbaca: detail.length,
        punya_item: detail.filter((d) => d.item_ids.length).length,
        sebaran_status: sebaranStatus,
        batch_gagal: gagalSetting,
      },
    });

    const antre = detail
      .filter((d) => String(d.status || '').toLowerCase() !== 'closed')
      .sort((a, b) => peringkat(a.status) - peringkat(b.status))
      .slice(0, maks);
    const petaItem = new Map(detail.map((d) => [String(d.campaign_id), d.item_ids]));
    const petaStatus = new Map(detail.map((d) => [String(d.campaign_id), d.status]));

    let totalCampaign = 0;
    const perCampaign = [];
    const perStatus = {};
    const gagalDaily = [];
    for (const grup of potong(antre.map((d) => d.campaign_id), 100)) {
      const r = await coba('daily_performance', () => call(EP.adsCampaignDaily, {
        accessToken: token, shopId,
        params: { start_date, end_date, campaign_id_list: grup.join(',') },
      }));
      if (!r.ok) { gagalDaily.push({ jumlah: grup.length, pesan: r.pesan, kode: r.kode }); continue; }
      for (const c of (cariArray(r.balasan?.response, 'metrics_list') || [])) {
        let e = 0;
        for (const m of (c.metrics_list || [])) e += angka(m.expense);
        totalCampaign += e;
        const st = petaStatus.get(String(c.campaign_id)) || '(?)';
        perStatus[st] = rupiah((perStatus[st] || 0) + e);
        if (e > 0) {
          perCampaign.push({
            campaign_id: c.campaign_id, ad_name: c.ad_name, status: st,
            expense: rupiah(e), item_ids: petaItem.get(String(c.campaign_id)) || [],
          });
        }
      }
    }
    perCampaign.sort((a, b) => b.expense - a.expense);

    const tk = await belanjaToko(shopId, token, start_date, end_date);
    langkah.push({
      nama: 'daily_performance iklan manual + banding belanja toko',
      ok: !gagalDaily.length,
      ringkas: {
        campaign_diantre: antre.length,
        campaign_yang_benar_berbelanja: perCampaign.length,
        total_expense_manual: rupiah(totalCampaign),
        expense_per_status: perStatus,
        belanja_toko: tk.total,
        sisa_bukan_manual: rupiah(tk.total - totalCampaign),
        sepuluh_terbesar: perCampaign.slice(0, 10),
        batch_gagal: gagalDaily,
      },
      arti: 'sisa_bukan_manual itulah yang seharusnya berasal dari GMV Max. '
        + 'Bandingkan dengan hasil ?gms=1 pada rentang yang sama.',
    });

    const semuaItem = [...new Set(perCampaign.flatMap((c) => c.item_ids))].map(Number);
    let cocok = [];
    if (semuaItem.length) {
      cocok = await q(
        `SELECT p.item_id, p.item_sku, p.name,
                (SELECT COUNT(*)::int FROM product_models pm WHERE pm.product_id = p.id) AS jumlah_variasi
         FROM products p
         WHERE p.shop_id = $1 AND p.item_id = ANY($2::bigint[])`,
        [shopId, semuaItem]);
    }
    langkah.push({
      nama: 'Item yang diiklankan vs katalog',
      ok: true,
      ringkas: {
        item_diiklankan: semuaItem.length,
        ketemu_di_products: cocok.length,
        punya_lebih_dari_satu_variasi: cocok.filter((c) => Number(c.jumlah_variasi) > 1).length,
      },
    });

    return NextResponse.json({
      ok: true,
      toko: { shop_id: shopId, nama: namaToko },
      periode: `${start_date} s/d ${end_date} (${hari} hari)`,
      catatan: 'Rute ini tidak mengubah data apa pun. Aman diulang.',
      langkah,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

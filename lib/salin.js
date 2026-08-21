import { q, one, log } from './db';
import { call, callMultipart, tidur } from './shopee';
import { EP, JEDA_MS } from './endpoints';
import { tokenHidup } from './tokens';

/**
 * ── Mesin salin listing antar toko ──
 *
 * Urutannya:
 *   1. Baca produk sumber (info dasar + varian)
 *   2. Unduh tiap gambar, unggah ulang lewat media_space → dapat image_id
 *   3. Ambil daftar kurir toko tujuan (tiap toko beda yang diaktifkan)
 *   4. add_item di toko tujuan
 *   5. Kalau ada varian: init_tier_variation
 *
 * Shopee menuntut banyak field wajib yang berbeda per kategori, jadi
 * kegagalan pertama itu wajar. Pesan error dari Shopee disimpan apa
 * adanya di tabel jobs supaya bisa diperbaiki dengan tepat.
 */

const angka = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

/** Unduh gambar dari URL Shopee lalu unggah ulang. Kembaliannya image_id. */
async function unggahGambar(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal mengunduh gambar (HTTP ${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const tipe = res.headers.get('content-type') || 'image/jpeg';

  const json = await callMultipart(EP.uploadImage, {
    bytes, tipe, namaBerkas: 'produk.jpg', field: 'image', params: { scene: 'normal' },
  });
  const info = json.response?.image_info || json.response?.image_info_list?.[0]?.image_info || json.response;
  const id = info?.image_id || info?.image_url_list?.[0]?.image_id;
  if (!id) throw new Error('Balasan unggah gambar tidak berisi image_id');
  return id;
}

async function kurirAktif(shopId) {
  const token = await tokenHidup(shopId);
  const json = await call(EP.channelList, { accessToken: token, shopId });
  const daftar = json.response?.logistics_channel_list || [];
  return daftar
    .filter((c) => c.enabled)
    .map((c) => ({ logistic_id: c.logistics_channel_id, enabled: true }));
}

/** Ambil detail lengkap produk sumber dari Shopee (bukan dari salinan lokal). */
async function bacaSumber(shopId, itemId) {
  const token = await tokenHidup(shopId);
  const dasar = await call(EP.itemBaseInfo, {
    accessToken: token, shopId,
    params: { item_id_list: String(itemId), need_complaint_policy: 'false', need_tax_info: 'false' },
  });
  const item = dasar.response?.item_list?.[0];
  if (!item) throw new Error(`Produk ${itemId} tidak ditemukan di toko sumber`);

  let model = [], tier = [];
  if (item.has_model) {
    const m = await call(EP.modelList, { accessToken: token, shopId, params: { item_id: itemId } });
    model = m.response?.model || [];
    tier = m.response?.tier_variation || [];
  }
  return { item, model, tier };
}

/** Salin satu produk. Dipanggil dari antrean, satu tugas satu produk. */
export async function salinProduk({ dariShop, keShop, itemId }) {
  const { item, model, tier } = await bacaSumber(dariShop, itemId);
  await tidur(JEDA_MS);

  // 1. Gambar — diunggah satu per satu dengan jeda
  const urlGambar = item.image?.image_url_list || [];
  const imageIds = [];
  for (const u of urlGambar.slice(0, 9)) {
    imageIds.push(await unggahGambar(u));
    await tidur(JEDA_MS);
  }
  if (!imageIds.length) throw new Error('Produk sumber tidak punya gambar yang bisa diunggah ulang');

  // 2. Kurir toko tujuan
  const logistik = await kurirAktif(keShop);
  if (!logistik.length) throw new Error('Toko tujuan belum mengaktifkan satu pun kurir');
  await tidur(JEDA_MS);

  // 3. Buat produk
  const token = await tokenHidup(keShop);
  const d = item.dimension || {};
  const body = {
    original_price: angka(item.price_info?.[0]?.original_price) ?? angka(model[0]?.price_info?.[0]?.original_price) ?? 0,
    description: item.description || item.item_name,
    weight: angka(item.weight) || 0.1,
    item_name: item.item_name,
    item_status: 'UNLIST',              // sengaja nonaktif dulu, biar kamu periksa sebelum tayang
    dimension: {
      package_length: angka(d.package_length) || 1,
      package_width:  angka(d.package_width)  || 1,
      package_height: angka(d.package_height) || 1,
    },
    logistic_info: logistik,
    category_id: item.category_id,
    image: { image_id_list: imageIds },
    item_sku: item.item_sku || '',
    condition: item.condition || 'NEW',
    seller_stock: [{ stock: 0 }],       // stok diisi belakangan lewat update_stock
  };
  if (Array.isArray(item.attribute_list) && item.attribute_list.length) {
    body.attribute_list = item.attribute_list.map((a) => ({
      attribute_id: a.attribute_id,
      attribute_value_list: (a.attribute_value_list || []).map((v) => ({
        value_id: v.value_id,
        original_value_name: v.original_value_name,
        value_unit: v.value_unit,
      })),
    }));
  }

  const dibuat = await call(EP.addItem, { accessToken: token, shopId: keShop, body });
  const itemBaru = dibuat.response?.item_id;
  if (!itemBaru) throw new Error('Balasan add_item tidak berisi item_id');
  await tidur(JEDA_MS);

  // 4. Varian
  if (tier.length && model.length) {
    await call(EP.initTier, {
      accessToken: token, shopId: keShop,
      body: {
        item_id: itemBaru,
        tier_variation: tier.map((t) => ({
          name: t.name,
          option_list: (t.option_list || []).map((o) => ({ option: o.option })),
        })),
        model: model.map((m) => ({
          tier_index: m.tier_index,
          original_price: angka(m.price_info?.[0]?.original_price) || 0,
          model_sku: m.model_sku || '',
          seller_stock: [{ stock: 0 }],
        })),
      },
    });
  }

  await log('salin', `Produk ${itemId} disalin dari toko ${dariShop} ke ${keShop} sebagai ${itemBaru}`,
    { shopId: keShop });
  return { itemBaru, gambar: imageIds.length, varian: model.length };
}

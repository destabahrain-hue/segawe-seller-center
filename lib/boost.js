import { q, one, log } from './db';
import { call, tidur } from './shopee';
import { EP, JEDA_MS } from './endpoints';
import { tokenHidup, tokoAktif } from './tokens';

/**
 * ── Boost otomatis ──
 *
 * Shopee membatasi jumlah produk yang bisa dinaikkan bersamaan (umumnya 5)
 * dan tiap boost bertahan beberapa jam. Jadi yang diotomatiskan bukan
 * "boost sebanyak-banyaknya", melainkan GILIRAN: begitu satu slot bebas,
 * produk yang paling lama tidak dinaikkan masuk menggantikan.
 *
 * Keunggulannya dibanding BigSeller: tidak perlu kamu login. Boost di sana
 * berhenti sendiri kalau 30 hari tidak dibuka.
 */

/** Produk yang sedang naik di satu toko, apa adanya dari Shopee. */
export async function sedangNaik(shopId) {
  const token = await tokenHidup(shopId);
  const json = await call(EP.boostedList, { accessToken: token, shopId });
  const r = json.response || {};
  const daftar = r.list || r.boosted_item_list || r.item_list || [];
  return daftar.map((x) => ({
    item_id: x.item_id,
    // nama kolom sisa waktu berbeda-beda antar versi dokumen Shopee
    sisaDetik: Number(x.cooldown_second ?? x.cooldown_seconds ?? x.remain_second ?? 0) || 0,
  }));
}

/** Naikkan sekumpulan produk. Shopee menerima beberapa item sekaligus. */
export async function naikkan(shopId, itemIds) {
  if (!itemIds.length) return { naik: [], gagal: [] };
  const token = await tokenHidup(shopId);
  const json = await call(EP.boostItem, {
    accessToken: token, shopId,
    body: { item_id_list: itemIds.map(Number) },
  });
  const r = json.response || {};
  const gagal = (r.failure_list || r.fail_list || []).map((f) => ({
    item_id: f.item_id, alasan: f.fail_message || f.failed_reason || f.reason,
  }));
  const setGagal = new Set(gagal.map((g) => String(g.item_id)));
  const naik = itemIds.filter((i) => !setGagal.has(String(i)));

  if (naik.length) {
    await q(`UPDATE boost_pool SET last_boost_at = now(), boost_count = boost_count + 1
             WHERE shop_id = $1 AND item_id = ANY($2::bigint[])`, [shopId, naik]);
  }
  return { naik, gagal };
}

/** Satu putaran giliran untuk satu toko. */
export async function putarSatuToko(shopId) {
  const set = await one('SELECT * FROM boost_setting WHERE shop_id = $1', [shopId]);
  const slot = Number(set?.slot) || 5;

  const naikSekarang = await sedangNaik(shopId);
  await tidur(JEDA_MS);

  // Slot yang benar-benar bebas
  const terpakai = naikSekarang.filter((x) => x.sisaDetik > 0).length;
  const bebas = Math.max(slot - terpakai, 0);
  if (!bebas) {
    await q(`UPDATE boost_setting SET last_run = now(), last_note = $2 WHERE shop_id = $1`,
      [shopId, `Semua ${slot} slot masih terpakai`]);
    return { shopId: String(shopId), bebas: 0, naik: [], gagal: [] };
  }

  const sedang = new Set(naikSekarang.map((x) => String(x.item_id)));
  const kandidat = await q(
    `SELECT item_id FROM boost_pool
     WHERE shop_id = $1 AND aktif = true
     ORDER BY last_boost_at NULLS FIRST, id
     LIMIT $2`, [shopId, bebas + sedang.size + 5]);

  const pilih = kandidat
    .map((k) => Number(k.item_id))
    .filter((id) => !sedang.has(String(id)))
    .slice(0, bebas);

  if (!pilih.length) {
    await q(`UPDATE boost_setting SET last_run = now(), last_note = $2 WHERE shop_id = $1`,
      [shopId, 'Tidak ada produk siap di daftar giliran']);
    return { shopId: String(shopId), bebas, naik: [], gagal: [] };
  }

  const hasil = await naikkan(shopId, pilih);
  await q(`UPDATE boost_setting SET last_run = now(), last_note = $2 WHERE shop_id = $1`,
    [shopId, `${hasil.naik.length} produk dinaikkan${hasil.gagal.length ? `, ${hasil.gagal.length} gagal` : ''}`]);
  await log('boost', `Toko ${shopId}: ${hasil.naik.length} produk dinaikkan`, { shopId });
  return { shopId: String(shopId), bebas, ...hasil };
}

/** Dipanggil cron. Hanya toko yang otomatisnya menyala. */
export async function putarSemua() {
  const toko = await tokoAktif();
  const hasil = [];
  for (const t of toko) {
    const set = await one('SELECT otomatis FROM boost_setting WHERE shop_id = $1', [t.shop_id]);
    if (!set?.otomatis) continue;
    try {
      hasil.push(await putarSatuToko(t.shop_id));
    } catch (e) {
      await q(`UPDATE boost_setting SET last_run = now(), last_note = $2 WHERE shop_id = $1`,
        [t.shop_id, `Gagal: ${String(e.message).slice(0, 300)}`]);
      await log('boost', `Toko ${t.shop_id} gagal: ${e.message}`, { shopId: t.shop_id, ok: false });
      hasil.push({ shopId: String(t.shop_id), ok: false, error: e.message });
    }
    await tidur(JEDA_MS);
  }
  return hasil;
}

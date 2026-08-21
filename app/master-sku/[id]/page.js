import Shell from '../../Shell';
import { Galat } from '../../UI';
import Editor from './Editor';
import { ensureSchema, q, one } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Halaman satu Master SKU.
 *
 * Sebelumnya penyuntingan paket mengembang di dalam baris tabel — layarnya
 * terdorong dan tim jadi bingung mana yang sedang diubah. Satu halaman
 * penuh per SKU jauh lebih jelas, dan cukup ruang untuk foto produk serta
 * pencarian komponen.
 */
export default async function DetailMaster({ params }) {
  let data = null, galat = null;
  try {
    await ensureSchema();
    const id = params.id;

    const [master, komponen, semua, tertaut, gambar] = await Promise.all([
      one(`SELECT ms.*, h.hpp, h.effective_from AS berlaku
           FROM master_sku ms
           LEFT JOIN LATERAL (
             SELECT hpp, effective_from FROM master_sku_hpp
             WHERE master_sku_id = ms.id AND effective_from <= CURRENT_DATE
             ORDER BY effective_from DESC LIMIT 1) h ON TRUE
           WHERE ms.id = $1`, [id]),

      q(`SELECT c.child_id AS id, c.qty, m.code, m.name,
                (SELECT hpp FROM master_sku_hpp WHERE master_sku_id = m.id
                  AND effective_from <= CURRENT_DATE ORDER BY effective_from DESC LIMIT 1) AS hpp
         FROM master_sku_component c
         JOIN master_sku m ON m.id = c.child_id
         WHERE c.parent_id = $1 ORDER BY m.code`, [id]),

      q(`SELECT ms.id, ms.code, ms.name, ms.kind,
                (SELECT hpp FROM master_sku_hpp WHERE master_sku_id = ms.id
                  AND effective_from <= CURRENT_DATE ORDER BY effective_from DESC LIMIT 1) AS hpp,
                img.url AS gambar
         FROM master_sku ms
         LEFT JOIN LATERAL (
           SELECT COALESCE(p.image_url, oi.image_url) AS url
           FROM sku_mapping sm
           LEFT JOIN products p ON p.shop_id = sm.shop_id
                AND (NULLIF(TRIM(p.item_sku),'') = sm.shop_sku)
           LEFT JOIN order_items oi ON NULLIF(TRIM(oi.item_sku),'') = sm.shop_sku
           WHERE sm.master_sku_id = ms.id
             AND COALESCE(p.image_url, oi.image_url) IS NOT NULL
           LIMIT 1) img ON TRUE
         WHERE ms.kind <> 'paket' AND ms.id <> $1
         ORDER BY ms.code LIMIT 800`, [id]),

      q(`SELECT m.shop_id, m.shop_sku, m.auto_linked, s.shop_name
         FROM sku_mapping m LEFT JOIN shops s ON s.shop_id = m.shop_id
         WHERE m.master_sku_id = $1 ORDER BY s.shop_name NULLS LAST, m.shop_sku`, [id]),

      one(`SELECT COALESCE(p.image_url, oi.image_url) AS url
           FROM sku_mapping sm
           LEFT JOIN products p ON p.shop_id = sm.shop_id
                AND (NULLIF(TRIM(p.item_sku),'') = sm.shop_sku)
           LEFT JOIN order_items oi ON NULLIF(TRIM(oi.item_sku),'') = sm.shop_sku
           WHERE sm.master_sku_id = $1
             AND COALESCE(p.image_url, oi.image_url) IS NOT NULL
           LIMIT 1`, [id]),
    ]);

    if (!master) throw new Error(`Master SKU ${id} tidak ditemukan`);
    data = { master, komponen, semua, tertaut, gambar: gambar?.url || null };
  } catch (e) {
    galat = { pesan: e.message, detail: e.code ? `kode: ${e.code}` : null };
  }

  return (
    <Shell judul={data ? data.master.code : 'Master SKU'}>
      {galat && <Galat judul="Master SKU gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {data && <Editor {...JSON.parse(JSON.stringify(data))} />}
    </Shell>
  );
}

import { NextResponse } from 'next/server';
import { q, one, log } from '@/lib/db';
import { hariJakarta } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

/**
 * Kunci pencocokan: huruf besar, tanpa spasi/strip/titik/garis bawah.
 * Dengan begitu "NEB-W302", "NEB W302", dan "neb_w302" dianggap
 * satu barang yang sama.
 */
const kunci = (x) => String(x || '').toUpperCase().replace(/[\s\-_.\/\\]+/g, '').trim();

async function usulOtomatis() {
  // Sumbernya SKU yang benar-benar pernah muncul di pesanan.
  const baris = await q(`
    SELECT o.shop_id, s.shop_name,
           COALESCE(NULLIF(oi.model_sku,''), NULLIF(oi.item_sku,'')) AS sku,
           oi.item_name AS nama, COUNT(*) AS n
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN shops s ON s.shop_id = o.shop_id
    LEFT JOIN sku_mapping m ON m.shop_id = o.shop_id
          AND m.shop_sku = COALESCE(NULLIF(oi.model_sku,''), NULLIF(oi.item_sku,''))
    -- Syaratnya master_sku_id kosong, BUKAN barisnya tidak ada.
    -- Saat sebuah Master SKU dihapus, baris sku_mapping-nya TIDAK ikut
    -- terhapus: kunci asingnya ON DELETE SET NULL, jadi barisnya tetap
    -- tinggal dengan master_sku_id kosong. Dengan syarat lama (m.id IS NULL)
    -- SKU-SKU itu jadi tidak terlihat oleh mesin usulan, padahal daftar
    -- "SKU toko belum tertaut" di halaman tetap menampilkannya — dua
    -- definisi "belum tertaut" yang berbeda di satu layar.
    WHERE m.master_sku_id IS NULL
      AND COALESCE(NULLIF(oi.model_sku,''), NULLIF(oi.item_sku,'')) IS NOT NULL
    GROUP BY 1,2,3,4`);

  const adaMaster = await q('SELECT id, code, name FROM master_sku');
  const petaMaster = new Map(adaMaster.map((m) => [kunci(m.code), m]));

  const grup = new Map();
  for (const b of baris) {
    const k = kunci(b.sku);
    if (!k) continue;
    if (!grup.has(k)) grup.set(k, { kunci: k, varian: new Map(), nama: new Map(), toko: new Set(), total: 0 });
    const g = grup.get(k);
    g.varian.set(b.sku, (g.varian.get(b.sku) || 0) + Number(b.n));
    if (b.nama) g.nama.set(b.nama, (g.nama.get(b.nama) || 0) + Number(b.n));
    g.toko.add(b.shop_name || `Toko ${b.shop_id}`);
    g.total += Number(b.n);
  }

  const terbanyak = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  return [...grup.values()]
    .map((g) => {
      const sudahAda = petaMaster.get(g.kunci) || null;
      return {
        kunci: g.kunci,
        kode: sudahAda ? sudahAda.code : terbanyak(g.varian),
        nama: sudahAda ? sudahAda.name : (terbanyak(g.nama) || terbanyak(g.varian)),
        varian: [...g.varian.keys()],
        toko: [...g.toko],
        pesanan: g.total,
        sudahAda: Boolean(sudahAda),
      };
    })
    .sort((a, b) => b.pesanan - a.pesanan);
}


export async function POST(req) {
  const b = await req.json();
  try {
    if (b.aksi === 'buat') {
      const ms = await one(
        `INSERT INTO master_sku (code, name, kind, reorder_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
        [b.code.trim().toUpperCase(), b.name.trim(), b.kind || 'tunggal', Number(b.reorder_at) || 0]);
      return NextResponse.json({ ok: true, ms });
    }

    if (b.aksi === 'ubah') {
      await q(`UPDATE master_sku SET name = COALESCE($2,name), kind = COALESCE($3,kind),
                      reorder_at = COALESCE($4,reorder_at) WHERE id = $1`,
        [b.id, b.name || null, b.kind || null,
         b.reorder_at === undefined || b.reorder_at === '' ? null : Number(b.reorder_at)]);
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === 'hpp') {
      await q(
        `INSERT INTO master_sku_hpp (master_sku_id, hpp, effective_from)
         VALUES ($1,$2,$3)
         ON CONFLICT (master_sku_id, effective_from) DO UPDATE SET hpp = EXCLUDED.hpp`,
        [b.id, Number(b.hpp) || 0, b.effective_from || hariJakarta()]);
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === 'komponen') {
      await q(`DELETE FROM master_sku_component WHERE parent_id = $1`, [b.id]);
      for (const c of b.komponen || []) {
        await q(`INSERT INTO master_sku_component (parent_id, child_id, qty) VALUES ($1,$2,$3)`,
          [b.id, c.child_id, Number(c.qty) || 1]);
      }
      await q(`UPDATE master_sku SET kind = 'paket' WHERE id = $1`, [b.id]);
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === 'tautkan') {
      await q(
        `INSERT INTO sku_mapping (shop_id, shop_sku, master_sku_id, auto_linked)
         VALUES ($1,$2,$3,false)
         ON CONFLICT (shop_id, shop_sku) DO UPDATE SET master_sku_id = EXCLUDED.master_sku_id`,
        [b.shop_id, b.shop_sku, b.master_sku_id]);
      return NextResponse.json({ ok: true });
    }

    // Lepas penautan satu SKU toko. Master SKU-nya tidak disentuh.
    if (b.aksi === 'lepas') {
      await q(`DELETE FROM sku_mapping WHERE shop_id = $1 AND shop_sku = $2`, [b.shop_id, b.shop_sku]);
      return NextResponse.json({ ok: true });
    }

    // Berapa yang ikut terdampak kalau Master SKU dihapus.
    if (b.aksi === 'tautkan-persis') {
    /**
     * Tautkan SKU toko yang namanya SAMA PERSIS dengan kode master ini.
     * Perbandingannya dinormalkan (huruf besar, spasi & tanda baca
     * dibuang) — jadi "NEBULIZER JSL-W302" dan "nebulizer jsl w302"
     * dianggap sama, tapi "NEBULIZER JSL W301" TIDAK. Kemiripan tidak
     * pernah cukup di sini: salah tautan berarti stok gudang salah.
     */
    const r = await q(`
      WITH master AS (
        SELECT id, regexp_replace(upper(trim(code)), '[^A-Z0-9]', '', 'g') AS kunci
        FROM master_sku WHERE id = $1
      ),
      sumber AS (
        SELECT DISTINCT o.shop_id, x.sku
        FROM orders o JOIN order_items oi ON oi.order_id = o.id
        CROSS JOIN LATERAL (VALUES (oi.model_sku), (oi.item_sku)) AS x(sku)
        WHERE NULLIF(TRIM(x.sku), '') IS NOT NULL
        UNION
        SELECT DISTINCT p.shop_id, y.sku
        FROM products p LEFT JOIN product_models pm ON pm.product_id = p.id
        CROSS JOIN LATERAL (VALUES (pm.model_sku), (p.item_sku)) AS y(sku)
        WHERE NULLIF(TRIM(y.sku), '') IS NOT NULL
      )
      INSERT INTO sku_mapping (shop_id, shop_sku, master_sku_id, auto_linked)
      SELECT s.shop_id, s.sku, m.id, true
      FROM sumber s CROSS JOIN master m
      WHERE regexp_replace(upper(trim(s.sku)), '[^A-Z0-9]', '', 'g') = m.kunci
      ON CONFLICT (shop_id, shop_sku) DO UPDATE SET master_sku_id = EXCLUDED.master_sku_id
      RETURNING id`, [b.id]);
    return NextResponse.json({ ok: true, jumlah: r.length });
  }

    if (b.aksi === 'periksa-hapus') {
      const ms = await one('SELECT id, code, name FROM master_sku WHERE id = $1', [b.id]);
      if (!ms) return NextResponse.json({ ok: false, error: 'Master SKU tidak ditemukan' }, { status: 404 });

      const induk = await q(
        `SELECT p.code, p.name FROM master_sku_component c
         JOIN master_sku p ON p.id = c.parent_id WHERE c.child_id = $1`, [b.id]);
      const n = await one(
        `SELECT (SELECT COUNT(*) FROM sku_mapping WHERE master_sku_id = $1)  AS taut,
                (SELECT COUNT(*) FROM stock_moves WHERE master_sku_id = $1)  AS mutasi,
                (SELECT COUNT(*) FROM master_sku_hpp WHERE master_sku_id = $1) AS hpp`, [b.id]);

      return NextResponse.json({
        ok: true, ms,
        terkunci: induk.length > 0,
        induk: induk.map((x) => `${x.code} — ${x.name}`),
        taut: Number(n.taut), mutasi: Number(n.mutasi), hpp: Number(n.hpp),
      });
    }

    if (b.aksi === 'hapus') {
      const ms = await one('SELECT code, name FROM master_sku WHERE id = $1', [b.id]);
      if (!ms) return NextResponse.json({ ok: false, error: 'Master SKU tidak ditemukan' }, { status: 404 });

      // Master SKU yang jadi isi paket tidak boleh dihapus — paketnya akan rusak.
      const induk = await q(
        `SELECT p.code FROM master_sku_component c
         JOIN master_sku p ON p.id = c.parent_id WHERE c.child_id = $1`, [b.id]);
      if (induk.length) {
        return NextResponse.json({
          ok: false,
          error: `Tidak bisa dihapus: masih jadi isi paket ${induk.map((x) => x.code).join(', ')}. `
               + `Keluarkan dulu dari paket itu.`,
        }, { status: 409 });
      }

      await q('DELETE FROM master_sku WHERE id = $1', [b.id]);
      await log('master-sku', `Master SKU ${ms.code} (${ms.name}) dihapus`, { ok: false });
      return NextResponse.json({ ok: true, pesan: `${ms.code} dihapus.` });
    }

    /**
     * Periksa dampak hapus massal — belum menghapus apa pun.
     *
     * Dipisah dari eksekusi karena penghapusan Master SKU merembet:
     * mutasi stok dan riwayat HPP ikut terhapus mengikuti kunci asing.
     * Orang berhak melihat persis apa yang akan hilang sebelum memutuskan.
     */
    if (b.aksi === 'periksa-hapus-massal') {
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
      if (!ids.length) return NextResponse.json({ ok: false, error: 'Tidak ada yang dipilih' }, { status: 400 });
      if (ids.length > 1000) {
        return NextResponse.json({ ok: false, error: 'Maksimal 1000 sekali hapus' }, { status: 400 });
      }

      const baris = await q(`
        SELECT ms.id, ms.code, ms.name,
               (SELECT COUNT(*)::int FROM sku_mapping   x WHERE x.master_sku_id = ms.id) AS taut,
               (SELECT COUNT(*)::int FROM stock_moves   x WHERE x.master_sku_id = ms.id) AS mutasi,
               (SELECT COUNT(*)::int FROM master_sku_hpp x WHERE x.master_sku_id = ms.id) AS hpp,
               COALESCE((SELECT array_agg(p.code) FROM master_sku_component c
                          JOIN master_sku p ON p.id = c.parent_id
                         WHERE c.child_id = ms.id), '{}') AS induk
          FROM master_sku ms
         WHERE ms.id = ANY($1::bigint[])
         ORDER BY ms.name`, [ids]);

      const rapi = baris.map((x) => ({
        id: Number(x.id), code: x.code, name: x.name,
        taut: Number(x.taut), mutasi: Number(x.mutasi), hpp: Number(x.hpp),
        induk: x.induk || [],
        terkunci: (x.induk || []).length > 0,
      }));

      return NextResponse.json({
        ok: true,
        baris: rapi,
        terkunci: rapi.filter((x) => x.terkunci).length,
        punyaMutasi: rapi.filter((x) => !x.terkunci && x.mutasi > 0).length,
        totalMutasi: rapi.filter((x) => !x.terkunci).reduce((a, x) => a + x.mutasi, 0),
      });
    }

    if (b.aksi === 'hapus-massal') {
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
      if (!ids.length) return NextResponse.json({ ok: false, error: 'Tidak ada yang dipilih' }, { status: 400 });

      // Yang jadi isi paket TIDAK PERNAH ikut terhapus, bahkan kalau dipaksa —
      // menghapusnya membuat paket induknya menghitung isi yang tidak ada.
      const aman = await q(`
        SELECT ms.id, ms.code, ms.name,
               (SELECT COUNT(*)::int FROM stock_moves x WHERE x.master_sku_id = ms.id) AS mutasi
          FROM master_sku ms
         WHERE ms.id = ANY($1::bigint[])
           AND NOT EXISTS (SELECT 1 FROM master_sku_component c WHERE c.child_id = ms.id)`, [ids]);

      const sasaran = aman.filter((x) => b.ikutRiwayat === true || Number(x.mutasi) === 0);
      if (!sasaran.length) {
        return NextResponse.json({
          ok: false,
          error: 'Tidak ada yang bisa dihapus: semuanya jadi isi paket, atau punya riwayat stok '
               + 'sementara pilihan "ikut hapus riwayat" belum dicentang.',
        }, { status: 409 });
      }

      const idSasaran = sasaran.map((x) => Number(x.id));
      await q('DELETE FROM master_sku WHERE id = ANY($1::bigint[])', [idSasaran]);
      await log('master-sku',
        `Hapus massal ${sasaran.length} Master SKU: ${sasaran.map((x) => x.code).join(', ').slice(0, 400)}`
        + (b.ikutRiwayat ? ' (termasuk riwayat stok)' : ''), { ok: false });

      return NextResponse.json({
        ok: true, dihapus: sasaran.length,
        dilewati: ids.length - sasaran.length,
      });
    }

    // Usulkan Master SKU dari SKU toko yang belum tertaut — belum menyimpan apa pun.
    if (b.aksi === 'usul-otomatis') {
      return NextResponse.json({ ok: true, usul: await usulOtomatis() });
    }

    // Terapkan usulan yang dicentang: buat Master SKU seperlunya, lalu tautkan.
    if (b.aksi === 'terapkan-otomatis') {
      const dipilih = new Set(b.kunci || []);
      const usul = (await usulOtomatis()).filter((u) => dipilih.has(u.kunci));

      let dibuat = 0, ditaut = 0;
      for (const u of usul) {
        const ms = await one(
          `INSERT INTO master_sku (code, name) VALUES ($1,$2)
           ON CONFLICT (code) DO UPDATE SET name = master_sku.name
           RETURNING id, (xmax = 0) AS baru`,
          [u.kode.trim().toUpperCase(), (u.nama || u.kode).slice(0, 200)]);
        if (ms.baru) dibuat++;

        const toko = await q(`
          SELECT DISTINCT o.shop_id, COALESCE(NULLIF(oi.model_sku,''), NULLIF(oi.item_sku,'')) AS sku
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE COALESCE(NULLIF(oi.model_sku,''), NULLIF(oi.item_sku,'')) = ANY($1::text[])`,
          [u.varian]);

        for (const t of toko) {
          await q(
            `INSERT INTO sku_mapping (shop_id, shop_sku, master_sku_id, auto_linked)
             VALUES ($1,$2,$3,true)
             ON CONFLICT (shop_id, shop_sku) DO UPDATE SET master_sku_id = EXCLUDED.master_sku_id`,
            [t.shop_id, t.sku, ms.id]);
          ditaut++;
        }
      }
      await log('master-sku', `Otomatis: ${dibuat} Master SKU dibuat, ${ditaut} SKU toko ditautkan`);
      return NextResponse.json({ ok: true, dibuat, ditaut });
    }


    // ── Usul Master SKU otomatis dari SKU yang muncul di pesanan ──
    // longgar=false : kode harus sama persis (setelah dirapikan huruf besar)
    // longgar=true  : abaikan spasi, tanda hubung, dan titik — "NEB W302" = "NEB-W302"
    if (b.aksi === 'auto-map' || b.aksi === 'auto-map-terapkan') {
      const longgar = !!b.longgar;
      const kunci = (x) => {
        const rapi = String(x || '').trim().toUpperCase().replace(/\s+/g, ' ');
        return longgar ? rapi.replace(/[^A-Z0-9]/g, '') : rapi;
      };

      // Sumber SKU: KATALOG PRODUK (bukan pesanan). Pesanan hanya dipakai
      // sebagai tambahan bila diminta, untuk produk yang sudah dihapus di Shopee.
      const dariProduk = await q(`
        SELECT p.shop_id, s.shop_name,
               COALESCE(NULLIF(TRIM(pm.model_sku),''), NULLIF(TRIM(p.item_sku),'')) AS sku,
               p.name AS item_name, 1::int AS n
        FROM products p
        LEFT JOIN product_models pm ON pm.product_id = p.id
        LEFT JOIN shops s ON s.shop_id = p.shop_id
        LEFT JOIN sku_mapping m ON m.shop_id = p.shop_id
              AND m.shop_sku = COALESCE(NULLIF(TRIM(pm.model_sku),''), NULLIF(TRIM(p.item_sku),''))
        -- Lihat catatan di usulOtomatis: baris sku_mapping tetap tinggal
        -- dengan master_sku_id kosong setelah Master SKU-nya dihapus.
        WHERE m.master_sku_id IS NULL
          AND COALESCE(NULLIF(TRIM(pm.model_sku),''), NULLIF(TRIM(p.item_sku),'')) IS NOT NULL
        GROUP BY 1,2,3,4`);

      let baris = dariProduk;

      if (b.sumber === 'produk+pesanan') {
        const dariPesanan = await q(`
          SELECT o.shop_id, s.shop_name,
                 COALESCE(NULLIF(TRIM(oi.model_sku),''), NULLIF(TRIM(oi.item_sku),'')) AS sku,
                 oi.item_name, COUNT(*)::int AS n
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN shops s ON s.shop_id = o.shop_id
          LEFT JOIN sku_mapping m ON m.shop_id = o.shop_id
                AND m.shop_sku = COALESCE(NULLIF(TRIM(oi.model_sku),''), NULLIF(TRIM(oi.item_sku),''))
          -- Sama seperti dua kueri di atas: yang menentukan master_sku_id
          -- kosong, bukan ada-tidaknya barisnya.
          WHERE m.master_sku_id IS NULL
            AND COALESCE(NULLIF(TRIM(oi.model_sku),''), NULLIF(TRIM(oi.item_sku),'')) IS NOT NULL
          GROUP BY 1,2,3,4`);
        const sudah = new Set(dariProduk.map((r) => `${r.shop_id}|${r.sku}`));
        baris = dariProduk.concat(dariPesanan.filter((r) => !sudah.has(`${r.shop_id}|${r.sku}`)));
      }

      if (!baris.length) {
        const adaProduk = await one('SELECT COUNT(*)::int AS n FROM products');
        if (!adaProduk.n) {
          return NextResponse.json({
            ok: false,
            error: 'Katalog produk masih kosong. Buka halaman Produk lalu tekan '
                 + '"Tarik produk dari Shopee" dulu — itu sumber usulan Master SKU.',
          }, { status: 409 });
        }
      }

      const adaMaster = await q('SELECT id, code, name FROM master_sku');
      const petaMaster = new Map(adaMaster.map((m) => [kunci(m.code), m]));

      const grup = new Map();
      for (const r of baris) {
        const k = kunci(r.sku);
        if (!k) continue;
        if (!grup.has(k)) grup.set(k, { kunci: k, kode: {}, nama: {}, toko: new Map(), sku: [] });
        const g = grup.get(k);
        g.kode[r.sku.trim().toUpperCase()] = (g.kode[r.sku.trim().toUpperCase()] || 0) + r.n;
        if (r.item_name) g.nama[r.item_name] = (g.nama[r.item_name] || 0) + r.n;
        g.toko.set(String(r.shop_id), r.shop_name || `Toko ${r.shop_id}`);
        g.sku.push({ shop_id: r.shop_id, shop_sku: r.sku });
      }

      const tersering = (o) => Object.entries(o).sort((a, c) => c[1] - a[1])[0]?.[0] || '';
      const usul = [...grup.values()].map((g) => {
        const cocok = petaMaster.get(g.kunci) || null;
        return {
          kunci: g.kunci,
          kode: cocok ? cocok.code : tersering(g.kode),
          nama: cocok ? cocok.name : (tersering(g.nama) || tersering(g.kode)),
          adaId: cocok ? cocok.id : null,
          jumlahSku: g.sku.length,
          toko: [...g.toko.values()],
          variasi: Object.keys(g.kode),
          sku: g.sku,
        };
      }).sort((a, c) => c.jumlahSku - a.jumlahSku);


    if (b.aksi === 'auto-map') {
        return NextResponse.json({
          ok: true,
          baru: usul.filter((u) => !u.adaId).length,
          tautkanSaja: usul.filter((u) => u.adaId).length,
          totalSku: usul.reduce((a, u) => a + u.jumlahSku, 0),
          usul: usul.map(({ sku, ...sisa }) => sisa),
        });
      }

      // Terapkan
      const pilih = Array.isArray(b.pilih) && b.pilih.length ? new Set(b.pilih) : null;
      let dibuat = 0, ditaut = 0;
      for (const u of usul) {
        if (pilih && !pilih.has(u.kunci)) continue;
        let id = u.adaId;
        if (!id) {
          const ms = await one(
            `INSERT INTO master_sku (code, name, kind) VALUES ($1,$2,'tunggal')
             ON CONFLICT (code) DO UPDATE SET name = master_sku.name RETURNING id`,
            [u.kode, u.nama]);
          id = ms.id; dibuat++;
        }
        for (const m of u.sku) {
          await q(
            `INSERT INTO sku_mapping (shop_id, shop_sku, master_sku_id, auto_linked)
             VALUES ($1,$2,$3,true)
             ON CONFLICT (shop_id, shop_sku) DO UPDATE SET master_sku_id = EXCLUDED.master_sku_id`,
            [m.shop_id, m.shop_sku, id]);
          ditaut++;
        }
      }
      await log('master-sku', `Auto mapping: ${dibuat} Master SKU dibuat, ${ditaut} SKU toko ditautkan`);
      return NextResponse.json({ ok: true, dibuat, ditaut });
    }

    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenal' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

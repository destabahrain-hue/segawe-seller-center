import Shell from '../Shell';
import { Kosong, Catatan, Galat } from '../UI';
import { SetelanToko, AturDaftar, HapusDariGiliran } from './Kendali';
import { ensureSchema, q } from '@/lib/db';
import { num, jam } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Boost() {
  let toko = [], pool = [], kandidat = [], galat = null;
  try {
    await ensureSchema();
    [toko, pool, kandidat] = await Promise.all([
      q(`SELECT s.shop_id, s.shop_name,
                COALESCE(b.otomatis,false) AS otomatis, COALESCE(b.slot,5) AS slot,
                b.last_run, b.last_note
         FROM shops s
         LEFT JOIN boost_setting b ON b.shop_id = s.shop_id
         WHERE s.status = 'active'
         ORDER BY s.shop_name NULLS LAST, s.shop_id`),
      q(`SELECT bp.*, p.name, p.item_sku
         FROM boost_pool bp
         LEFT JOIN products p ON p.shop_id = bp.shop_id AND p.item_id = bp.item_id
         ORDER BY bp.shop_id, bp.last_boost_at NULLS FIRST, bp.id`),
      q(`SELECT shop_id, item_id, name, item_sku FROM products
         WHERE status = 'NORMAL' ORDER BY name LIMIT 2000`),
    ]);
  } catch (e) {
    galat = { pesan: e.message, detail: [e.code && `kode: ${e.code}`, e.detail, e.hint]
              .filter(Boolean).join('\n') || null };
  }

  const poolToko = (id) => pool.filter((x) => String(x.shop_id) === String(id));
  const kandidatToko = (id) => kandidat.filter((x) => String(x.shop_id) === String(id));

  return (
    <Shell judul="Boost Otomatis" rute="/boost">
      {galat && <Galat judul="Halaman Boost gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {!galat && <>
        <Catatan>
          <b>Ini menaikkan produk bergiliran, bukan sebanyak-banyaknya.</b> Shopee membatasi
          jumlah produk yang bisa naik bersamaan. Begitu satu slot bebas, produk yang paling
          lama tidak dinaikkan otomatis menggantikan. Cron menjalankannya tanpa kamu perlu login —
          berbeda dengan BigSeller yang berhenti sendiri kalau 30 hari tidak dibuka.
        </Catatan>

        {!toko.length && (
          <Kosong judul="Belum ada toko terhubung"
                  anak="Hubungkan toko dulu di halaman Toko Terhubung." />
        )}

        {toko.map((t) => {
          const daftar = poolToko(t.shop_id);
          const aktif = daftar.filter((d) => d.aktif);
          return (
            <div className="card" key={t.shop_id} style={{ marginBottom: 'var(--s4)' }}>
              <div className="card-head">
                <h2>{t.shop_name || `Toko ${t.shop_id}`}</h2>
                <span className={'badge ' + (t.otomatis ? 'b-pos' : 'b-mute')}>
                  {t.otomatis ? 'otomatis menyala' : 'manual'}
                </span>
                <span className="badge b-mute">{num(aktif.length)} produk di giliran</span>
                <div className="spacer" />
                <SetelanToko shopId={String(t.shop_id)} otomatis={t.otomatis} slot={t.slot} />
              </div>

              <div className="card-body" style={{ paddingBottom: 'var(--s3)' }}>
                <div className="form-row" style={{ alignItems: 'center' }}>
                  <span className="t-mute" style={{ fontSize: 12 }}>
                    {t.last_run
                      ? `Putaran terakhir ${jam(t.last_run)}${t.last_note ? ` · ${t.last_note}` : ''}`
                      : 'Belum pernah dijalankan'}
                  </span>
                  <div className="spacer" />
                  <AturDaftar shopId={String(t.shop_id)}
                              kandidat={JSON.parse(JSON.stringify(kandidatToko(t.shop_id)))}
                              sudah={JSON.parse(JSON.stringify(daftar))} />
                </div>
              </div>

              {daftar.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead><tr>
                      <th>Produk</th><th>SKU</th>
                      <th className="t-right">Sudah dinaikkan</th>
                      <th>Terakhir naik</th><th style={{ width: 110 }}></th>
                    </tr></thead>
                    <tbody>
                      {daftar.map((d) => (
                        <tr key={d.id}>
                          <td className="tt">{d.name || `item ${d.item_id}`}</td>
                          <td className="mono t-mute">{d.item_sku || '—'}</td>
                          <td className="t-num">{num(d.boost_count)}×</td>
                          <td className="t-mute">
                            {d.last_boost_at ? jam(d.last_boost_at)
                              : <span className="badge b-info">giliran berikutnya</span>}
                          </td>
                          <td><HapusDariGiliran shopId={String(t.shop_id)} itemId={String(d.item_id)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </>}
    </Shell>
  );
}

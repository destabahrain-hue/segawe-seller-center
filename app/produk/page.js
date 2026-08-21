import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import Paginasi, { bacaPer } from '../Paginasi';
import { Kosong, Catatan, Galat } from '../UI';
import Tarik from './Tarik';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema, q, one } from '@/lib/db';
import { TAB, cariTab, hitungTab, daftarProduk, hitungBarisProduk } from '@/lib/katalog';
import { rp, num, jam } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Produk({ searchParams }) {
  const uang = bolehUang(await peranSekarang());
  const tab = searchParams?.t || 'live';
  const toko = searchParams?.toko || null;
  const cari = searchParams?.cari || null;
  const perHalaman = bacaPer(searchParams?.per);
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);
  const t = cariTab(tab);

  let hitung = {}, rows = [], daftarToko = [], ringkas = {}, jumlahBaris = 0, galat = null;
  try {
    await ensureSchema();
    [hitung, rows, daftarToko, ringkas, jumlahBaris] = await Promise.all([
    hitungTab({ shopId: toko }),
    daftarProduk({ tab, shopId: toko, cari, halaman, perHalaman }),
    q('SELECT shop_id, shop_name FROM shops ORDER BY shop_name NULLS LAST'),
    one(`SELECT (SELECT COUNT(*) FROM products) AS total,
                (SELECT COUNT(*) FROM products p
                  WHERE EXISTS (SELECT 1 FROM product_models m WHERE m.product_id = p.id)) AS lengkap,
                (SELECT MAX(synced_at) FROM products) AS terakhir`),
      hitungBarisProduk({ tab, shopId: toko, cari }),
    ]);
  } catch (e) {
    galat = { pesan: e.message, detail: [e.code && `kode: ${e.code}`, e.detail, e.hint,
              e.position && `posisi: ${e.position}`].filter(Boolean).join('\n') || null };
  }

  const total = Number(ringkas?.total || 0);
  const belumLengkap = total - Number(ringkas?.lengkap || 0);
  const qs = (u) => {
    const p = new URLSearchParams();
    const v = { t: tab, toko, cari, per: perHalaman === 50 ? null : perHalaman, ...u };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return '/produk?' + p.toString();
  };

  return (
    <Shell judul="Produk" rute="/produk" kanan={<AutoSegar detik={180} />}>
      {galat && <Galat judul="Halaman Produk gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {!galat && <>
      {total === 0 ? (
        <Catatan>
          Katalog belum pernah ditarik. Tekan <b>Tarik produk dari Shopee</b> di kanan.
          Katalog ini jadi sumber Master SKU sekaligus dasar halaman Salin Listing.
        </Catatan>
      ) : belumLengkap > 0 && (
        <Catatan>
          <b>{num(belumLengkap)} produk belum lengkap variannya.</b> Shopee membatasi pengambilan
          varian satu produk per panggilan, jadi ditarik bertahap. Tekan <b>Tarik produk</b> lagi
          sampai angka ini nol.
        </Catatan>
      )}

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Status</div>
          <div className="filter-vals">
            {TAB.map((x) => (
              <a key={x.key} className="chip" href={qs({ t: x.key })} aria-pressed={tab === x.key}>
                {x.label} <span className="n">{num(hitung[x.key] ?? 0)}</span>
              </a>
            ))}
          </div>
        </div>
        {daftarToko.length > 1 && (
          <div className="filter-row">
            <div className="filter-key">Toko</div>
            <div className="filter-vals">
              <a className="chip" href={qs({ toko: null })} aria-pressed={!toko}>Semua toko</a>
              {daftarToko.map((s) => (
                <a key={s.shop_id} className="chip" href={qs({ toko: String(s.shop_id) })}
                   aria-pressed={String(toko) === String(s.shop_id)}>
                  {s.shop_name || `Toko ${s.shop_id}`}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t.label}</h2>
          <span className="t-mute" style={{ fontSize: 12 }}>
            {jumlahBaris > 0
              ? `${num((halaman - 1) * perHalaman + 1)}–${num((halaman - 1) * perHalaman + rows.length)} dari ${num(jumlahBaris)}`
              : '0 produk'}
          </span>
          <div className="spacer" />
          <span className="t-mute" style={{ fontSize: 12 }}>
            {ringkas?.terakhir ? `Tarik terakhir ${jam(ringkas.terakhir)}` : 'Belum pernah ditarik'}
          </span>
          <Tarik />
        </div>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={jumlahBaris} qs={qs}
                    aksi="/produk" cari={cari}
                    cariPlaceholder="Cari nama produk, SKU, atau nomor item"
                    saring={{ t: tab, toko, per: perHalaman === 50 ? null : perHalaman }} />
        </div>
        <div className="table-wrap">
          <table className="wide">
            <thead><tr>
              <th style={{ width: 56 }}></th>
              <th className="sticky-c">Produk</th><th>Toko</th><th>SKU induk</th><th>Master SKU</th>
              <th className="t-right">Varian</th>{uang && <th className="t-right">Harga</th>}
              <th className="t-right">Stok</th><th>Status</th><th>Diperbarui</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.image_url
                      ? <img src={p.image_url} alt="" width={40} height={40} loading="lazy"
                             style={{ width: 40, height: 40, objectFit: 'cover', display: 'block',
                                      borderRadius: 'var(--r-sm)', border: '1px solid var(--line)',
                                      background: 'var(--surface-sunken)' }} />
                      : <span className="thumb" style={{ width: 40, height: 40 }}>
                          {String(p.item_sku || p.name || '?').slice(0, 3).toUpperCase()}</span>}
                  </td>
                  <td className="sticky-c">
                    <div className="tt">{p.name}</div>
                    <div className="st mono">item {p.item_id}</div>
                  </td>
                  <td>{p.shop_name || `Toko ${p.shop_id}`}</td>
                  <td className="mono">{p.item_sku || <span className="t-mute">—</span>}</td>
                  <td>{p.master_code
                    ? <span className="badge b-info">{p.master_code}</span>
                    : <span className="badge b-warn">belum tertaut</span>}</td>
                  <td className="t-num">{num(p.varian || 0)}</td>
                  {uang && (
                    <td className="t-num t-strong">
                      {p.harga_min
                        ? (Number(p.harga_min) === Number(p.harga_maks)
                            ? rp(p.harga_min)
                            : `${rp(p.harga_min)}–${rp(p.harga_maks)}`)
                        : '—'}
                    </td>
                  )}
                  <td className="t-num" style={Number(p.stok) === 0 ? { color: 'var(--neg)' } : undefined}>
                    {p.stok ?? '—'}
                  </td>
                  <td><span className={'badge ' + (p.status === 'NORMAL' ? 'b-pos' : 'b-mute')}>
                    {p.status || '—'}</span></td>
                  <td className="t-mute">{jam(p.synced_at)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={uang ? 10 : 9}>
                <Kosong judul={`Tidak ada produk di "${t.label}"`}
                        anak="Tarik katalog dulu, atau pilih status lain." />
              </td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <Paginasi halaman={halaman} perHalaman={perHalaman} total={jumlahBaris} qs={qs}
                      aksi="/produk" bawah />
          </div>
        )}
      </div>
      </>}
    </Shell>
  );
}

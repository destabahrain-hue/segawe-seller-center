import Shell from '../Shell';
import { Kosong, Catatan, Galat } from '../UI';
import { ensureSchema, q } from '@/lib/db';
import { petaSebaran, selisihToko } from '@/lib/katalog';
import { rp, num } from '@/lib/fmt';
import { sesi, bolehUang } from '@/lib/auth';
import Salin from './Salin';

export const dynamic = 'force-dynamic';

export default async function SalinListing({ searchParams }) {
  const uang = bolehUang(sesi()?.peran);
  const sumber = searchParams?.dari || null;
  const tujuan = searchParams?.ke || null;

  let toko = [], sebaran = [], selisih = [], galat = null;
  try {
    await ensureSchema();
    [toko, sebaran, selisih] = await Promise.all([
      q(`SELECT shop_id, shop_name FROM shops WHERE status = 'active' ORDER BY shop_name NULLS LAST`),
      petaSebaran(),
      sumber && tujuan && sumber !== tujuan ? selisihToko(sumber, tujuan) : Promise.resolve([]),
    ]);
  } catch (e) {
    galat = { pesan: e.message, detail: [e.code && `kode: ${e.code}`, e.detail, e.hint,
              e.position && `posisi: ${e.position}`].filter(Boolean).join('\n') || null };
  }

  const belum = sebaran.filter((r) => Number(r.belum_di) > 0);
  const totalCelah = belum.reduce((a, r) => a + Number(r.belum_di), 0);
  const qs = (u) => {
    const p = new URLSearchParams();
    const v = { dari: sumber, ke: tujuan, ...u };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return '/salin-listing?' + p.toString();
  };
  const nama = (id) => toko.find((t) => String(t.shop_id) === String(id))?.shop_name || `Toko ${id}`;

  return (
    <Shell judul="Salin Listing" rute="/salin-listing">
      {galat && <Galat judul="Salin Listing gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {!galat && <>
      <Catatan>
        <b>Produk hasil salinan dibuat dalam keadaan NONAKTIF dan stok nol.</b> Disengaja —
        supaya kamu memeriksa harga, deskripsi, dan gambarnya dulu di Seller Centre sebelum
        ditayangkan. Penyalinan berjalan lewat antrean, jadi halaman boleh ditutup.
      </Catatan>

      <div className="kpi-row">
        <div className="kpi"><div className="k">Produk unik</div><div className="v num">{num(sebaran.length)}</div>
          <div className="d">digabung lewat Master SKU / SKU induk</div></div>
        <div className="kpi"><div className="k">Belum lengkap di semua toko</div>
          <div className="v num">{num(belum.length)}</div>
          <div className="d">ada di sebagian toko saja</div></div>
        <div className="kpi"><div className="k">Total celah</div>
          <div className="v num" style={{ color: totalCelah ? 'var(--warn)' : undefined }}>{num(totalCelah)}</div>
          <div className="d">jumlah pasangan produk × toko yang kosong</div></div>
        <div className="kpi"><div className="k">Toko aktif</div><div className="v num">{num(toko.length)}</div>
          <div className="d">jadi pembanding</div></div>
      </div>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Dari toko</div>
          <div className="filter-vals">
            {toko.map((t) => (
              <a key={t.shop_id} className="chip" href={qs({ dari: String(t.shop_id) })}
                 aria-pressed={String(sumber) === String(t.shop_id)}>
                {t.shop_name || `Toko ${t.shop_id}`}
              </a>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-key">Ke toko</div>
          <div className="filter-vals">
            {toko.map((t) => (
              <a key={t.shop_id} className="chip" href={qs({ ke: String(t.shop_id) })}
                 aria-pressed={String(tujuan) === String(t.shop_id)}>
                {t.shop_name || `Toko ${t.shop_id}`}
              </a>
            ))}
          </div>
        </div>
      </div>

      {sumber && tujuan && sumber !== tujuan && (
        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <div className="card-head">
            <h2>Ada di {nama(sumber)}, belum ada di {nama(tujuan)}</h2>
            <span className="badge b-warn">{num(selisih.length)} produk</span>
          </div>
          <div className="card-body">
            <Salin produk={JSON.parse(JSON.stringify(selisih))} uang={uang}
                   dari={sumber} ke={tujuan} namaTujuan={nama(tujuan)} />
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Sebaran produk antar toko</h2>
          <div className="spacer" />
          <span className="badge b-mute">urut dari yang paling banyak celahnya</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Produk</th><th>Kunci</th><th className="t-right">Ada di</th>
              <th className="t-right">Belum di</th><th>Toko yang sudah punya</th>
            </tr></thead>
            <tbody>
              {sebaran.map((r) => (
                <tr key={r.kunci}>
                  <td className="tt">{r.nama}</td>
                  <td className="mono">{r.kunci}</td>
                  <td className="t-num t-strong">{num(r.ada_di)}</td>
                  <td className="t-num" style={Number(r.belum_di) > 0 ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>
                    {num(Math.max(Number(r.belum_di), 0))}
                  </td>
                  <td className="t-mute" style={{ fontSize: 11.5 }}>{(r.toko_ada || []).join(', ')}</td>
                </tr>
              ))}
              {!sebaran.length && <tr><td colSpan={5}>
                <Kosong judul="Katalog masih kosong"
                        anak="Tarik katalog produk dulu di halaman Produk, lalu halaman ini terisi sendiri." />
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      </>}
    </Shell>
  );
}

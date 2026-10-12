import Shell from '../../Shell';
import AutoSegar from '../../AutoSegar';
import { Kpi, Kosong, Catatan } from '../../UI';
import RangePicker from '../../RangePicker';
import Paginasi, { bacaPer } from '../../Paginasi';
import { ensureSchema, q } from '@/lib/db';
import { laporanSku, URUT_SKU } from '@/lib/laporan-sku';
import { rentang } from '@/lib/rentang';
import { rp, num, pct } from '@/lib/fmt';
import { bolehUang, peranSekarang } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Laporan SKU — berapa pcs, omzet, pesanan, tayangan & klik iklan per SKU
 * untuk rentang yang dipilih. Rutenya di bawah /laporan-toko supaya izin
 * peran ikut otomatis.
 */
const PILIHAN_SKU = [
  ['hari-ini',   'Hari ini'],
  ['kemarin',    'Kemarin'],
  ['7h',         '7 hari'],
  ['14h',        '14 hari'],
  ['30h',        '1 bulan'],
  ['bulan-lalu', 'Bulan lalu'],
  ['custom',     'Pilih tanggal'],
];
const KODE_SAH = PILIHAN_SKU.map(([k]) => k);

const urutNilai = {
  omzet: (x) => x.omzet, terjual: (x) => x.terjual, pesanan: (x) => x.pesanan,
  laba: (x) => x.labaKotor, iklan: (x) => x.biayaIklan, tayangan: (x) => x.tayangan,
  klik: (x) => x.klik, batal: (x) => x.batal,
};

export default async function LaporanSku({ searchParams }) {
  await ensureSchema();
  const uang = bolehUang(await peranSekarang());

  const kode = KODE_SAH.includes(searchParams?.r) ? searchParams.r : '7h';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const toko = searchParams?.toko || null;
  const mp = ['shopee', 'tiktok'].includes(searchParams?.mp) ? searchParams.mp : null;
  const cari = String(searchParams?.cari || '').trim();
  const urutBoleh = URUT_SKU.filter(([k]) => uang || !['omzet', 'laba', 'iklan'].includes(k));
  const urut = urutBoleh.some(([k]) => k === searchParams?.urut) ? searchParams.urut
    : (uang ? 'omzet' : 'terjual');
  const arah = searchParams?.arah === 'naik' ? 'naik' : 'turun';
  const perHalaman = bacaPer(searchParams?.per);
  const halamanMinta = Math.max(Number(searchParams?.hal) || 1, 1);

  const [data, tokoList] = await Promise.all([
    laporanSku({ dari: r.dari, sampai: r.sampai, toko, mp }),
    q(`SELECT * FROM (
         SELECT shop_id::text AS id, shop_name, 'shopee' AS mp FROM shops WHERE status = 'active'
         UNION ALL
         SELECT 'tt-' || shop_id, shop_name, 'tiktok' FROM tiktok_shops WHERE status = 'active') t
       WHERE ($1::text IS NULL OR mp = $1)
       ORDER BY mp, shop_name NULLS LAST`, [mp]).catch(() => []),
  ]);

  const kata = cari.toLowerCase().split(/\s+/).filter(Boolean);
  const tersaring = data.baris.filter((x) => {
    if (!kata.length) return true;
    const teks = `${x.code} ${x.nama} ${x.namaProduk || ''}`.toLowerCase();
    return kata.every((k) => teks.includes(k));
  });
  const f = urutNilai[urut];
  tersaring.sort((a, b) => (arah === 'naik' ? f(a) - f(b) : f(b) - f(a))
    || String(a.code).localeCompare(String(b.code)));

  const total = tersaring.reduce((t, x) => ({
    terjual: t.terjual + x.terjual, pesanan: t.pesanan + x.pesanan, omzet: t.omzet + x.omzet,
    hpp: t.hpp + x.hpp, iklan: t.iklan + x.biayaIklan, tayangan: t.tayangan + x.tayangan,
    klik: t.klik + x.klik, batal: t.batal + x.batal,
  }), { terjual: 0, pesanan: 0, omzet: 0, hpp: 0, iklan: 0, tayangan: 0, klik: 0, batal: 0 });
  const tanpaHpp = tersaring.filter((x) => x.tanpaHpp).length;
  const belumTaut = tersaring.filter((x) => !x.tertaut).length;
  const adaTayangan = total.tayangan > 0;

  // Halaman di luar jangkauan (mis. setelah menyaring) jatuh ke halaman terakhir.
  const halaman = Math.min(halamanMinta, Math.max(Math.ceil(tersaring.length / perHalaman), 1));
  const mulai = (halaman - 1) * perHalaman;
  const halamanIni = tersaring.slice(mulai, mulai + perHalaman);

  const qs = (ubah = {}) => {
    const v = {
      r: kode === '7h' ? null : kode, dari: r.awal, sampai: r.akhir, toko, mp, cari: cari || null,
      urut: urut === (uang ? 'omzet' : 'terjual') ? null : urut,
      arah: arah === 'turun' ? null : arah, per: perHalaman === 50 ? null : perHalaman,
      hal: halaman === 1 ? null : halaman, ...ubah,
    };
    const u = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined && x !== '') u.set(k, String(x));
    const s = u.toString();
    return '/laporan-toko/produk' + (s ? '?' + s : '');
  };
  const kepala = (k, label) => (
    <a href={qs({ urut: k, arah: urut === k && arah === 'turun' ? 'naik' : null, hal: null })}
       style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}
       title={`Urutkan menurut ${label}`}>
      {label}{urut === k ? (arah === 'turun' ? ' ↓' : ' ↑') : ''}
    </a>
  );

  return (
    <Shell judul="Laporan SKU" rute="/laporan-toko"
           kanan={<><a className="btn btn-sm" href="/laporan-toko">Kembali ke Laporan</a>
                   <AutoSegar detik={300} /></>}>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Periode</div>
          <RangePicker aktif={kode} awal={r.awal || ''} akhir={r.akhir || ''} pilihan={PILIHAN_SKU} />
        </div>
        <div className="filter-row">
          <div className="filter-key">Marketplace</div>
          <div className="filter-vals">
            <a className="chip" href={qs({ mp: null, toko: null, hal: null })} aria-pressed={!mp}>Semua</a>
            <a className="chip" href={qs({ mp: 'shopee', toko: null, hal: null })} aria-pressed={mp === 'shopee'}>Shopee</a>
            <a className="chip" href={qs({ mp: 'tiktok', toko: null, hal: null })} aria-pressed={mp === 'tiktok'}>TikTok</a>
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-key">Toko</div>
          <div className="filter-vals">
            <a className="chip" href={qs({ toko: null, hal: null })} aria-pressed={!toko}>Semua toko</a>
            {tokoList.map((t) => (
              <a key={t.id} className="chip" href={qs({ toko: t.id, hal: null })}
                 aria-pressed={String(toko) === String(t.id)}>
                {t.shop_name || t.id}
                {t.mp === 'tiktok' && !mp && <span className="t-mute" style={{ fontWeight: 400 }}> (TikTok)</span>}
              </a>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-key">Urutkan</div>
          <div className="filter-vals">
            {urutBoleh.map(([k, label]) => (
              <a key={k} className="chip" href={qs({ urut: k, hal: null })} aria-pressed={urut === k}>{label}</a>
            ))}
            <a className="chip" href={qs({ arah: arah === 'turun' ? 'naik' : null, hal: null })}>
              {arah === 'turun' ? 'Terbesar dulu ↓' : 'Terkecil dulu ↑'}
            </a>
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="SKU terjual" nilai={num(tersaring.filter((x) => x.terjual > 0).length)}
             sub={r.label} lead />
        <Kpi label="Terjual" nilai={`${num(total.terjual)} pcs`} sub={`${num(total.pesanan)} pesanan`} />
        {uang && <Kpi label="Omzet" nilai={rp(total.omzet)}
             sub={total.terjual ? `rata-rata ${rp(total.omzet / total.terjual)} / pcs` : '—'} />}
        {uang && <Kpi label="Biaya iklan Shopee" nilai={rp(total.iklan)}
             sub={total.iklan ? `ROAS ${(total.omzet / total.iklan).toFixed(1)}× · termasuk PPN` : 'belum ada data'} />}
        <Kpi label="Tayangan iklan" nilai={num(total.tayangan)}
             sub={total.tayangan ? `${num(total.klik)} klik · CTR ${pct(total.klik / total.tayangan * 100, 2)}` : 'belum ada data'} />
        <Kpi label="Batal" nilai={`${num(total.batal)} pcs`}
             warna={total.batal ? 'var(--warn)' : undefined} sub="pesanan dibatalkan" />
      </div>

      <Catatan>
        Dihitung dari <b>tanggal pesanan dibuat</b>; pesanan belum dibayar tidak dihitung, pesanan batal
        dipisah di kolom Batal. <b>Tayangan &amp; klik adalah angka iklan Shopee</b> per produk — jumlah
        kunjungan halaman produk secara organik ("Dilihat" di Seller Centre) tidak disediakan API, jadi
        tidak ditampilkan. Iklan TikTok belum tersedia per produk.
        {uang && <> <b>Laba kotor</b> = omzet − HPP, sebelum potongan marketplace dan iklan; laba bersih
          per SKU ada di <a href="/laporan-toko/sku">SKU Bocor</a>.</>}
        {!adaTayangan && total.iklan > 0 && <> Tayangan &amp; klik baru terisi untuk data iklan yang
          ditarik setelah fitur ini aktif — data lama akan terisi saat iklan per produk ditarik ulang.</>}
        {uang && data.iklanSisa > 0 && <> Biaya iklan {rp(data.iklanSisa)} untuk produk yang diiklankan tapi
          tidak terjual di periode ini tidak masuk ke SKU mana pun.</>}
        {(tanpaHpp > 0 || belumTaut > 0) && <> <b>{num(belumTaut)} SKU belum tertaut</b> ke Master SKU dan
          <b> {num(tanpaHpp)} SKU belum punya HPP</b> — rapikan di Master SKU supaya laba kotornya benar.</>}
      </Catatan>

      <div className="card">
        <div className="card-head">
          <h2>Per SKU</h2>
          <span className="badge b-mute">{num(tersaring.length)} SKU</span>
        </div>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={tersaring.length} qs={qs}
                    aksi="/laporan-toko/produk" cari={cari || null}
                    saring={{ r: kode === '7h' ? null : kode, dari: r.awal, sampai: r.akhir, toko, mp,
                              urut: searchParams?.urut, arah: searchParams?.arah,
                              per: perHalaman === 50 ? null : perHalaman }}
                    cariPlaceholder="Cari kode atau nama SKU" />
        </div>

        {!halamanIni.length ? (
          <div className="card-body">
            <Kosong judul={cari ? 'Tidak ada SKU yang cocok' : 'Belum ada penjualan pada periode ini'}
                    anak={cari ? 'Coba kata lain.' : 'Coba perlebar periodenya.'} />
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th style={{ width: 52 }}></th>
                <th>SKU</th>
                <th className="t-right">{kepala('terjual', 'Terjual')}</th>
                <th className="t-right">{kepala('pesanan', 'Pesanan')}</th>
                {uang && <><th className="t-right">{kepala('omzet', 'Omzet')}</th>
                <th className="t-right">Harga / pcs</th>
                <th className="t-right">HPP</th>
                <th className="t-right">{kepala('laba', 'Laba kotor')}</th>
                <th className="t-right">{kepala('iklan', 'Iklan')}</th>
                <th className="t-right">ROAS</th></>}
                <th className="t-right">{kepala('tayangan', 'Tayangan')}</th>
                <th className="t-right">{kepala('klik', 'Klik')}</th>
                <th className="t-right">CTR</th>
                <th className="t-right">{kepala('batal', 'Batal')}</th>
                {!mp && <th className="t-right">Shopee / TikTok</th>}
              </tr></thead>
              <tbody>
                {halamanIni.map((x) => (
                  <tr key={x.code}>
                    <td>
                      {x.gambar
                        ? <img src={x.gambar} alt="" width={40} height={40} loading="lazy"
                               style={{ borderRadius: 6, objectFit: 'cover', border: '1px solid var(--line)' }} />
                        : <div style={{ width: 40, height: 40, borderRadius: 6,
                                        background: 'var(--surface-sunken)', border: '1px solid var(--line)' }} />}
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <div className="tt">{x.nama}</div>
                      <div className="st mono">{x.code}{x.paket ? ' · paket' : ''}
                        {x.toko > 1 ? ` · ${x.toko} toko` : ''}</div>
                      {!x.tertaut && <span className="badge b-warn">belum tertaut Master SKU</span>}
                    </td>
                    <td className="t-num">{num(x.terjual)}</td>
                    <td className="t-num">{num(x.pesanan)}</td>
                    {uang && <>
                      <td className="t-num">{rp(x.omzet)}</td>
                      <td className="t-num t-mute">{x.terjual ? rp(x.hargaRata) : '—'}</td>
                      <td className="t-num">{x.tanpaHpp && !x.hpp ? <span className="t-mute">belum ada</span> : rp(x.hpp)}</td>
                      <td className="t-num" style={x.labaKotor < 0 ? { color: 'var(--neg)' } : undefined}>
                        {x.tanpaHpp && !x.hpp ? '—' : rp(x.labaKotor)}
                        {x.omzet > 0 && !(x.tanpaHpp && !x.hpp) &&
                          <div className="st">{pct(x.labaKotor / x.omzet * 100)}</div>}
                      </td>
                      <td className="t-num">{x.biayaIklan ? rp(x.biayaIklan) : '—'}</td>
                      <td className="t-num">{x.biayaIklan ? `${x.roas.toFixed(1)}×` : '—'}</td>
                    </>}
                    <td className="t-num">{x.tayangan ? num(x.tayangan) : '—'}</td>
                    <td className="t-num">{x.klik ? num(x.klik) : '—'}</td>
                    <td className="t-num">{x.tayangan ? pct(x.ctr * 100, 2) : '—'}</td>
                    <td className="t-num" style={x.batal ? { color: 'var(--warn)' } : undefined}>
                      {x.batal ? num(x.batal) : '—'}
                      {x.batal > 0 && <div className="st">{pct(x.tingkatBatal * 100)}</div>}
                    </td>
                    {!mp && <td className="t-num t-mute">{num(x.pcsShopee)} / {num(x.pcsTiktok)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-body" style={{ paddingTop: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={tersaring.length} qs={qs} bawah />
        </div>
      </div>
    </Shell>
  );
}

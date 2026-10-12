import Shell from '../Shell';
import RangePicker from '../RangePicker';
import Paginasi, { bacaPer } from '../Paginasi';
import { Kpi, Catatan, Kosong } from '../UI';
import Filter from './Filter';
import { ensureSchema, q } from '@/lib/db';
import { daftarPelanggan } from '@/lib/pelanggan';
import { rentang } from '@/lib/rentang';
import { rp, num, pct, tgl } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const TAB = [['semua', 'Semua'], ['teratas', 'Pembeli Teratas'], ['batal', 'Paling Sering Batal']];

export default async function Pelanggan({ searchParams }) {
  await ensureSchema();
  const kode = searchParams?.r || '30h';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const tab = TAB.some(([k]) => k === searchParams?.tab) ? searchParams.tab : 'semua';
  const urut = ['belanja', 'pesanan', 'batal', 'terakhir'].includes(searchParams?.urut)
    ? searchParams.urut : 'belanja';
  const arah = searchParams?.arah === 'asc' ? 'asc' : 'desc';
  const perHalaman = bacaPer(searchParams?.per);
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);

  const [toko, data] = await Promise.all([
    q(`SELECT shop_id, shop_name FROM shops ORDER BY shop_name`),
    daftarPelanggan({
      dari: r.dari, sampai: r.sampai,
      shopId: searchParams?.toko || null,
      cari: searchParams?.q || '', tab, urut, arah,
      limit: perHalaman, offset: (halaman - 1) * perHalaman,
    }),
  ]);

  const qs = (ubah) => {
    const v = { r: kode === '30h' ? null : kode, dari: searchParams?.dari, sampai: searchParams?.sampai,
                toko: searchParams?.toko, q: searchParams?.q, tab: tab === 'semua' ? null : tab,
                urut: urut === 'belanja' ? null : urut, arah: arah === 'desc' ? null : arah,
                per: perHalaman === 50 ? null : perHalaman, hal: halaman === 1 ? null : halaman, ...ubah };
    const p = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    const s = p.toString();
    return '/pelanggan' + (s ? '?' + s : '');
  };
  const kepala = (kunci, teks) => {
    const aktif = urut === kunci;
    const arahBaru = aktif && arah === 'desc' ? 'asc' : 'desc';
    return (
      <a href={qs({ urut: kunci === 'belanja' ? null : kunci,
                    arah: arahBaru === 'desc' ? null : arahBaru, hal: null })}
         style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}>
        {teks} <span style={{ opacity: aktif ? 1 : .35 }}>{aktif ? (arah === 'desc' ? '↓' : '↑') : '↕'}</span>
      </a>
    );
  };
  const g = data.ringkas;
  const unduh = `/api/pelanggan?${new URLSearchParams({
    r: kode, ...(searchParams?.dari ? { dari: searchParams.dari, sampai: searchParams.sampai || '' } : {}),
    ...(searchParams?.toko ? { toko: searchParams.toko } : {}),
    ...(searchParams?.q ? { q: searchParams.q } : {}), tab })}`;

  return (
    <Shell judul="Data Pelanggan" rute="/pelanggan"
           kanan={<a className="btn btn-sm btn-primary" href={unduh}>Unduh Excel</a>}>
      <RangePicker aktif={kode} awal={searchParams?.dari || ''} akhir={searchParams?.sampai || ''} />
      <Filter toko={toko} nilai={{ ...searchParams, r: kode, tab }} />

      <div className="kpi-row">
        <Kpi label="Pelanggan" nilai={num(g.pelanggan)}
             sub={`${num(g.berulang)} pernah belanja lagi`} />
        <Kpi label="Total belanja" nilai={rp(g.belanja)}
             sub={`${num(g.pesanan)} pesanan · ${num(g.batal)} batal`} />
        <Kpi label="Rata-rata per pelanggan" nilai={rp(g.rata)} sub="dari pesanan sah" />
        <Kpi label="Pembeli berulang" nilai={pct(g.pelanggan ? (g.berulang / g.pelanggan) * 100 : 0)}
             sub="punya 2+ pesanan sah" />
      </div>

      <Catatan>
        Pelanggan dikelompokkan dari <b>akun pembeli per toko</b> — orang yang sama belanja di dua toko
        terhitung dua pelanggan, karena akun Shopee-nya memang berbeda dan tidak boleh digabungkan.
        Nama penerima, telepon, kota, dan alamat <b>tidak tersedia sama sekali</b>: Shopee menyensornya
        menjadi tanda bintang untuk aplikasi tanpa akses data sensitif. Yang dikirim utuh hanya username.
      </Catatan>

      <div className="card">
        <div className="card-head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="filter-vals">
            {TAB.map(([k, t]) => (
              <a key={k} className="chip" href={qs({ tab: k === 'semua' ? null : k, hal: null })}
                 aria-pressed={tab === k}>{t}</a>
            ))}
          </div>
          <span className="badge b-mute" style={{ marginLeft: 'auto' }}>{num(data.total)} pelanggan</span>
        </div>
        {tab === 'teratas' && <div className="card-body" style={{ paddingBottom: 0 }}>
          <p className="t-mute" style={{ fontSize: 12.5, margin: 0 }}>20% pelanggan dengan belanja terbesar dari hasil saringan saat ini.</p></div>}
        {tab === 'batal' && <div className="card-body" style={{ paddingBottom: 0 }}>
          <p className="t-mute" style={{ fontSize: 12.5, margin: 0 }}>Pelanggan dengan minimal 2 pesanan batal, atau rasio batal minimal 30%.</p></div>}

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Pelanggan</th>
              <th className="t-right">{kepala('pesanan', 'Pesanan')}</th>
              <th className="t-right">{kepala('batal', 'Batal')}</th>
              <th className="t-right">{kepala('belanja', 'Total belanja')}</th>
              <th className="t-right">Rata-rata</th>
              <th className="t-right kol-opsional">Pertama</th>
              <th className="t-right">{kepala('terakhir', 'Terakhir')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {data.baris.map((b) => (
                <tr key={b.pembeli_id}>
                  <td className="t-strong">{b.username || <span className="mono t-mute">P-{b.pembeli_id.slice(0, 8)}</span>}
                    {b.toko > 1 && <span className="badge b-mute" style={{ marginLeft: 6 }}>{b.toko} toko</span>}</td>
                  <td className="t-num">{num(b.pesanan)}</td>
                  <td className="t-num" style={b.batal ? { color: 'var(--neg)' } : undefined}>
                    {b.batal ? `${b.batal} · ${pct((b.batal / b.pesanan) * 100)}` : '—'}</td>
                  <td className="t-num t-strong">{rp(b.belanja)}</td>
                  <td className="t-num t-mute">{rp(b.rata)}</td>
                  <td className="t-num t-mute kol-opsional">{tgl(b.pertama)}</td>
                  <td className="t-num t-mute">{tgl(b.terakhir)}</td>
                  <td><a className="btn btn-sm" href={`/pelanggan/${b.pembeli_id}`}>Detail</a></td>
                </tr>
              ))}
              {!data.baris.length && <tr><td colSpan={8}>
                <Kosong judul="Tidak ada pelanggan" anak="Coba ubah rentang tanggal atau saringannya." /></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={data.total} qs={qs} aksi="/pelanggan" bawah />
        </div>
      </div>
    </Shell>
  );
}

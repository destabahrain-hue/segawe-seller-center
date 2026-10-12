import Shell from '../../Shell';
import RangePicker from '../../RangePicker';
import { Kpi, Catatan } from '../../UI';
import { ensureSchema, q } from '@/lib/db';
import { kurir } from '@/lib/pelanggan';
import { rentang } from '@/lib/rentang';
import { rp, num, pct } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Kurir({ searchParams }) {
  await ensureSchema();
  const kode = searchParams?.r || '30h';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const shopId = searchParams?.toko || null;

  const [toko, data] = await Promise.all([
    q(`SELECT shop_id, shop_name FROM shops ORDER BY shop_name`),
    kurir({ dari: r.dari, sampai: r.sampai, shopId }),
  ]);
  const totalPesanan = data.reduce((a, x) => a + x.pesanan, 0) || 1;
  const totalOmzet = data.reduce((a, x) => a + Number(x.omzet), 0);
  const maks = Math.max(...data.map((x) => x.pesanan), 1);
  const tercepat = data.filter((x) => x.jam_jemput)
    .sort((a, b) => Number(a.jam_jemput) - Number(b.jam_jemput))[0];

  const qsToko = (id) => {
    const p = new URLSearchParams();
    if (kode !== '30h') p.set('r', kode);
    if (searchParams?.dari) { p.set('dari', searchParams.dari); p.set('sampai', searchParams.sampai || ''); }
    if (id) p.set('toko', id);
    const s = p.toString();
    return '/pelanggan/kurir' + (s ? '?' + s : '');
  };

  return (
    <Shell judul="Distribusi Kurir" rute="/pelanggan">
      <RangePicker aktif={kode} awal={searchParams?.dari || ''} akhir={searchParams?.sampai || ''} />
      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Toko</div>
          <div className="filter-vals">
            <a className="chip" href={qsToko(null)} aria-pressed={!shopId}>Semua toko</a>
            {toko.map((t) => (
              <a key={t.shop_id} className="chip" href={qsToko(t.shop_id)}
                 aria-pressed={String(shopId) === String(t.shop_id)}>{t.shop_name || t.shop_id}</a>
            ))}
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="Kurir terbanyak" nilai={data[0]?.nama || '—'}
             sub={data[0] ? `${pct((data[0].pesanan / totalPesanan) * 100)} pesanan` : ''} />
        <Kpi label="Jumlah kurir" nilai={num(data.length)} sub="dipakai pada rentang ini" />
        <Kpi label="Penjemputan tercepat" nilai={tercepat ? `${Number(tercepat.jam_jemput).toFixed(1)} jam` : '—'}
             sub={tercepat ? tercepat.nama : 'belum ada data serah-terima'} />
        <Kpi label="Omzet" nilai={rp(totalOmzet)} sub={`${num(totalPesanan)} pesanan sah`} />
      </div>

      <div className="card">
        <div className="card-head"><h2>Kurir yang dipilih pembeli</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th style={{ width: 26 }}>#</th><th>Kurir</th>
            <th className="t-right">Pesanan</th><th className="t-right">Porsi</th>
            <th className="t-right">Omzet</th><th className="t-right">Rata-rata jemput</th>
            <th style={{ width: '22%' }}></th></tr></thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.nama}>
                <td className="t-mute">{i + 1}</td>
                <td className="t-strong">{d.nama}</td>
                <td className="t-num">{num(d.pesanan)}</td>
                <td className="t-num t-mute">{pct((d.pesanan / totalPesanan) * 100)}</td>
                <td className="t-num">{rp(d.omzet)}</td>
                <td className="t-num t-mute">{d.jam_jemput ? `${Number(d.jam_jemput).toFixed(1)} jam` : '—'}</td>
                <td><div style={{ height: 7, borderRadius: 99, background: 'var(--brand)',
                                  width: `${(d.pesanan / maks) * 100}%` }} /></td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={7} className="t-mute">Belum ada pesanan di rentang ini.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <Catatan>
        <b>Rata-rata jemput</b> dihitung dari jeda antara pesanan diatur kirim sampai barang benar-benar
        diserahkan ke kurir. Berguna membandingkan kecepatan kurir, dan melihat apakah ada penumpukan di gudang.
        {' '}<b>Sebaran kota dan provinsi tidak ada di sini</b> karena Shopee menyensor seluruh alamat
        pembeli untuk aplikasi tanpa akses data sensitif — yang terkirim hanya tanda bintang.
      </Catatan>
    </Shell>
  );
}

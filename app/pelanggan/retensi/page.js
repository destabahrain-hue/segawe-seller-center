import Shell from '../../Shell';
import { Kpi, Catatan } from '../../UI';
import { ensureSchema, q } from '@/lib/db';
import { retensi } from '@/lib/pelanggan';
import { rp, num, pct } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export default async function Retensi({ searchParams }) {
  await ensureSchema();
  const shopId = searchParams?.toko || null;
  const [toko, r] = await Promise.all([
    q(`SELECT shop_id, shop_name FROM shops ORDER BY shop_name`),
    retensi({ shopId, bulan: 12 }),
  ]);
  const b = r.balik, s = r.segmen;
  const persen = (x) => (b.pelanggan ? (x / b.pelanggan) * 100 : 0);
  const totalSeg = (s.sekali || 0) + (s.berulang || 0) + (s.setia || 0);
  const maks = Math.max(...r.perBulan.map((x) => x.aktif), 1);

  return (
    <Shell judul="Retensi & Segmen" rute="/pelanggan">
      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Toko</div>
          <div className="filter-vals">
            <a className="chip" href="/pelanggan/retensi" aria-pressed={!shopId}>Semua toko</a>
            {toko.map((t) => (
              <a key={t.shop_id} className="chip" href={`/pelanggan/retensi?toko=${t.shop_id}`}
                 aria-pressed={String(shopId) === String(t.shop_id)}>{t.shop_name || t.shop_id}</a>
            ))}
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="Pernah belanja lagi" nilai={pct(persen(b.pernah_ulang))}
             sub={`${num(b.pernah_ulang)} dari ${num(b.pelanggan)} pelanggan`} />
        <Kpi label="Kembali dalam 30 hari" nilai={pct(persen(b.d30))} sub={`${num(b.d30)} pelanggan`} />
        <Kpi label="Kembali dalam 90 hari" nilai={pct(persen(b.d90))} sub={`${num(b.d90)} pelanggan`} />
        <Kpi label="Jeda ke pembelian kedua" nilai={b.jeda_hari ? `${Math.round(b.jeda_hari)} hari` : '—'}
             sub="rata-rata" />
      </div>

      <Catatan>
        Yang dihitung hanya pelanggan yang <b>pesanan pertamanya lebih dari 90 hari lalu</b>. Kalau pembeli
        minggu ini ikut dihitung, angka retensi akan terlihat jauh lebih buruk dari kenyataan — mereka
        memang belum sempat kembali.
      </Catatan>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Pelanggan aktif per bulan</h2>
          <span className="badge b-mute">baru vs berulang</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Bulan</th><th className="t-right">Aktif</th><th className="t-right">Baru</th>
            <th className="t-right">Berulang</th><th style={{ width: '40%' }}></th></tr></thead>
          <tbody>
            {r.perBulan.map((x) => {
              const d = new Date(x.bulan);
              const ulang = x.aktif - x.baru;
              return (
                <tr key={x.bulan}>
                  <td className="t-strong">{BULAN[d.getUTCMonth()]} {d.getUTCFullYear()}</td>
                  <td className="t-num">{num(x.aktif)}</td>
                  <td className="t-num">{num(x.baru)}</td>
                  <td className="t-num t-strong">{num(ulang)}</td>
                  <td>
                    <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden',
                                  background: 'var(--surface-sunken)', width: `${(x.aktif / maks) * 100}%` }}>
                      <div style={{ width: `${(x.baru / x.aktif) * 100}%`, background: 'var(--brand)' }} />
                      <div style={{ flex: 1, background: 'var(--pos)' }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {!r.perBulan.length && <tr><td colSpan={5} className="t-mute">Belum ada data.</td></tr>}
          </tbody>
        </table></div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <span className="t-mute" style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--brand)' }}>■</span> baru ·
            <span style={{ color: 'var(--pos)' }}> ■</span> berulang
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Segmen pelanggan</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Segmen</th><th>Artinya</th><th className="t-right">Pelanggan</th><th className="t-right">Porsi</th></tr></thead>
          <tbody>
            <tr><td className="t-strong">Sekali beli</td><td className="t-mute">1 pesanan sah</td>
              <td className="t-num">{num(s.sekali)}</td><td className="t-num">{pct(totalSeg ? (s.sekali / totalSeg) * 100 : 0)}</td></tr>
            <tr><td className="t-strong">Berulang</td><td className="t-mute">2–3 pesanan</td>
              <td className="t-num">{num(s.berulang)}</td><td className="t-num">{pct(totalSeg ? (s.berulang / totalSeg) * 100 : 0)}</td></tr>
            <tr><td className="t-strong">Setia</td><td className="t-mute">4 pesanan atau lebih</td>
              <td className="t-num">{num(s.setia)}</td><td className="t-num">{pct(totalSeg ? (s.setia / totalSeg) * 100 : 0)}</td></tr>
            <tr><td className="t-strong">Lama tidak kembali</td><td className="t-mute">terakhir belanja &gt; 180 hari lalu</td>
              <td className="t-num">{num(s.hilang)}</td><td className="t-num">{pct(totalSeg ? (s.hilang / totalSeg) * 100 : 0)}</td></tr>
          </tbody>
        </table></div>
        <div className="card-body">
          <p style={{ fontSize: 13, margin: 0 }}>
            Pelanggan berulang menyumbang <b>{rp(Number(s.belanja_berulang))}</b> dari total{' '}
            <b>{rp(Number(s.belanja_semua))}</b>
            {Number(s.belanja_semua) > 0 && <> ({pct((Number(s.belanja_berulang) / Number(s.belanja_semua)) * 100)})</>}.
          </p>
        </div>
      </div>
    </Shell>
  );
}

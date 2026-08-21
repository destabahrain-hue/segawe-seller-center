import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kpi, Catatan, Batang } from '../UI';
import RangePicker from '../RangePicker';
import Riwayat from './Riwayat';
import Iklan from './Iklan';
import { ensureSchema } from '@/lib/db';
import { ringkasan, deret } from '@/lib/report';
import { rentang, sebelumnya } from '@/lib/rentang';
import { one } from '@/lib/db';
import { ringkasIklan } from '@/lib/iklan';
import { rp, num, pct } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function LaporanToko({ searchParams }) {
  await ensureSchema();
  const kode = searchParams?.r || 'kemarin';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const [kini, lalu, seri, iklan, jangkauan] = await Promise.all([
    ringkasan(r), ringkasan(sebelumnya(r)), deret(r),
    ringkasIklan().catch(() => null),
    one(`SELECT MIN(created_time) AS terawal,
                (SELECT COUNT(*)::int FROM jobs
                  WHERE kind = 'tarik_riwayat' AND status IN ('pending','running')) AS menunggu
         FROM orders`).catch(() => null),
  ]);
  const t = kini.total, l = lalu.total;
  const naik = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const grafik = seri.map((d) => ({
    label: new Date(d.titik).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
    omzet: d.omzet, laba: d.omzet * (t.omzet ? t.laba / t.omzet : 0),
  }));

  return (
    <Shell judul="Laporan Toko" rute="/laporan-toko" kanan={<AutoSegar detik={120} />}>
      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Periode</div>
          <RangePicker aktif={kode} awal={r.awal || ''} akhir={r.akhir || ''} />
        </div>
      </div>

      <Riwayat terawal={jangkauan?.terawal || null} menunggu={Number(jangkauan?.menunggu || 0)} />
      <Iklan baris={Number(iklan?.baris || 0)}
             terawal={iklan?.terawal
               ? new Date(iklan.terawal).toLocaleDateString('id-ID',
                   { day: '2-digit', month: 'long', year: 'numeric' })
               : null} />

      <div className="kpi-row">
        <Kpi lead label="Omzet bersih" nilai={rp(t.omzet)} delta={naik(t.omzet, l.omzet)} sub="vs periode sebelumnya" />
        <Kpi lead label="Laba bersih" nilai={rp(t.laba)} delta={naik(t.laba, l.laba)} warna="var(--pos)" sub={`margin ${pct(t.margin)}`} />
        <Kpi label="Pesanan" nilai={num(t.pesanan)} delta={naik(t.pesanan, l.pesanan)} sub={`sebelumnya ${num(l.pesanan)}`} />
        <Kpi label="Barang terjual" nilai={num(t.unit)} delta={naik(t.unit, l.unit)} sub={`sebelumnya ${num(l.unit)}`} />
        <Kpi label="Dana diterima" nilai={rp(t.diterima)}
             sub={t.perkiraan > 0
               ? `${t.perkiraan} pesanan belum cair`
               : 'seluruh pesanan sudah cair'} />
        <Kpi label="Biaya iklan" nilai={rp(t.iklan)}
             sub={t.iklanPokok
               ? `termasuk PPN ${rp(t.iklanPpn)} · ROAS ${(t.omzet / t.iklan).toFixed(1)}×`
               : 'belum ada data iklan'} />
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head">
          <h2>Omzet &amp; laba — {r.label}</h2><div className="spacer" />
          <span className="lg"><i className="sw sw-y" />Omzet</span>
          <span className="lg"><i className="sw sw-l" />Laba</span>
        </div>
        <div className="card-body"><Batang data={grafik} /></div>
      </div>

      <Catatan>
        <b>Tiga angka omzet itu berbeda, jangan tertukar.</b> <b>Omzet</b> = yang dibayar pembeli.
        <b> Dana diterima</b> = sisa setelah komisi dan biaya layanan Shopee.
        <b> Laba</b> = omzet dikurangi HPP, biaya platform, dan iklan.
        {t.perkiraan > 0 && <> Saat ini <b>{t.perkiraan} pesanan</b> belum cair,
          jadi biayanya ditaksir memakai tarif potongan <b>{(t.tarif * 100).toFixed(1)}%</b>
          {t.sampel >= 5
            ? ' yang diukur dari pesananmu sendiri yang sudah cair.'
            : ' cadangan — belum cukup pesanan cair untuk mengukurnya dari datamu.'}</>}
      </Catatan>

      <div className="card">
        <div className="card-head"><h2>Rincian per toko</h2><span className="badge b-mute">{r.label}</span></div>
        <div className="table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th className="sticky-c">Toko</th>
                <th className="t-right">Pesanan</th><th className="t-right">Qty</th>
                <th className="t-right">Omzet</th><th className="t-right">HPP</th>
                <th className="t-right">Biaya platform</th><th className="t-right">Iklan + PPN</th>
                <th className="t-right">Laba bersih</th><th className="t-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {kini.toko.map((s) => (
                <tr key={s.shopId}>
                  <td className="t-strong sticky-c">{s.nama}</td>
                  <td className="t-num">{num(s.pesanan)}</td>
                  <td className="t-num">{num(s.unit)}</td>
                  <td className="t-num t-strong">{rp(s.omzet)}</td>
                  <td className="t-num">{rp(s.hpp)}</td>
                  <td className="t-num">{rp(s.biaya)}</td>
                  <td className="t-num">{rp(s.iklan)}</td>
                  <td className="t-num t-strong" style={s.laba < 0 ? { color: 'var(--neg)' } : undefined}>{rp(s.laba)}</td>
                  <td className="t-num" style={s.laba < 0 ? { color: 'var(--neg)' } : undefined}>{pct(s.margin)}</td>
                </tr>
              ))}
              {!kini.toko.length && <tr><td colSpan={9} className="t-mute">Tidak ada data pada periode ini.</td></tr>}
            </tbody>
            {kini.toko.length > 0 && (
              <tfoot><tr>
                <td className="sticky-c">Total {kini.toko.length} toko</td>
                <td className="t-num">{num(t.pesanan)}</td><td className="t-num">{num(t.unit)}</td>
                <td className="t-num">{rp(t.omzet)}</td><td className="t-num">{rp(t.hpp)}</td>
                <td className="t-num">{rp(t.biaya)}</td><td className="t-num">{rp(t.iklan)}</td>
                <td className="t-num">{rp(t.laba)}</td><td className="t-num">{pct(t.margin)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </Shell>
  );
}

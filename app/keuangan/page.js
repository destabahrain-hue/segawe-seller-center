import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import RangePicker from '../RangePicker';
import { Catatan } from '../UI';
import { ensureSchema } from '@/lib/db';
import { ringkasan, perSku } from '@/lib/report';
import { rentang } from '@/lib/rentang';
import { rp, num, pct } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Keuangan({ searchParams }) {
  await ensureSchema();
  const kode = searchParams?.r || 'bulan-ini';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const [ring, sku] = await Promise.all([ringkasan(r), perSku({ ...r, limit: 15 })]);
  const t = ring.total;

  return (
    <Shell judul="Keuangan" rute="/keuangan" kanan={<AutoSegar detik={180} />}>
      <div className="filter-bar">
        <div className="filter-row"><div className="filter-key">Periode</div><RangePicker aktif={kode} awal={r.awal || ''} akhir={r.akhir || ''} /></div>
      </div>

      {t.perkiraan > 0 && (
        <Catatan>
          <b>{t.perkiraan} pesanan belum direkonsiliasi.</b> Rincian dana Shopee baru keluar setelah
          pesanan selesai, jadi biaya platform untuk pesanan itu masih memakai persentase perkiraan.
          Angka akan diperbarui sendiri saat dana dilepas.
        </Catatan>
      )}

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Laba rugi — {r.label}</h2></div>
        <div className="table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th className="sticky-c">Toko</th>
                <th className="t-right">Omzet</th><th className="t-right">HPP</th>
                <th className="t-right">Biaya platform</th><th className="t-right">Iklan + PPN</th>
                <th className="t-right">Laba bersih</th><th className="t-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {ring.toko.map((s) => (
                <tr key={s.shopId}>
                  <td className="t-strong sticky-c">{s.nama}</td>
                  <td className="t-num">{rp(s.omzet)}</td>
                  <td className="t-num">{rp(s.hpp)}</td>
                  <td className="t-num">{rp(s.biaya)}</td>
                  <td className="t-num">{rp(s.iklan)}</td>
                  <td className="t-num t-strong" style={s.laba < 0 ? { color: 'var(--neg)' } : undefined}>{rp(s.laba)}</td>
                  <td className="t-num" style={s.laba < 0 ? { color: 'var(--neg)' } : undefined}>{pct(s.margin)}</td>
                </tr>
              ))}
              {!ring.toko.length && <tr><td colSpan={7} className="t-mute">Belum ada data pada periode ini.</td></tr>}
            </tbody>
            {ring.toko.length > 0 && (
              <tfoot><tr>
                <td className="sticky-c">Total {ring.toko.length} toko</td>
                <td className="t-num">{rp(t.omzet)}</td><td className="t-num">{rp(t.hpp)}</td>
                <td className="t-num">{rp(t.biaya)}</td><td className="t-num">{rp(t.iklan)}</td>
                <td className="t-num">{rp(t.laba)}</td><td className="t-num">{pct(t.margin)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Penjualan per Master SKU</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Master SKU</th><th className="t-right">Terjual</th><th className="t-right">Omzet</th></tr></thead>
            <tbody>
              {sku.map((s) => (
                <tr key={s.code}>
                  <td className="t-strong">{s.name} <span className="mono t-mute">{s.code}</span>
                    {!s.tertaut && <span className="badge b-warn" style={{ marginLeft: 6 }}>belum tertaut</span>}</td>
                  <td className="t-num">{num(s.unit)}</td>
                  <td className="t-num t-strong">{rp(s.omzet)}</td>
                </tr>
              ))}
              {!sku.length && <tr><td colSpan={3} className="t-mute">Belum ada SKU tertaut dengan penjualan.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

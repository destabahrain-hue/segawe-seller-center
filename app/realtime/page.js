import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kpi, Kosong } from '../UI';
import { ensureSchema } from '@/lib/db';
import { ringkasan, deret, perSku } from '@/lib/report';
import { rentang, sebelumnya } from '@/lib/rentang';
import { rp, num, pct } from '@/lib/fmt';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Realtime() {
  await ensureSchema();
  const r = rentang('hari-ini');
  const [kini, lalu, jamJam, produk] = await Promise.all([
    ringkasan(r), ringkasan(sebelumnya(r)),
    deret({ ...r, satuan: 'hour' }), perSku({ ...r, limit: 8 }),
  ]);
  const t = kini.total, l = lalu.total;
  const naik = (a, b) => (b ? ((a - b) / b) * 100 : 0);

  const jamAda = new Map(jamJam.map((d) => [new Date(d.titik).getUTCHours(), d.omzet]));
  const bar = Array.from({ length: 24 }, (_, i) => ({ jam: i, omzet: jamAda.get(i) || 0 }));
  const mx = Math.max(...bar.map((b) => b.omzet), 1);
  const jamSekarang = Number(new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(new Date()));

  return (
    <Shell judul="Laporan Realtime" rute="/realtime" kanan={<AutoSegar detik={30} />}>
      <div className="live">
        <span className="live-dot" aria-hidden="true" />
        <span className="live-t">Diperbarui {new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })}</span>
        <span className="live-s">
          data ditarik otomatis dari Shopee tiap beberapa menit · halaman ini menyegar sendiri
        </span>
      </div>

      <div className="kpi-row">
        <Kpi lead label="Omzet hari ini" nilai={rp(t.omzet)} delta={naik(t.omzet, l.omzet)} sub={`vs kemarin jam ini (${rp(l.omzet)})`} />
        <Kpi lead label="Laba berjalan" nilai={rp(t.laba)} warna="var(--pos)" sub={`margin ${pct(t.margin)}`} />
        <Kpi label="Pesanan" nilai={num(t.pesanan)} delta={naik(t.pesanan, l.pesanan)} sub={`kemarin ${num(l.pesanan)}`} />
        <Kpi label="Barang terjual" nilai={num(t.unit)} delta={naik(t.unit, l.unit)} sub={`kemarin ${num(l.unit)}`} />
      </div>

      <div className="grid-rt">
        <div className="card">
          <div className="card-head">
            <h2>Penjualan per jam</h2><div className="spacer" />
            <span className="lg"><i className="sw sw-t" />Omzet per jam</span>
          </div>
          <div className="card-body">
            {t.omzet === 0 ? <Kosong judul="Belum ada penjualan hari ini" anak="Grafik terisi setelah pesanan pertama masuk dan disinkronkan." /> : (
              <svg className="chart" viewBox="0 0 900 260" role="img" aria-label="Omzet per jam hari ini">
                {[0, 1, 2, 3].map((i) => {
                  const y = 22 + (204 * i) / 3;
                  return <g key={i}>
                    <line className="gridline" x1="58" y1={y} x2="880" y2={y} />
                    <text className="axis-t" x="50" y={y + 4} textAnchor="end">{((mx * (3 - i)) / 3 / 1e6).toFixed(1)} jt</text>
                  </g>;
                })}
                {bar.map((b, i) => {
                  const slot = (880 - 58) / 24, cx = 58 + slot * i + slot / 2;
                  const h = (b.omzet / mx) * 204;
                  return <rect key={i} className={i <= jamSekarang ? 'bar-t' : 'bar-y'}
                    x={cx - slot * 0.3} y={226 - h} width={slot * 0.6} height={h} rx="2">
                    <title>{String(i).padStart(2, '0')}.00 — {rp(b.omzet)}</title></rect>;
                })}
                {[0, 3, 6, 9, 12, 15, 18, 21].map((i) => {
                  const slot = (880 - 58) / 24;
                  return <text key={i} className="axis-t" x={58 + slot * i + slot / 2} y="246" textAnchor="middle">
                    {String(i).padStart(2, '0')}.00</text>;
                })}
              </svg>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Peringkat toko</h2><div className="spacer" /><span className="badge b-mute">hari ini</span></div>
          <div className="card-body rank-list">
            {kini.toko.map((s, i) => (
              <div className="rank" key={s.shopId}>
                <span className="rk">{i + 1}</span>
                <div className="rk-body">
                  <div className="rk-top">
                    <span className="rk-n">{s.nama}</span>
                    <span className="rk-v num">{rp(s.omzet)}</span>
                  </div>
                  <div className="rk-bar"><i style={{ width: `${(s.omzet / (kini.toko[0]?.omzet || 1)) * 100}%` }} /></div>
                  <div className="rk-sub">
                    <span style={s.laba < 0 ? { color: 'var(--neg)' } : undefined}>laba {rp(s.laba)}</span>
                    <span className="badge b-mute">{pct(s.margin)}</span>
                  </div>
                </div>
              </div>
            ))}
            {!kini.toko.length && <Kosong judul="Belum ada penjualan" anak="Peringkat muncul setelah pesanan pertama hari ini." />}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <div className="card-head"><h2>Produk terlaris hari ini</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th></th><th></th><th>Produk</th>
              <th className="t-right">Qty</th><th className="t-right">Omzet</th></tr></thead>
            <tbody>
              {produk.map((p, i) => (
                <tr key={p.code}>
                  <td className="t-mute" style={{ width: 30 }}>{i + 1}</td>
                  <td style={{ width: 46 }}>
                    {p.gambar
                      ? <img src={p.gambar} alt="" width={38} height={38} loading="lazy"
                             style={{ width: 38, height: 38, objectFit: 'cover',
                                      borderRadius: 'var(--r-sm)', border: '1px solid var(--line)',
                                      display: 'block', background: 'var(--surface-sunken)' }} />
                      : <div className="thumb">{String(p.code || '?').slice(0, 3).toUpperCase()}</div>}
                  </td>
                  <td className="t-strong">{p.name} <span className="mono t-mute">{p.code}</span>
                    {!p.tertaut && <span className="badge b-warn" style={{ marginLeft: 6 }}>belum tertaut</span>}</td>
                  <td className="t-num">{num(p.unit)}</td>
                  <td className="t-num t-strong">{rp(p.omzet)}</td>
                </tr>
              ))}
              {!produk.length && <tr><td colSpan={5} className="t-mute">Belum ada penjualan hari ini.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

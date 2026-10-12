import Shell from './Shell';
import AutoSegar from './AutoSegar';
import { Kpi, Ledger, Catatan } from './UI';
import { ensureSchema, q } from '@/lib/db';
import { ringkasanGabung } from '@/lib/gabung';
import { rentang, sebelumnya } from '@/lib/rentang';
import { rp, pct, jam } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  await ensureSchema();
  const r = rentang('hari-ini');
  const bulan = rentang('bulan-ini');

  const [hariIni, kemarin, bulanIni, toko] = await Promise.all([
    ringkasanGabung(r),
    ringkasanGabung(sebelumnya(r)),
    ringkasanGabung(bulan),
    // TikTok ikut di daftar status toko supaya kelihatan kalau penarikannya macet.
    q(`SELECT shop_id::text AS shop_id, shop_name, last_sync_at, 'Shopee' AS platform FROM shops
       UNION ALL
       SELECT shop_id, shop_name, last_sync_at, 'TikTok Shop' FROM tiktok_shops
       ORDER BY last_sync_at DESC NULLS LAST`).catch(() =>
      q('SELECT shop_id, shop_name, last_sync_at FROM shops ORDER BY last_sync_at DESC NULLS LAST')),
  ]);

  const sinkron = toko[0]?.last_sync_at ? `Sinkron terakhir ${jam(toko[0].last_sync_at)}` : 'Belum pernah sinkron';
  const naik = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const belumTertaut = hariIni.total.tanpaHpp;
  const belumTertautTt = hariIni.total.tiktok?.tanpaTaut || 0;

  return (
    <Shell judul="Dashboard" rute="/" kanan={<AutoSegar detik={60} />}>
      {toko.length === 0 ? (
        <Catatan>
          Belum ada toko yang terhubung. Buka halaman <b>Toko Terhubung</b> lalu klik
          &nbsp;<b>Hubungkan toko</b> untuk memberi izin lewat Shopee.
        </Catatan>
      ) : (belumTertaut > 0 || belumTertautTt > 0) && (
        <Catatan>
          <b>{belumTertaut > 0 && `${belumTertaut} pesanan Shopee`}
            {belumTertaut > 0 && belumTertautTt > 0 && ' dan '}
            {belumTertautTt > 0 && `${belumTertautTt} baris pesanan TikTok`} hari ini memakai SKU
            yang belum tertaut ke Master SKU.</b>{' '}
          HPP-nya dihitung nol, jadi laba di bawah ini terlalu tinggi. Rapikan di halaman Master SKU.
        </Catatan>
      )}

      <Ledger t={hariIni.total} keterangan={`${toko.length} toko`} />

      <div className="kpi-row">
        <Kpi label="Omzet bulan ini" nilai={rp(bulanIni.total.omzet)} sub="berjalan" />
        <Kpi label="Laba bulan ini" nilai={rp(bulanIni.total.laba)}
             sub={`margin ${pct(bulanIni.total.margin)}`} warna="var(--pos)" />
        <Kpi label="Omzet hari ini" nilai={rp(hariIni.total.omzet)}
             delta={naik(hariIni.total.omzet, kemarin.total.omzet)} sub="vs kemarin jam ini" />
        <Kpi label="Menunggu dana" nilai={hariIni.total.perkiraan + ' pesanan'} sub="Shopee · biaya masih perkiraan" />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Laba per toko hari ini</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Toko</th><th className="t-right">Omzet</th><th className="t-right">Laba</th><th className="t-right">Margin</th></tr></thead>
              <tbody>
                {hariIni.toko.map((t) => (
                  <tr key={t.shopId}>
                    <td className="t-strong">{t.nama}
                      {t.platform === 'TikTok Shop' &&
                        <span className="t-mute" style={{ fontWeight: 400 }}> (TikTok Shop)</span>}</td>
                    <td className="t-num">{rp(t.omzet)}</td>
                    <td className="t-num t-strong" style={t.laba < 0 ? { color: 'var(--neg)' } : undefined}>{rp(t.laba)}</td>
                    <td className="t-num" style={t.laba < 0 ? { color: 'var(--neg)' } : undefined}>{pct(t.margin)}</td>
                  </tr>
                ))}
                {!hariIni.toko.length && <tr><td colSpan={4} className="t-mute">Belum ada pesanan hari ini.</td></tr>}
              </tbody>
              {hariIni.toko.length > 0 && (
                <tfoot><tr>
                  <td>Total</td>
                  <td className="t-num">{rp(hariIni.total.omzet)}</td>
                  <td className="t-num">{rp(hariIni.total.laba)}</td>
                  <td className="t-num">{pct(hariIni.total.margin)}</td>
                </tr></tfoot>
              )}
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Status toko</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Toko</th><th>Sinkron terakhir</th></tr></thead>
              <tbody>
                {toko.map((t) => (
                  <tr key={`${t.platform || 'Shopee'}-${t.shop_id}`}>
                    <td className="t-strong">{t.shop_name || `Toko ${t.shop_id}`}
                      {t.platform === 'TikTok Shop' &&
                        <span className="t-mute" style={{ fontWeight: 400 }}> (TikTok Shop)</span>}</td>
                    <td className="t-mute">{jam(t.last_sync_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}

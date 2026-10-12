import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kpi, Catatan, Batang } from '../UI';
import RangePicker from '../RangePicker';
import { ensureSchema } from '@/lib/db';
import { ringkasanGabung, deretGabung } from '@/lib/gabung';
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
    ringkasanGabung(r), ringkasanGabung(sebelumnya(r)), deretGabung(r),
    ringkasIklan().catch(() => null),
    one(`SELECT MIN(created_time) AS terawal,
                (SELECT COUNT(*)::int FROM jobs
                  WHERE kind = 'tarik_riwayat' AND status IN ('pending','running')) AS menunggu
         FROM orders`).catch(() => null),
  ]);
  /**
   * Kartu di atas, grafik, dan tabel per toko kini membaca SATU total yang
   * sama (lib/gabung.js), Shopee + TikTok. Dulu kartu hanya Shopee sementara
   * tabel sudah menyertakan TikTok, jadi Omzet bersih di kartu selalu kurang
   * sebesar baris TikTok.
   */
  const semuaToko = kini.toko;
  const barisTiktok = semuaToko.filter((x) => x.platform === 'TikTok Shop');
  const tt = kini.total.tiktok;

  const t = kini.total, l = lalu.total;
  const naik = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  /**
   * `titik` dari deret() adalah jam dinding WIB TANPA zona waktu, yang
   * dibaca pg sebagai waktu UTC. Jadi diformat dengan timeZone 'UTC' supaya
   * angkanya tidak bergeser lagi. Rentang per jam memakai label jam —
   * dulu semua batang berlabel tanggal yang sama.
   */
  const grafik = seri.map((d) => ({
    label: r.satuan === 'hour'
      ? `${String(new Date(d.titik).getUTCHours()).padStart(2, '0')}:00`
      : new Date(d.titik).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
    omzet: d.omzet, laba: d.omzet * (t.omzet ? t.laba / t.omzet : 0),
  }));

  return (
    <Shell judul="Laporan Toko" rute="/laporan-toko"
           kanan={<><a className="btn btn-sm" href="/laporan-toko/sku">SKU Bocor</a>
                   <AutoSegar detik={120} /></>}>
      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Periode</div>
          <RangePicker aktif={kode} awal={r.awal || ''} akhir={r.akhir || ''} />
        </div>
      </div>

      {jangkauan?.terawal && (
        <Catatan>
          Data pesanan tersimpan sejak{' '}
          <b>{new Date(jangkauan.terawal).toLocaleDateString('id-ID',
            { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}</b>.
          Rentang yang lebih panjang akan terlihat sama karena pesanan lamanya belum ditarik.
          {Number(jangkauan.menunggu) > 0
            ? <> Sedang berjalan: <b>{jangkauan.menunggu} potongan</b> di antrean.</>
            : <> Tarik riwayat lebih lama di <a href="/toko">Toko Terhubung</a>.</>}
        </Catatan>
      )}
      {!iklan?.baris && (
        <Catatan>
          Biaya iklan belum pernah ditarik, jadi laba di bawah masih terlihat lebih besar dari kenyataan.
          Tarik di <a href="/toko">Toko Terhubung</a>.
        </Catatan>
      )}

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
             sub={t.iklan
               ? `termasuk PPN Shopee ${rp(t.iklanPpn)} · ROAS ${(t.omzet / t.iklan).toFixed(1)}×`
                 + (tt.toko && tt.tanpaIklan ? ' · iklan TikTok belum diisi' : '')
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
        <b> Dana diterima</b> = sisa setelah komisi dan biaya layanan Shopee / TikTok.
        <b> Laba</b> = omzet dikurangi HPP, biaya platform, dan iklan.
        {t.perkiraan > 0 && <> Saat ini <b>{t.perkiraan} pesanan</b> belum cair.</>}
        {t.dariShopee > 0 && <> Biaya platform <b>{t.dariShopee} pesanan</b> diambil dari
          perkiraan penghasilan Shopee (sudah termasuk biaya campaign &amp; voucher).</>}
        {t.ditaksir > 0 && <> <b>{t.ditaksir} pesanan</b> lainnya belum punya perkiraan, jadi
          biayanya ditaksir memakai tarif potongan <b>{(t.tarif * 100).toFixed(1)}%</b>
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
              {semuaToko.map((s) => (
                <tr key={s.shopId}>
                  <td className="t-strong sticky-c">{s.nama}
                    {s.platform === 'TikTok Shop' &&
                      <span className="t-mute" style={{ fontWeight: 400 }}> (TikTok Shop)</span>}
                    {s.tanpaTaut > 0 && <a href="/master-sku" className="badge b-warn"
                      style={{ marginLeft: 6 }}>{s.tanpaTaut} SKU belum tertaut</a>}</td>
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
              {!semuaToko.length && <tr><td colSpan={9} className="t-mute">Tidak ada data pada periode ini.</td></tr>}
            </tbody>
            {semuaToko.length > 0 && (
              <tfoot><tr>
                <td className="sticky-c">Total {semuaToko.length} toko</td>
                <td className="t-num">{num(t.pesanan)}</td>
                <td className="t-num">{num(t.unit)}</td>
                <td className="t-num">{rp(t.omzet)}</td>
                <td className="t-num">{rp(t.hpp)}</td>
                <td className="t-num">{rp(t.biaya)}</td>
                <td className="t-num">{rp(t.iklan)}</td>
                <td className="t-num">{rp(t.laba)}</td>
                <td className="t-num">{pct(t.margin)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>
    {barisTiktok.length > 0 && (
        <Catatan>
          <b>Baris TikTok Shop</b> sudah ikut di semua angka di atas. Untuk pesanan TikTok yang
          sudah cair, biaya platformnya <b>nyata</b> (omzet − uang cair dari transaksi statement);
          yang belum cair ditaksir memakai tarif yang diukur dari pesanan TikTok yang sudah cair.
          Rata-rata potongan TikTok periode ini <b>{tt.tarif !== null ? (tt.tarif * 100).toFixed(1) + '%' : '—'}</b>.
          Biaya iklannya <b>diisi manual</b> karena iklan TikTok Shop tidak tersedia di API Shop —
          {' '}<a href="/tiktok">isi di halaman TikTok Shop</a>.
          {barisTiktok.some((x) => x.tanpaIklan) && <> <b>Biaya iklan TikTok belum diisi untuk periode
            ini</b>, jadi laba bersihnya masih terlihat lebih besar dari kenyataan.</>}
        </Catatan>
      )}

    </Shell>
  );
}

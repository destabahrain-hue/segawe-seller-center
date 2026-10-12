import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import RangePicker from '../RangePicker';
import { Catatan } from '../UI';
import { ensureSchema } from '@/lib/db';
import Paginasi, { bacaPer } from '../Paginasi';
import { ringkasPeriode, perSkuPeriode } from '@/lib/keuangan';
import { bonusPeriode } from '@/lib/bonus-iklan';
import { rentang } from '@/lib/rentang';
import { rp, num, pct, hariJakarta } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Keuangan({ searchParams }) {
  await ensureSchema();
  const kode = searchParams?.r || 'bulan-ini';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const urut = searchParams?.urut === 'terjual' ? 'terjual' : 'uang';
  const arah = searchParams?.arah === 'asc' ? 'asc' : 'desc';
  const perHalaman = bacaPer(searchParams?.per);
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);
  /**
   * Basisnya TANGGAL DANA DILEPAS, sama dengan Laporan Mingguan & Bulanan —
   * jadi halaman ini bisa disandingkan langsung dengan keduanya, hanya beda
   * rentang tanggalnya. Pesanan yang dananya belum cair TIDAK masuk sini;
   * gambaran lengkap termasuk yang belum cair ada di Laporan Toko.
   */
  const dari = hariJakarta(r.dari);
  const sampai = hariJakarta(r.sampai);   // eksklusif, sama seperti lib/keuangan
  const bonus = await bonusPeriode(dari, sampai);
  const [toko, sku] = await Promise.all([
    ringkasPeriode(dari, sampai, { bonus }),
    perSkuPeriode(dari, sampai, { urut, arah, limit: perHalaman, offset: (halaman - 1) * perHalaman }),
  ]);

  const t = toko.reduce((a, s) => ({
    pesanan: a.pesanan + s.pesanan, penjualan: a.penjualan + s.penjualan, hpp: a.hpp + s.hpp,
    margin: a.margin + s.margin, iklan: a.iklan + s.iklan, ppn: a.ppn + s.ppn,
    bonus: a.bonus + s.bonus, grossProfit: a.grossProfit + s.grossProfit,
    barisTanpaHpp: a.barisTanpaHpp + s.barisTanpaHpp,
  }), { pesanan: 0, penjualan: 0, hpp: 0, margin: 0, iklan: 0, ppn: 0, bonus: 0, grossProfit: 0, barisTanpaHpp: 0 });
  const persenDari = (a) => (t.penjualan ? (a / t.penjualan) * 100 : 0);

  const qs = (ubah) => {
    const p = new URLSearchParams();
    const v = { r: kode === 'bulan-ini' ? null : kode, dari: searchParams?.dari, sampai: searchParams?.sampai,
                urut: urut === 'uang' ? null : urut, arah: arah === 'desc' ? null : arah,
                per: perHalaman === 50 ? null : perHalaman, hal: halaman === 1 ? null : halaman, ...ubah };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    const s = p.toString();
    return '/keuangan' + (s ? '?' + s : '');
  };
  // Klik kolom yang sama membalik arah; klik kolom lain mulai dari terbesar.
  const kepala = (kunci, teks) => {
    const aktif = urut === kunci;
    const arahBaru = aktif && arah === 'desc' ? 'asc' : 'desc';
    return (
      <a href={qs({ urut: kunci === 'uang' ? null : kunci, arah: arahBaru === 'desc' ? null : arahBaru, hal: null })}
         title={`Urutkan ${teks.toLowerCase()} ${arahBaru === 'desc' ? 'terbesar dulu' : 'terkecil dulu'}`}
         style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}>
        {teks} <span style={{ opacity: aktif ? 1 : 0.35 }}>{aktif ? (arah === 'desc' ? '↓' : '↑') : '↕'}</span>
      </a>
    );
  };

  return (
    <Shell judul="Keuangan" rute="/keuangan"
           kanan={<><a className="btn btn-sm" href="/keuangan/opex">Beban Operasional</a>
                   <AutoSegar detik={180} /></>}>
      <div className="filter-bar">
        <div className="filter-row"><div className="filter-key">Periode</div><RangePicker aktif={kode} awal={r.awal || ''} akhir={r.akhir || ''} /></div>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="k">Penjualan (uang masuk)</div>
          <div className="v num">{rp(t.penjualan)}</div>
          <div className="d">{num(t.pesanan)} pesanan cair</div></div>
        <div className="kpi"><div className="k">Laba kotor</div>
          <div className="v num">{rp(t.margin)}</div>
          <div className="d">margin {pct(persenDari(t.margin))}</div></div>
        <div className="kpi"><div className="k">Biaya iklan</div>
          <div className="v num">{rp(t.iklan)}</div>
          <div className="d">termasuk PPN {rp(t.ppn)}{t.bonus > 0 ? ` · bonus ${rp(t.bonus)}` : ''}</div></div>
        <div className="kpi"><div className="k">Laba sebelum opex</div>
          <div className="v num" style={{ color: t.grossProfit < 0 ? 'var(--neg)' : 'var(--pos)' }}>{rp(t.grossProfit)}</div>
          <div className="d">margin {pct(persenDari(t.grossProfit))}</div></div>
      </div>

      <Catatan>
        <b>Dasar tanggal: dana dilepas Shopee.</b> Hanya pesanan yang dananya sudah cair pada periode ini
        yang masuk — sama seperti Laporan Mingguan dan Bulanan, jadi angkanya bisa disandingkan.
        Untuk gambaran termasuk pesanan yang belum cair, buka <a href="/laporan-toko">Laporan Toko</a>.
        {' '}Beban operasional (gaji, listrik, sewa) belum dikurangkan di halaman ini.
        {t.barisTanpaHpp > 0 && <> <b>{num(t.barisTanpaHpp)} baris pesanan belum punya HPP</b>, jadi laba
          kotor di atas masih terlihat lebih besar dari kenyataan.</>}
      </Catatan>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Laba rugi — {r.label}</h2>
          <span className="badge b-mute">dana cair</span></div>
        <div className="table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th className="sticky-c">Toko</th>
                <th className="t-right">Pesanan</th>
                <th className="t-right">Penjualan</th><th className="t-right">HPP</th>
                <th className="t-right">Laba kotor</th><th className="t-right">Iklan + PPN</th>
                <th className="t-right">Laba</th><th className="t-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {toko.map((s) => (
                <tr key={s.shopId}>
                  <td className="t-strong sticky-c">{s.nama}</td>
                  <td className="t-num t-mute">{num(s.pesanan)}</td>
                  <td className="t-num">{rp(s.penjualan)}</td>
                  <td className="t-num">{rp(s.hpp)}</td>
                  <td className="t-num">{rp(s.margin)}</td>
                  <td className="t-num">{rp(s.iklan)}</td>
                  <td className="t-num t-strong" style={s.grossProfit < 0 ? { color: 'var(--neg)' } : undefined}>{rp(s.grossProfit)}</td>
                  <td className="t-num" style={s.grossProfit < 0 ? { color: 'var(--neg)' } : undefined}>
                    {pct(s.penjualan ? (s.grossProfit / s.penjualan) * 100 : 0)}</td>
                </tr>
              ))}
              {!toko.length && <tr><td colSpan={8} className="t-mute">Belum ada dana cair pada periode ini.</td></tr>}
            </tbody>
            {toko.length > 0 && (
              <tfoot><tr>
                <td className="sticky-c">Total {toko.length} toko</td>
                <td className="t-num">{num(t.pesanan)}</td>
                <td className="t-num">{rp(t.penjualan)}</td><td className="t-num">{rp(t.hpp)}</td>
                <td className="t-num">{rp(t.margin)}</td><td className="t-num">{rp(t.iklan)}</td>
                <td className="t-num">{rp(t.grossProfit)}</td>
                <td className="t-num">{pct(persenDari(t.grossProfit))}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Penjualan per Master SKU</h2>
          <span className="badge b-mute">{num(sku.total)} SKU</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th style={{ width: 52 }}></th>
              <th>Master SKU</th>
              <th className="t-right">{kepala('terjual', 'Terjual')}</th>
              <th className="t-right">{kepala('uang', 'Uang masuk')}</th>
            </tr></thead>
            <tbody>
              {sku.baris.map((s) => (
                <tr key={s.code}>
                  <td>
                    {s.gambar
                      ? <img src={s.gambar} alt="" width={40} height={40} loading="lazy"
                             style={{ borderRadius: 6, objectFit: 'cover', border: '1px solid var(--line)', display: 'block' }} />
                      : <div style={{ width: 40, height: 40, borderRadius: 6,
                                      background: 'var(--surface-sunken)', border: '1px solid var(--line)' }} />}
                  </td>
                  <td className="t-strong mono">{s.code}
                    {!s.tertaut && <span className="badge b-warn" style={{ marginLeft: 6 }}>belum tertaut</span>}</td>
                  <td className="t-num">{num(s.unit)}</td>
                  <td className="t-num t-strong">{rp(s.uang)}</td>
                </tr>
              ))}
              {!sku.baris.length && <tr><td colSpan={4} className="t-mute">Belum ada penjualan pada periode ini.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={sku.total} qs={qs}
                    aksi="/keuangan" bawah />
        </div>
      </div>
    </Shell>
  );
}

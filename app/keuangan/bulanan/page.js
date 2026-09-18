import Shell from '../../Shell';
import AutoSegar from '../../AutoSegar';
import { Kpi, Kosong, Catatan } from '../../UI';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema } from '@/lib/db';
import { laporanKeuangan, daftarBulan } from '@/lib/keuangan';
import { rp, num, pct } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function labelBulan(iso) {
  const d = new Date(iso);
  return `${NAMA_BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default async function LaporanBulanan({ searchParams }) {
  await ensureSchema();

  if (!bolehUang(await peranSekarang())) {
    return (
      <Shell judul="Laporan Bulanan" rute="/keuangan">
        <Kosong judul="Halaman ini hanya untuk peran yang boleh melihat data keuangan." />
      </Shell>
    );
  }

  const bulan = daftarBulan(12);
  const dipilih = bulan.find((b) => b.dari === searchParams?.bulan) || bulan[0];
  const L = await laporanKeuangan({ ...dipilih, mode: 'bulan' });
  const t = L.total;

  return (
    <Shell judul="Laporan Bulanan" rute="/keuangan"
           kanan={<>
             <a className="btn btn-sm btn-primary"
                href={`/api/keuangan/ekspor?bulan=${dipilih.dari}`}>Unduh Excel</a>
             <a className="btn btn-sm" href="/keuangan/opex">Beban Operasional</a>
             <AutoSegar detik={300} />
           </>}>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Bulan</div>
          <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select name="bulan" defaultValue={dipilih.dari}>
              {bulan.map((b) => (
                <option key={b.dari} value={b.dari}>{labelBulan(b.dari)}</option>
              ))}
            </select>
            <button className="btn btn-sm btn-primary" type="submit">Terapkan</button>
          </form>
        </div>
      </div>

      {L.opexKosong && (
        <Catatan>
          <b>Beban operasional bulan ini belum diisi.</b> Gaji, cicilan, listrik, wifi,
          dan operasional gudang belum masuk hitungan, jadi Nett Profit di bawah masih
          terlalu besar — yang tampil sebenarnya laba sebelum opex.{' '}
          <a href="/keuangan/opex">Isi sekarang</a>.
        </Catatan>
      )}

      {t.barisTanpaHpp > 0 && (
        <Catatan>
          <b>{num(t.barisTanpaHpp)} baris pesanan tidak punya HPP.</b> Modalnya terbaca
          nol, jadi laba pada baris itu terlalu besar. Periksa penautan SKU di Master SKU.
        </Catatan>
      )}

      <div className="kpi-row" style={{ marginBottom: 'var(--s4)' }}>
        <Kpi label="Penjualan" nilai={rp(t.penjualan)} sub={`${num(t.pesanan)} pesanan cair`} lead />
        <Kpi label="Gross Profit" nilai={rp(t.grossProfit)} sub={`margin ${pct(t.marginKotor)}`} />
        <Kpi label="Potongan Iklan" nilai={rp(t.iklan)} sub={`${pct(t.persenIklan)} dari penjualan`} />
        <Kpi label="Nett Profit" nilai={rp(t.nett)} sub={`margin ${pct(t.marginNett)}`}
             warna={t.nett < 0 ? 'var(--neg)' : 'var(--pos)'} />
      </div>

      {/* ── Susunan sengaja meniru sheet SUMMARRY, baris demi baris,
             supaya bisa disandingkan langsung dengan Excel ── */}
      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Laba rugi — {labelBulan(dipilih.dari)}</h2></div>
        <div className="table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th className="sticky-c">Keterangan</th>
                <th className="t-right">Saldo</th>
                <th className="t-right">%</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="sticky-c"><b>PENDAPATAN</b></td><td /><td /></tr>
              <tr>
                <td className="sticky-c" style={{ paddingLeft: 28 }}>Penjualan</td>
                <td className="t-right">{rp(t.penjualan)}</td><td />
              </tr>
              <tr>
                <td className="sticky-c" style={{ paddingLeft: 28 }}>Harga Pokok Penjualan</td>
                <td className="t-right">{rp(t.hpp)}</td>
                <td className="t-right">{pct(t.penjualan ? (t.hpp / t.penjualan) * 100 : 0)}</td>
              </tr>
              <tr>
                <td className="sticky-c"><b>GROSS PROFIT</b></td>
                <td className="t-right"><b>{rp(t.grossProfit)}</b></td>
                <td className="t-right"><b>{pct(t.marginKotor)}</b></td>
              </tr>

              <tr><td className="sticky-c"><b>BEBAN</b></td><td /><td /></tr>
              <tr>
                <td className="sticky-c" style={{ paddingLeft: 28 }}>
                  Potongan Iklan <span style={{ opacity: 0.6 }}>(include PPN 11%)</span>
                </td>
                <td className="t-right">{rp(t.iklan)}</td>
                <td className="t-right">{pct(t.persenIklan)}</td>
              </tr>
              {L.beban.map((b) => (
                <tr key={b.jenis}>
                  <td className="sticky-c" style={{ paddingLeft: 28 }}>{b.jenis}</td>
                  <td className="t-right">{rp(b.nominal)}</td>
                  <td className="t-right">{pct(b.persen)}</td>
                </tr>
              ))}

              <tr>
                <td className="sticky-c"><b>NETT PROFIT</b></td>
                <td className="t-right" style={{ color: t.nett < 0 ? 'var(--neg)' : undefined }}>
                  <b>{rp(t.nett)}</b>
                </td>
                <td className="t-right"><b>{pct(t.marginNett)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Rekapitulasi per toko</h2></div>
        {L.toko.length === 0 ? (
          <Kosong judul="Belum ada pesanan yang dananya cair di bulan ini." />
        ) : (
          <div className="table-wrap">
            <table className="wide">
              <thead>
                <tr>
                  <th className="sticky-c">Toko</th>
                  <th className="t-right">Pesanan</th>
                  <th className="t-right">Penjualan Bersih</th>
                  <th className="t-right">HPP</th>
                  <th className="t-right">Margin</th>
                  <th className="t-right">%</th>
                  <th className="t-right">Total Iklan</th>
                  <th className="t-right">%</th>
                  <th className="t-right">Gross Profit</th>
                  <th className="t-right">%</th>
                </tr>
              </thead>
              <tbody>
                {L.toko.map((x) => (
                  <tr key={x.shopId}>
                    <td className="sticky-c">
                      {x.nama}
                      {x.manual && <span style={{ opacity: 0.6, fontSize: 12 }}> · manual</span>}
                    </td>
                    <td className="t-right">{x.pesanan ? num(x.pesanan) : '—'}</td>
                    <td className="t-right">{rp(x.penjualan)}</td>
                    <td className="t-right">{rp(x.hpp)}</td>
                    <td className="t-right">{rp(x.margin)}</td>
                    <td className="t-right">{pct(x.penjualan ? (x.margin / x.penjualan) * 100 : 0)}</td>
                    <td className="t-right">{rp(x.iklan)}</td>
                    <td className="t-right">{pct(x.penjualan ? (x.iklan / x.penjualan) * 100 : 0)}</td>
                    <td className="t-right"
                        style={{ color: x.grossProfit < 0 ? 'var(--neg)' : undefined }}>
                      {rp(x.grossProfit)}
                    </td>
                    <td className="t-right">{pct(x.penjualan ? (x.grossProfit / x.penjualan) * 100 : 0)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="sticky-c"><b>Total {L.toko.length} toko</b></td>
                  <td className="t-right"><b>{num(t.pesanan)}</b></td>
                  <td className="t-right"><b>{rp(t.penjualan)}</b></td>
                  <td className="t-right"><b>{rp(t.hpp)}</b></td>
                  <td className="t-right"><b>{rp(t.grossProfit)}</b></td>
                  <td className="t-right"><b>{pct(t.marginKotor)}</b></td>
                  <td className="t-right"><b>{rp(t.iklan)}</b></td>
                  <td className="t-right"><b>{pct(t.persenIklan)}</b></td>
                  <td className="t-right"><b>{rp(t.grossProfit - t.iklan)}</b></td>
                  <td className="t-right">
                    <b>{pct(t.penjualan ? ((t.grossProfit - t.iklan) / t.penjualan) * 100 : 0)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: 'var(--s4) var(--s5)', fontSize: 13, opacity: 0.75 }}>
          Gross Profit per toko sudah dikurangi iklan, tapi <b>belum</b> dikurangi beban
          operasional — opex dicatat di tingkat grup dan tidak dibagi ke toko, jadi
          jumlah kolom terakhir tidak sama dengan Nett Profit di atas.
        </div>
      </div>
    </Shell>
  );
}

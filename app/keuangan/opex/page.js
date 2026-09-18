import Shell from '../../Shell';
import { Kpi, Kosong, Catatan } from '../../UI';
import { FormOpex, FormTokoManual, TombolSalin, TombolHapus, UnggahTiktok,
         UnggahBonus } from './Form';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema } from '@/lib/db';
import { opexBulan, tokoManualBulan, awalBulan, JENIS_OPEX } from '@/lib/opex';
import { daftarBonus, LABEL_JENIS } from '@/lib/bonus-iklan';
import { rp, num } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function labelBulan(iso) {
  const d = new Date(iso);
  return `${NAMA_BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Dua belas bulan ke belakang, untuk pemilih bulan. */
function daftarBulan() {
  const out = [];
  const kini = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(kini.getUTCFullYear(), kini.getUTCMonth() - i, 1));
    out.push(awalBulan(d));
  }
  return out;
}

export default async function HalamanOpex({ searchParams }) {
  await ensureSchema();

  if (!bolehUang(await peranSekarang())) {
    return (
      <Shell judul="Beban Operasional" rute="/keuangan">
        <Kosong judul="Halaman ini hanya untuk peran yang boleh melihat data keuangan." />
      </Shell>
    );
  }

  const bulan = awalBulan(searchParams?.bulan || new Date());
  // Bonus tersimpan per hari, jadi dibaca dengan rentang — bukan bulan.
  const d = new Date(bulan);
  const akhir = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString().slice(0, 10);
  const [ox, manual, bonus] = await Promise.all([
    opexBulan(bulan), tokoManualBulan(bulan), daftarBonus(bulan, akhir),
  ]);
  const totalBonus = bonus.reduce((a, r) => a + Number(r.total || 0), 0);
  const totalManual = manual.reduce((a, r) => ({
    penjualan: a.penjualan + Number(r.penjualan || 0),
    hpp:       a.hpp       + Number(r.hpp || 0),
    iklan:     a.iklan     + Number(r.iklan || 0),
  }), { penjualan: 0, hpp: 0, iklan: 0 });
  const labaManual = totalManual.penjualan - totalManual.hpp - totalManual.iklan;

  return (
    <Shell judul="Beban Operasional" rute="/keuangan"
           kanan={<a className="btn btn-sm" href="/keuangan">Kembali ke Keuangan</a>}>

      <Catatan>
        Angka di halaman ini <b>diketik tangan</b>, bukan ditarik dari Shopee. Beban
        operasional dicatat di tingkat grup, tidak dibagi per toko. Toko manual hanya
        ikut di laporan <b>bulanan</b> — laporan mingguan berbasis tanggal dana cair
        per pesanan, dan data yang diketik tangan tidak punya rincian itu.
      </Catatan>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Bulan</div>
          <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select name="bulan" defaultValue={bulan}>
              {daftarBulan().map((b) => (
                <option key={b} value={b}>{labelBulan(b)}</option>
              ))}
            </select>
            <button className="btn btn-sm btn-primary" type="submit">Terapkan</button>
          </form>
        </div>
      </div>

      <div className="kpi-row" style={{ marginBottom: 'var(--s4)' }}>
        <Kpi label="Total beban operasional" nilai={rp(ox.total)} sub={labelBulan(bulan)} lead />
        <Kpi label="Jumlah pos beban" nilai={String(ox.baris.length)} />
        <Kpi label="Laba toko manual" nilai={rp(labaManual)}
             sub={manual.length ? `${manual.length} toko` : 'belum ada'} />
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head">
          <h2>Beban operasional — {labelBulan(bulan)}</h2>
          <TombolSalin bulan={bulan} />
        </div>

        <div style={{ padding: 'var(--s4) var(--s5)' }}>
          <FormOpex bulan={bulan} jenisPilihan={JENIS_OPEX} />
        </div>

        {ox.baris.length === 0 ? (
          <Kosong judul="Belum ada beban tercatat untuk bulan ini."
                  anak="Isi lewat form di atas, atau tekan Salin dari bulan lalu." />
        ) : (
          <div className="table-wrap">
            <table className="wide">
              <thead>
                <tr>
                  <th className="sticky-c">Jenis</th>
                  <th className="t-right">Nominal</th>
                  <th>Catatan</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ox.baris.map((r) => (
                  <tr key={r.id}>
                    <td className="sticky-c">{r.jenis}</td>
                    <td className="t-right">{rp(r.nominal)}</td>
                    <td>{r.catatan || '—'}</td>
                    <td className="t-right"><TombolHapus id={r.id} jenis="opex" /></td>
                  </tr>
                ))}
                <tr>
                  <td className="sticky-c"><b>Total</b></td>
                  <td className="t-right"><b>{rp(ox.total)}</b></td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Bonus iklan Shopee — {labelBulan(bulan)}</h2></div>

        <div style={{ padding: 'var(--s4) var(--s5)' }}>
          <UnggahBonus />
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>
            Ekspor dari Shopee Ads → Riwayat Transaksi, satu berkas per jenis bonus.
            Toko dan periodenya dibaca dari dalam berkas, jadi tidak ada yang perlu
            dipilih. Mengunggah berkas yang sama dua kali <b>menggantikan</b> isinya,
            bukan menambahkan. Bonus dikurangkan <b>sesudah</b> PPN — (beban × 1,11)
            − bonus — karena rebate tidak dikenai PPN.
          </div>
        </div>

        {bonus.length === 0 ? (
          <Kosong judul="Belum ada bonus tercatat untuk bulan ini."
                  anak="Tanpa ini, biaya iklan di laporan akan lebih tinggi dari semestinya." />
        ) : (
          <div className="table-wrap">
            <table className="wide">
              <thead>
                <tr>
                  <th className="sticky-c">Toko</th>
                  <th>Jenis</th>
                  <th className="t-right">Baris</th>
                  <th className="t-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {bonus.map((r) => (
                  <tr key={`${r.shop_id}-${r.jenis}`}>
                    <td className="sticky-c">{r.shop_name || `Toko ${r.shop_id}`}</td>
                    <td>{LABEL_JENIS[r.jenis] || r.jenis}</td>
                    <td className="t-right">{num(r.baris)}</td>
                    <td className="t-right">{rp(r.total)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="sticky-c"><b>Total</b></td>
                  <td colSpan={2} />
                  <td className="t-right"><b>{rp(totalBonus)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Toko manual — {labelBulan(bulan)}</h2></div>

        <div style={{ padding: 'var(--s4) var(--s5)' }}>
          <UnggahTiktok bulan={bulan} />
          <div style={{ marginTop: 'var(--s5)', fontSize: 13, opacity: 0.75 }}>
            Atau isi manual:
          </div>
          <FormTokoManual bulan={bulan} />
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>
            <b>Penjualan</b> = uang masuk bersih (TikTok: Jumlah penyelesaian pembayaran),
            sudah dipotong seluruh biaya platform. <b>Iklan</b> diisi sudah termasuk PPN 11%,
            supaya sebanding dengan kolom Iklan + PPN pada toko Shopee.
          </div>
        </div>

        {manual.length === 0 ? (
          <Kosong judul="Belum ada toko manual untuk bulan ini." />
        ) : (
          <div className="table-wrap">
            <table className="wide">
              <thead>
                <tr>
                  <th className="sticky-c">Toko</th>
                  <th className="t-right">Penjualan</th>
                  <th className="t-right">HPP</th>
                  <th className="t-right">Iklan + PPN</th>
                  <th className="t-right">Laba</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {manual.map((r) => {
                  const laba = Number(r.penjualan) - Number(r.hpp) - Number(r.iklan);
                  return (
                    <tr key={r.id}>
                      <td className="sticky-c">{r.nama}</td>
                      <td className="t-right">{rp(r.penjualan)}</td>
                      <td className="t-right">{rp(r.hpp)}</td>
                      <td className="t-right">{rp(r.iklan)}</td>
                      <td className="t-right">{rp(laba)}</td>
                      <td className="t-right">
                        <TombolHapus id={r.id} jenis="toko-manual" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

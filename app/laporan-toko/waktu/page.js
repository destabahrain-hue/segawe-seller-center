import Shell from '../../Shell';
import RangePicker from '../../RangePicker';
import { Kpi, Catatan, Batang } from '../../UI';
import { ensureSchema, q } from '@/lib/db';
import { laporanWaktu } from '@/lib/waktu';
import { rentang } from '@/lib/rentang';
import { rp, num, pct, tgl } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const HARI = { 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: 'Jumat', 6: 'Sabtu', 7: 'Minggu' };
const MINGGU = { 1: 'Minggu 1 · tgl 1–7', 2: 'Minggu 2 · tgl 8–14', 3: 'Minggu 3 · tgl 15–21',
                 4: 'Minggu 4 · tgl 22–28', 5: 'Minggu 5 · tgl 29–31' };
const SEPERTIGA = { 1: 'Awal bulan · tgl 1–10', 2: 'Tengah bulan · tgl 11–20', 3: 'Akhir bulan · tgl 21–31' };

function Peringkat({ judul, jelas, data, label }) {
  const maks = Math.max(...data.map((d) => d.produk), 1);
  return (
    <div className="card">
      <div className="card-head"><h2>{judul}</h2></div>
      {jelas && <div className="card-body" style={{ paddingBottom: 0 }}>
        <p className="t-mute" style={{ fontSize: 12.5, margin: 0 }}>{jelas}</p></div>}
      <div className="table-wrap"><table>
        <tbody>
          {data.map((d, i) => (
            <tr key={d.kunci}>
              <td className="t-mute" style={{ width: 26 }}>{i + 1}</td>
              <td className="t-strong">{label(d.kunci)}</td>
              <td style={{ width: '45%' }}>
                <div style={{ height: 7, borderRadius: 99, background: 'var(--brand)',
                              width: `${(d.produk / maks) * 100}%` }} />
              </td>
              <td className="t-num">{num(d.produk)}</td>
              <td className="t-num t-mute" style={{ width: 62 }}>{pct(d.porsi)}</td>
            </tr>
          ))}
          {!data.length && <tr><td className="t-mute">Belum ada data.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

export default async function PenjualanWaktu({ searchParams }) {
  await ensureSchema();
  const kode = searchParams?.r || '30h';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const shopId = searchParams?.toko || null;
  const [toko, L] = await Promise.all([
    q(`SELECT shop_id, shop_name FROM shops ORDER BY shop_name`),
    laporanWaktu({ dari: r.dari, sampai: r.sampai, shopId }),
  ]);
  const k = L.kartu;
  const maksJam = Math.max(...L.perJam.map((x) => x.produk), 1);
  const qsToko = (id) => {
    const p = new URLSearchParams();
    if (kode !== '30h') p.set('r', kode);
    if (searchParams?.dari) { p.set('dari', searchParams.dari); p.set('sampai', searchParams.sampai || ''); }
    if (id) p.set('toko', id);
    const s = p.toString();
    return '/laporan-toko/waktu' + (s ? '?' + s : '');
  };

  return (
    <Shell judul="Penjualan Per Waktu" rute="/laporan-toko"
           kanan={<a className="btn btn-sm" href="/laporan-toko">Ringkasan</a>}>
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
        <Kpi label="Net GMV" nilai={rp(k.netGmv)}
             sub={`${num(k.pesananSah)} pesanan · ${num(k.produk)} produk`} />
        <Kpi label="GMV" nilai={rp(k.gmv)} sub={`termasuk batal ${rp(k.nilaiBatal)}`} />
        <Kpi label="Rata-rata per pesanan" nilai={rp(k.rataPerPesanan)}
             sub={`${k.produkPerPesanan.toFixed(1)} produk per pesanan`} />
        <Kpi label="Pembatalan" nilai={pct(k.tingkatBatal)}
             sub={`${num(k.batal)} pesanan · ${rp(k.nilaiBatal)}`} />
        <Kpi label="Retur" nilai={num(k.retur)} sub={k.nilaiRetur ? rp(k.nilaiRetur) : 'diajukan di rentang ini'} />
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Tren penjualan — {r.label}</h2></div>
        <div className="card-body">
          <Batang data={L.harian.map((h) => ({
            label: new Date(h.tanggal).toLocaleDateString('id-ID',
              { day: '2-digit', month: 'short', timeZone: 'UTC' }),
            omzet: h.penjualan, laba: h.nilaiBatal,
          }))} />
          <p className="t-mute" style={{ fontSize: 12, margin: 0 }}>Batang = penjualan sah · garis = nilai pembatalan</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card">
          <div className="card-head"><h2>Jam belanja</h2>
            <span className="badge b-mute">waktu bayar, WIB</span></div>
          <div className="card-body" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 180 }}>
            {L.perJam.map((j) => (
              <div key={j.jam} title={`${String(j.jam).padStart(2, '0')}:00 — ${num(j.produk)} produk`}
                   style={{ flex: 1, display: 'flex', flexDirection: 'column',
                            justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${(j.produk / maksJam) * 100}%`, background: 'var(--brand)',
                              borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                {j.jam % 3 === 0 && <span className="t-mute" style={{ fontSize: 10, textAlign: 'center' }}>
                  {String(j.jam).padStart(2, '0')}</span>}
              </div>
            ))}
          </div>
        </div>

        <Peringkat judul="Segmen waktu belanja" jelas="Produk terjual per bagian hari, waktu WIB."
                   data={L.segmen.map((s) => ({ kunci: s.nama, produk: s.produk, porsi: s.porsi }))}
                   label={(nama) => {
                     const s = L.segmen.find((x) => x.nama === nama);
                     return `${nama} · ${String(s.dari).padStart(2, '0')}:00–${String(s.sampai).padStart(2, '0')}:59`;
                   }} />
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Alasan pembatalan terbanyak</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th style={{ width: 26 }}>#</th><th>Alasan</th><th>Oleh</th>
            <th className="t-right">Pesanan</th><th className="t-right">Nilai</th>
            <th className="t-right">Porsi</th></tr></thead>
          <tbody>
            {L.alasan.map((a, i) => (
              <tr key={a.alasan + a.oleh}>
                <td className="t-mute">{i + 1}</td>
                <td className="t-strong">{a.alasan}</td>
                <td className="t-mute">{a.oleh || '—'}</td>
                <td className="t-num">{num(a.pesanan)}</td>
                <td className="t-num">{rp(a.nilai)}</td>
                <td className="t-num t-mute">{pct(a.porsi)}</td>
              </tr>
            ))}
            {!L.alasan.length && <tr><td colSpan={6} className="t-mute">Tidak ada pembatalan di rentang ini.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="grid-2" style={{ marginBottom: 'var(--s4)' }}>
        <Peringkat judul="Hari dalam seminggu" jelas="Produk terjual, semua hari yang sama dijumlahkan."
                   data={L.pola.hari} label={(k2) => HARI[k2] || k2} />
        <Peringkat judul="Minggu ke berapa dalam bulan" jelas="Berdasarkan tanggal kalender, bukan Senin–Minggu."
                   data={L.pola.minggu} label={(k2) => MINGGU[k2] || k2} />
      </div>

      <div style={{ marginBottom: 'var(--s4)' }}>
        <Peringkat judul="Awal, tengah, atau akhir bulan"
                   jelas="Berguna untuk membaca efek tanggal gajian."
                   data={L.pola.sepertiga} label={(k2) => SEPERTIGA[k2] || k2} />
      </div>

      <div className="card">
        <div className="card-head"><h2>Rincian harian</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Tanggal</th><th className="t-right">Pesanan</th><th className="t-right">Batal</th>
            <th className="t-right">Tingkat batal</th><th className="t-right">Nilai batal</th>
            <th className="t-right">Produk</th><th className="t-right">Penjualan</th>
            <th className="t-right">GMV</th><th className="t-right">Rata-rata</th></tr></thead>
          <tbody>
            {L.harian.map((h) => (
              <tr key={h.tanggal}>
                <td className="t-strong">{tgl(h.tanggal)}</td>
                <td className="t-num">{num(h.pesanan)}</td>
                <td className="t-num" style={h.batal ? { color: 'var(--neg)' } : undefined}>{h.batal || '—'}</td>
                <td className="t-num t-mute">{h.pesanan ? pct(h.tingkatBatal) : '—'}</td>
                <td className="t-num t-mute">{h.nilaiBatal ? rp(h.nilaiBatal) : '—'}</td>
                <td className="t-num">{num(h.produk)}</td>
                <td className="t-num t-strong">{rp(h.penjualan)}</td>
                <td className="t-num t-mute">{rp(h.gmv)}</td>
                <td className="t-num t-mute">{rp(h.rata)}</td>
              </tr>
            ))}
            {!L.harian.length && <tr><td colSpan={9} className="t-mute">Belum ada pesanan di rentang ini.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <Catatan>
        <b>Tanggal</b> memakai waktu pesanan dibuat, <b>jam belanja</b> memakai waktu pesanan dibayar —
        itu yang paling dekat dengan saat pembeli menekan bayar, dan paling berguna untuk menyetel jadwal iklan.
        GMV termasuk pesanan batal; Net GMV tidak.
      </Catatan>
    </Shell>
  );
}

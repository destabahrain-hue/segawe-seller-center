import Shell from '../../Shell';
import AutoSegar from '../../AutoSegar';
import { Kpi, Kosong } from '../../UI';
import { ensureSchema } from '@/lib/db';
import { hitungDOS, ringkasDOS, BAWAAN } from '@/lib/dos';
import { num } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

/**
 * Rutenya sengaja di bawah /gudang. Izin peran diperiksa lewat awalan
 * rute, jadi siapa pun yang sudah boleh membuka Gudang langsung boleh
 * membuka halaman ini — tidak perlu mengubah peran satu per satu.
 */

const URUTAN = { habis: 0, pesan: 1, waspada: 2, aman: 3, diam: 4 };

const LENCANA = {
  habis:   ['b-neg',  'Habis'],
  pesan:   ['b-neg',  'Saatnya pesan'],
  waspada: ['b-warn', 'Waspada'],
  diam:    ['b-mute', 'Tidak ada penjualan'],
  aman:    ['b-pos',  'Aman'],
};

export default async function DOS({ searchParams }) {
  await ensureSchema();
  const saring = searchParams?.f || 'perlu';

  const semua = await hitungDOS();
  const rd = ringkasDOS(semua);

  const baris = semua
    .filter((d) => saring === 'semua'
      ? true
      : saring === 'perlu'
        ? ['habis', 'pesan', 'waspada'].includes(d.status)
        : d.status === saring)
    // Yang paling mendesak di atas: DOS terkecil lebih dulu, baru status.
    .sort((a, b) => (URUTAN[a.status] - URUTAN[b.status])
                 || ((a.dos ?? 1e9) - (b.dos ?? 1e9)));

  const qs = (f) => `/gudang/dos?f=${f}`;
  const CHIP = [
    ['perlu',   'Perlu tindakan', rd.habis + rd.pesan + rd.waspada],
    ['pesan',   'Saatnya pesan',  rd.pesan],
    ['habis',   'Habis',          rd.habis],
    ['waspada', 'Waspada',        rd.waspada],
    ['diam',    'Tidak laku',     rd.diam],
    ['semua',   'Semua SKU',      semua.length],
  ];

  return (
    <Shell judul="Days of Supply" rute="/gudang"
           kanan={<><a className="btn btn-sm" href="/gudang">Kembali ke Gudang</a>
                   <AutoSegar detik={300} /></>}>

      <div className="kpi-row">
        <Kpi label="Saatnya pesan" nilai={num(rd.pesan + rd.habis)}
             warna={(rd.pesan + rd.habis) ? 'var(--neg)' : undefined}
             sub={`termasuk ${num(rd.habis)} sudah habis`} />
        <Kpi label="Waspada" nilai={num(rd.waspada)} warna={rd.waspada ? 'var(--warn)' : undefined}
             sub="menipis dalam waktu dekat" />
        <Kpi label="Tidak ada penjualan" nilai={num(rd.diam)} sub="30 hari terakhir" />
        <Kpi label="Master SKU dipantau" nilai={num(semua.length)} sub="tunggal + paket" />
      </div>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Tampilkan</div>
          <div className="filter-vals">
            {CHIP.map(([k, label, n]) => (
              <a key={k} className="chip" href={qs(k)} aria-pressed={saring === k}>
                {label}<span className="n">{num(n)}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{CHIP.find(([k]) => k === saring)?.[1] || 'Days of Supply'}</h2>
          <span className="badge b-mute">
            waktu tunggu {BAWAAN.leadTime} hari · pengaman {BAWAAN.aman} hari · target isi {BAWAAN.target} hari
          </span>
        </div>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <p className="t-mute" style={{ fontSize: 12.5, marginTop: 0 }}>
            DOS = berapa hari lagi stok cukup pada laju penjualan sekarang. Rata-rata harian
            dibagi <b>hanya dengan hari yang stoknya ada</b> — hari kosong stok tidak ikut
            membagi, karena barang yang habis akan terlihat seolah tidak laku.
            Angka 7 hari menangkap tren baru, 30 hari menahan guncangan flash sale;
            yang dipakai untuk memicu pemesanan adalah yang lebih tinggi.
          </p>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Master SKU</th><th className="t-right">Saldo</th>
              <th className="t-right">Rata-rata / hari</th>
              <th className="t-right">DOS</th>
              <th className="t-right">Titik pesan</th>
              <th className="t-right">Saran pesan</th>
              <th>Status</th>
            </tr></thead>
            <tbody>
              {baris.map((d) => {
                const [kelas, teks] = LENCANA[d.status] || LENCANA.aman;
                return (
                  <tr key={d.id}>
                    <td>
                      <div className="tt">{d.name}</div>
                      <div className="st mono">{d.code}</div>
                    </td>
                    <td className="t-num t-strong"
                        style={d.saldo <= 0 ? { color: 'var(--neg)' } : undefined}>{num(d.saldo)}</td>
                    <td className="t-num">
                      {d.rata30 > 0 || d.rata7 > 0 ? (
                        <>
                          {d.rata7.toFixed(1)} <span className="t-mute">/ {d.rata30.toFixed(1)}</span>
                          {d.naik && <span className="badge b-warn" style={{ marginLeft: 6 }}>naik</span>}
                          {d.turun && <span className="badge b-mute" style={{ marginLeft: 6 }}>turun</span>}
                        </>
                      ) : <span className="t-mute">—</span>}
                      <div className="st t-mute">7 hari / 30 hari</div>
                    </td>
                    <td className="t-num t-strong">
                      {d.dos === null ? <span className="t-mute">—</span>
                        : d.dos >= 999 ? '999+' : `${Math.floor(d.dos)} hari`}
                    </td>
                    <td className="t-num t-mute">{num(d.ambang)}</td>
                    <td className="t-num t-strong">
                      {d.saran > 0 ? num(d.saran) : <span className="t-mute">—</span>}
                    </td>
                    <td><span className={'badge ' + kelas}>{teks}</span></td>
                  </tr>
                );
              })}
              {!baris.length && <tr><td colSpan={7}>
                <Kosong judul={semua.length ? 'Tidak ada SKU di kelompok ini' : 'Belum ada Master SKU'}
                        anak={semua.length
                          ? 'Bagus — berarti tidak ada yang perlu ditindak di kelompok ini.'
                          : 'Buat Master SKU dulu, lalu catat stok masuk di halaman Gudang.'} />
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

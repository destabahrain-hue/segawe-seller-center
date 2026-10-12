import Shell from '../../Shell';
import { Kpi, Catatan } from '../../UI';
import { ensureSchema } from '@/lib/db';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { laporanBulanan, KOLOM_MASUK, KOLOM_KELUAR } from '@/lib/laporan-stok';
import { pilihanMaster } from '@/lib/gudang';
import { Foto } from '../PilihSku';
import { num, rp, hariJakarta } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const geser = (bulan, n) => {
  const [y, m] = bulan.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default async function LaporanStok({ searchParams }) {
  await ensureSchema();
  const uang = bolehUang(await peranSekarang());
  const kini = hariJakarta().slice(0, 7);
  const bulan = /^\d{4}-\d{2}$/.test(searchParams?.bulan || '') ? searchParams.bulan : kini;
  const tampil = ['ringkas', 'masuk', 'keluar'].includes(searchParams?.t) ? searchParams.t : 'ringkas';
  const cari = String(searchParams?.q || '').toLowerCase().split(/\s+/).filter(Boolean);

  const [L, foto] = await Promise.all([laporanBulanan(bulan, { denganNilai: uang }), pilihanMaster()]);
  const gambar = new Map(foto.map((m) => [Number(m.id), m.gambar]));
  // Barang tanpa saldo dan tanpa mutasi sebulan disembunyikan supaya tabel tidak penuh baris nol.
  const baris = L.baris
    .filter((b) => b.awal || b.masuk || b.keluar || b.koreksi || b.akhir)
    .filter((b) => cari.every((k) => b.code.toLowerCase().includes(k)));
  const [y, m] = bulan.split('-').map(Number);
  const judul = `${NAMA_BULAN[m - 1]} ${y}`;
  const url = (ubah) => {
    const p = new URLSearchParams({ bulan, t: tampil, ...(searchParams?.q ? { q: searchParams.q } : {}), ...ubah });
    return `/gudang/laporan?${p}`;
  };
  const hari = Array.from({ length: L.hari }, (_, i) => i + 1);
  const sel = (x, tebal) => <td className={'t-num' + (tebal ? ' t-strong' : '')}>{x ? num(x) : <span className="t-mute">·</span>}</td>;

  return (
    <Shell judul="Laporan Stok" rute="/gudang"
           kanan={<a className="btn btn-sm btn-primary" href={`/api/gudang/laporan-stok?bulan=${bulan}`}>Unduh Excel</a>}>
      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Bulan</div>
          <div className="filter-vals" style={{ alignItems: 'center' }}>
            <a className="chip" href={url({ bulan: geser(bulan, -1) })}>‹ {NAMA_BULAN[(m + 10) % 12]}</a>
            <span className="t-strong" style={{ padding: '0 8px' }}>{judul}</span>
            {bulan < kini && <a className="chip" href={url({ bulan: geser(bulan, 1) })}>{NAMA_BULAN[m % 12]} ›</a>}
            {bulan !== kini && <a className="chip" href={url({ bulan: kini })}>Bulan ini</a>}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-key">Tampilan</div>
          <div className="filter-vals">
            {[['ringkas', 'Ringkasan'], ['masuk', 'Masuk per tanggal'], ['keluar', 'Keluar per tanggal']].map(([k, t]) => (
              <a key={k} className="chip" href={url({ t: k })} aria-pressed={tampil === k}>{t}</a>
            ))}
            <form action="/gudang/laporan" style={{ marginLeft: 12 }}>
              <input type="hidden" name="bulan" value={bulan} /><input type="hidden" name="t" value={tampil} />
              <input name="q" defaultValue={searchParams?.q || ''} placeholder="Cari kode…" style={{ height: 32, width: 200 }} />
            </form>
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="Sisa bulan lalu" nilai={num(L.total.awal)} sub="unit, semua barang" />
        <Kpi label="Masuk" nilai={num(L.total.masuk)} sub="supplier + retur + lain-lain" />
        <Kpi label="Keluar" nilai={num(L.total.keluar)} sub="Shopee + TikTok + offline + lain-lain" />
        <Kpi label="Sisa akhir" nilai={num(L.total.akhir)}
             sub={L.total.koreksi ? `termasuk koreksi ${L.total.koreksi > 0 ? '+' : ''}${num(L.total.koreksi)}` : 'unit'} />
        {uang && <Kpi label="Nilai persediaan" nilai={rp(L.total.nilai)} sub="sisa akhir × HPP" />}
      </div>

      {bulan === kini && <Catatan>Bulan berjalan: "sisa akhir" adalah stok sampai saat ini.</Catatan>}

      <div className="card">
        <div className="table-wrap">
          {tampil === 'ringkas' ? (
            <table>
              <thead>
                <tr><th rowSpan={2} style={{ width: 52 }}></th><th rowSpan={2}>Master SKU</th>
                  <th rowSpan={2} className="t-right">Sisa bulan lalu</th>
                  <th colSpan={KOLOM_MASUK.length} style={{ textAlign: 'center', color: 'var(--pos)' }}>Masuk</th>
                  <th colSpan={KOLOM_KELUAR.length} style={{ textAlign: 'center', color: 'var(--neg)' }}>Keluar</th>
                  <th rowSpan={2} className="t-right">Koreksi</th><th rowSpan={2} className="t-right">Sisa akhir</th>
                  {uang && <th rowSpan={2} className="t-right">Nilai</th>}</tr>
                <tr>{KOLOM_MASUK.map(([k, t]) => <th key={k} className="t-right">{t}</th>)}
                    {KOLOM_KELUAR.map(([k, t]) => <th key={k} className="t-right">{t}</th>)}</tr>
              </thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={b.id}>
                    <td><Foto src={gambar.get(b.id)} ukuran={32} /></td>
                    <td className="mono t-strong">{b.code}</td>
                    {sel(b.awal)}
                    {KOLOM_MASUK.map(([k]) => <td key={k} className="t-num" style={{ color: b.masukPer[k] ? 'var(--pos)' : undefined }}>{b.masukPer[k] ? num(b.masukPer[k]) : <span className="t-mute">·</span>}</td>)}
                    {KOLOM_KELUAR.map(([k]) => <td key={k} className="t-num">{b.keluarPer[k] ? num(b.keluarPer[k]) : <span className="t-mute">·</span>}</td>)}
                    <td className="t-num" style={{ color: b.koreksi < 0 ? 'var(--neg)' : b.koreksi > 0 ? 'var(--pos)' : undefined }}>
                      {b.koreksi ? `${b.koreksi > 0 ? '+' : ''}${num(b.koreksi)}` : <span className="t-mute">·</span>}</td>
                    <td className="t-num t-strong" style={{ color: b.akhir < 0 ? 'var(--neg)' : undefined }}>{num(b.akhir)}</td>
                    {uang && <td className="t-num">{rp(b.nilai)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={{ fontSize: 12.5 }}>
              <thead><tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>Master SKU</th>
                <th className="t-right">Sisa lalu</th>
                {hari.map((h) => <th key={h} className="t-right" style={{ minWidth: 34 }}>{h}</th>)}
                <th className="t-right">Total</th></tr></thead>
              <tbody>
                {baris.map((b) => {
                  const d = tampil === 'masuk' ? b.masukHarian : b.keluarHarian;
                  return (
                    <tr key={b.id}>
                      <td className="mono t-strong" style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>{b.code}</td>
                      {sel(b.awal)}
                      {d.map((x, i) => <td key={i} className="t-num">{x ? num(x) : <span className="t-mute">·</span>}</td>)}
                      {sel(d.reduce((a, x) => a + x, 0), true)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!baris.length && <p className="t-mute" style={{ padding: 'var(--s4)' }}>Tidak ada stok maupun mutasi di bulan ini.</p>}
        </div>
      </div>
    </Shell>
  );
}

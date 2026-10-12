import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kpi, Kosong, Catatan } from '../UI';
import Paginasi, { bacaPer } from '../Paginasi';
import FormMutasi from './FormMutasi';
import BatalBatch from './BatalBatch';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema, q } from '@/lib/db';
import { saldoGudang } from '@/lib/report';
import { rp, num, jam, hariJakarta } from '@/lib/fmt';
import { daftarSupplier, batchTerakhir, pilihanMaster, LABEL_JENIS } from '@/lib/gudang';
import { bolehKoreksiStok } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Gudang({ searchParams }) {
  await ensureSchema();
  const uang = bolehUang(await peranSekarang());
  const [saldo, mutasi, supplier, batch] = await Promise.all([
    saldoGudang(),
    q(`SELECT sm.*, ms.code, ms.name FROM stock_moves sm
       JOIN master_sku ms ON ms.id = sm.master_sku_id
       ORDER BY sm.moved_at DESC LIMIT 40`),
    daftarSupplier(),
    batchTerakhir(30),
  ]);
  const pilihan = (await pilihanMaster()).map((m) => ({ ...m, id: Number(m.id), saldo: Number(m.saldo) }));
  const bolehKoreksi = await bolehKoreksiStok();

  // Saldo dipisah per halaman: 60-an SKU sudah terlalu panjang untuk
  // satu tabel, dan tim biasanya mencari satu barang tertentu.
  const perHalaman = bacaPer(searchParams?.per);
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);
  const kata = String(searchParams?.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const tersaring = saldo.filter((s) => kata.every((k) => `${s.code} ${s.name}`.toLowerCase().includes(k)));
  const tampil = tersaring.slice((halaman - 1) * perHalaman, halaman * perHalaman);
  const qsGudang = (ubah) => {
    const p = new URLSearchParams();
    const v = { q: searchParams?.q, per: perHalaman === 50 ? null : perHalaman,
                hal: halaman === 1 ? null : halaman, ...ubah };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    const t = p.toString();
    return '/gudang' + (t ? '?' + t : '');
  };

  const nilai = saldo.reduce((a, s) => a + Number(s.saldo) * Number(s.hpp || 0), 0);
  const perluRestock = saldo.filter((s) => Number(s.saldo) <= Number(s.reorder_at)).length;

  return (
    <Shell judul="Gudang" rute="/gudang"
           kanan={<><a className="btn btn-sm" href="/gudang/opname">Stock Opname</a>
                   <a className="btn btn-sm" href="/gudang/laporan">Laporan Stok</a>
                   <a className="btn btn-sm" href="/gudang/dos">Days of Supply</a>
                   <AutoSegar detik={120} /></>}>
      <Catatan>
        Angka di halaman ini <b>tidak disinkronkan ke Shopee</b>. Ini stok fisik gudangmu sendiri.
        Keluar <b>Shopee</b> dipotong otomatis saat pesanan <b>dikirim</b> — paket bundling langsung diuraikan
        ke barang di dalamnya. Yang dicatat di formulir di bawah: barang masuk, retur, keluar <b>TikTok</b>
        dan <b>offline</b>. Koreksi dan pembatalan catatan hanya oleh akun yang diizinkan.
      </Catatan>

      <div className="kpi-row">
        {uang && <Kpi label="Nilai stok gudang" nilai={rp(nilai)} sub="berdasarkan HPP berjalan" />}
        <Kpi label="Master SKU aktif" nilai={num(saldo.length)} sub="barang satuan" />
        <Kpi label="Perlu restock" nilai={num(perluRestock)} warna={perluRestock ? 'var(--warn)' : undefined}
             sub="di bawah ambang manual" />
        <Kpi label="Mutasi tercatat" nilai={num(mutasi.length)} sub="40 terakhir" />
      </div>

      <FormMutasi master={pilihan} supplier={supplier} hariIni={hariJakarta()} uang={uang} bolehKurang={bolehKoreksi} />

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head" style={{ gap: 10, flexWrap: 'wrap' }}>
          <h2>Saldo stok fisik</h2>
          <span className="badge b-mute">{num(tersaring.length)} barang</span>
          <form action="/gudang" style={{ marginLeft: 'auto' }}>
            {perHalaman !== 50 && <input type="hidden" name="per" value={perHalaman} />}
            <input name="q" defaultValue={searchParams?.q || ''} placeholder="Cari kode atau nama…"
                   style={{ height: 34, width: 240 }} />
          </form>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Master SKU</th><th className="t-right">Masuk</th><th className="t-right">Keluar</th>
              <th className="t-right">Saldo</th><th style={{ width: 150 }}>Terhadap ambang</th>
              {uang && <th className="t-right">Nilai stok</th>}<th>Status</th>
            </tr></thead>
            <tbody>
              {tampil.map((s) => {
                const sal = Number(s.saldo), amb = Number(s.reorder_at) || 0;
                const rasio = amb ? Math.min(sal / amb, 1) : 1;
                const kelas = sal <= 0 ? 'crit' : (amb && sal <= amb ? 'low' : '');
                return (
                  <tr key={s.id}>
                    <td><div className="tt">{s.name}</div><div className="st mono">{s.code}</div></td>
                    <td className="t-num">{num(s.masuk)}</td>
                    <td className="t-num">{num(s.keluar)}</td>
                    <td className="t-num t-strong" style={sal <= 0 ? { color: 'var(--neg)' } : undefined}>{num(sal)}</td>
                    <td>
                      <span className="t-mute" style={{ fontSize: 12 }}>ambang {num(amb)}</span>
                      <div className={'stockbar ' + kelas}><i style={{ width: `${Math.max(rasio * 100, 0)}%` }} /></div>
                    </td>
                    {uang && <td className="t-num">{rp(sal * Number(s.hpp || 0))}</td>}
                    <td>
                      {sal <= 0 ? <span className="badge b-neg">Habis</span>
                        : amb && sal <= amb ? <span className="badge b-warn">Menipis</span>
                        : <span className="badge b-pos">Aman</span>}
                    </td>
                  </tr>
                );
              })}
              {!tampil.length && <tr><td colSpan={uang ? 7 : 6}>
                <Kosong judul={saldo.length ? 'Tidak ada barang yang cocok' : 'Belum ada Master SKU satuan'}
                        anak={saldo.length ? 'Coba kata kunci lain.' : 'Buat Master SKU dulu, lalu catat stok masuk di sini.'} />
              </td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={tersaring.length} qs={qsGudang}
                    aksi="/gudang" bawah />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Catatan manual terakhir</h2>
          <span className="badge b-mute">satu baris = satu kali simpan</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Jenis</th><th>Isi</th><th>Supplier / catatan</th>
              <th>Dicatat oleh</th><th></th></tr></thead>
            <tbody>
              {batch.map((b) => (
                <tr key={b.batch_id + b.jenis}>
                  <td className="t-mute">{jam(b.moved_at)}</td>
                  <td><span className="badge b-mute">{LABEL_JENIS[b.jenis] || b.jenis}</span></td>
                  <td style={{ maxWidth: 420 }}><div className="st" style={{ whiteSpace: 'normal' }}>{b.isi}</div>
                    <div className="st t-mute">{num(b.sku)} SKU · {num(b.unit)} unit</div></td>
                  <td className="t-mute">{[b.supplier, b.note].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="t-mute">{b.oleh || '—'}</td>
                  <td>{bolehKoreksi && <BatalBatch batchId={b.batch_id}
                        ringkas={`${LABEL_JENIS[b.jenis] || b.jenis} · ${b.isi}`} />}</td>
                </tr>
              ))}
              {!batch.length && <tr><td colSpan={6} className="t-mute">Belum ada catatan manual.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Mutasi terakhir</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Waktu</th><th>Master SKU</th><th>Jenis</th><th className="t-right">Qty</th>
              <th>Keterangan</th><th>Oleh</th></tr></thead>
            <tbody>
              {mutasi.map((m) => (
                <tr key={m.id}>
                  <td className="t-mute">{jam(m.moved_at)}</td>
                  <td className="t-strong">{m.code}</td>
                  <td><span className={'badge ' + (m.direction === 'in' ? 'b-pos' : m.direction === 'out' ? 'b-info' : 'b-mute')}>
                    {LABEL_JENIS[m.jenis] || (m.direction === 'in' ? 'Masuk' : m.direction === 'out' ? 'Keluar' : 'Koreksi')}</span></td>
                  <td className="t-num">{m.direction === 'out' ? '−' : m.direction === 'in' ? '+' : ''}{num(m.qty)}</td>
                  <td className="t-mute">{[m.supplier, m.note].filter(Boolean).join(' · ') || m.ref_type}</td>
                  <td className="t-mute">{m.dicatat_oleh || (m.jenis === 'shopee' ? 'otomatis' : '—')}</td>
                </tr>
              ))}
              {!mutasi.length && <tr><td colSpan={6} className="t-mute">Belum ada mutasi.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

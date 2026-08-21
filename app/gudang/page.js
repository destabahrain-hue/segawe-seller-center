import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kpi, Kosong, Catatan } from '../UI';
import FormStok from './Form';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema, q } from '@/lib/db';
import { saldoGudang } from '@/lib/report';
import { rp, num, jam } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Gudang() {
  await ensureSchema();
  const uang = bolehUang(await peranSekarang());
  const [saldo, mutasi] = await Promise.all([
    saldoGudang(),
    q(`SELECT sm.*, ms.code, ms.name FROM stock_moves sm
       JOIN master_sku ms ON ms.id = sm.master_sku_id
       ORDER BY sm.moved_at DESC LIMIT 40`),
  ]);

  const nilai = saldo.reduce((a, s) => a + Number(s.saldo) * Number(s.hpp || 0), 0);
  const perluRestock = saldo.filter((s) => Number(s.saldo) <= Number(s.reorder_at)).length;
  const master = saldo.map((s) => ({ id: s.id, code: s.code, name: s.name }));

  return (
    <Shell judul="Gudang" rute="/gudang"
           kanan={<><a className="btn btn-sm" href="/gudang/dos">Days of Supply</a>
                   <AutoSegar detik={120} /></>}>
      <Catatan>
        Angka di halaman ini <b>tidak disinkronkan ke Shopee</b>. Ini stok fisik gudangmu sendiri.
        Stok keluar dipotong otomatis saat pesanan <b>dikirim</b>, dan paket bundling diuraikan ke komponennya.
      </Catatan>

      <div className="kpi-row">
        {uang && <Kpi label="Nilai stok gudang" nilai={rp(nilai)} sub="berdasarkan HPP berjalan" />}
        <Kpi label="Master SKU aktif" nilai={num(saldo.length)} sub="tunggal + paket" />
        <Kpi label="Perlu restock" nilai={num(perluRestock)} warna={perluRestock ? 'var(--warn)' : undefined}
             sub="di bawah ambang manual" />
        <Kpi label="Mutasi tercatat" nilai={num(mutasi.length)} sub="40 terakhir" />
      </div>

      <FormStok master={master} />

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Saldo stok fisik</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Master SKU</th><th className="t-right">Masuk</th><th className="t-right">Keluar</th>
              <th className="t-right">Saldo</th><th style={{ width: 150 }}>Terhadap ambang</th>
              {uang && <th className="t-right">Nilai stok</th>}<th>Status</th>
            </tr></thead>
            <tbody>
              {saldo.map((s) => {
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
              {!saldo.length && <tr><td colSpan={uang ? 7 : 6}>
                <Kosong judul="Belum ada Master SKU" anak="Buat Master SKU dulu, lalu catat stok masuk di sini." />
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Mutasi terakhir</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Waktu</th><th>Master SKU</th><th>Arah</th><th className="t-right">Qty</th><th>Keterangan</th></tr></thead>
            <tbody>
              {mutasi.map((m) => (
                <tr key={m.id}>
                  <td className="t-mute">{jam(m.moved_at)}</td>
                  <td className="t-strong">{m.code}</td>
                  <td><span className={'badge ' + (m.direction === 'in' ? 'b-pos' : m.direction === 'out' ? 'b-info' : 'b-mute')}>
                    {m.direction === 'in' ? 'Masuk' : m.direction === 'out' ? 'Keluar' : 'Koreksi'}</span></td>
                  <td className="t-num">{num(m.qty)}</td>
                  <td className="t-mute">{m.note || m.ref_type}</td>
                </tr>
              ))}
              {!mutasi.length && <tr><td colSpan={5} className="t-mute">Belum ada mutasi.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

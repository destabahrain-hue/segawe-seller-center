'use client';
import { useState } from 'react';

export default function Salin({ produk, dari, ke, namaTujuan }) {
  const [pilih, setPilih] = useState(new Set());
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  const [err, setErr] = useState('');

  const semua = pilih.size > 0 && pilih.size === produk.length;
  const toggle = (id) => {
    const n = new Set(pilih);
    n.has(id) ? n.delete(id) : n.add(id);
    setPilih(n);
  };

  async function jalan() {
    setSibuk(true); setErr(''); setPesan('');
    try {
      const r = await fetch('/api/salin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dari, ke, items: [...pilih] }),
      });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || 'Gagal'); return; }
      setPesan(`${j.diantrikan} produk masuk antrean. Pantau di halaman Antrean Tugas.`);
      setPilih(new Set());
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  return (
    <>
      <div className="bulkbar">
        <input type="checkbox" checked={semua}
               onChange={() => setPilih(semua ? new Set() : new Set(produk.map((p) => p.item_id)))}
               aria-label="Pilih semua produk" />
        <span className="t">
          {pilih.size ? `${pilih.size} produk dipilih` : `Pilih produk untuk disalin (${produk.length} tersedia)`}
        </span>
        <div className="spacer" />
        {pesan && <span className="badge b-pos">{pesan}</span>}
        <button className="btn btn-sm btn-primary" disabled={!pilih.size || sibuk} onClick={jalan}>
          {sibuk ? 'Mengantrikan…' : `Salin ke ${namaTujuan}`}
        </button>
      </div>
      {err && <p className="err">{err}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th style={{ width: 40 }}></th>
            <th>Produk</th><th>Kunci</th><th className="t-right">Harga</th>
            <th className="t-right">Stok</th><th>Status di sumber</th>
          </tr></thead>
          <tbody>
            {produk.map((r) => (
              <tr key={r.kunci}>
                <td><input type="checkbox" checked={pilih.has(r.item_id)}
                           onChange={() => toggle(r.item_id)} aria-label={`Pilih ${r.nama}`} /></td>
                <td><div className="tt">{r.nama}</div><div className="st mono">item {r.item_id}</div></td>
                <td className="mono">{r.kunci}</td>
                <td className="t-num t-strong">{r.harga ? rp(r.harga) : '—'}</td>
                <td className="t-num">{r.stok ?? '—'}</td>
                <td><span className={'badge ' + (r.status === 'NORMAL' ? 'b-pos' : 'b-mute')}>{r.status}</span></td>
              </tr>
            ))}
            {!produk.length && <tr><td colSpan={6} className="t-mute">
              Tidak ada selisih. Semua produk sumber sudah ada di toko tujuan.
            </td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
const rp = (n) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);

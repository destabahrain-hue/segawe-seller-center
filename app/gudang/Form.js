'use client';
import { useState } from 'react';

export default function FormStok({ master }) {
  const [buka, setBuka] = useState(false);
  const [f, setF] = useState({ master_sku_id: '', direction: 'in', qty: '', unit_cost: '', moved_at: '', note: '' });
  const [err, setErr] = useState('');

  async function kirim() {
    setErr('');
    if (!f.master_sku_id || !f.qty) { setErr('Pilih Master SKU dan isi jumlah.'); return; }
    const r = await fetch('/api/gudang', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
    });
    const j = await r.json();
    if (j.ok) location.reload(); else setErr(j.error || 'Gagal menyimpan');
  }

  if (!buka) return <button className="btn btn-sm btn-primary" onClick={() => setBuka(true)}>Catat stok masuk</button>;

  return (
    <div className="card" style={{ padding: 'var(--s4) var(--s5)', marginBottom: 'var(--s4)' }}>
      <div className="form-row">
        <div className="field" style={{ minWidth: 260 }}><label>Master SKU</label>
          <select value={f.master_sku_id} onChange={(e) => setF({ ...f, master_sku_id: e.target.value })}>
            <option value="">— pilih —</option>
            {master.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select></div>
        <div className="field"><label>Arah</label>
          <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
            <option value="in">Masuk</option><option value="out">Keluar</option><option value="adjust">Koreksi</option>
          </select></div>
        <div className="field"><label>Jumlah</label>
          <input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={{ width: 100 }} /></div>
        <div className="field"><label>Harga beli / unit</label>
          <input type="number" value={f.unit_cost} placeholder="jadi HPP"
                 onChange={(e) => setF({ ...f, unit_cost: e.target.value })} style={{ width: 140 }} /></div>
        <div className="field"><label>Tanggal</label>
          <input type="date" value={f.moved_at} onChange={(e) => setF({ ...f, moved_at: e.target.value })} /></div>
        <button className="btn btn-primary" onClick={kirim}>Simpan</button>
        <button className="btn" onClick={() => setBuka(false)}>Batal</button>
      </div>
      <p className="t-mute" style={{ fontSize: 12.5, marginTop: 8 }}>
        Harga beli yang kamu isi di sini otomatis menjadi HPP berlaku untuk Master SKU tersebut.
      </p>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

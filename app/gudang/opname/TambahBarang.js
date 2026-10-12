'use client';
import { useState } from 'react';

/**
 * Tambah Master SKU langsung dari lembar opname.
 *
 * Gunanya untuk barang yang selama ini tidak pernah tercatat karena tidak
 * dijual di marketplace — kardus, lakban, bubble wrap. Barangnya langsung
 * muncul di daftar hitung dengan stok sistem 0, jadi hasil hitung fisiknya
 * masuk lewat opname seperti barang lain.
 */
export default function TambahBarang() {
  const [buka, setBuka] = useState(false);
  const [f, setF] = useState({ code: '', name: '', reorder_at: '' });
  const [jalan, setJalan] = useState(false);
  const [err, setErr] = useState('');

  async function simpan() {
    setErr('');
    if (!f.code.trim() || !f.name.trim()) { setErr('Kode dan nama wajib diisi.'); return; }
    setJalan(true);
    const r = await fetch('/api/gudang/opname', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'tambah-sku', ...f }) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) location.reload(); else { setErr(j.error || 'Gagal menyimpan'); setJalan(false); }
  }

  if (!buka) return <button className="btn btn-sm" onClick={() => setBuka(true)}>+ Tambah barang</button>;
  return (
    <div className="form-row" style={{ width: '100%', alignItems: 'flex-end' }}>
      <div className="field"><label>Kode</label>
        <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="KARDUS A" autoFocus /></div>
      <div className="field" style={{ flex: 1, minWidth: 200 }}><label>Nama barang</label>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kardus ukuran A" /></div>
      <div className="field"><label>Ambang restock</label>
        <input type="number" value={f.reorder_at} onChange={(e) => setF({ ...f, reorder_at: e.target.value })}
               placeholder="0" style={{ width: 120 }} /></div>
      <button className="btn btn-primary" onClick={simpan} disabled={jalan}>{jalan ? '…' : 'Tambahkan'}</button>
      <button className="btn" onClick={() => setBuka(false)} disabled={jalan}>Batal</button>
      {err && <p className="err" style={{ width: '100%', margin: 0 }}>{err}</p>}
    </div>
  );
}

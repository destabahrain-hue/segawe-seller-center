'use client';
import { useState } from 'react';
export default function Mulai() {
  const [jalan, setJalan] = useState(false);
  const [catatan, setCatatan] = useState('');
  async function mulai() {
    setJalan(true);
    const r = await fetch('/api/gudang/opname', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify({ aksi: 'mulai', catatan }) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) location.reload(); else { alert(j.error || 'Gagal'); setJalan(false); }
  }
  return (
    <div className="card"><div className="card-body" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div className="t-strong">Belum ada stock opname yang berjalan</div>
        <div className="t-mute" style={{ fontSize: 12.5 }}>Buka opname, hitung fisik barang di rak, isi angkanya — boleh dicicil dan dikerjakan beberapa orang.</div>
      </div>
      <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="catatan, mis. opname akhir bulan" style={{ width: 260, height: 36 }} />
      <button className="btn btn-primary" onClick={mulai} disabled={jalan}>{jalan ? '…' : 'Mulai stock opname'}</button>
    </div></div>
  );
}

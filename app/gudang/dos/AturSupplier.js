'use client';
import { useState } from 'react';

/** Isian supplier langganan per Master SKU, tersimpan saat kolom ditinggalkan. */
export default function AturSupplier({ id, awal, daftar }) {
  const [v, setV] = useState(awal || '');
  const [status, setStatus] = useState('');
  async function simpan() {
    if ((awal || '') === v.trim()) return;
    setStatus('…');
    const r = await fetch('/api/master-sku', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ aksi: 'supplier', id, supplier: v }) });
    const j = await r.json().catch(() => ({}));
    setStatus(j.ok ? '✓' : '✗');
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input list="dos-supplier" value={v} onChange={(e) => setV(e.target.value)} onBlur={simpan}
             placeholder="—" style={{ width: 130, height: 26, fontSize: 12 }} />
      <span className="t-mute" style={{ fontSize: 11, width: 10 }}>{status}</span>
      {daftar && <datalist id="dos-supplier">{daftar.map((s) => <option key={s} value={s} />)}</datalist>}
    </span>
  );
}

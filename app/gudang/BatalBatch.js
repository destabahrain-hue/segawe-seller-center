'use client';
import { useState } from 'react';

export default function BatalBatch({ batchId, ringkas }) {
  const [jalan, setJalan] = useState(false);
  async function batal() {
    if (!confirm(`Batalkan mutasi ini?\n\n${ringkas}\n\nSemua barisnya dihapus dan stok kembali seperti sebelumnya.`)) return;
    setJalan(true);
    const r = await fetch('/api/gudang', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ batch_id: batchId }) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) location.reload(); else { alert(j.error || 'Gagal membatalkan'); setJalan(false); }
  }
  return <button className="btn btn-sm" onClick={batal} disabled={jalan}>{jalan ? '…' : 'Batalkan'}</button>;
}

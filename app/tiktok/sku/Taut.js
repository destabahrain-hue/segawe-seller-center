'use client';
import { useState } from 'react';

/** Tautkan satu SKU TikTok ke Master SKU, atau lepaskan tautannya. */
export function Taut({ shopId, sellerSku, terpilih, pilihan }) {
  const [nilai, setNilai] = useState(terpilih || '');
  const [sibuk, setSibuk] = useState(false);
  const [ok, setOk] = useState(false);

  async function simpan(v) {
    setNilai(v); setSibuk(true); setOk(false);
    const r = await fetch('/api/tiktok/sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'tautkan', shop_id: shopId, seller_sku: sellerSku,
                             master_sku_id: v ? Number(v) : null }),
    });
    const j = await r.json().catch(() => ({}));
    setSibuk(false);
    if (j.ok) { setOk(true); setTimeout(() => setOk(false), 1500); }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select value={nilai} disabled={sibuk} onChange={(e) => simpan(e.target.value)}
              style={{ minHeight: 32, fontSize: 12.5, maxWidth: 260 }}>
        <option value="">— belum tertaut —</option>
        {pilihan.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
      </select>
      {ok && <span className="ok" style={{ fontSize: 12 }}>tersimpan</span>}
    </span>
  );
}

export function Cocokkan() {
  const [sibuk, setSibuk] = useState(false);
  return (
    <button className="btn btn-sm btn-primary" disabled={sibuk} onClick={async () => {
      setSibuk(true);
      await fetch('/api/tiktok/sku', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'cocokkan' }) });
      location.reload();
    }}>{sibuk ? 'Mencocokkan…' : 'Cocokkan otomatis'}</button>
  );
}

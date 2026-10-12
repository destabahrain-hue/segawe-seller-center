'use client';
import { useState } from 'react';

/**
 * Biaya iklan TikTok, diisi manual per hari.
 *
 * Iklan TikTok Shop (GMV Max) tidak ada di API Shop — jalurnya TikTok Ads
 * yang aplikasi dan otorisasinya terpisah. Daripada laba TikTok terlihat
 * lebih besar dari kenyataan, angkanya diisi dari Seller Center.
 */
export default function Iklan({ shopId, baris }) {
  const [hari, setHari] = useState(new Date().toISOString().slice(0, 10));
  const [biaya, setBiaya] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState('');

  async function simpan() {
    setSibuk(true); setErr('');
    const r = await fetch('/api/tiktok/iklan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: shopId, hari, biaya: Number(biaya) || 0 }),
    });
    const j = await r.json().catch(() => ({}));
    setSibuk(false);
    if (j.ok) location.reload(); else setErr(j.error || 'Gagal menyimpan');
  }

  const total = (baris || []).reduce((a, b) => a + Number(b.biaya || 0), 0);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="t-mute" style={{ fontSize: 12.5 }}>Biaya iklan:</span>
        <input type="date" value={hari} onChange={(e) => setHari(e.target.value)}
               max={new Date().toISOString().slice(0, 10)} style={{ minHeight: 32, fontSize: 12.5 }} />
        <input type="number" value={biaya} onChange={(e) => setBiaya(e.target.value)}
               placeholder="rupiah hari itu" style={{ minHeight: 32, width: 150, fontSize: 12.5 }} />
        <button className="btn btn-sm" disabled={sibuk || !biaya} onClick={simpan}>
          {sibuk ? '…' : 'Simpan'}
        </button>
        {baris?.length > 0 && (
          <span className="t-mute" style={{ fontSize: 12 }}>
            {baris.length} hari terisi · total {total.toLocaleString('id-ID', {
              style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
          </span>
        )}
        {err && <span className="err" style={{ fontSize: 12.5 }}>{err}</span>}
      </div>
    </div>
  );
}

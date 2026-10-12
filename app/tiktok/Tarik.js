'use client';
import { useEffect, useState } from 'react';

/**
 * Penarikan data TikTok: satu tekan, lalu berjalan sendiri.
 *
 * Tombol hanya MENGANTRIKAN pekerjaan; penjadwal yang mengerjakannya di
 * latar belakang. Bilah di bawahnya menanyakan kemajuan tiap 4 detik selama
 * masih ada tugas berjalan, jadi tim tidak perlu menekan berulang kali.
 */
const BAGIAN = [['pesanan', 'Pesanan'], ['statement', 'Statement & transaksi'], ['retur', 'Retur']];

export default function Tarik({ shopId, awal }) {
  const [st, setSt] = useState(awal || null);
  const [hari, setHari] = useState(90);
  const [sibuk, setSibuk] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!st?.berjalan) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/tiktok/tarik?shop_id=${shopId}`);
        const j = await r.json();
        if (j.ok) setSt(j.status);
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [st?.berjalan, shopId]);

  async function tarik(bagian) {
    setSibuk(bagian); setErr('');
    try {
      const r = await fetch('/api/tiktok/tarik', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, bagian, hari }),
      });
      const teks = await r.text();
      let j; try { j = JSON.parse(teks); } catch {
        throw new Error(`Balasan server tidak dikenali (${r.status}). Muat ulang halaman.`);
      }
      if (!j.ok) throw new Error(j.error || 'Gagal');
      setSt(j.status);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(''); }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="t-mute" style={{ fontSize: 12.5 }}>Tarik data:</span>
        <select value={hari} onChange={(e) => setHari(Number(e.target.value))}
                aria-label="Rentang" style={{ minHeight: 32, fontSize: 12.5 }}>
          {[7, 30, 90, 180, 365].map((h) => <option key={h} value={h}>{h} hari</option>)}
        </select>
        {BAGIAN.map(([k, t]) => (
          <button key={k} className="btn btn-sm" disabled={!!sibuk || st?.berjalan}
                  onClick={() => tarik(k)}>{sibuk === k ? '…' : t}</button>
        ))}
        <button className="btn btn-sm btn-primary" disabled={!!sibuk || st?.berjalan}
                onClick={() => tarik('semua')}>{sibuk === 'semua' ? '…' : 'Tarik semua'}</button>
        {st?.gagal > 0 && <span className="badge b-warn">{st.gagal} tugas gagal</span>}
      </div>

      {st?.berjalan && (
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(st.persen || 0, 4)}%`, height: '100%',
                          background: 'var(--brand)', transition: 'width .4s ease' }} />
          </div>
          <span className="t-mute" style={{ fontSize: 11.5 }}>
            Menarik data TikTok… {st.selesai} dari {st.total} bagian ({st.persen}%) —
            berjalan sendiri, halaman boleh ditutup.
          </span>
        </div>
      )}
      {err && <span className="err" style={{ fontSize: 12.5 }}>{err}</span>}
    </div>
  );
}

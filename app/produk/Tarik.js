'use client';
import { useState } from 'react';

/**
 * Tombol tarik katalog. Menampilkan pesan error PER TOKO apa adanya —
 * versi sebelumnya hanya menghitung "2 toko gagal" tanpa menyebut sebabnya,
 * sehingga tidak bisa dipakai untuk memperbaiki apa pun.
 */
export default function Tarik({ label = 'Tarik produk dari Shopee' }) {
  const [sibuk, setSibuk] = useState(false);
  const [ringkas, setRingkas] = useState('');
  const [gagal, setGagal] = useState([]);
  const [err, setErr] = useState('');

  async function jalan() {
    setSibuk(true); setRingkas(''); setGagal([]); setErr('');
    try {
      const r = await fetch('/api/produk', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || `HTTP ${r.status}`); return; }

      const p = j.hasil.reduce((a, x) => a + (x.produk || 0), 0);
      const v = j.hasil.reduce((a, x) => a + (x.varian || 0), 0);
      const g = j.hasil.filter((x) => !x.ok);
      setRingkas(`${p} produk, ${v} varian tersimpan`);
      setGagal(g);
      if (!g.length) setTimeout(() => location.reload(), 900);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  return (
    <>
      <button className="btn btn-sm btn-primary" onClick={jalan} disabled={sibuk}>
        {sibuk ? 'Menarik…' : label}
      </button>
      {ringkas && <span className={'badge ' + (gagal.length ? 'b-warn' : 'b-pos')}>{ringkas}</span>}
      {err && <span className="badge b-neg">{err}</span>}

      {gagal.length > 0 && (
        <div style={{ flexBasis: '100%', marginTop: 'var(--s3)' }}>
          <div className="card" style={{ borderColor: 'var(--neg)' }}>
            <div className="card-head" style={{ background: 'var(--neg-tint)' }}>
              <h2 style={{ color: 'var(--neg)' }}>{gagal.length} toko gagal — pesan dari Shopee</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th style={{ width: 150 }}>Toko</th><th>Pesan</th></tr></thead>
                <tbody>
                  {gagal.map((g) => (
                    <tr key={g.shopId}>
                      <td className="mono">{g.nama || g.shopId}</td>
                      <td style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{g.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-body" style={{ paddingTop: 'var(--s3)' }}>
              <span className="t-mute" style={{ fontSize: 12 }}>
                Salin pesan di atas apa adanya — itu yang menentukan perbaikannya.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

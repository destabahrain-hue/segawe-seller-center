'use client';
import { useEffect, useState } from 'react';

/**
 * Banner Pack yang gagal.
 *
 * Sebelumnya kegagalan Pack hanya tercatat di halaman Antrean, dan orang
 * yang menekan Pack tidak pernah tahu pesanannya tidak jadi dikirim —
 * baru ketahuan berhari-hari kemudian saat batas kirim lewat. Banner ini
 * membawa kabar itu ke tempat pekerjaannya, bukan menunggu dicari.
 *
 * Pesanannya SENGAJA tidak disembunyikan dari daftar: yang gagal justru
 * harus tetap gampang dipilih ulang untuk dicoba lagi.
 */
const KUNCI = 'nsc-pack-gagal-ditutup';

export default function GagalPack() {
  const [gagal, setGagal] = useState([]);
  const [tutup, setTutup] = useState(new Set());
  const [buka, setBuka] = useState(false);

  useEffect(() => {
    try {
      const t = JSON.parse(window.localStorage.getItem(KUNCI) || '[]');
      setTutup(new Set(t.map(String)));
    } catch { /* peramban tanpa penyimpanan tetap boleh dipakai */ }

    fetch('/api/pack/gagal')
      .then((r) => r.json())
      .then((j) => { if (j.ok) setGagal(j.gagal || []); })
      .catch(() => { /* banner tidak boleh menjatuhkan halaman */ });
  }, []);

  const terlihat = gagal.filter((g) => !tutup.has(String(g.id)));
  if (!terlihat.length) return null;

  const tutupSemua = () => {
    const semua = [...tutup, ...terlihat.map((g) => String(g.id))];
    setTutup(new Set(semua));
    try { window.localStorage.setItem(KUNCI, JSON.stringify(semua.slice(-500))); } catch {}
  };

  return (
    <div className="note" style={{ borderColor: 'var(--neg)', background: 'var(--neg-tint)',
                                   alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{terlihat.length} pesanan gagal di-Pack dalam 24 jam terakhir.</b>{' '}
        Pesanan ini <b>belum diatur pengirimannya di Shopee</b> dan resinya belum terbit.
        Semuanya sudah dipindahkan ke tab <b>Proses gagal</b> atau
        <b> Menunggu proses marketplace</b>, dan bisa dicoba lagi dari sana.
        <a className="btn btn-sm" style={{ marginLeft: 8 }} href="/pesanan?s=gagalpack">
          Buka tab Proses gagal
        </a>
        <button className="btn btn-sm" style={{ marginLeft: 6 }}
                onClick={() => setBuka((b) => !b)}>
          {buka ? 'Sembunyikan rincian' : 'Lihat rincian'}
        </button>

        {buka && (
          <div style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>
            {terlihat.map((g) => (
              <div key={g.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                <span className="mono" style={{ fontWeight: 600 }}>{g.order_sn}</span>
                {g.shop_name && <span className="t-mute"> · {g.shop_name}</span>}
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{g.last_error}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-sm" onClick={tutupSemua}>Tutup</button>
    </div>
  );
}

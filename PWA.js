'use client';
import { useEffect, useState } from 'react';

/**
 * Pendaftar service worker + tombol "Pasang aplikasi".
 *
 * Chrome/Android memberi event beforeinstallprompt; iPhone tidak punya itu,
 * jadi di Safari ditampilkan petunjuk manual. Kalau aplikasi sudah dipasang
 * (berjalan standalone), tombolnya hilang sendiri.
 */
export default function PWA() {
  const [prompt, setPrompt] = useState(null);
  const [petunjuk, setPetunjuk] = useState(false);
  const [terpasang, setTerpasang] = useState(true);   // sembunyikan dulu sampai jelas

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const berdiriSendiri = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    setTerpasang(berdiriSendiri);

    const tangkap = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', tangkap);
    window.addEventListener('appinstalled', () => { setTerpasang(true); setPrompt(null); });
    return () => window.removeEventListener('beforeinstallprompt', tangkap);
  }, []);

  if (terpasang) return null;

  const iOS = typeof navigator !== 'undefined'
    && /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!prompt && !iOS) return null;   // browser ini belum siap memasang

  return (
    <>
      <button className="btn btn-sm" onClick={async () => {
        if (prompt) { prompt.prompt(); await prompt.userChoice; setPrompt(null); }
        else setPetunjuk(true);
      }}>Pasang aplikasi</button>

      {petunjuk && (
        <div className="lapis" onClick={(e) => e.target === e.currentTarget && setPetunjuk(false)}>
          <div className="card lembar" style={{ width: 'min(380px,100%)' }}>
            <div className="card-head"><h2>Pasang di iPhone</h2></div>
            <div className="card-body" style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
              <div>1. Buka halaman ini di <b>Safari</b>.</div>
              <div>2. Tekan tombol <b>Bagikan</b> (kotak dengan panah ke atas).</div>
              <div>3. Pilih <b>Tambah ke Layar Utama</b>.</div>
              <button className="btn btn-primary" onClick={() => setPetunjuk(false)}>Mengerti</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

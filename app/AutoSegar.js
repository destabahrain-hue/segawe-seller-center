'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Memuat ulang data halaman berkala tanpa memuat ulang seluruh browser —
 * router.refresh() hanya mengambil ulang render server.
 *
 * Dua perilaku yang disengaja:
 *  1. Hitungan BERHENTI saat tab tidak dilihat, supaya tidak membebani
 *     server untuk halaman yang menganggur di tab belakang.
 *  2. Begitu tab dilihat lagi, data langsung disegarkan tanpa menunggu
 *     hitungan selesai — kalau tidak, kamu akan menatap angka lama
 *     selama beberapa menit setelah kembali dari tab lain.
 */
export default function AutoSegar({ detik = 60 }) {
  const router = useRouter();
  const [sisa, setSisa] = useState(detik);
  const [nyala, setNyala] = useState(true);
  const [sibuk, setSibuk] = useState(false);
  const acuan = useRef(detik);
  const pernahTersembunyi = useRef(false);
  acuan.current = detik;

  function segarkanSekarang() {
    setSibuk(true);
    router.refresh();
    setSisa(acuan.current);
    setTimeout(() => setSibuk(false), 1200);
  }

  // Hitungan mundur
  useEffect(() => {
    if (!nyala) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setSisa((s) => {
        if (s > 1) return s - 1;
        setSibuk(true);
        router.refresh();
        setTimeout(() => setSibuk(false), 1200);
        return acuan.current;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [nyala, router]);

  // Kembali ke tab ini setelah sempat ditinggalkan → segarkan langsung
  useEffect(() => {
    function saatBerubah() {
      if (document.visibilityState === 'hidden') { pernahTersembunyi.current = true; return; }
      if (pernahTersembunyi.current && nyala) {
        pernahTersembunyi.current = false;
        segarkanSekarang();
      }
    }
    document.addEventListener('visibilitychange', saatBerubah);
    return () => document.removeEventListener('visibilitychange', saatBerubah);
  }, [nyala]);

  return (
    <button className="btn btn-sm btn-ghost" onClick={() => setNyala(!nyala)}
            title={nyala
              ? 'Penyegaran otomatis menyala — klik untuk mematikan'
              : 'Penyegaran otomatis mati — klik untuk menyalakan'}
            style={{ gap: 7 }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flex: '0 0 7px',
        background: nyala ? 'var(--pos)' : 'var(--line-strong)',
        opacity: sibuk ? .4 : 1, transition: 'opacity 150ms',
      }} />
      <span className="num" style={{ fontSize: 11.5, color: 'var(--ink-3)', minWidth: 54 }}>
        {nyala ? (sibuk ? 'memuat…' : `segar ${sisa}s`) : 'otomatis mati'}
      </span>
    </button>
  );
}

'use client';
import { useState } from 'react';
import ThemeToggle from './ThemeToggle';
import { IRefresh, IExit } from './Icons';

export default function Topbar({ judul, kanan = null }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');

  async function sinkron() {
    setSibuk(true); setPesan('');
    try {
      const r = await fetch('/api/sync', { method: 'POST' });

      /**
       * Balasannya belum tentu JSON. Kalau server sempat tidak menjawab —
       * paling sering beberapa detik setelah deploy — Railway mengirim
       * halaman error, dan r.json() melempar "Unexpected token 'u'".
       * Pesan itu tidak berarti apa-apa bagi yang membacanya, jadi
       * diterjemahkan ke keadaan yang sebenarnya.
       */
      const tipe = r.headers.get('content-type') || '';
      if (!tipe.includes('json')) {
        setPesan(r.status >= 500
          ? 'Server sedang tidak siap — coba lagi sebentar lagi'
          : `Gagal (HTTP ${r.status})`);
        return;
      }

      const j = await r.json();
      setPesan(j.ok ? 'Sinkron selesai' : (j.error || 'Gagal'));
      if (j.ok) location.reload();
    } catch (e) {
      // Gagal jaringan, bukan gagal sinkron.
      setPesan('Tidak bisa menghubungi server — periksa koneksi, lalu coba lagi');
    } finally { setSibuk(false); }
  }

  return (
    <header className="topbar">
      <div>
        <div className="crumb">PT Segawe Jaya Mulia</div>
        <h1>{judul}</h1>
      </div>
      <div className="spacer" />
      {pesan && <span className="badge b-mute">{pesan}</span>}
      {kanan}
      <span className="cmd" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <span>Cari pesanan, SKU…</span><kbd>⌘K</kbd>
      </span>
      <ThemeToggle />
      <button className="btn btn-sm btn-primary" onClick={sinkron} disabled={sibuk}>
        <IRefresh width={14} height={14} />
        {sibuk ? 'Menyinkron…' : 'Sinkron'}
      </button>
      <form action="/api/logout" method="post">
        <button className="btn btn-sm btn-ghost" aria-label="Keluar" title="Keluar">
          <IExit width={14} height={14} />
        </button>
      </form>
    </header>
  );
}

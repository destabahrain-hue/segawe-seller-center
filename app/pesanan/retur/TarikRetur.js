'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Tombol tarik retur. Penarikannya berjalan di latar server (lihat
 * app/api/retur/tarik/route.js); tombol ini hanya memulai lalu memantau
 * tiap 4 detik sampai selesai, kemudian memuat ulang halaman.
 */
async function bacaJson(r) {
  const teks = await r.text();
  try { return JSON.parse(teks); }
  catch {
    throw new Error(r.status >= 500
      ? `Server sedang sibuk atau terputus (HTTP ${r.status}). Coba lagi sebentar lagi.`
      : `Balasan server tidak terbaca (HTTP ${r.status}).`);
  }
}

export default function TarikRetur({ sisa }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  const [err, setErr] = useState('');
  const pantau = useRef(null);

  function berhentiPantau() {
    if (pantau.current) { clearInterval(pantau.current); pantau.current = null; }
  }

  function mulaiPantau() {
    berhentiPantau();
    const awal = Date.now();
    pantau.current = setInterval(async () => {
      try {
        const j = await fetch('/api/retur/tarik', { cache: 'no-store' }).then(bacaJson);
        if (!j.ok) return;
        const detik = Math.round((Date.now() - awal) / 1000);
        if (j.berjalan) { setPesan(`Sedang menarik retur di latar… ${detik} detik`); return; }
        berhentiPantau();
        setSibuk(false);
        if (/^GAGAL/.test(j.catatan || '')) { setErr(j.catatan); return; }
        setPesan(j.catatan || 'Selesai.');
        setTimeout(() => location.reload(), 1500);
      } catch { /* sambungan sesaat putus — coba lagi di detik berikutnya */ }
    }, 4000);
  }

  // Kalau halaman dibuka saat penarikan masih berjalan, langsung pantau.
  useEffect(() => {
    fetch('/api/retur/tarik', { cache: 'no-store' }).then(bacaJson)
      .then((j) => { if (j.ok && j.berjalan) { setSibuk(true); setPesan('Sedang menarik retur di latar…'); mulaiPantau(); } })
      .catch(() => {});
    return berhentiPantau;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function jalan() {
    setSibuk(true); setErr(''); setPesan('');
    try {
      const j = await fetch('/api/retur/tarik', { method: 'POST' }).then(bacaJson);
      if (!j.ok) { setErr(j.error || 'Gagal memulai'); setSibuk(false); return; }
      setPesan(j.sudahJalan ? 'Penarikan sudah berjalan — memantau…' : 'Penarikan dimulai — memantau…');
      mulaiPantau();
    } catch (e) { setErr(e.message); setSibuk(false); }
  }

  return (
    <>
      <button className="btn btn-sm btn-primary" onClick={jalan} disabled={sibuk}>
        {sibuk ? 'Menarik…' : 'Tarik data retur'}
      </button>
      {(pesan || err) && (
        <div className={err ? 'err' : 'ok'} style={{ marginTop: 8 }}>{err || pesan}</div>
      )}
      {sisa > 0 && !pesan && (
        <p className="t-mute" style={{ fontSize: 12.5, marginTop: 6, marginBottom: 0 }}>
          {sisa} toko riwayatnya belum tertarik penuh. Tekan lagi, atau tinggalkan — penjadwal
          melanjutkannya sendiri.
        </p>
      )}
    </>
  );
}

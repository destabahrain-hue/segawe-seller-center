'use client';
import { useState } from 'react';

/** Tombol tarik retur — menampilkan hasil apa adanya, termasuk kegagalan per toko. */
export default function TarikRetur({ sisa }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  const [err, setErr] = useState('');

  async function jalan() {
    setSibuk(true); setErr(''); setPesan('');
    try {
      const j = await fetch('/api/retur/tarik', { method: 'POST' }).then((r) => r.json());
      if (!j.ok) { setErr(j.error || 'Gagal menarik'); return; }
      const gagal = (j.toko || []).filter((t) => !t.ok);
      setPesan(`${j.tersimpan} retur tersimpan.`
        + (gagal.length ? ` ${gagal.length} toko gagal: ${gagal[0].nama} — ${gagal[0].error}` : ''));
      setTimeout(() => location.reload(), 1200);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
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
          {sisa} toko riwayatnya belum tertarik penuh. Tekan berulang kali sampai habis,
          atau tinggalkan — penjadwal melanjutkannya sendiri.
        </p>
      )}
    </>
  );
}

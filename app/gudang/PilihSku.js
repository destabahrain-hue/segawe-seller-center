'use client';
import { useMemo, useRef, useState } from 'react';

/**
 * Satu kotak untuk mengetik kode ATAU nama; saran yang muncul hanya kode
 * Master SKU + thumbnail + stok. Nama ikut dicari tapi tidak ditampilkan,
 * supaya daftar tetap ringkas dan tim terbiasa dengan kodenya.
 */
export function Foto({ src, ukuran = 36 }) {
  const gaya = { width: ukuran, height: ukuran, borderRadius: 8, flex: 'none',
                 border: '1px solid var(--line)', background: 'var(--surface-sunken)', objectFit: 'cover' };
  return src ? <img src={src} alt="" width={ukuran} height={ukuran} loading="lazy" style={gaya} />
             : <span style={{ ...gaya, display: 'inline-block' }} />;
}

export default function PilihSku({ id, master, nilai, onPilih, onEnter }) {
  const [teks, setTeks] = useState('');
  const [buka, setBuka] = useState(false);
  const [sorot, setSorot] = useState(0);
  const tutupNanti = useRef(null);

  const hasil = useMemo(() => {
    const kata = teks.toLowerCase().split(/\s+/).filter(Boolean);
    const cocok = kata.length
      ? master.filter((m) => kata.every((k) => `${m.code} ${m.name}`.toLowerCase().includes(k)))
      : master;
    // Kode yang DIAWALI ketikan naik ke atas.
    const awal = teks.trim().toLowerCase();
    return cocok
      .map((m) => ({ m, skor: m.code.toLowerCase().startsWith(awal) ? 0 : 1 }))
      .sort((a, b) => a.skor - b.skor || a.m.code.localeCompare(b.m.code))
      .slice(0, 8).map((x) => x.m);
  }, [teks, master]);

  const pilih = (m) => { onPilih(m); setTeks(''); setBuka(false); setSorot(0); };

  if (nilai) {
    return (
      <button type="button" onClick={() => { onPilih(null); setTimeout(() => document.getElementById(id)?.focus(), 0); }}
              title="Klik untuk ganti"
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                       background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}>
        <Foto src={nilai.gambar} />
        <span className="mono t-strong" style={{ fontSize: 13.5 }}>{nilai.code}</span>
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input id={id} value={teks} autoComplete="off" placeholder="Ketik kode atau nama barang…"
             onChange={(e) => { setTeks(e.target.value); setBuka(true); setSorot(0); }}
             onFocus={() => { clearTimeout(tutupNanti.current); setBuka(true); }}
             onBlur={() => { tutupNanti.current = setTimeout(() => setBuka(false), 150); }}
             onKeyDown={(e) => {
               if (e.key === 'ArrowDown') { e.preventDefault(); setBuka(true); setSorot((s) => Math.min(s + 1, hasil.length - 1)); }
               else if (e.key === 'ArrowUp') { e.preventDefault(); setSorot((s) => Math.max(s - 1, 0)); }
               else if (e.key === 'Enter') { e.preventDefault(); if (hasil[sorot]) { pilih(hasil[sorot]); onEnter?.(); } }
               else if (e.key === 'Escape') setBuka(false);
             }}
             style={{ width: '100%', height: 38 }} />
      {buka && (
        <div role="listbox"
             style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0,
                      background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10,
                      boxShadow: 'var(--sh-3)', overflow: 'hidden', maxHeight: 340, overflowY: 'auto' }}>
          {hasil.map((m, i) => (
            <div key={m.id} role="option" aria-selected={i === sorot}
                 onMouseDown={(e) => { e.preventDefault(); pilih(m); onEnter?.(); }}
                 onMouseEnter={() => setSorot(i)}
                 style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', cursor: 'pointer',
                          background: i === sorot ? 'var(--brand-tint)' : undefined }}>
              <Foto src={m.gambar} ukuran={32} />
              <span className="mono t-strong" style={{ fontSize: 13, flex: 1 }}>{m.code}</span>
              <span className="t-mute" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums',
                    color: m.saldo <= 0 ? 'var(--neg)' : undefined }}>stok {m.saldo.toLocaleString('id-ID')}</span>
            </div>
          ))}
          {!hasil.length && <div className="t-mute" style={{ padding: '10px 12px', fontSize: 13 }}>Tidak ada Master SKU yang cocok.</div>}
        </div>
      )}
    </div>
  );
}

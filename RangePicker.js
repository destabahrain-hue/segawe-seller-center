'use client';
import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { PILIHAN } from '@/lib/rentang';

/**
 * Daftar pilihannya bisa diganti lewat prop `pilihan` — halaman Pesanan
 * butuh "Semua waktu" sebagai bawaan, sedangkan halaman laporan tidak
 * boleh punya pilihan itu sama sekali.
 */
export default function RangePicker({ aktif = 'hari-ini', awal = '', akhir = '', pilihan = PILIHAN }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [a, setA] = useState(awal);
  const [b, setB] = useState(akhir);

  function pilih(kode) {
    const p = new URLSearchParams(sp.toString());
    p.set('r', kode);
    p.delete('hal');   // rentang baru, jumlah halamannya lain
    if (kode !== 'custom') { p.delete('dari'); p.delete('sampai'); }
    router.push(`${path}?${p.toString()}`);
  }

  function terapkan() {
    if (!a) return;
    const p = new URLSearchParams(sp.toString());
    p.set('r', 'custom');
    p.delete('hal');
    p.set('dari', a);
    p.set('sampai', b || a);
    router.push(`${path}?${p.toString()}`);
  }

  return (
    <div className="filter-vals" style={{ alignItems: 'center' }}>
      {pilihan.map(([kode, label]) => (
        <button key={kode} className="chip" aria-pressed={aktif === kode} onClick={() => pilih(kode)}>
          {label}
        </button>
      ))}

      {aktif === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <input type="date" value={a} onChange={(e) => setA(e.target.value)} aria-label="Tanggal awal"
                 style={{ minHeight: 30, fontSize: 12.5 }} />
          <span className="t-mute" style={{ fontSize: 12 }}>s/d</span>
          <input type="date" value={b} onChange={(e) => setB(e.target.value)} aria-label="Tanggal akhir"
                 style={{ minHeight: 30, fontSize: 12.5 }} />
          <button className="btn btn-sm btn-primary" onClick={terapkan} disabled={!a}>Terapkan</button>
        </span>
      )}
    </div>
  );
}

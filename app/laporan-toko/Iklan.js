'use client';
import { useState } from 'react';

export default function Iklan({ baris = 0, terawal = null }) {
  const [hari, setHari] = useState(30);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  const [gagal, setGagal] = useState([]);

  async function jalan() {
    setSibuk(true); setPesan(''); setGagal([]);
    try {
      const r = await fetch('/api/iklan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hari: Number(hari) }),
      });
      const j = await r.json();
      if (!j.ok) { setGagal([{ nama: 'Semua toko', error: j.error }]); return; }
      const ok = j.hasil.filter((x) => x.ok);
      const g = j.hasil.filter((x) => !x.ok);
      setPesan(`${ok.reduce((a, x) => a + x.hari, 0)} hari tersimpan dari ${ok.length} toko`);
      setGagal(g);
      if (!g.length) setTimeout(() => location.reload(), 1000);
    } catch (e) { setGagal([{ nama: '—', error: e.message }]); }
    finally { setSibuk(false); }
  }

  return (
    <div className="note" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        {baris > 0
          ? <><b>Biaya iklan tersimpan sejak {terawal}.</b> Tarik ulang kalau angkanya terasa tertinggal.</>
          : <><b>Biaya iklan belum pernah ditarik, jadi kolomnya masih Rp 0.</b> Selama ini kosong,
              laba yang ditampilkan lebih tinggi dari kenyataan — belanja iklan belum dikurangkan.</>}
        {pesan && <div className="ok" style={{ marginTop: 6 }}>{pesan}</div>}
        {gagal.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {gagal.map((g, i) => (
              <div key={i} className="err" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                <b>{g.nama}:</b> {g.error}
              </div>
            ))}
            <div className="t-mute" style={{ fontSize: 11.5, marginTop: 6 }}>
              Salin pesan di atas apa adanya — endpoint iklan belum pernah diuji,
              dan bentuk balasannya menentukan perbaikannya.
            </div>
          </div>
        )}
      </div>
      <div className="form-row" style={{ gap: 6, alignItems: 'center' }}>
        <select value={hari} onChange={(e) => setHari(e.target.value)}
                aria-label="Rentang biaya iklan" style={{ minHeight: 30, fontSize: 12.5 }}>
          <option value={7}>7 hari</option>
          <option value={30}>30 hari</option>
          <option value={90}>90 hari</option>
          <option value={180}>180 hari</option>
        </select>
        <button className="btn btn-sm btn-primary" onClick={jalan} disabled={sibuk}>
          {sibuk ? 'Menarik…' : 'Tarik biaya iklan'}
        </button>
      </div>
    </div>
  );
}

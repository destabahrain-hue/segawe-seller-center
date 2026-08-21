'use client';
import { useState } from 'react';

export default function Aksi({ shopId, nama, terhubung }) {
  const [buka, setBuka] = useState(false);
  const [tanya, setTanya] = useState(null);   // 'putuskan' | 'hapus'
  const [ketik, setKetik] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState('');

  async function jalankan(aksi) {
    setSibuk(true); setErr('');
    try {
      const r = await fetch('/api/toko', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi, shop_id: shopId }),
      });
      const j = await r.json();
      if (j.ok) location.reload(); else { setErr(j.error || 'Gagal'); setSibuk(false); }
    } catch (e) { setErr(e.message); setSibuk(false); }
  }

  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <div className="form-row" style={{ gap: 'var(--s2)' }}>
        <a className="btn btn-sm" href="/api/auth/shopee">
          {terhubung ? 'Otorisasi ulang' : 'Hubungkan ulang'}
        </a>
        <button className="btn btn-sm btn-ghost" onClick={() => setBuka(!buka)}
                aria-expanded={buka} aria-label="Pilihan lain">
          Pilihan lain
        </button>
      </div>

      {buka && !tanya && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'var(--s3)' }}>
          <button className="btn btn-sm" onClick={() => setTanya('putuskan')}>
            Hapus otorisasi — data tetap disimpan
          </button>
          <a className="btn btn-sm" href="/api/auth/cabut">
            Cabut izin di Shopee
          </a>
          <button className="btn btn-sm" onClick={() => { setTanya('hapus'); setKetik(''); }}
                  style={{ color: 'var(--neg)', borderColor: 'var(--neg)' }}>
            Hapus toko beserta seluruh datanya
          </button>
        </div>
      )}

      {tanya === 'putuskan' && (
        <div className="note" style={{ marginTop: 'var(--s3)', marginBottom: 0 }}>
          <div>
            <b>Putuskan {nama}?</b> Token dibuang dan toko berhenti disinkronkan.
            Seluruh pesanan, HPP, dan riwayat gudang <b>tetap tersimpan</b> — laporan bulan-bulan
            lalu tidak berubah. Kamu bisa menghubungkannya lagi kapan saja.
            <div className="form-row" style={{ marginTop: 'var(--s3)' }}>
              <button className="btn btn-sm btn-primary" disabled={sibuk}
                      onClick={() => jalankan('putuskan')}>
                {sibuk ? 'Memproses…' : 'Ya, putuskan'}
              </button>
              <button className="btn btn-sm" onClick={() => setTanya(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {tanya === 'hapus' && (
        <div className="note" style={{ marginTop: 'var(--s3)', marginBottom: 0,
                                       background: 'var(--neg-tint)', borderColor: 'var(--neg)', color: 'var(--neg)' }}>
          <div>
            <b>Ini tidak bisa dibatalkan.</b> Seluruh pesanan, rincian dana, penautan SKU,
            dan mutasi gudang milik <b>{nama}</b> ikut terhapus. Laporan keuangan bulan-bulan
            sebelumnya akan berubah.
            <div className="field" style={{ marginTop: 'var(--s3)', maxWidth: 260 }}>
              <label>Ketik <span className="mono">HAPUS</span> untuk melanjutkan</label>
              <input value={ketik} onChange={(e) => setKetik(e.target.value)} placeholder="HAPUS" />
            </div>
            <div className="form-row" style={{ marginTop: 'var(--s3)' }}>
              <button className="btn btn-sm" disabled={ketik !== 'HAPUS' || sibuk}
                      style={{ background: 'var(--neg)', borderColor: 'var(--neg)', color: '#fff' }}
                      onClick={() => jalankan('hapus')}>
                {sibuk ? 'Menghapus…' : 'Hapus permanen'}
              </button>
              <button className="btn btn-sm" onClick={() => setTanya(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {err && <p className="err">{err}</p>}
    </div>
  );
}

'use client';
import { useState } from 'react';

/**
 * Menarik pesanan lama dari Shopee. Sinkron harian hanya mengambil 1 hari
 * ke belakang, jadi tanpa ini laporan 7 hari dan 30 hari akan selalu
 * menampilkan angka yang sama — bukan karena query salah, tapi karena
 * data lamanya belum pernah ada di database.
 */
export default function Riwayat({ terawal, menunggu = 0 }) {
  const [hari, setHari] = useState(90);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  const [err, setErr] = useState('');

  async function jalan() {
    setSibuk(true); setPesan(''); setErr('');
    try {
      const r = await fetch('/api/riwayat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hari: Number(hari) }),
      });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || 'Gagal'); return; }
      setPesan(`${j.tugas} potongan diantrikan untuk ${j.toko} toko — dikerjakan bertahap`);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  const tgl = terawal
    ? new Date(terawal).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="note" style={{ alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        {tgl
          ? <><b>Data pesanan yang tersimpan baru sejak {tgl}.</b> Laporan untuk rentang
              yang lebih panjang akan terlihat sama, karena pesanan lamanya belum ditarik.</>
          : <><b>Belum ada pesanan tersimpan.</b> Tarik riwayat untuk mengisi laporan.</>}
        {menunggu > 0 && <> Sedang berjalan: <b>{menunggu} potongan</b> menunggu di antrean.</>}
        {pesan && <div className="ok" style={{ marginTop: 6 }}>{pesan}</div>}
        {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      </div>
      <div className="form-row" style={{ gap: 6, alignItems: 'center' }}>
        <select value={hari} onChange={(e) => setHari(e.target.value)}
                aria-label="Berapa hari ke belakang" style={{ minHeight: 30, fontSize: 12.5 }}>
          <option value={30}>30 hari</option>
          <option value={90}>90 hari</option>
          <option value={180}>180 hari</option>
          <option value={365}>1 tahun</option>
        </select>
        <button className="btn btn-sm btn-primary" onClick={jalan} disabled={sibuk}>
          {sibuk ? 'Mengantrikan…' : 'Tarik riwayat'}
        </button>
      </div>
    </div>
  );
}

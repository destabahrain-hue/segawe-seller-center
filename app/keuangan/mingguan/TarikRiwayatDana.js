'use client';
import { useState } from 'react';

/**
 * Menarik ulang rincian dana pesanan lama.
 *
 * Tanggal pencairan baru mulai disimpan belakangan, jadi pesanan yang
 * rincian dananya sudah pernah ditarik punya nilai tapi tanpa tanggal —
 * dan tidak masuk laporan minggu mana pun. Tombol ini menariknya ulang
 * dari Shopee, bertahap per putaran.
 */
export default function TarikRiwayatDana({ jumlah }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  const [err, setErr] = useState('');

  async function jalan() {
    setSibuk(true); setErr(''); setPesan('');
    try {
      const j = await fetch('/api/mingguan/tarik-dana', { method: 'POST' }).then((r) => r.json());
      if (!j.ok) { setErr(j.error || 'Gagal'); return; }
      const bagian = [];
      if (j.tanggalCair > 0) bagian.push(`${j.tanggalCair.toLocaleString('id-ID')} tanggal pencairan terisi`);
      if (j.diperbarui > 0) bagian.push(`${j.diperbarui.toLocaleString('id-ID')} rincian dana diperbarui`);
      if (!bagian.length) bagian.push('Belum ada yang berubah putaran ini');
      setPesan(bagian.join(', ')
        + (j.sisa > 0 ? `. Sisa ${j.sisa.toLocaleString('id-ID')} — tekan lagi.` : '. Semua sudah lengkap.'));
      if (j.gagal?.length) setErr(j.gagal.join(' · '));
      if (j.tanggalCair > 0 || j.diperbarui > 0) setTimeout(() => location.reload(), 1800);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  return (
    <div className="note" style={{ alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <b>{jumlah.toLocaleString('id-ID')} pesanan belum punya tanggal pencairan.</b>{' '}
        Selama belum ditarik, minggu-minggu sebelumnya akan terlihat kosong atau kurang.
        Sekali tekan mengerjakan beberapa potongan riwayat; kalau masih bersisa, tekan lagi.
        {pesan && <div className="ok" style={{ marginTop: 6 }}>{pesan}</div>}
        {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      </div>
      <button className="btn btn-sm btn-primary" onClick={jalan} disabled={sibuk}>
        {sibuk ? 'Menarik…' : 'Tarik data pencairan'}
      </button>
    </div>
  );
}

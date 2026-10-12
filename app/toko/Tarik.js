'use client';
import { useEffect, useState } from 'react';

/**
 * Penarikan data satu toko + bilah kemajuannya.
 *
 * Semua penarikan lewat antrean, jadi tombol di sini cuma MENGANTRIKAN.
 * Kemajuannya ditanyakan berkala selama masih ada tugas berjalan; begitu
 * selesai, pemantauan berhenti sendiri supaya tidak memanggil server terus.
 */
const PERIODE = {
  pesanan: [[90, '90 hari'], [180, '180 hari'], [365, '1 tahun'], [730, '2 tahun']],
  iklan:   [[30, '30 hari'], [90, '90 hari'], [180, '180 hari']],
};
const JUDUL = { produk: 'Produk', pesanan: 'Pesanan', iklan: 'Biaya iklan' };

const tgl = (x) => (x ? new Date(x).toLocaleDateString('id-ID',
  { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }) : null);
const num = (x) => Number(x || 0).toLocaleString('id-ID');

/**
 * Balasan yang bukan JSON (halaman galat gateway, sesi habis, deploy ulang)
 * dulu muncul sebagai "Unexpected token '<'" yang tidak berarti apa-apa
 * bagi tim. Di sini diterjemahkan jadi kalimat yang bisa ditindaklanjuti.
 */
async function bacaJson(r) {
  const teks = await r.text();
  try { return JSON.parse(teks); } catch {
    if (r.status === 401 || r.status === 403 || /\/login/.test(teks)) {
      throw new Error('Sesi berakhir — muat ulang halaman lalu masuk lagi.');
    }
    if (r.status === 502 || r.status === 504 || r.status === 524) {
      throw new Error('Server lama menjawab. Tugasnya kemungkinan sudah masuk antrean — muat ulang halaman untuk memastikan.');
    }
    throw new Error(`Balasan server tidak dikenali (${r.status}). Coba muat ulang halaman.`);
  }
}

export default function Tarik({ shopId, awal, terhubung }) {
  const [st, setSt] = useState(awal || null);
  const [hari, setHari] = useState({ pesanan: 90, iklan: 30 });
  const [sibuk, setSibuk] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!st?.berjalan) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/toko/tarik?shop_id=${shopId}`);
        const j = await bacaJson(r);
        if (j.ok) setSt(j.status[shopId]);
      } catch {}   // pemantauan berkala: satu kegagalan cukup dilewati
    }, 4000);
    return () => clearInterval(t);
  }, [st?.berjalan, shopId]);

  async function tarik(bagian) {
    setSibuk(bagian); setErr('');
    try {
      const r = await fetch('/api/toko/tarik', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, bagian, hari: hari[bagian] }),
      });
      const j = await bacaJson(r);
      if (j.ok) setSt(j.status); else setErr(j.error || 'Gagal');
    } catch (e) { setErr(e.message); }
    finally { setSibuk(''); }
  }

  if (!terhubung) return null;

  const baris = (bagian) => {
    const b = st?.[bagian] || {};
    const ket = bagian === 'produk'
      ? (b.jumlah ? `${num(b.jumlah)} produk · ditarik ${tgl(b.terakhir) || '—'}` : 'belum pernah ditarik')
      : bagian === 'pesanan'
        ? (b.jumlah ? `${num(b.jumlah)} pesanan · sejak ${tgl(b.terawal) || '—'}` : 'belum ada pesanan')
        : (b.terawal ? `iklan sejak ${tgl(b.terawal)}` : 'belum ada data iklan');

    return (
      <div key={bagian} style={{ display: 'grid', gap: 4, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5 }}>{JUDUL[bagian]}</b>
          <span className="t-mute" style={{ fontSize: 12 }}>{ket}</span>
          {b.gagal > 0 && <span className="badge b-warn">{b.gagal} gagal</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {PERIODE[bagian] && (
              <select value={hari[bagian]} onChange={(e) => setHari({ ...hari, [bagian]: Number(e.target.value) })}
                      aria-label={`Periode ${JUDUL[bagian]}`} style={{ minHeight: 30, fontSize: 12 }}>
                {PERIODE[bagian].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            )}
            <button className="btn btn-sm" disabled={!!sibuk || b.berjalan} onClick={() => tarik(bagian)}>
              {sibuk === bagian ? '…' : b.berjalan ? 'Berjalan' : 'Tarik'}
            </button>
          </div>
        </div>

        {b.berjalan && (
          <>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(b.persen || 0, 4)}%`, height: '100%', background: 'var(--brand)',
                            transition: 'width .4s ease' }} />
            </div>
            <div className="t-mute" style={{ fontSize: 11.5 }}>
              {bagian === 'pesanan'
                ? `Menarik pesanan… ${b.selesai} dari ${b.total} potongan (${b.persen}%)`
                : `Menarik ${JUDUL[bagian].toLowerCase()}… sisa ${b.sisa} tugas`}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 12.5 }}>Tarik data dari Shopee</b>
        <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }}
                disabled={!!sibuk || st?.berjalan} onClick={() => tarik('semua')}>
          {sibuk === 'semua' ? '…' : 'Tarik semua'}
        </button>
      </div>
      {['produk', 'pesanan', 'iklan'].map(baris)}
      <div className="t-mute" style={{ fontSize: 11.5, marginTop: 8 }}>
        Escrow dan retur ditarik sendiri oleh penjadwal begitu pesanannya ada
        {st?.retur ? ` · ${num(st.retur)} retur tersimpan` : ''}.
      </div>
      {err && <p className="err" style={{ marginBottom: 0 }}>{err}</p>}
    </div>
  );
}

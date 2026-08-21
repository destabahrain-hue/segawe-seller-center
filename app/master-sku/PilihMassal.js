'use client';
import { useEffect, useState } from 'react';

/**
 * ── Pilih massal + hapus massal Master SKU ──
 *
 * Kotak centangnya dirender oleh halaman (server), komponen ini hanya
 * membacanya lewat DOM. Sengaja begitu: tabelnya berisi banyak komponen
 * lain — HPP, tautan, lepas taut — dan memindahkan semuanya jadi satu
 * komponen klien hanya menambah risiko tanpa menambah kemampuan.
 *
 * Menghapus Master SKU BUKAN tindakan ringan: mutasi stok dan riwayat HPP
 * ikut terhapus mengikuti kunci asing. Karena itu selalu dua langkah —
 * periksa dampaknya dulu, baru hapus — dan yang punya riwayat stok
 * dilewati kecuali kamu menyalakannya sendiri.
 */
export default function PilihMassal() {
  const [jumlah, setJumlah] = useState(0);
  const [tahap, setTahap] = useState('diam');   // diam | memeriksa | tanya | jalan
  const [info, setInfo] = useState(null);
  const [ikutRiwayat, setIkutRiwayat] = useState(false);
  const [err, setErr] = useState('');

  const kotak = () => Array.from(document.querySelectorAll('input[name="pilih-sku"]'));
  const terpilih = () => kotak().filter((k) => k.checked);

  useEffect(() => {
    const hitung = () => setJumlah(terpilih().length);

    const onUbah = (e) => {
      const t = e.target;
      if (t?.id === 'pilih-semua-halaman') {
        kotak().forEach((k) => { k.checked = t.checked; });
      }
      if (t?.name === 'pilih-sku' || t?.id === 'pilih-semua-halaman') hitung();
    };

    document.addEventListener('change', onUbah);
    hitung();
    return () => document.removeEventListener('change', onUbah);
  }, []);

  function bersihkan() {
    kotak().forEach((k) => { k.checked = false; });
    const semua = document.getElementById('pilih-semua-halaman');
    if (semua) semua.checked = false;
    setJumlah(0);
  }

  async function periksa() {
    const ids = terpilih().map((k) => Number(k.value));
    if (!ids.length) return;
    setTahap('memeriksa'); setErr(''); setIkutRiwayat(false);
    try {
      const r = await fetch('/api/master-sku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'periksa-hapus-massal', ids }),
      });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || 'Gagal memeriksa'); setTahap('diam'); return; }
      setInfo(j); setTahap('tanya');
    } catch (e) { setErr(e.message); setTahap('diam'); }
  }

  async function hapus() {
    setTahap('jalan'); setErr('');
    try {
      const r = await fetch('/api/master-sku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aksi: 'hapus-massal',
          ids: info.baris.map((b) => b.id),
          ikutRiwayat,
        }),
      });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || 'Gagal menghapus'); setTahap('tanya'); return; }
      location.reload();
    } catch (e) { setErr(e.message); setTahap('tanya'); }
  }

  const bisaHapus = info
    ? info.baris.filter((b) => !b.terkunci && (ikutRiwayat || b.mutasi === 0)).length
    : 0;

  return (
    <>
      <div className="form-row" style={{ alignItems: 'center', gap: 'var(--s2)',
                                         marginBottom: 'var(--s3)', flexWrap: 'wrap' }}>
        <span className="t-mute" style={{ fontSize: 12.5 }}>
          {jumlah ? <><b style={{ color: 'var(--ink)' }}>{jumlah}</b> Master SKU dipilih</>
                  : 'Centang baris untuk menghapus beberapa sekaligus'}
        </span>
        <div className="spacer" style={{ flex: 1 }} />
        {jumlah > 0 && (
          <>
            <button className="btn btn-sm" onClick={bersihkan}>Batal pilih</button>
            <button className="btn btn-sm" onClick={periksa} disabled={tahap === 'memeriksa'}
                    style={{ color: 'var(--neg)', borderColor: 'var(--neg)' }}>
              {tahap === 'memeriksa' ? 'Memeriksa…' : `Hapus ${jumlah} Master SKU`}
            </button>
          </>
        )}
      </div>
      {err && <p className="err">{err}</p>}

      {tahap !== 'diam' && tahap !== 'memeriksa' && info && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', padding: 20,
                      background: 'rgba(11,18,38,.62)' }}
             role="alertdialog" aria-modal="true">
          <div className="card" style={{ width: 'min(660px,100%)', maxHeight: '86vh',
                                         display: 'flex', flexDirection: 'column' }}>
            <div className="card-head"><h2>Hapus {info.baris.length} Master SKU?</h2></div>
            <div className="card-body" style={{ overflow: 'auto' }}>
              <p style={{ marginTop: 0 }}>
                Menghapus Master SKU <b>ikut menghapus mutasi stok dan riwayat HPP-nya</b>.
                Saldo gudang, laporan laba, dan Days of Supply untuk barang itu akan berubah,
                dan tidak ada tombol urungkan.
              </p>

              {info.terkunci > 0 && (
                <p className="err" style={{ marginTop: 0 }}>
                  {info.terkunci} SKU dilewati karena masih jadi <b>isi paket</b>. Keluarkan dulu
                  dari paketnya kalau memang mau dihapus.
                </p>
              )}

              {info.punyaMutasi > 0 && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                                padding: '10px 12px', borderRadius: 'var(--r-sm)',
                                background: 'var(--warn-tint)', border: '1px solid var(--warn)' }}>
                  <input type="checkbox" checked={ikutRiwayat}
                         onChange={(e) => setIkutRiwayat(e.currentTarget.checked)} />
                  <span>
                    <b>{info.punyaMutasi} SKU punya riwayat stok</b> ({info.totalMutasi} baris mutasi).
                    Secara bawaan yang ini <b>dilewati</b>. Centang kalau memang mau ikut dihapus
                    beserta seluruh riwayatnya.
                  </span>
                </label>
              )}

              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr>
                    <th>Master SKU</th><th className="t-right">Tertaut</th>
                    <th className="t-right">Mutasi</th><th>Hasil</th>
                  </tr></thead>
                  <tbody>
                    {info.baris.map((b) => {
                      const dilewati = b.terkunci || (!ikutRiwayat && b.mutasi > 0);
                      return (
                        <tr key={b.id}>
                          <td><div className="tt">{b.name}</div><div className="st mono">{b.code}</div></td>
                          <td className="t-num">{b.taut}</td>
                          <td className="t-num">{b.mutasi}</td>
                          <td>
                            {b.terkunci
                              ? <span className="badge b-mute">isi paket {b.induk.join(', ')}</span>
                              : dilewati
                                ? <span className="badge b-warn">dilewati</span>
                                : <span className="badge b-neg">dihapus</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center',
                          padding: 'var(--s4)', borderTop: '1px solid var(--line)' }}>
              <span className="t-mute" style={{ fontSize: 12.5, flex: 1 }}>
                {bisaHapus} dari {info.baris.length} akan benar-benar dihapus.
              </span>
              <button className="btn btn-sm" onClick={() => setTahap('diam')}
                      disabled={tahap === 'jalan'}>Batal</button>
              <button className="btn btn-sm btn-primary" onClick={hapus}
                      disabled={tahap === 'jalan' || bisaHapus === 0}
                      style={{ background: 'var(--neg)', borderColor: 'var(--neg)' }}>
                {tahap === 'jalan' ? 'Menghapus…' : `Hapus ${bisaHapus}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

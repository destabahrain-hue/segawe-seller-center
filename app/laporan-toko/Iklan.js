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
      setPesan(`${ok.reduce((a, x) => a + x.hari, 0)} hari tersimpan dari ${ok.length} toko`
        + ' — lanjut menarik rincian per produk\u2026');

      /**
       * Rincian per produk ditarik menyusul, bukan sekaligus.
       *
       * Dua alasan. Batas laju endpoint Ads jauh lebih ketat, jadi jarak
       * antar panggilan harus longgar dan prosesnya lama (belasan panggilan
       * per toko). Dan kalau bagian ini gagal, total iklan per toko yang
       * sudah tersimpan di atas TIDAK ikut hilang — laporan tetap punya
       * angka yang benar, hanya rinciannya yang belum ada.
       *
       * Dibatasi 30 hari sekali jalan; untuk rentang lebih panjang, jalankan
       * berulang. Sekali jalan 90 hari akan gagal di tengah.
       */
      let pesanRinci = '';
      try {
        const r2 = await fetch('/api/iklan-item', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hari: Math.min(Number(hari), 30) }),
        });
        const j2 = await r2.json();
        if (!j2.ok) {
          g.push({ nama: 'Rincian per produk', error: j2.error });
        } else {
          const ok2 = j2.hasil.filter((x) => x.ok);
          const baris2 = ok2.reduce((a, x) => a + (x.baris || 0), 0);
          pesanRinci = `${baris2} baris biaya per produk dari ${ok2.length} toko`
            + (Number(hari) > 30 ? ' (rincian dibatasi 30 hari)' : '');
          g.push(...j2.hasil.filter((x) => !x.ok)
            .map((x) => ({ nama: `${x.nama || x.shopId} (per produk)`, error: x.error })));
        }
      } catch (e) {
        g.push({ nama: 'Rincian per produk', error: e.message });
      }

      setPesan([`${ok.reduce((a, x) => a + x.hari, 0)} hari tersimpan dari ${ok.length} toko`,
                pesanRinci].filter(Boolean).join(' \u00b7 '));
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
              Salin pesan di atas apa adanya. Kalau yang gagal hanya bagian
              &quot;per produk&quot;, total iklan per toko tetap tersimpan dan
              laporan tetap benar — cuma rincian per SKU-nya yang belum ada.
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

'use client';
import { useState } from 'react';

export function SetelanToko({ shopId, otomatis, slot }) {
  const [on, setOn] = useState(!!otomatis);
  const [n, setN] = useState(slot || 5);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');

  async function simpan(next = on, jml = n) {
    setSibuk(true); setPesan('');
    const r = await fetch('/api/boost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'setelan', shop_id: shopId, otomatis: next, slot: Number(jml) }),
    });
    setSibuk(false);
    setPesan((await r.json()).ok ? 'tersimpan' : 'gagal');
    setTimeout(() => setPesan(''), 1500);
  }

  async function sekarang() {
    setSibuk(true); setPesan('menjalankan…');
    const r = await fetch('/api/boost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'sekarang', shop_id: shopId }),
    });
    const j = await r.json();
    setSibuk(false);
    if (j.ok) { setPesan(`${j.hasil.naik?.length ?? 0} dinaikkan`); setTimeout(() => location.reload(), 900); }
    else setPesan(j.error || 'gagal');
  }

  return (
    <div className="form-row" style={{ gap: 'var(--s2)', alignItems: 'center' }}>
      <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <input type="checkbox" checked={on} disabled={sibuk}
               onChange={(e) => { setOn(e.target.checked); simpan(e.target.checked, n); }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Otomatis</span>
      </label>
      <input type="number" min="1" max="10" value={n} disabled={sibuk} aria-label="Jumlah slot"
             onChange={(e) => setN(e.target.value)} onBlur={() => simpan(on, n)}
             style={{ width: 62, height: 28, padding: '0 8px', border: '1px solid var(--line-strong)',
                      borderRadius: 'var(--r-sm)', fontSize: 12.5, textAlign: 'right' }} />
      <span className="t-mute" style={{ fontSize: 11.5 }}>slot</span>
      <button className="btn btn-sm" onClick={sekarang} disabled={sibuk}>Jalankan sekarang</button>
      {pesan && <span className="badge b-mute">{pesan}</span>}
    </div>
  );
}

export function AturDaftar({ shopId, kandidat, sudah }) {
  const [buka, setBuka] = useState(false);
  const [pilih, setPilih] = useState(new Set());
  const [cari, setCari] = useState('');
  const [sibuk, setSibuk] = useState(false);

  async function kirim(aksi, items) {
    setSibuk(true);
    await fetch('/api/boost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi, shop_id: shopId, items }),
    });
    location.reload();
  }

  if (!buka) {
    return <button className="btn btn-sm" onClick={() => setBuka(true)}>
      Atur daftar giliran ({sudah.length})
    </button>;
  }

  const belum = kandidat.filter((k) => !sudah.some((s) => String(s.item_id) === String(k.item_id)));

  /**
   * Pencarian per toko: nama produk ATAU SKU.
   *
   * Kata dicocokkan terpisah, jadi "tensi omicron" tetap ketemu walau di
   * nama produk kedua kata itu berjauhan — nama produk Shopee panjang dan
   * urutan katanya jarang sesuai ingatan orang.
   */
  const kata = cari.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const terlihat = kata.length
    ? belum.filter((k) => {
        const teks = `${k.name || ''} ${k.item_sku || ''}`.toLowerCase();
        return kata.every((w) => teks.includes(w));
      })
    : belum;

  // "Pilih semua" hanya mencakup yang SEDANG TERLIHAT. Mencentang diam-diam
  // produk di luar hasil pencarian adalah cara mudah memasukkan barang yang
  // tidak dimaksud ke giliran boost.
  const semuaTerlihat = terlihat.length > 0 && terlihat.every((k) => pilih.has(k.item_id));

  function alihSemua() {
    const s = new Set(pilih);
    if (semuaTerlihat) terlihat.forEach((k) => s.delete(k.item_id));
    else terlihat.forEach((k) => s.add(k.item_id));
    setPilih(s);
  }

  return (
    <div style={{ width: '100%', marginTop: 'var(--s3)' }}>
      <div className="bulkbar">
        <span className="t">
          {pilih.size ? `${pilih.size} dipilih` : 'Pilih produk untuk masuk giliran'}
        </span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => setBuka(false)}>Tutup</button>
        <button className="btn btn-sm btn-primary" disabled={!pilih.size || sibuk}
                onClick={() => kirim('tambah', [...pilih])}>
          {sibuk ? 'Menyimpan…' : `Tambahkan${pilih.size ? ` (${pilih.size})` : ''}`}
        </button>
      </div>

      <div className="form-row" style={{ gap: 8, alignItems: 'center', margin: 'var(--s3) 0' }}>
        <input value={cari} onChange={(e) => setCari(e.target.value)} autoFocus
               placeholder="Cari nama produk atau SKU di toko ini…"
               style={{ flex: 1, height: 32 }} />
        {cari && (
          <button className="btn btn-sm" onClick={() => setCari('')}>Hapus cari</button>
        )}
        <span className="t-mute" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {kata.length ? `${terlihat.length} dari ${belum.length}` : `${belum.length} produk`}
        </span>
      </div>

      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead><tr>
            <th style={{ width: 36 }}>
              <input type="checkbox" checked={semuaTerlihat} onChange={alihSemua}
                     disabled={!terlihat.length}
                     aria-label="Pilih semua yang terlihat" />
            </th>
            <th style={{ width: 52 }}></th>
            <th>Produk</th><th>SKU</th>
          </tr></thead>
          <tbody>
            {terlihat.map((k) => (
              <tr key={k.item_id}>
                <td><input type="checkbox" checked={pilih.has(k.item_id)} aria-label={`Pilih ${k.name}`}
                           onChange={() => { const s = new Set(pilih);
                             s.has(k.item_id) ? s.delete(k.item_id) : s.add(k.item_id); setPilih(s); }} /></td>
                <td>
                  {k.image_url
                    ? <img src={k.image_url} alt="" width={40} height={40} loading="lazy"
                           style={{ borderRadius: 6, objectFit: 'cover',
                                    border: '1px solid var(--line)' }} />
                    : <div style={{ width: 40, height: 40, borderRadius: 6,
                                    background: 'var(--surface-sunken)',
                                    border: '1px solid var(--line)' }} />}
                </td>
                <td className="tt">{k.name}</td>
                <td className="mono t-mute">{k.item_sku || '—'}</td>
              </tr>
            ))}
            {!terlihat.length && (
              <tr><td colSpan={4} className="t-mute">
                {kata.length
                  ? `Tidak ada produk yang cocok dengan "${cari}" di toko ini.`
                  : 'Semua produk aktif toko ini sudah masuk giliran.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HapusDariGiliran({ shopId, itemId }) {
  const [sibuk, setSibuk] = useState(false);
  return (
    <button className="btn btn-sm" disabled={sibuk} onClick={async () => {
      setSibuk(true);
      await fetch('/api/boost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'hapus', shop_id: shopId, items: [itemId] }),
      });
      location.reload();
    }}>{sibuk ? '…' : 'Keluarkan'}</button>
  );
}

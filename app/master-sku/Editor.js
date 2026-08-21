'use client';
import { useState } from 'react';

export function HppInput({ id, awal }) {
  const [v, setV] = useState(awal ?? '');
  const [st, setSt] = useState('');
  async function simpan() {
    setSt('…');
    const r = await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'hpp', id, hpp: Number(String(v).replace(/\D/g, '')) }),
    });
    setSt(r.ok ? '✓' : '✕');
    setTimeout(() => setSt(''), 1600);
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input className="hpp-in num" value={v} aria-label="HPP"
             onChange={(e) => setV(e.target.value)} onBlur={simpan}
             onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <span className="t-mute" style={{ width: 12, fontSize: 12 }}>{st}</span>
    </span>
  );
}

export function TambahMaster() {
  const [buka, setBuka] = useState(false);
  const [f, setF] = useState({ code: '', name: '', kind: 'tunggal', reorder_at: 0 });
  const [err, setErr] = useState('');
  async function kirim() {
    setErr('');
    const r = await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'buat', ...f }),
    });
    const j = await r.json();
    if (j.ok) location.reload(); else setErr(j.error || 'Gagal menyimpan');
  }
  if (!buka) return <button className="btn btn-sm btn-primary" onClick={() => setBuka(true)}>Master SKU baru</button>;
  return (
    <div className="card" style={{ padding: 'var(--s4) var(--s5)', marginBottom: 'var(--s4)' }}>
      <div className="form-row">
        <div className="field"><label>Kode</label>
          <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="NEB-W302" /></div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Nama</label>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nebulizer JSL W-302" /></div>
        <div className="field"><label>Tipe</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="tunggal">Tunggal</option><option value="paket">Paket / bundling</option>
          </select></div>
        <div className="field"><label>Ambang restock</label>
          <input type="number" value={f.reorder_at} onChange={(e) => setF({ ...f, reorder_at: e.target.value })} style={{ width: 110 }} /></div>
        <button className="btn btn-primary" onClick={kirim}>Simpan</button>
        <button className="btn" onClick={() => setBuka(false)}>Batal</button>
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

export function AturKomponen({ id, semua, awal }) {
  const [buka, setBuka] = useState(false);
  const [baris, setBaris] = useState(awal.length ? awal : [{ child_id: '', qty: 1 }]);
  async function simpan() {
    await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'komponen', id, komponen: baris.filter((b) => b.child_id) }),
    });
    location.reload();
  }
  if (!buka) return <button className="btn btn-sm" onClick={() => setBuka(true)}>Atur isi paket</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {baris.map((b, i) => (
        <div className="form-row" key={i}>
          <select value={b.child_id} style={{ minHeight: 32, minWidth: 240 }}
                  onChange={(e) => { const n = [...baris]; n[i].child_id = e.target.value; setBaris(n); }}>
            <option value="">— pilih komponen —</option>
            {semua.filter((s) => s.id !== id && s.kind === 'tunggal').map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </select>
          <input type="number" min="1" value={b.qty} style={{ width: 80, minHeight: 32 }}
                 onChange={(e) => { const n = [...baris]; n[i].qty = e.target.value; setBaris(n); }} />
          <button className="btn btn-sm" onClick={() => setBaris(baris.filter((_, x) => x !== i))}>Hapus</button>
        </div>
      ))}
      <div className="form-row">
        <button className="btn btn-sm" onClick={() => setBaris([...baris, { child_id: '', qty: 1 }])}>Tambah komponen</button>
        <button className="btn btn-sm btn-primary" onClick={simpan}>Simpan isi paket</button>
        <button className="btn btn-sm" onClick={() => setBuka(false)}>Tutup</button>
      </div>
    </div>
  );
}

export function Tautkan({ shopId, shopSku, semua, usul = null }) {
  const [v, setV] = useState('');
  const [sibuk, setSibuk] = useState(false);

  async function simpan(id) {
    if (!id) return;
    setSibuk(true); setV(id);
    await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'tautkan', shop_id: shopId, shop_sku: shopSku, master_sku_id: id }),
    });
    location.reload();
  }

  // Mode usulan: tombol setuju satu klik, bukan dropdown.
  if (usul) {
    return (
      <button className="btn btn-sm" disabled={sibuk} onClick={() => simpan(usul.id)}
              title={`Tautkan ${shopSku} ke ${usul.code}`}>
        {sibuk ? '…' : <>Tautkan ke <span className="mono">{usul.code}</span></>}
      </button>
    );
  }

  return (
    <select value={v} disabled={sibuk} onChange={(e) => simpan(e.target.value)}
            style={{ minHeight: 30, fontSize: 12.5 }}>
      <option value="">— pilih sendiri —</option>
      {semua.map((s2) => <option key={s2.id} value={s2.id}>{s2.code}</option>)}
    </select>
  );
}

/** Tautkan otomatis SKU toko yang namanya sama persis dengan kode ini. */
export function TautkanPersis({ id, kode }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  return (
    <>
      <button className="btn btn-sm" disabled={sibuk} title={`Tautkan SKU toko bernama persis "${kode}"`}
              onClick={async () => {
                setSibuk(true); setPesan('');
                const r = await fetch('/api/master-sku', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ aksi: 'tautkan-persis', id }),
                });
                const j = await r.json();
                if (j.ok && j.jumlah > 0) location.reload();
                else { setPesan(j.ok ? 'tidak ada yang sama persis' : (j.error || 'gagal')); setSibuk(false); }
              }}>
        {sibuk ? '…' : 'Tautkan sama persis'}
      </button>
      {pesan && <span className="st">{pesan}</span>}
    </>
  );
}

export function HapusMaster({ id, kode }) {
  const [tahap, setTahap] = useState('diam');   // diam | memeriksa | tanya | jalan
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');

  async function periksa() {
    setTahap('memeriksa'); setErr('');
    const r = await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'periksa-hapus', id }),
    });
    const j = await r.json();
    if (!j.ok) { setErr(j.error || 'Gagal memeriksa'); setTahap('diam'); return; }
    setInfo(j); setTahap('tanya');
  }

  async function hapus() {
    setTahap('jalan'); setErr('');
    const r = await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'hapus', id }),
    });
    const j = await r.json();
    if (j.ok) location.reload();
    else { setErr(j.error || 'Gagal menghapus'); setTahap('tanya'); }
  }

  if (tahap === 'diam' || tahap === 'memeriksa') {
    return (
      <>
        <button className="btn btn-sm" onClick={periksa} disabled={tahap === 'memeriksa'}
                style={{ color: 'var(--neg)' }}>
          {tahap === 'memeriksa' ? '…' : 'Hapus'}
        </button>
        {err && <div className="err">{err}</div>}
      </>
    );
  }

  return (
    <div className="note" style={{ margin: 0, background: 'var(--neg-tint)',
                                   borderColor: 'var(--neg)', color: 'var(--neg)' }}>
      <div>
        {info.terkunci ? (
          <>
            <b>{kode} tidak bisa dihapus.</b> Masih jadi isi paket {info.induk.join(', ')}.
            Keluarkan dulu dari paket itu lewat <b>Atur isi paket</b>.
          </>
        ) : (
          <>
            <b>Hapus {kode}?</b> Ikut terhapus: {info.hpp} riwayat HPP,
            {' '}{info.mutasi} mutasi gudang. {info.taut} SKU toko akan lepas tautannya.
            {info.mutasi > 0 && <> Saldo stoknya kembali nol.</>}
            {' '}Laporan laba periode lalu untuk produk ini akan berubah.
          </>
        )}
        <div className="form-row" style={{ marginTop: 'var(--s3)' }}>
          {!info.terkunci && (
            <button className="btn btn-sm" disabled={tahap === 'jalan'} onClick={hapus}
                    style={{ background: 'var(--neg)', borderColor: 'var(--neg)', color: '#fff' }}>
              {tahap === 'jalan' ? 'Menghapus…' : 'Ya, hapus'}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setTahap('diam')}>Batal</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}

export function LepasTaut({ shopId, shopSku }) {
  const [sibuk, setSibuk] = useState(false);
  async function lepas() {
    setSibuk(true);
    await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'lepas', shop_id: shopId, shop_sku: shopSku }),
    });
    location.reload();
  }
  return (
    <button className="btn btn-sm" onClick={lepas} disabled={sibuk}>
      {sibuk ? '…' : 'Lepas'}
    </button>
  );
}

export function AutoMap() {
  const [tahap, setTahap] = useState('diam');   // diam | memindai | pratinjau | menerapkan
  const [longgar, setLonggar] = useState(false);
  const [sumber, setSumber] = useState('produk');
  const [hasil, setHasil] = useState(null);
  const [batal, setBatal] = useState(new Set());   // kunci yang TIDAK jadi dibuat
  const [err, setErr] = useState('');

  async function pindai(mode = longgar, src = sumber) {
    setTahap('memindai'); setErr(''); setBatal(new Set());
    const r = await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'auto-map', longgar: mode, sumber: src }),
    });
    const j = await r.json();
    if (!j.ok) { setErr(j.error || 'Gagal memindai'); setTahap('diam'); return; }
    setHasil(j); setTahap('pratinjau');
  }

  async function terapkan() {
    setTahap('menerapkan'); setErr('');
    const pilih = hasil.usul.map((u) => u.kunci).filter((k) => !batal.has(k));
    const r = await fetch('/api/master-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi: 'auto-map-terapkan', longgar, sumber, pilih }),
    });
    const j = await r.json();
    if (j.ok) location.reload();
    else { setErr(j.error || 'Gagal menerapkan'); setTahap('pratinjau'); }
  }

  function toggle(k) {
    const n = new Set(batal);
    n.has(k) ? n.delete(k) : n.add(k);
    setBatal(n);
  }

  if (tahap === 'diam' || tahap === 'memindai') {
    return (
      <>
        <button className="btn btn-sm btn-primary" onClick={() => pindai()} disabled={tahap === 'memindai'}>
          {tahap === 'memindai' ? 'Memindai katalog…' : 'Buat otomatis dari katalog produk'}
        </button>
        {err && <div className="err">{err}</div>}
      </>
    );
  }

  const dipakai = hasil.usul.filter((u) => !batal.has(u.kunci));
  const akanBuat = dipakai.filter((u) => !u.adaId).length;
  const akanTaut = dipakai.reduce((a, u) => a + u.jumlahSku, 0);

  return (
    <div className="card" style={{ marginBottom: 'var(--s4)' }}>
      <div className="card-head">
        <h2>Usulan Master SKU otomatis</h2>
        <span className="badge b-info">{akanBuat} akan dibuat</span>
        <span className="badge b-mute">{akanTaut} SKU toko ditautkan</span>
        <div className="spacer" />
        <select value={sumber} aria-label="Sumber SKU"
                onChange={(e) => { setSumber(e.target.value); pindai(longgar, e.target.value); }}>
          <option value="produk">Dari katalog produk</option>
          <option value="produk+pesanan">Katalog + pesanan lama</option>
        </select>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <input type="checkbox" checked={longgar}
                 onChange={(e) => { setLonggar(e.target.checked); pindai(e.target.checked, sumber); }} />
          <span style={{ fontSize: 12.5 }}>Gabungkan penulisan mirip</span>
        </label>
        <button className="btn btn-sm" onClick={() => setTahap('diam')}>Batal</button>
        <button className="btn btn-sm btn-primary" onClick={terapkan}
                disabled={tahap === 'menerapkan' || !dipakai.length}>
          {tahap === 'menerapkan' ? 'Menerapkan…' : `Terapkan ${dipakai.length} usulan`}
        </button>
      </div>

      {longgar && (
        <div className="note" style={{ margin: 'var(--s4) var(--s5) 0' }}>
          <div>
            <b>Mode gabung menyala.</b> Spasi, tanda hubung, dan titik diabaikan, jadi
            <span className="mono"> NEB W302</span> dan <span className="mono">NEB-W302</span> dianggap sama.
            Periksa kolom <b>Penulisan ditemukan</b> — kalau ada yang seharusnya beda produk, hilangkan centangnya.
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th style={{ width: 40 }}></th>
            <th>Kode</th><th>Nama diusulkan</th><th>Penulisan ditemukan</th>
            <th className="t-right">SKU toko</th><th>Toko</th><th>Tindakan</th>
          </tr></thead>
          <tbody>
            {hasil.usul.map((u) => (
              <tr key={u.kunci} style={batal.has(u.kunci) ? { opacity: .45 } : undefined}>
                <td><input type="checkbox" checked={!batal.has(u.kunci)}
                           onChange={() => toggle(u.kunci)} aria-label={`Pakai ${u.kode}`} /></td>
                <td className="mono t-strong">{u.kode}</td>
                <td className="tt">{u.nama}</td>
                <td className="mono t-mute">{u.variasi.join(' · ')}</td>
                <td className="t-num">{u.jumlahSku}</td>
                <td className="t-mute" style={{ fontSize: 11.5 }}>{u.toko.join(', ')}</td>
                <td>
                  <span className={'badge ' + (u.adaId ? 'b-mute' : 'b-info')}>
                    {u.adaId ? 'tautkan ke yang ada' : 'buat baru'}
                  </span>
                </td>
              </tr>
            ))}
            {!hasil.usul.length && (
              <tr><td colSpan={7} className="t-mute">
                Tidak ada SKU baru yang bisa diusulkan. Semua SKU di pesanan sudah tertaut.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card-body" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--s3)' }}>
        <span className="t-mute" style={{ fontSize: 12 }}>
          Sumber SKU adalah katalog produk yang sudah ditarik dari Shopee.
          Kalau ada produk yang belum muncul, tarik ulang katalog di halaman Produk.
          HPP tidak ikut terisi — itu tetap harus kamu masukkan sendiri.
        </span>
      </div>
      {err && <div className="err" style={{ padding: '0 var(--s5) var(--s4)' }}>{err}</div>}
    </div>
  );
}

'use client';
import { useMemo, useState } from 'react';

const rp = (n) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);

/** Kotak gambar seragam, dengan cadangan huruf awal kalau tidak ada foto. */
function Foto({ src, kode, ukuran = 44 }) {
  if (src) {
    return <img src={src} alt="" width={ukuran} height={ukuran} loading="lazy"
                style={{ width: ukuran, height: ukuran, flex: `0 0 ${ukuran}px`, objectFit: 'cover',
                         borderRadius: 'var(--r-sm)', border: '1px solid var(--line)',
                         background: 'var(--surface-sunken)' }} />;
  }
  return <span className="thumb" style={{ width: ukuran, height: ukuran, flex: `0 0 ${ukuran}px` }}>
    {String(kode || '?').slice(0, 3).toUpperCase()}
  </span>;
}

export default function Editor({ master, komponen, semua, tertaut, gambar }) {
  const [nama, setNama] = useState(master.name || '');
  const [hpp, setHpp] = useState(master.hpp ? Math.round(master.hpp) : '');
  const [isi, setIsi] = useState(komponen.map((k) => ({ id: String(k.id), qty: k.qty, code: k.code, name: k.name, hpp: k.hpp })));
  const [cari, setCari] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');
  const [err, setErr] = useState('');

  const paket = master.kind === 'paket';
  const hppPaket = isi.reduce((a, k) => a + Number(k.hpp || 0) * Number(k.qty || 0), 0);

  // Pencarian komponen — tanpa ini daftar 800 SKU tidak mungkin dipakai.
  const kandidat = useMemo(() => {
    const k = cari.trim().toUpperCase();
    const sudah = new Set(isi.map((x) => String(x.id)));
    return semua
      .filter((s) => !sudah.has(String(s.id)))
      .filter((s) => !k || `${s.code} ${s.name}`.toUpperCase().includes(k))
      .slice(0, 40);
  }, [cari, semua, isi]);

  async function kirim(body) {
    setSibuk(true); setErr(''); setPesan('');
    try {
      const r = await fetch('/api/master-sku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || 'Gagal'); return null; }
      return j;
    } catch (e) { setErr(e.message); return null; }
    finally { setSibuk(false); }
  }

  const simpanDasar = async () => {
    if (await kirim({ aksi: 'ubah', id: master.id, name: nama })) setPesan('Nama tersimpan');
  };
  const simpanHpp = async () => {
    if (await kirim({ aksi: 'hpp', id: master.id, hpp: Number(hpp) || 0 })) setPesan('HPP tersimpan');
  };
  const simpanIsi = async () => {
    const j = await kirim({ aksi: 'komponen', id: master.id,
      komponen: isi.map((k) => ({ child_id: k.id, qty: Number(k.qty) || 1 })) });
    if (j) { setPesan('Isi paket tersimpan'); setTimeout(() => location.reload(), 700); }
  };
  const tautkanPersis = async () => {
    const j = await kirim({ aksi: 'tautkan-persis', id: master.id });
    if (j) {
      setPesan(j.jumlah > 0 ? `${j.jumlah} SKU toko ditautkan` : 'Tidak ada SKU toko yang namanya sama persis');
      if (j.jumlah > 0) setTimeout(() => location.reload(), 700);
    }
  };
  const lepas = async (shopId, shopSku) => {
    if (await kirim({ aksi: 'lepas', shop_id: shopId, shop_sku: shopSku })) location.reload();
  };

  return (
    <>
      <div className="form-row" style={{ marginBottom: 'var(--s4)', alignItems: 'center' }}>
        <a className="btn btn-sm" href="/master-sku">‹ Kembali ke daftar</a>
        <div className="spacer" style={{ flex: 1 }} />
        {pesan && <span className="badge b-pos">{pesan}</span>}
        {err && <span className="badge b-neg">{err}</span>}
      </div>

      {/* ── Informasi dasar ── */}
      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head">
          <h2>Informasi dasar</h2>
          <span className={'badge ' + (paket ? 'b-info' : 'b-mute')}>{paket ? 'SKU paket' : 'SKU tunggal'}</span>
        </div>
        <div className="card-body">
          <div className="form-row" style={{ gap: 'var(--s4)', alignItems: 'flex-start' }}>
            <Foto src={gambar} kode={master.code} ukuran={88} />
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="field" style={{ marginBottom: 'var(--s3)' }}>
                <label>Kode Master SKU</label>
                <input value={master.code} readOnly className="mono"
                       style={{ background: 'var(--surface-sunken)' }} />
              </div>
              <div className="field">
                <label htmlFor="nm">Nama</label>
                <input id="nm" value={nama} onChange={(e) => setNama(e.target.value)} />
              </div>
            </div>
            <div style={{ minWidth: 220 }}>
              <div className="field">
                <label htmlFor="hp">HPP</label>
                {paket ? (
                  <>
                    <input id="hp" value={rp(hppPaket)} readOnly
                           style={{ background: 'var(--surface-sunken)' }} />
                    <span className="st">Dihitung otomatis dari isi paket</span>
                  </>
                ) : (
                  <>
                    <input id="hp" type="number" value={hpp} onChange={(e) => setHpp(e.target.value)} />
                    <span className="st">Berlaku untuk semua toko</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 'var(--s3)' }}>
            <button className="btn btn-primary" onClick={simpanDasar} disabled={sibuk}>Simpan nama</button>
            {!paket && <button className="btn" onClick={simpanHpp} disabled={sibuk}>Simpan HPP</button>}
          </div>
        </div>
      </div>

      {/* ── Isi paket ── */}
      {paket && (
        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <div className="card-head">
            <h2>Isi paket</h2>
            <span className="badge b-mute">{isi.length} komponen</span>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="t-mute" style={{ fontSize: 12 }}>Total HPP {rp(hppPaket)}</span>
          </div>
          <div className="card-body">
            <p className="t-mute" style={{ fontSize: 12.5, marginTop: 0 }}>
              Saat pesanan paket ini masuk, stok yang dipotong adalah SKU tunggal di bawah —
              bukan stok paketnya. Itulah yang membuat stok gudang tetap benar.
            </p>

            {isi.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 'var(--s3)' }}>
                <table>
                  <thead><tr><th>Komponen</th><th style={{ width: 120 }}>Jumlah</th>
                    <th className="t-right">HPP satuan</th><th style={{ width: 90 }}></th></tr></thead>
                  <tbody>
                    {isi.map((k, i) => (
                      <tr key={k.id}>
                        <td><div className="tt">{k.name}</div><div className="st mono">{k.code}</div></td>
                        <td>
                          <input type="number" min="1" value={k.qty} style={{ width: 90, height: 30 }}
                                 onChange={(e) => setIsi(isi.map((x, j) =>
                                   j === i ? { ...x, qty: e.target.value } : x))} />
                        </td>
                        <td className="t-num">{k.hpp ? rp(k.hpp) : <span className="badge b-warn">HPP kosong</span>}</td>
                        <td><button className="btn btn-sm"
                                    onClick={() => setIsi(isi.filter((_, j) => j !== i))}>Keluarkan</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="field" style={{ maxWidth: 460 }}>
              <label htmlFor="cr">Tambah komponen</label>
              <input id="cr" value={cari} onChange={(e) => setCari(e.target.value)}
                     placeholder="Ketik kode atau nama SKU tunggal…" />
            </div>

            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', marginTop: 'var(--s2)' }}>
              <table>
                <tbody>
                  {kandidat.map((s) => (
                    <tr key={s.id}>
                      <td style={{ width: 56 }}><Foto src={s.gambar} kode={s.code} /></td>
                      <td><div className="tt">{s.name}</div><div className="st mono">{s.code}</div></td>
                      <td className="t-num t-mute">{s.hpp ? rp(s.hpp) : '—'}</td>
                      <td style={{ width: 90 }}>
                        <button className="btn btn-sm" onClick={() => {
                          setIsi([...isi, { id: String(s.id), qty: 1, code: s.code, name: s.name, hpp: s.hpp }]);
                          setCari('');
                        }}>Tambah</button>
                      </td>
                    </tr>
                  ))}
                  {!kandidat.length && <tr><td className="t-mute">
                    {cari ? `Tidak ada SKU tunggal yang cocok dengan "${cari}"` : 'Semua SKU tunggal sudah masuk paket ini'}
                  </td></tr>}
                </tbody>
              </table>
            </div>

            <div className="form-row" style={{ marginTop: 'var(--s3)' }}>
              <button className="btn btn-primary" onClick={simpanIsi} disabled={sibuk}>Simpan isi paket</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SKU toko tertaut ── */}
      <div className="card">
        <div className="card-head">
          <h2>SKU toko yang tertaut</h2>
          <span className="badge b-mute">{tertaut.length}</span>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={tautkanPersis} disabled={sibuk}
                  title="Menautkan SKU toko yang namanya sama persis — bukan yang mirip">
            Tautkan sama persis
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Toko</th><th>SKU di toko</th><th>Cara</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {tertaut.map((t, i) => (
                <tr key={i}>
                  <td className="t-strong">{t.shop_name || `Toko ${t.shop_id}`}</td>
                  <td className="mono">{t.shop_sku}</td>
                  <td><span className={'badge ' + (t.auto_linked ? 'b-mute' : 'b-info')}>
                    {t.auto_linked ? 'otomatis' : 'manual'}</span></td>
                  <td><button className="btn btn-sm" disabled={sibuk}
                              onClick={() => lepas(t.shop_id, t.shop_sku)}>Lepas</button></td>
                </tr>
              ))}
              {!tertaut.length && <tr><td colSpan={4} className="t-mute">
                Belum ada SKU toko yang tertaut. Selama kosong, penjualan lewat SKU ini
                tidak memotong stok dan HPP-nya dihitung nol.
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

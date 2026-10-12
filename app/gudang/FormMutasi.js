'use client';
import { useState } from 'react';
import PilihSku, { Foto } from './PilihSku';

/**
 * Mutasi stok — selalu terbuka di atas halaman Gudang, karena inilah
 * pekerjaan harian tim. Satu kali simpan = satu batch.
 *
 * Keluar Shopee tidak ada di sini: dipotong otomatis saat pesanan dikirim
 * (paket bundling diuraikan ke komponennya). Koreksi dan pembatalan
 * catatan hanya untuk akun master — server juga menolaknya dari akun lain.
 */
const KELOMPOK = [
  { judul: 'Barang masuk', warna: 'var(--pos)', jenis: [
    ['supplier', 'Dari supplier'], ['retur', 'Retur'], ['lain_masuk', 'Lain-lain']] },
  { judul: 'Barang keluar', warna: 'var(--neg)', jenis: [
    ['tiktok', 'TikTok Shop'], ['offline', 'Offline'], ['terpakai', 'Terpakai'], ['lain_keluar', 'Lain-lain']] },
  { judul: 'Koreksi', warna: 'var(--ink-3)', master: true, jenis: [['opname', 'Koreksi +/−']] },
];
const ARAH = { supplier: 1, retur: 1, lain_masuk: 1, tiktok: -1, offline: -1, terpakai: -1, lain_keluar: -1, opname: 0 };
const baru = () => ({ k: Math.random().toString(36).slice(2), sku: null, qty: '', harga: '' });

export default function FormMutasi({ master, supplier: daftarSup = [], hariIni, uang, bolehKurang }) {
  const [jenis, setJenis] = useState('supplier');
  const [tanggal, setTanggal] = useState(hariIni);
  const [sup, setSup] = useState('');
  const [catatan, setCatatan] = useState('');
  const [baris, setBaris] = useState([baru()]);
  const [jalan, setJalan] = useState(false);
  const [pesan, setPesan] = useState(null);

  const arah = ARAH[jenis];
  const ubah = (i, isi) => setBaris((bs) => {
    const nb = bs.map((b, j) => (j === i ? { ...b, ...isi } : b));
    // Selalu sisakan satu baris kosong di bawah — tidak perlu tombol tambah.
    if (nb[nb.length - 1].sku) nb.push(baru());
    return nb;
  });
  const hapus = (i) => setBaris((bs) => { const nb = bs.filter((_, j) => j !== i); return nb.length && nb[nb.length - 1].sku ? [...nb, baru()] : (nb.length ? nb : [baru()]); });
  const fokus = (i, bagian) => setTimeout(() => document.getElementById(`${bagian}-${i}`)?.focus(), 0);

  const terisi = baris.filter((b) => b.sku && b.qty !== '' && Number(b.qty) !== 0);
  const totalUnit = terisi.reduce((a, b) => a + Math.abs(Number(b.qty) || 0), 0);

  async function simpan() {
    setPesan(null);
    if (!terisi.length) { setPesan({ err: 'Pilih barang dan isi jumlahnya dulu.' }); return; }
    if (jenis === 'supplier' && !sup.trim()) { setPesan({ err: 'Isi nama supplier.' }); return; }
    setJalan(true);
    try {
      const r = await fetch('/api/gudang', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jenis, tanggal, supplier: sup, catatan,
          baris: terisi.map((b) => ({ master_sku_id: b.sku.id, qty: b.qty, harga: b.harga })) }),
      });
      const j = await r.json();
      if (!j.ok) { setPesan({ err: j.error || 'Gagal menyimpan' }); setJalan(false); return; }
      setPesan({ ok: `Tersimpan: ${terisi.length} barang, ${totalUnit.toLocaleString('id-ID')} unit.`
        + (j.minus?.length ? ` Perhatian, stok jadi minus: ${j.minus.map((m) => `${m.code} (${m.saldo})`).join(', ')}.` : '') });
      setTimeout(() => location.reload(), j.minus?.length ? 2500 : 900);
    } catch (e) {
      setPesan({ err: e.message }); setJalan(false);
    }
  }

  const kelompok = KELOMPOK.filter((g) => !g.master || bolehKurang);

  return (
    <div className="card" style={{ marginBottom: 'var(--s4)' }}>
      <div className="card-head" style={{ gap: 12, flexWrap: 'wrap' }}>
        <h2>Mutasi stok</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="t-mute" style={{ fontSize: 12.5 }}>Tanggal</span>
          <input type="date" value={tanggal} max={hariIni} onChange={(e) => setTanggal(e.target.value)} style={{ height: 34 }} />
        </div>
      </div>

      <div className="card-body" style={{ display: 'grid', gap: 'var(--s4)' }}>
        {/* Jenis mutasi */}
        <div style={{ display: 'flex', gap: 'var(--s5)', flexWrap: 'wrap' }}>
          {kelompok.map((g) => (
            <div key={g.judul}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                            color: g.warna, marginBottom: 6 }}>{g.judul}</div>
              <div className="filter-vals">
                {g.jenis.map(([k, t]) => (
                  <button key={k} type="button" className="chip" aria-pressed={jenis === k}
                          onClick={() => { setJenis(k); setPesan(null); }}>{t}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!bolehKurang && (
          <p className="t-mute" style={{ fontSize: 12.5, margin: '-8px 0 0' }}>
            🔒 Salah input? Koreksi dan pembatalan catatan hanya bisa dilakukan akun yang diizinkan — hubungi pemegang akun master.
          </p>
        )}

        {/* Supplier & catatan */}
        <div className="form-row">
          {jenis === 'supplier' && (
            <div className="field" style={{ minWidth: 220 }}><label>Supplier</label>
              <input list="daftar-supplier" value={sup} onChange={(e) => setSup(e.target.value)} placeholder="mis. JAKNOT" />
              <datalist id="daftar-supplier">{daftarSup.map((s) => <option key={s} value={s} />)}</datalist></div>
          )}
          <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Catatan (opsional)</label>
            <input value={catatan} onChange={(e) => setCatatan(e.target.value)}
                   placeholder={jenis === 'supplier' ? 'no. surat jalan / faktur' : 'keterangan'} /></div>
        </div>

        {/* Barang */}
        <div className={'mut' + (jenis === 'supplier' && uang ? ' mut-harga' : '')}>
          <div className="mut-head">
            <span>Barang</span><span style={{ textAlign: 'right' }}>Stok</span>
            <span>{arah === 0 ? 'Selisih' : 'Jumlah'}</span>
            {jenis === 'supplier' && uang && <span>Harga beli</span>}<span />
          </div>
          {baris.map((b, i) => {
            const n = Number(b.qty) || 0;
            const sesudah = b.sku ? b.sku.saldo + (arah === 0 ? n : arah * n) : null;
            return (
              <div key={b.k} className="mut-row">
                <div>
                  <PilihSku id={`sku-${i}`} master={master} nilai={b.sku}
                            onPilih={(m) => ubah(i, { sku: m })} onEnter={() => fokus(i, 'qty')} />
                </div>
                <div data-l="Stok" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                  {b.sku ? (
                    <>
                      <span className="t-mute">{b.sku.saldo.toLocaleString('id-ID')}</span>
                      {n !== 0 && <>
                        <span className="t-mute"> → </span>
                        <b style={{ color: sesudah < 0 ? 'var(--neg)' : undefined }}>{sesudah.toLocaleString('id-ID')}</b>
                      </>}
                    </>
                  ) : <span className="t-mute">—</span>}
                </div>
                <div data-l={arah === 0 ? 'Selisih' : 'Jumlah'}>
                  <input id={`qty-${i}`} type="number" inputMode="numeric" value={b.qty} disabled={!b.sku}
                         min={arah === 0 ? undefined : 1} placeholder={b.sku ? '0' : ''}
                         onChange={(e) => ubah(i, { qty: e.target.value })}
                         onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fokus(i + 1, 'sku'); } }}
                         style={{ width: '100%', fontWeight: 700 }} />
                </div>
                {jenis === 'supplier' && uang && (
                  <div data-l="Harga beli">
                    <input type="number" value={b.harga} disabled={!b.sku} placeholder="jadi HPP"
                           onChange={(e) => ubah(i, { harga: e.target.value })} style={{ width: '100%' }} />
                  </div>
                )}
                <button type="button" className="btn btn-sm mut-hapus" aria-label="Hapus baris"
                        style={{ visibility: b.sku ? 'visible' : 'hidden' }} onClick={() => hapus(i)}>×</button>
              </div>
            );
          })}
        </div>

        {/* Simpan */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="t-mute" style={{ fontSize: 13 }}>
            {terisi.length ? <><b>{terisi.length}</b> barang · <b>{totalUnit.toLocaleString('id-ID')}</b> unit</> : 'Belum ada barang'}
          </span>
          {pesan?.err && <span className="err" style={{ margin: 0 }}>{pesan.err}</span>}
          {pesan?.ok && <span style={{ color: 'var(--pos)', fontSize: 13, fontWeight: 600 }}>✓ {pesan.ok}</span>}
          <button className="btn btn-primary" onClick={simpan} disabled={jalan || !terisi.length}
                  style={{ marginLeft: 'auto', minWidth: 140 }}>{jalan ? 'Menyimpan…' : 'Simpan mutasi'}</button>
        </div>
        {jenis === 'terpakai' && (
          <p className="t-mute" style={{ fontSize: 12.5, margin: 0 }}>
            Untuk barang yang habis dipakai sendiri: kardus, lakban, bubble wrap. Ikut dihitung sebagai
            permintaan di Days of Supply, jadi titik pesannya tetap terpantau.
          </p>
        )}
        {jenis === 'tiktok' && (
          <p className="err" style={{ fontSize: 12.5, margin: 0 }}>
            Keluar TikTok Shop kini <b>dipotong otomatis</b> saat pesanan dijemput kurir, sama seperti Shopee
            (termasuk isi paket bundling). Catat manual di sini HANYA untuk pesanan TikTok yang dikirim
            sebelum fitur ini aktif — kalau tidak, stoknya terpotong dua kali.
          </p>
        )}
        {jenis === 'offline' && (
          <p className="t-mute" style={{ fontSize: 12.5, margin: 0 }}>
            Keluar ini ikut dihitung sebagai penjualan di Days of Supply. Keluar Shopee dan TikTok tidak perlu
            dicatat — sudah dipotong otomatis saat pesanan dikirim, termasuk isi paket bundling.
          </p>
        )}
      </div>
    </div>
  );
}

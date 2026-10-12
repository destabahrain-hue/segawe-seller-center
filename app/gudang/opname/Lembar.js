'use client';
import { useMemo, useState } from 'react';
import { Foto } from '../PilihSku';
import TambahBarang from './TambahBarang';

const f = (n) => Number(n || 0).toLocaleString('id-ID');

export default function Lembar({ opname, baris, akunMaster }) {
  const awal = useMemo(() => Object.fromEntries(baris.map((b) => [b.id, b.stok_fisik ?? ''])), [baris]);
  const [isi, setIsi] = useState(awal);
  const [cari, setCari] = useState('');
  const [saring, setSaring] = useState('semua');
  const [jalan, setJalan] = useState(false);
  const [pesan, setPesan] = useState(null);

  const berubah = baris.filter((b) => String(isi[b.id] ?? '') !== String(awal[b.id] ?? ''));
  const dihitung = baris.filter((b) => b.stok_fisik !== null && b.stok_fisik !== undefined);
  const selisihOf = (b) => {
    const v = isi[b.id];
    if (v === '' || v === undefined || v === null) return null;
    // Yang sudah tersimpan dibandingkan dengan potretnya; yang baru diketik dengan stok sekarang.
    const dasar = String(v) === String(awal[b.id]) && b.stok_sistem !== null ? b.stok_sistem : b.kini;
    return Number(v) - dasar;
  };
  const kata = cari.toLowerCase().split(/\s+/).filter(Boolean);
  const tampil = baris.filter((b) => kata.every((k) => b.code.toLowerCase().includes(k)))
    .filter((b) => saring === 'semua' ? true
      : saring === 'belum' ? (isi[b.id] === '' || isi[b.id] === undefined)
      : (selisihOf(b) ?? 0) !== 0);
  const adaSelisih = dihitung.filter((b) => b.stok_fisik !== b.stok_sistem);

  async function kirim(aksi, badan = {}) {
    setJalan(true); setPesan(null);
    const r = await fetch('/api/gudang/opname', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify({ aksi, id: opname.id, ...badan }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { setPesan({ err: j.error || 'Gagal' }); setJalan(false); return false; }
    return true;
  }
  async function simpan() {
    if (await kirim('simpan', { baris: berubah.map((b) => ({ master_sku_id: b.id, stok_fisik: isi[b.id] })) })) location.reload();
  }
  async function terapkan() {
    if (berubah.length) { setPesan({ err: 'Simpan dulu hitungan yang belum tersimpan.' }); return; }
    const net = adaSelisih.reduce((a, b) => a + (b.stok_fisik - b.stok_sistem), 0);
    if (!confirm(`Terapkan stock opname #${opname.id}?\n\n${adaSelisih.length} SKU berselisih, total ${net > 0 ? '+' : ''}${f(net)} unit.\n`
      + 'Selisih akan dicatat sebagai koreksi stok. Barang yang belum dihitung tidak diubah.')) return;
    if (await kirim('terapkan')) location.reload();
  }
  async function batal() {
    if (!confirm('Batalkan stock opname ini? Hitungan yang sudah diisi tidak dipakai.')) return;
    if (await kirim('batal')) location.reload();
  }

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2>Stock opname #{opname.id}</h2>
        <span className="badge b-warn">draf</span>
        <span className="t-mute" style={{ fontSize: 12.5 }}>dibuka {opname.dibuat_oleh || '—'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13 }}>
          <b>{f(dihitung.length)}</b> dari {f(baris.length)} barang dihitung · <b style={{ color: adaSelisih.length ? 'var(--warn)' : undefined }}>{f(adaSelisih.length)}</b> berselisih
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', paddingBottom: 0 }}>
        <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari kode…" style={{ width: 240, height: 36 }} />
        <div className="filter-vals">
          {[['semua', 'Semua'], ['belum', 'Belum dihitung'], ['selisih', 'Ada selisih']].map(([k, t]) => (
            <button key={k} type="button" className="chip" aria-pressed={saring === k} onClick={() => setSaring(k)}>{t}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}><TambahBarang /></div>
      </div>
      <div className="table-wrap" style={{ marginTop: 'var(--s3)' }}>
        <table>
          <thead><tr>
            <th className="kol-opsional" style={{ width: 52 }}></th><th>Master SKU</th>
            <th className="t-right">Stok sistem</th><th style={{ width: 140 }}>Stok fisik</th>
            <th className="t-right">Selisih</th><th className="kol-opsional">Dihitung oleh</th>
          </tr></thead>
          <tbody>
            {tampil.map((b) => {
              const sel = selisihOf(b);
              const belumSimpan = String(isi[b.id] ?? '') !== String(awal[b.id] ?? '');
              return (
                <tr key={b.id}>
                  <td className="kol-opsional"><Foto src={b.gambar} ukuran={36} /></td>
                  <td className="mono t-strong">{b.code}</td>
                  <td className="t-num t-mute">{f(b.stok_sistem !== null && !belumSimpan ? b.stok_sistem : b.kini)}</td>
                  <td><input type="number" min={0} inputMode="numeric" value={isi[b.id] ?? ''}
                             onChange={(e) => setIsi({ ...isi, [b.id]: e.target.value })}
                             placeholder="hitung…" style={{ width: '100%', height: 36, fontWeight: 700,
                               borderColor: belumSimpan ? 'var(--brand)' : undefined }} /></td>
                  <td className="t-num t-strong" style={{ color: sel > 0 ? 'var(--pos)' : sel < 0 ? 'var(--neg)' : 'var(--ink-3)' }}>
                    {sel === null ? '—' : sel === 0 ? 'cocok' : `${sel > 0 ? '+' : ''}${f(sel)}`}</td>
                  <td className="t-mute kol-opsional" style={{ fontSize: 12.5 }}>{belumSimpan ? 'belum disimpan' : b.dicatat_oleh || '—'}</td>
                </tr>
              );
            })}
            {!tampil.length && <tr><td colSpan={6} className="t-mute">Tidak ada barang di saringan ini.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card-body" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {pesan?.err && <span className="err" style={{ margin: 0 }}>{pesan.err}</span>}
        <span className="t-mute" style={{ fontSize: 12.5 }}>
          {berubah.length ? `${berubah.length} hitungan belum disimpan` : 'Semua hitungan tersimpan'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {akunMaster && <button className="btn" onClick={batal} disabled={jalan}>Batalkan opname</button>}
          <button className="btn" onClick={simpan} disabled={jalan || !berubah.length}>Simpan hitungan</button>
          {akunMaster
            ? <button className="btn btn-primary" onClick={terapkan} disabled={jalan || !dihitung.length}>Terapkan selisih ke stok</button>
            : <span className="t-mute" style={{ fontSize: 12.5, alignSelf: 'center' }}>🔒 Selisih diterapkan oleh akun yang diizinkan</span>}
        </div>
      </div>
    </div>
  );
}

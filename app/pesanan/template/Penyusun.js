'use client';
import { useMemo, useRef, useState } from 'react';

/**
 * ── Penyusun template ekspor ──
 *
 * Tata letaknya mengikuti BigSeller: kolom tersedia di kiri, dikelompokkan
 * dalam kotak berjudul dengan centang "Semua" per kelompok; susunan
 * terpilih di kanan, bisa digeser-seret untuk mengubah urutan.
 *
 * Kolom yang datanya belum ada TETAP ditampilkan dan boleh dipilih, tapi
 * diberi tanda "kosong". Menyembunyikannya membuat susunan berkas tidak
 * bisa dibuat persis sama dengan ekspor BigSeller; menampilkannya tanpa
 * tanda membuat orang memasukkan kolom yang selamanya kosong ke laporan
 * tanpa sadar.
 */
export default function Penyusun({ katalog, kelompok, bawaan }) {
  const [daftar, setDaftar] = useState([]);
  const [nama, setNama] = useState('');
  const [id, setId] = useState(null);
  const [cari, setCari] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState('');
  const [pesan, setPesan] = useState('');
  const [seret, setSeret] = useState(null);      // indeks yang sedang diseret
  const [atas, setAtas] = useState(null);        // indeks yang sedang dilewati

  const peta = useMemo(() => new Map(katalog.map((k) => [k.kunci, k])), [katalog]);
  const terpilih = useMemo(() => new Set(daftar), [daftar]);

  const terlihat = useMemo(() => {
    const c = cari.trim().toLowerCase();
    return c ? katalog.filter((k) => k.nama.toLowerCase().includes(c)) : katalog;
  }, [katalog, cari]);

  const tambah = (k) => setDaftar((d) => (d.includes(k) ? d : [...d, k]));
  const buang = (k) => setDaftar((d) => d.filter((x) => x !== k));
  const alih = (k) => (terpilih.has(k) ? buang(k) : tambah(k));

  /** Centang "Semua" per kelompok — hanya untuk kolom yang sedang terlihat. */
  function alihKelompok(g, nyala) {
    const isi = terlihat.filter((k) => k.kel === g).map((k) => k.kunci);
    setDaftar((d) => (nyala
      ? [...d, ...isi.filter((k) => !d.includes(k))]
      : d.filter((k) => !isi.includes(k))));
  }

  /** Pindahkan satu kolom ke posisi lain. Dipakai seret maupun tombol panah. */
  function pindah(dari, ke) {
    setDaftar((d) => {
      if (dari === ke || ke < 0 || ke >= d.length) return d;
      const b = [...d];
      const [x] = b.splice(dari, 1);
      b.splice(ke, 0, x);
      return b;
    });
  }

  function muat(t) {
    setId(t.id ?? null);
    setNama(t.id ? t.nama : `${t.nama} (salinan)`);
    setDaftar(t.kunci);
    setPesan(''); setErr('');
  }

  async function simpan() {
    setSibuk(true); setErr(''); setPesan('');
    try {
      const r = await fetch('/api/template-ekspor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, nama, kunci: daftar }),
      }).then((x) => x.json());
      if (!r.ok) { setErr(r.error || 'Gagal menyimpan'); return; }
      setPesan('Template tersimpan.');
      setTimeout(() => location.reload(), 900);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  const kosongTerpilih = daftar.filter((k) => peta.get(k) && !peta.get(k).ada).length;

  return (
    <>
      <style>{`
        .tpl-wrap{display:grid;grid-template-columns:minmax(360px,1fr) minmax(320px,420px);
          gap:var(--s4);align-items:start}
        .tpl-grup{border:1px solid var(--line);border-radius:var(--r-md);padding:10px 12px 12px;
          margin-bottom:10px}
        .tpl-grup>legend{padding:0 6px;font-size:12px;font-weight:700;color:var(--ink-2)}
        .tpl-kol{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;margin-top:4px}
        .tpl-cek{display:flex;align-items:flex-start;gap:7px;padding:3px 4px;border-radius:6px;
          font-size:12.5px;cursor:pointer;line-height:1.35}
        .tpl-cek:hover{background:var(--surface-sunken)}
        .tpl-cek input{margin-top:2px;flex:0 0 auto}
        .tpl-pilih{display:flex;align-items:center;gap:8px;padding:6px 8px;
          border:1px solid var(--line);border-radius:7px;margin-bottom:4px;background:var(--surface);
          cursor:grab;font-size:12.5px}
        .tpl-pilih.seret{opacity:.4}
        .tpl-pilih.atas{border-color:var(--brand);box-shadow:0 -2px 0 var(--brand) inset}
        .tpl-pegang{color:var(--ink-3);cursor:grab;flex:0 0 auto;line-height:1}
        @media (max-width:900px){.tpl-wrap{grid-template-columns:1fr}}
      `}</style>

      <div className="tpl-wrap">
        {/* ── KIRI: kolom tersedia ── */}
        <div className="card">
          <div className="card-body">
            <div className="form-row" style={{ gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                Nama template
              </span>
              <input value={nama} onChange={(e) => setNama(e.target.value)}
                     placeholder="mis. Sortir pagi" style={{ flex: 1, height: 32 }} />
            </div>

            <div className="form-row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <input value={cari} onChange={(e) => setCari(e.target.value)}
                     placeholder="Cari kolom…" style={{ height: 30, width: 180 }} />
              <span className="t-mute" style={{ fontSize: 12 }}>
                Mulai dari template siap pakai:
              </span>
              {bawaan.map((t) => (
                <button key={t.kode} className="chip" style={{ cursor: 'pointer' }}
                        onClick={() => muat({ nama: t.nama, kunci: t.kunci })}
                        title={`${t.kunci.length} kolom`}>
                  {t.nama} <span className="n">{t.kunci.length}</span>
                </button>
              ))}
            </div>

            {kelompok.map((g) => {
              const isi = terlihat.filter((k) => k.kel === g);
              if (!isi.length) return null;
              const semua = isi.every((k) => terpilih.has(k.kunci));
              return (
                <fieldset key={g} className="tpl-grup">
                  <legend>
                    <label className="tpl-cek" style={{ padding: 0 }}>
                      <input type="checkbox" checked={semua}
                             onChange={(e) => alihKelompok(g, e.currentTarget.checked)} />
                      <span>{g} <span className="t-mute">— semua</span></span>
                    </label>
                  </legend>
                  <div className="tpl-kol">
                    {isi.map((k) => (
                      <label key={k.kunci} className="tpl-cek"
                             title={k.ada ? 'Datanya tersedia'
                               : 'Kolom ini akan selalu kosong — datanya belum ada di aplikasi'}>
                        <input type="checkbox" checked={terpilih.has(k.kunci)}
                               onChange={() => alih(k.kunci)} />
                        <span>
                          {k.nama}
                          {!k.ada && <span className="badge b-warn"
                                           style={{ marginLeft: 5 }}>kosong</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>

        {/* ── KANAN: susunan terpilih ── */}
        <div className="card" style={{ position: 'sticky', top: 'var(--s4)' }}>
          <div className="card-head">
            <h2>Kolom terpilih</h2>
            <span className="badge b-mute">{daftar.length}</span>
            {kosongTerpilih > 0 && <span className="badge b-warn">{kosongTerpilih} kosong</span>}
            <div className="spacer" style={{ flex: 1 }} />
            {daftar.length > 0 && (
              <button className="btn btn-sm" onClick={() => { setDaftar([]); setId(null); }}>
                Kosongkan
              </button>
            )}
          </div>

          <div className="card-body">
            <p className="t-mute" style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
              Seret untuk mengubah urutan — urutan di sini menjadi urutan kolom di berkas Excel.
            </p>

            {!daftar.length ? (
              <div style={{ textAlign: 'center', padding: '38px 10px', color: 'var(--ink-3)' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Belum ada kolom</div>
                <div style={{ fontSize: 12.5 }}>Centang kolom di sebelah kiri lebih dulu.</div>
              </div>
            ) : (
              <div style={{ maxHeight: '52vh', overflow: 'auto', paddingRight: 2 }}>
                {daftar.map((k, i) => {
                  const info = peta.get(k);
                  return (
                    <div key={k} draggable
                         className={'tpl-pilih' + (seret === i ? ' seret' : '')
                                    + (atas === i && seret !== null && seret !== i ? ' atas' : '')}
                         onDragStart={() => setSeret(i)}
                         onDragEnd={() => { setSeret(null); setAtas(null); }}
                         onDragOver={(e) => { e.preventDefault(); setAtas(i); }}
                         onDrop={(e) => {
                           e.preventDefault();
                           if (seret !== null) pindah(seret, i);
                           setSeret(null); setAtas(null);
                         }}>
                      <span className="tpl-pegang" aria-hidden="true">⠿</span>
                      <span className="t-mute" style={{ width: 22, fontSize: 11,
                                                        fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {info?.nama || k}
                        {info && !info.ada && (
                          <span className="badge b-warn" style={{ marginLeft: 5 }}>kosong</span>
                        )}
                      </span>
                      {/* Panah tetap ada: seret tidak bekerja di layar sentuh,
                          dan sebagian orang memakai papan ketik saja. */}
                      <button className="btn btn-sm" style={{ padding: '0 6px' }}
                              disabled={i === 0} onClick={() => pindah(i, i - 1)}
                              title="Naikkan">↑</button>
                      <button className="btn btn-sm" style={{ padding: '0 6px' }}
                              disabled={i === daftar.length - 1} onClick={() => pindah(i, i + 1)}
                              title="Turunkan">↓</button>
                      <button className="btn btn-sm" style={{ padding: '0 6px', color: 'var(--neg)' }}
                              onClick={() => buang(k)} title="Buang">×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {err && <p className="err">{err}</p>}
            {pesan && <p className="ok">{pesan}</p>}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center',
                        padding: 'var(--s4)', borderTop: '1px solid var(--line)' }}>
            <span className="t-mute" style={{ fontSize: 12, flex: 1 }}>
              {id ? 'Mengubah template tersimpan' : 'Template baru'}
            </span>
            <button className="btn btn-sm btn-primary"
                    disabled={sibuk || !nama.trim() || !daftar.length} onClick={simpan}>
              {sibuk ? 'Menyimpan…' : (id ? 'Simpan perubahan' : 'Simpan template')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Daftar template buatan sendiri, dengan tombol pakai dan hapus. */
export function DaftarTemplate({ template }) {
  async function hapus(t) {
    if (!window.confirm(`Hapus template "${t.nama}"?`)) return;
    await fetch(`/api/template-ekspor?id=${t.id}`, { method: 'DELETE' });
    location.reload();
  }
  if (!template.length) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>Nama</th><th className="t-right">Kolom</th><th>Dibuat oleh</th><th></th>
        </tr></thead>
        <tbody>
          {template.map((t) => (
            <tr key={t.id}>
              <td className="tt">{t.nama}</td>
              <td className="t-num">{(t.kunci || []).length}</td>
              <td className="t-mute">{t.dibuat_oleh || '—'}</td>
              <td>
                <div className="form-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <a className="btn btn-sm" href={`/pesanan?tpl=${t.id}`}>Pakai di Pesanan</a>
                  <button className="btn btn-sm" style={{ color: 'var(--neg)' }}
                          onClick={() => hapus(t)}>Hapus</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

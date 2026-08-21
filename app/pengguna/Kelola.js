'use client';
import { useState } from 'react';

async function kirim(body) {
  const r = await fetch('/api/pengguna', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
const acakSandi = () => 'Segawe-' + Math.random().toString(36).slice(2, 10);

/** Penyunting peran: nama, centang halaman, dan dua saklar. */
export function EditorPeran({ peran = null, halaman, onTutup }) {
  const [f, setF] = useState({
    nama: peran?.nama || '', jelas: peran?.jelas || '',
    rute: new Set(peran?.rute || []), uang: !!peran?.uang, kelola: !!peran?.kelola,
  });
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState('');

  const semua = f.rute.has('*');
  const grup = [...new Set(halaman.map((h) => h.grup))];
  const toggle = (rute) => {
    const n = new Set(f.rute);
    n.has(rute) ? n.delete(rute) : n.add(rute);
    setF({ ...f, rute: n });
  };

  async function simpan() {
    setSibuk(true); setErr('');
    const j = await kirim({
      aksi: peran ? 'peran-ubah' : 'peran-buat', id: peran?.id,
      nama: f.nama, jelas: f.jelas, rute: [...f.rute], uang: f.uang, kelola: f.kelola,
    });
    if (j.ok) location.reload(); else { setErr(j.error || 'Gagal'); setSibuk(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(7,10,18,.55)', zIndex: 90,
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                  padding: '4vh 16px', overflowY: 'auto' }}>
      <div className="card" style={{ width: 'min(760px, 100%)' }}>
        <div className="card-head">
          <h2>{peran ? `Ubah peran ${peran.nama}` : 'Peran baru'}</h2>
          {peran?.bawaan && <span className="badge b-mute">bawaan</span>}
        </div>
        <div className="card-body">
          <div className="form-row" style={{ gap: 'var(--s3)' }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Nama peran</label>
              <input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })}
                     placeholder="PIC Gudang" />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 260 }}>
              <label>Keterangan</label>
              <input value={f.jelas} onChange={(e) => setF({ ...f, jelas: e.target.value })}
                     placeholder="Menangani stok dan pengemasan" />
            </div>
          </div>

          <div className="field" style={{ marginTop: 'var(--s3)' }}>
            <label>Halaman yang boleh dibuka</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <input type="checkbox" checked={semua} onChange={() => toggle('*')} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Semua halaman (akses penuh)</span>
            </label>

            {!semua && grup.map((g) => (
              <div key={g} style={{ marginBottom: 10 }}>
                <div className="st" style={{ marginBottom: 4 }}>{g}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                  {halaman.filter((h) => h.grup === g).map((h) => (
                    <label key={h.rute} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 170 }}>
                      <input type="checkbox" checked={f.rute.has(h.rute)} onChange={() => toggle(h.rute)} />
                      <span style={{ fontSize: 12.5 }}>{h.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="field" style={{ marginTop: 'var(--s2)' }}>
            <label>Izin tambahan</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <input type="checkbox" checked={f.uang} onChange={(e) => setF({ ...f, uang: e.target.checked })} />
              <span style={{ fontSize: 12.5 }}>Boleh melihat angka rupiah (omzet, HPP, laba, harga)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <input type="checkbox" checked={f.kelola} onChange={(e) => setF({ ...f, kelola: e.target.checked })} />
              <span style={{ fontSize: 12.5 }}>Boleh mengelola pengguna dan peran</span>
            </label>
          </div>

          {err && <p className="err">{err}</p>}
          <div className="form-row" style={{ marginTop: 'var(--s3)', justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onTutup} disabled={sibuk}>Batal</button>
            <button className="btn btn-primary" onClick={simpan} disabled={sibuk || !f.nama}>
              {sibuk ? 'Menyimpan…' : 'Simpan peran'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TombolPeran({ peran = null, halaman, label = 'Ubah' }) {
  const [buka, setBuka] = useState(false);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setBuka(true)}>{label}</button>
      {buka && <EditorPeran peran={peran} halaman={halaman} onTutup={() => setBuka(false)} />}
    </>
  );
}

export function HapusPeran({ id, nama }) {
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button className="btn btn-sm" disabled={sibuk} onClick={async () => {
        if (!confirm(`Hapus peran "${nama}"?`)) return;
        setSibuk(true);
        const j = await kirim({ aksi: 'peran-hapus', id });
        if (j.ok) location.reload(); else { setErr(j.error); setSibuk(false); }
      }}>Hapus</button>
      {err && <div className="err" style={{ fontSize: 11.5 }}>{err}</div>}
    </>
  );
}

export function TambahPengguna({ peran }) {
  const [buka, setBuka] = useState(false);
  const [f, setF] = useState({ nama: '', username: '', sandi: '', role_id: peran[0]?.id || '' });
  const [err, setErr] = useState('');
  const [sibuk, setSibuk] = useState(false);

  if (!buka) return <button className="btn btn-sm btn-primary" onClick={() => setBuka(true)}>Tambah pengguna</button>;

  return (
    <div className="card" style={{ padding: 'var(--s4) var(--s5)', marginBottom: 'var(--s4)' }}>
      <div className="form-row" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <div className="field"><label>Nama</label>
          <input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="Budi" /></div>
        <div className="field"><label>Nama pengguna</label>
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="budi" /></div>
        <div className="field"><label>Kata sandi</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={f.sandi} onChange={(e) => setF({ ...f, sandi: e.target.value })} style={{ width: 190 }} />
            <button className="btn btn-sm" onClick={() => setF({ ...f, sandi: acakSandi() })}>Acak</button>
          </div></div>
        <div className="field"><label>Peran</label>
          <select value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })}>
            {peran.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
          </select></div>
        <button className="btn btn-primary" disabled={sibuk} onClick={async () => {
          setSibuk(true); setErr('');
          const j = await kirim({ aksi: 'buat', ...f });
          if (j.ok) location.reload(); else { setErr(j.error || 'Gagal'); setSibuk(false); }
        }}>Simpan</button>
        <button className="btn" onClick={() => setBuka(false)}>Batal</button>
      </div>
      {f.sandi && <p className="ok">Catat kata sandinya sekarang — setelah disimpan tidak bisa dilihat lagi.</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

export function UbahPeranAkun({ id, nilai, peran }) {
  const [v, setV] = useState(nilai || '');
  return (
    <select value={v} style={{ minHeight: 28, fontSize: 12 }} onChange={async (e) => {
      setV(e.target.value);
      await kirim({ aksi: 'peran', id, role_id: e.target.value });
      location.reload();
    }}>
      {peran.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
    </select>
  );
}

export function AksiPengguna({ id, aktif }) {
  const [sibuk, setSibuk] = useState(false);
  const jalan = async (body) => { setSibuk(true); await kirim(body); location.reload(); };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button className="btn btn-sm" disabled={sibuk} onClick={() => {
        const s = acakSandi();
        if (confirm(`Kata sandi baru:\n\n${s}\n\nCatat dulu, lalu tekan OK.`)) jalan({ aksi: 'sandi', id, sandi: s });
      }}>Setel ulang sandi</button>
      <button className="btn btn-sm" disabled={sibuk}
              onClick={() => jalan({ aksi: 'aktif', id, aktif: !aktif })}>
        {aktif ? 'Nonaktifkan' : 'Aktifkan'}
      </button>
    </div>
  );
}

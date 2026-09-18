'use client';
import { useState } from 'react';

async function kirim(body) {
  const r = await fetch('/api/opex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export function FormOpex({ bulan, jenisPilihan }) {
  const [f, setF] = useState({ jenis: jenisPilihan[0] || '', nominal: '', catatan: '' });
  const [err, setErr] = useState('');
  const [sibuk, setSibuk] = useState(false);

  async function simpan() {
    setErr('');
    if (!f.jenis) { setErr('Pilih jenis beban.'); return; }
    setSibuk(true);
    const j = await kirim({ bulan, ...f });
    setSibuk(false);
    if (j.ok) location.reload(); else setErr(j.error || 'Gagal menyimpan');
  }

  return (
    <div className="form-row" style={{ alignItems: 'flex-end' }}>
      <div className="field" style={{ minWidth: 220 }}>
        <label>Jenis beban</label>
        <input list="jenis-opex" value={f.jenis}
               onChange={(e) => setF({ ...f, jenis: e.target.value })}
               placeholder="Beban Gaji" />
        {/* Daftar bawaan, tapi tetap boleh diketik bebas — beban baru
            muncul sewaktu-waktu dan tidak perlu menunggu deploy. */}
        <datalist id="jenis-opex">
          {jenisPilihan.map((x) => <option key={x} value={x} />)}
        </datalist>
      </div>
      <div className="field" style={{ minWidth: 160 }}>
        <label>Nominal (Rp)</label>
        <input type="number" value={f.nominal}
               onChange={(e) => setF({ ...f, nominal: e.target.value })}
               placeholder="86500000" />
      </div>
      <div className="field" style={{ minWidth: 200 }}>
        <label>Catatan</label>
        <input value={f.catatan}
               onChange={(e) => setF({ ...f, catatan: e.target.value })}
               placeholder="opsional" />
      </div>
      <button className="btn btn-sm btn-primary" onClick={simpan} disabled={sibuk}>
        {sibuk ? 'Menyimpan…' : 'Simpan'}
      </button>
      {err && <div className="field" style={{ color: 'var(--neg)' }}>{err}</div>}
    </div>
  );
}

export function TombolSalin({ bulan }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState('');

  async function salin() {
    setSibuk(true);
    const j = await kirim({ aksi: 'salin', bulan });
    setSibuk(false);
    if (!j.ok) { setPesan(j.error || 'Gagal'); return; }
    if (j.disalin === 0) { setPesan('Tidak ada yang disalin — bulan lalu kosong, atau semua jenisnya sudah ada di bulan ini.'); return; }
    location.reload();
  }

  return (
    <>
      <button className="btn btn-sm" onClick={salin} disabled={sibuk}>
        {sibuk ? 'Menyalin…' : 'Salin dari bulan lalu'}
      </button>
      {pesan && <span style={{ marginLeft: 8, fontSize: 13 }}>{pesan}</span>}
    </>
  );
}

export function FormTokoManual({ bulan }) {
  const [f, setF] = useState({ nama: '', penjualan: '', hpp: '', iklan: '', catatan: '' });
  const [err, setErr] = useState('');
  const [sibuk, setSibuk] = useState(false);

  async function simpan() {
    setErr('');
    if (!f.nama) { setErr('Isi nama toko.'); return; }
    setSibuk(true);
    const j = await kirim({ aksi: 'toko-manual', bulan, ...f });
    setSibuk(false);
    if (j.ok) location.reload(); else setErr(j.error || 'Gagal menyimpan');
  }

  return (
    <div className="form-row" style={{ alignItems: 'flex-end' }}>
      <div className="field" style={{ minWidth: 190 }}>
        <label>Nama toko</label>
        <input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })}
               placeholder="Humaira TikTok" />
      </div>
      <div className="field" style={{ minWidth: 160 }}>
        <label>Penjualan (uang masuk)</label>
        <input type="number" value={f.penjualan}
               onChange={(e) => setF({ ...f, penjualan: e.target.value })} />
      </div>
      <div className="field" style={{ minWidth: 140 }}>
        <label>HPP</label>
        <input type="number" value={f.hpp}
               onChange={(e) => setF({ ...f, hpp: e.target.value })} />
      </div>
      <div className="field" style={{ minWidth: 140 }}>
        <label>Iklan + PPN</label>
        <input type="number" value={f.iklan}
               onChange={(e) => setF({ ...f, iklan: e.target.value })} />
      </div>
      <button className="btn btn-sm btn-primary" onClick={simpan} disabled={sibuk}>
        {sibuk ? 'Menyimpan…' : 'Simpan'}
      </button>
      {err && <div className="field" style={{ color: 'var(--neg)' }}>{err}</div>}
    </div>
  );
}

export function UnggahTiktok({ bulan }) {
  const [income, setIncome] = useState(null);
  const [pesanan, setPesanan] = useState(null);
  const [hasil, setHasil] = useState(null);
  const [nama, setNama] = useState('Humaira TikTok');
  const [err, setErr] = useState('');
  const [sibuk, setSibuk] = useState(false);

  const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

  async function proses(fIncome, fPesanan) {
    setErr(''); setHasil(null);
    if (!fIncome) return;
    setSibuk(true);
    const fd = new FormData();
    fd.append('income', fIncome);
    if (fPesanan) fd.append('pesanan', fPesanan);
    const j = await fetch('/api/tiktok-import', { method: 'POST', body: fd })
      .then((r) => r.json()).catch(() => ({ ok: false, error: 'Gagal mengunggah' }));
    setSibuk(false);
    if (!j.ok) { setErr(j.error || 'Gagal membaca berkas'); return; }
    setHasil(j);
  }

  function pilihIncome(f) { setIncome(f); proses(f, pesanan); }
  function pilihPesanan(f) { setPesanan(f); proses(income, f); }

  async function simpan() {
    setErr('');
    if (!nama) { setErr('Isi nama toko.'); return; }
    setSibuk(true);
    const j = await kirim({
      aksi: 'toko-manual',
      // Bulan diambil dari PERIODE DI DALAM BERKAS, bukan dari pilihan
      // di layar. Berkas Juli yang diunggah saat layar menampilkan
      // Agustus harus mendarat di Juli.
      bulan: hasil.bulan || bulan,
      nama,
      penjualan: hasil.penjualan,
      hpp: hasil.hpp,
      iklan: hasil.iklan,
      catatan: `impor TikTok ${hasil.periodeTeks || ''}`,
    });
    setSibuk(false);
    if (j.ok) location.reload(); else setErr(j.error || 'Gagal menyimpan');
  }

  const bedaBulan = hasil?.bulan && hasil.bulan !== bulan;
  const laba = hasil ? hasil.penjualan - hasil.hpp - hasil.iklan : 0;

  return (
    <div>
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ minWidth: 280 }}>
          <label>1. Berkas income (income_*.xlsx)</label>
          <input type="file" accept=".xlsx" disabled={sibuk}
                 onChange={(e) => pilihIncome(e.target.files?.[0] || null)} />
        </div>
        <div className="field" style={{ minWidth: 280 }}>
          <label>2. Berkas pesanan (Selesai_pesanan_*.xlsx)</label>
          <input type="file" accept=".xlsx" disabled={sibuk}
                 onChange={(e) => pilihPesanan(e.target.files?.[0] || null)} />
        </div>
      </div>
      <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>
        Berkas pesanan dipakai untuk menghitung HPP dari Master SKU. Ekspornya harus
        mencakup tanggal jauh ke belakang, bukan hanya bulan laporan — pesanan bulan
        lama yang dananya baru cair ikut terhitung di bulan ini.
      </div>

      {sibuk && <div style={{ fontSize: 13 }}>Membaca berkas…</div>}
      {err && <div style={{ color: 'var(--neg)', fontSize: 13 }}>{err}</div>}

      {hasil && (
        <div className="card" style={{ padding: 'var(--s4) var(--s5)', marginTop: 'var(--s3)' }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Periode berkas: <b>{hasil.periodeTeks || 'tidak terbaca'}</b> ·{' '}
            {hasil.jumlahPesanan} pesanan
          </div>

          <table className="wide" style={{ marginBottom: 12 }}>
            <tbody>
              <tr><td>Penjualan</td><td className="t-right">{rp(hasil.penjualan)}</td></tr>
              <tr><td>HPP</td>
                  <td className="t-right" style={{ color: hasil.hpp === 0 ? 'var(--neg)' : undefined }}>
                    {rp(hasil.hpp)}</td></tr>
              <tr><td>Iklan pokok</td><td className="t-right">{rp(hasil.iklanPokok)}</td></tr>
              <tr><td style={{ paddingLeft: 20, opacity: 0.75 }}>+ PPN 11%</td>
                  <td className="t-right" style={{ opacity: 0.75 }}>{rp(hasil.ppn)}</td></tr>
              <tr><td><b>Iklan + PPN</b></td><td className="t-right"><b>{rp(hasil.iklan)}</b></td></tr>
              <tr><td><b>Laba</b></td>
                  <td className="t-right" style={{ color: laba < 0 ? 'var(--neg)' : undefined }}>
                    <b>{rp(laba)}</b></td></tr>
            </tbody>
          </table>

          {!hasil.adaPesanan && (
            <div style={{ color: 'var(--neg)', fontSize: 13, marginBottom: 12 }}>
              <b>Berkas pesanan belum dipilih, jadi HPP nol.</b> Kalau disimpan begini,
              TikTok akan tampil tanpa modal sama sekali dan labanya terlihat jauh lebih
              besar dari kenyataan.
            </div>
          )}

          {hasil.adaPesanan && (
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              Cakupan: <b>{hasil.cakupanNilai?.toFixed(1)}%</b> dari nilai penjualan punya
              rincian SKU ({hasil.pesananKetemu} pesanan).
              {hasil.hilangBernilai?.length > 0 && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  <b>{hasil.hilangBernilai.length} pesanan bernilai tidak ada di berkas
                  pesanan</b> — HPP-nya hilang. Ekspor ulang daftar pesanan dengan rentang
                  tanggal yang lebih panjang. Contoh: {hasil.hilangBernilai.slice(0, 3)
                    .map((x) => x.id).join(', ')}
                </div>
              )}
            </div>
          )}

          {hasil.takTertaut?.length > 0 && (
            <div style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 12 }}>
              <b>{hasil.takTertaut.length} SKU tanpa HPP</b> — belum tertaut ke Master SKU,
              atau tertaut tapi HPP-nya belum diisi:{' '}
              {hasil.takTertaut.slice(0, 5).map((x) => x.sku).join(', ')}
              {hasil.takTertaut.length > 5 && ` (+${hasil.takTertaut.length - 5} lagi)`}
            </div>
          )}

          {bedaBulan && (
            <div style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 12 }}>
              Periode berkas ini <b>{hasil.bulan}</b>, berbeda dengan bulan di layar.
              Angkanya akan disimpan ke bulan berkas.
            </div>
          )}

          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Nama toko</label>
              <input value={nama} onChange={(e) => setNama(e.target.value)} />
            </div>
            <button className="btn btn-sm btn-primary" onClick={simpan} disabled={sibuk}>
              Simpan ke laporan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function UnggahBonus() {
  const [hasil, setHasil] = useState(null);
  const [err, setErr] = useState('');
  const [sibuk, setSibuk] = useState(false);

  const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

  async function unggah(files) {
    setErr(''); setHasil(null);
    if (!files || !files.length) return;
    setSibuk(true);
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    const j = await fetch('/api/bonus-iklan', { method: 'POST', body: fd })
      .then((r) => r.json()).catch(() => ({ ok: false, error: 'Gagal mengunggah' }));
    setSibuk(false);
    if (!j.ok) { setErr(j.error || 'Gagal membaca berkas'); return; }
    setHasil(j);
    // Berbeda dari unggahan lain: ini LANGSUNG tersimpan, tidak perlu
    // konfirmasi. Aman karena mengunggah berkas yang sama dua kali
    // menggantikan isinya, bukan menambahkan.
    setTimeout(() => location.reload(), 2500);
  }

  return (
    <div>
      <div className="field" style={{ maxWidth: 480 }}>
        <label>Unggah ekspor Riwayat Transaksi (boleh beberapa berkas sekaligus)</label>
        <input type="file" accept=".csv" multiple disabled={sibuk}
               onChange={(e) => unggah(e.target.files)} />
      </div>
      {sibuk && <div style={{ fontSize: 13 }}>Membaca berkas…</div>}
      {err && <div style={{ color: 'var(--neg)', fontSize: 13 }}>{err}</div>}

      {hasil && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {hasil.hasil.map((h) => (
            <div key={h.nama} style={{ marginBottom: 4,
                 color: h.ok ? undefined : 'var(--neg)' }}>
              {h.ok
                ? `${h.nama}: ${h.baris} baris, ${rp(h.total)} · toko ${h.shopId} · ${h.periode.dari} s/d ${h.periode.sampai}`
                : `${h.nama}: ${h.error}`}
            </div>
          ))}
          <div style={{ opacity: 0.7, marginTop: 6 }}>Menyegarkan halaman…</div>
        </div>
      )}
    </div>
  );
}

export function TombolHapus({ id, jenis }) {
  const [sibuk, setSibuk] = useState(false);
  async function hapus() {
    if (!confirm('Hapus baris ini?')) return;
    setSibuk(true);
    const r = await fetch(`/api/opex?id=${id}&jenis=${jenis}`, { method: 'DELETE' });
    const j = await r.json();
    setSibuk(false);
    if (j.ok) location.reload(); else alert(j.error || 'Gagal menghapus');
  }
  return (
    <button className="btn btn-sm" onClick={hapus} disabled={sibuk}>Hapus</button>
  );
}

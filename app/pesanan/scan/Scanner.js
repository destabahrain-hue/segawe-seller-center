'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * ── Layar Scan & Kirim ──
 *
 * Dirancang untuk seribu paket sehari, jadi tiga hal ini yang menentukan
 * bentuknya:
 *
 *  1. Kotak input TIDAK PERNAH menunggu jawaban server. Alat scan bisa
 *     menembak lebih cepat daripada bolak-balik ke server; kalau input
 *     dikunci sampai balasan datang, operator kehilangan scan tanpa sadar.
 *     Tiap tembakan langsung masuk daftar sebagai "diproses", dikirim di
 *     latar, lalu barisnya berubah sendiri saat balasan tiba.
 *
 *  2. Yang GAGAL menghentikan pekerjaan. Dari seribu scan mungkin cuma
 *     empat yang gagal, dan justru itu yang harus ditangani — kalau cuma
 *     jadi baris merah, ia tenggelam dalam hitungan detik. Jadi gagal
 *     memunculkan popup yang wajib ditutup operator, dan selama popup
 *     terbuka scan berikutnya diabaikan.
 *
 *  3. Tidak ada tombol bersihkan. Angka dan riwayat dibaca dari database
 *     per hari, jadi halaman boleh ditutup, dimuat ulang, atau dibuka di
 *     komputer lain tanpa kehilangan hitungan.
 */

const JEDA_KEMBAR = 1200;   // tembakan ganda alat scan, bukan paket kedua

const WARNA = {
  sukses:  { garis: 'var(--pos)',  latar: 'var(--pos-tint)',  teks: 'var(--pos)' },
  duplikat:{ garis: 'var(--warn)', latar: 'var(--warn-tint)', teks: 'var(--warn)' },
  gagal:   { garis: 'var(--neg)',  latar: 'var(--neg-tint)',  teks: 'var(--neg)' },
  proses:  { garis: 'var(--line-strong)', latar: 'var(--surface-sunken)', teks: 'var(--ink-3)' },
};

const JUDUL_GAGAL = {
  duplikat:   'Resi kembar — sudah pernah discan',
  'tidak-ada':'Resi tidak dikenal',
  ganda:      'Resi terdaftar di dua pesanan',
  batal:      'Pesanan sudah dibatalkan',
  mintabatal: 'Pembeli minta batal',
  'sudah-jalan':'Paket sudah dijemput kurir',
  unpaid:     'Pesanan belum dibayar',
  status:     'Status di luar alur pengiriman',
  'belum-pack':'Belum di-Pack',
  kosong:     'Resi kosong',
};

/**
 * ── Bunyi ──
 *
 * Dibuat langsung oleh peramban, tanpa berkas suara — jadi tidak ada yang
 * perlu diunggah dan tidak ada jeda memuat pada scan pertama.
 *
 * Yang penting di sini: mesin bunyinya DIHIDUPKAN saat tombol ditekan,
 * bukan saat balasan server datang. Peramban hanya mengizinkan suara
 * kalau perintahnya lahir dari tindakan pengguna; balasan fetch tiba
 * beberapa ratus milidetik setelah itu dan sudah di luar jendela izin,
 * sehingga bunyi scan pertama bisa hilang diam-diam.
 *
 * Nadanya sengaja dibedakan jauh, bukan cuma beda tinggi rendah. Di
 * gudang yang berisik operator mengenali pola, bukan nada:
 *   berhasil  — satu bip pendek naik
 *   kembar    — dua bip sedang
 *   gagal     — tiga bip rendah turun, lebih panjang dan lebih keras
 */
const NADA = {
  sukses:   { pola: [[880, 0], [1320, 0.07]], panjang: 0.09, keras: 0.13, bentuk: 'triangle' },
  duplikat: { pola: [[700, 0], [700, 0.17]],  panjang: 0.13, keras: 0.17, bentuk: 'square' },
  gagal:    { pola: [[440, 0], [350, 0.19], [260, 0.38]], panjang: 0.17, keras: 0.22, bentuk: 'sawtooth' },
};

function useBunyi(aktif) {
  const ref = useRef(null);
  const nyala = useRef(aktif);
  useEffect(() => { nyala.current = aktif; }, [aktif]);

  /** Dipanggil dari dalam penanganan tombol, selagi izin peramban masih hidup. */
  const siapkan = useCallback(() => {
    try {
      if (!ref.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ref.current = new AC();
      }
      if (ref.current.state === 'suspended') ref.current.resume();
    } catch { /* tanpa suara pun pekerjaan harus jalan */ }
  }, []);

  const mainkan = useCallback((jenis, paksa = false) => {
    if (!nyala.current && !paksa) return;
    try {
      const ac = ref.current;
      if (!ac) return;
      const n = NADA[jenis] || NADA.gagal;
      n.pola.forEach(([hz, jeda]) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = n.bentuk;
        o.frequency.value = hz;
        const t = ac.currentTime + jeda;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(n.keras, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n.panjang);
        o.connect(g); g.connect(ac.destination);
        o.start(t); o.stop(t + n.panjang + 0.02);
      });
    } catch { /* bunyi gagal tidak boleh menjatuhkan scan */ }
  }, []);

  return { mainkan, siapkan };
}

export default function Scanner({ awal }) {
  const [baris, setBaris] = useState(() => (awal?.riwayat || []).map(dariRiwayat));
  const [ringkas, setRingkas] = useState(awal?.ringkas || { berhasil: 0, gagal: 0 });
  const [antreGagal, setAntreGagal] = useState([]);
  const [saring, setSaring] = useState('semua');
  const [suara, setSuara] = useState(true);

  const input = useRef(null);
  const tutup = useRef(null);
  const terakhir = useRef({ resi: '', pada: 0 });
  const { mainkan, siapkan } = useBunyi(suara);

  // Pilihan suara diingat per komputer — gudang yang berisik dan meja
  // yang sepi tidak selalu mau setelan yang sama.
  useEffect(() => {
    try {
      const t = window.localStorage.getItem('nsc-scan-suara');
      if (t !== null) setSuara(t === '1');
    } catch { /* peramban tanpa penyimpanan tetap boleh dipakai */ }
  }, []);
  const ubahSuara = (nyala) => {
    setSuara(nyala);
    try { window.localStorage.setItem('nsc-scan-suara', nyala ? '1' : '0'); } catch {}
    if (nyala) { siapkan(); mainkan('sukses', true); }
  };

  const gagalTerbuka = antreGagal.length > 0;
  const kini = antreGagal[0] || null;

  // Fokus dijaga terus. Operator memakai alat scan, bukan papan ketik —
  // sekali fokus lepas, tembakan berikutnya hilang entah ke mana.
  useEffect(() => {
    if (!gagalTerbuka) input.current?.focus();
    else tutup.current?.focus();
  }, [gagalTerbuka]);

  useEffect(() => {
    const jaga = setInterval(() => {
      if (!gagalTerbuka && document.activeElement !== input.current) input.current?.focus();
    }, 1200);
    return () => clearInterval(jaga);
  }, [gagalTerbuka]);

  const kirim = useCallback(async (resiMentah) => {
    const resi = String(resiMentah || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!resi) return;

    // Alat scan kadang menembak dua kali untuk satu paket. Dua kiriman
    // resi sama dalam sekejap itu artefak alat, bukan paket kedua.
    const kmb = terakhir.current;
    if (kmb.resi === resi && Date.now() - kmb.pada < JEDA_KEMBAR) return;
    terakhir.current = { resi, pada: Date.now() };

    const kunci = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setBaris((b) => [{ kunci, resi, jenis: 'proses', pesan: 'Mengirim…', waktu: new Date().toISOString() }, ...b].slice(0, 60));

    try {
      const r = await fetch('/api/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resi }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);

      const h = j.hasil;
      setBaris((b) => b.map((x) => (x.kunci === kunci ? { ...x, ...h, kunci } : x)));
      setRingkas((r0) => ({
        berhasil: Math.max(r0.berhasil, j.ringkas?.berhasil ?? 0),
        gagal:    Math.max(r0.gagal,    j.ringkas?.gagal ?? 0),
      }));
      mainkan(h.jenis);
      if (!h.ok) setAntreGagal((a) => [...a, { ...h, kunci }]);
    } catch (e) {
      const h = { jenis: 'gagal', kode: 'jaringan', ok: false, resi,
                  pesan: `Tidak bisa menghubungi server: ${e.message}. Paket ini BELUM dipindahkan.` };
      setBaris((b) => b.map((x) => (x.kunci === kunci ? { ...x, ...h, kunci } : x)));
      mainkan('gagal');
      setAntreGagal((a) => [...a, { ...h, kunci }]);
    }
  }, [mainkan]);

  function onKey(e) {
    // Dipanggil di SETIAP tombol, bukan hanya Enter: inilah satu-satunya
    // saat peramban mengizinkan mesin bunyi dinyalakan.
    siapkan();
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.currentTarget.value;
    e.currentTarget.value = '';
    kirim(v);
  }

  // Popup ditutup dengan klik atau Esc — sengaja BUKAN dengan Enter.
  // Alat scan mengirim Enter di akhir tiap tembakan; kalau Enter bisa
  // menutup popup, tembakan berikutnya akan menutupnya tanpa pernah
  // dibaca operator, dan resinya ikut hilang.
  useEffect(() => {
    if (!gagalTerbuka) return;
    const h = (e) => { if (e.key === 'Escape') tutupSatu(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [gagalTerbuka]);

  const tutupSatu = () => setAntreGagal((a) => a.slice(1));

  const terlihat = useMemo(() => baris.filter((b) =>
    saring === 'semua' ? true : saring === 'gagal' ? b.jenis === 'gagal' || b.jenis === 'duplikat' : b.jenis === 'sukses'
  ), [baris, saring]);

  const jumlahGagal = baris.filter((b) => b.jenis === 'gagal' || b.jenis === 'duplikat').length;

  return (
    <>
      <style>{`
        .scan-input{width:100%;font-size:22px;font-weight:600;letter-spacing:.04em;
          padding:16px 18px;border-radius:var(--r-md);border:2px solid var(--brand);
          background:var(--surface);color:var(--ink);outline:none;
          font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        .scan-input:disabled{border-color:var(--line-strong);background:var(--surface-sunken)}
        .scan-angka{font-size:78px;line-height:1;font-weight:800;letter-spacing:-.03em;
          font-variant-numeric:tabular-nums;color:var(--pos)}
        .scan-tirai{position:fixed;inset:0;z-index:90;display:flex;align-items:center;
          justify-content:center;padding:20px;background:rgba(11,18,38,.62)}
        .scan-popup{width:min(560px,100%);background:var(--surface);border-radius:var(--r-lg);
          box-shadow:var(--sh-3);overflow:hidden;border-top:6px solid var(--neg)}
        .scan-popup.kembar{border-top-color:var(--warn)}
        .scan-baris{display:grid;grid-template-columns:150px 1fr 128px;gap:10px;align-items:baseline;
          padding:9px 12px;border-radius:var(--r-sm);border:1px solid var(--line);margin-bottom:6px}
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,380px) 1fr',
                    gap: 'var(--s4)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <div className="card">
            <div className="card-head"><h2>Tembak barcode resi</h2></div>
            <div className="card-body">
              <input ref={input} className="scan-input" autoFocus disabled={gagalTerbuka}
                     placeholder={gagalTerbuka ? 'Tutup peringatan dulu' : 'SPXID…'}
                     onKeyDown={onKey} aria-label="Nomor resi" />
              <p className="t-mute" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                Kotak ini selalu aktif sendiri — tidak perlu diklik. Tembak terus tanpa
                menunggu, hasil tiap scan menyusul di kanan.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12,
                              cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={suara}
                       onChange={(e) => ubahSuara(e.currentTarget.checked)} />
                <span style={{ fontWeight: 600 }}>Bunyi tiap scan</span>
                <span className="t-mute" style={{ fontSize: 11.5 }}>
                  {suara ? 'satu bip = berhasil, bip rendah beruntun = gagal' : 'sedang dimatikan'}
                </span>
              </label>
            </div>
          </div>

          <div className="card">
            <div className="card-body" style={{ textAlign: 'center', paddingTop: 'var(--s5)',
                                                paddingBottom: 'var(--s5)' }}>
              <div className="scan-angka">{ringkas.berhasil}</div>
              <div style={{ marginTop: 6, fontWeight: 600 }}>dipindahkan ke Siap dijemput</div>
              <div className="t-mute" style={{ fontSize: 12, marginTop: 2 }}>hari ini, seluruh toko</div>
              {ringkas.gagal > 0 && (
                <div className="badge b-neg" style={{ marginTop: 12 }}>
                  {ringkas.gagal} scan gagal hari ini
                </div>
              )}
            </div>
          </div>

          <a className="btn" href="/pesanan?s=pickup">Lihat daftar Siap dijemput</a>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Riwayat scan hari ini</h2>
            <div className="spacer" />
            {['semua', 'sukses', 'gagal'].map((s) => (
              <button key={s} className="chip" aria-pressed={saring === s}
                      onClick={() => setSaring(s)} style={{ cursor: 'pointer' }}>
                {s === 'semua' ? 'Semua' : s === 'sukses' ? 'Berhasil' : 'Gagal'}
                {s === 'gagal' && jumlahGagal > 0 && <span className="n">{jumlahGagal}</span>}
              </button>
            ))}
          </div>
          <div className="card-body">
            {terlihat.length === 0 && (
              <p className="t-mute" style={{ margin: 0 }}>
                Belum ada scan. Tembak barcode resi di kotak sebelah kiri.
              </p>
            )}
            {terlihat.map((b) => {
              const w = WARNA[b.jenis] || WARNA.proses;
              return (
                <div key={b.kunci} className="scan-baris"
                     style={{ borderColor: w.garis, background: w.latar }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{b.resi}</span>
                  <span style={{ minWidth: 0 }}>
                    <b style={{ color: w.teks }}>
                      {b.jenis === 'sukses' ? 'Siap dijemput'
                        : b.jenis === 'proses' ? 'Mengirim…'
                        : JUDUL_GAGAL[b.kode] || 'Gagal'}
                    </b>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-2)' }}>
                      {[b.order_sn, b.shop_name].filter(Boolean).join(' · ') || b.pesan}
                    </span>
                  </span>
                  <span className="t-mute" style={{ fontSize: 12, textAlign: 'right' }}>
                    {b.waktu ? jam(b.waktu) : ''}
                  </span>
                </div>
              );
            })}
            {baris.length >= 50 && (
              <p className="t-mute" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                Menampilkan 50 scan terakhir. Seluruhnya tetap tersimpan.
              </p>
            )}
          </div>
        </div>
      </div>

      {kini && (
        <div className="scan-tirai" role="alertdialog" aria-modal="true"
             aria-labelledby="scan-judul-gagal">
          <div className={'scan-popup' + (kini.kode === 'duplikat' ? ' kembar' : '')}>
            <div style={{ padding: 'var(--s5)' }}>
              <div className="badge" style={{
                background: kini.kode === 'duplikat' ? 'var(--warn-tint)' : 'var(--neg-tint)',
                color: kini.kode === 'duplikat' ? 'var(--warn)' : 'var(--neg)', marginBottom: 10 }}>
                Scan gagal
              </div>
              <h2 id="scan-judul-gagal" style={{ margin: '0 0 6px', fontSize: 21 }}>
                {JUDUL_GAGAL[kini.kode] || 'Scan gagal'}
              </h2>
              <p className="mono" style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>
                {kini.resi}
              </p>
              <p style={{ margin: 0, color: 'var(--ink-2)' }}>{kini.pesan}</p>
              {(kini.order_sn || kini.shop_name) && (
                <p className="t-mute" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
                  {[kini.order_sn, kini.shop_name, kini.penerima].filter(Boolean).join(' · ')}
                </p>
              )}
              <p style={{ marginTop: 14, marginBottom: 0, fontWeight: 600 }}>
                Pisahkan paket ini dulu, baru lanjut scan.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'var(--s4) var(--s5)',
                          borderTop: '1px solid var(--line)', background: 'var(--surface-sunken)' }}>
              <span className="t-mute" style={{ fontSize: 12, flex: 1 }}>
                {antreGagal.length > 1
                  ? `${antreGagal.length - 1} peringatan lain menunggu di belakang ini.`
                  : 'Scan berhenti selama peringatan ini terbuka.'}
              </span>
              <button ref={tutup} className="btn btn-primary" onClick={tutupSatu}>
                Sudah dipisahkan, lanjut scan
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function dariRiwayat(r) {
  return {
    kunci: `db-${r.id}`,
    resi: r.resi,
    jenis: r.ok ? 'sukses' : r.sebab === 'duplikat' ? 'duplikat' : 'gagal',
    kode: r.sebab,
    pesan: r.pesan,
    order_sn: r.order_sn,
    shop_name: r.shop_name,
    waktu: r.scanned_at,
  };
}

const jam = (d) => new Date(d).toLocaleTimeString('id-ID',
  { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' });

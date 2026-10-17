'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Bilah saringan halaman Pesanan — bentuknya meniru "Kelola Pesanan" ala
 * Gurita Market: tab marketplace, kotak cari, deretan dropdown, tombol
 * Atur ulang / Terapkan, lalu kartu status berangka.
 *
 * Dropdown TIDAK langsung memuat ulang halaman. Pilihannya ditampung dulu
 * (draf) dan baru dipakai saat Terapkan ditekan — supaya mengganti tiga
 * saringan sekaligus cukup satu kali muat, bukan tiga. Tab marketplace dan
 * kartu status tetap langsung pindah, karena keduanya "pindah layar",
 * bukan menyaring.
 *
 * Semua keadaan tetap tinggal di alamat halaman (?toko=…&kurir=…), jadi
 * tautannya masih bisa di-bookmark atau dikirim ke tim seperti sebelumnya.
 */

const BAWAAN = { toko: null, cetak: null, tipe: null, tahap: null, kurir: null, kadaluarsa: null,
                 w: 'dibuat', r: 'semua', dari: null, sampai: null,
                 urut: 'batas', arah: 'turun', cari: null };

// Nilai yang sama dengan bawaan tidak ditulis ke alamat — sama persis
// dengan qs() di page.js, supaya alamat dari dua jalur ini tidak berbeda.
function keUrl(v) {
  const p = new URLSearchParams();
  const tulis = {
    s: v.s, mp: v.mp, toko: v.toko, kadaluarsa: v.kadaluarsa, kurir: v.kurir, cari: v.cari,
    cetak: v.cetak, tipe: v.tipe, tahap: v.tahap, tpl: v.tpl,
    urut: v.urut === 'batas' ? null : v.urut, arah: v.arah === 'turun' ? null : v.arah,
    w: v.w === 'dibuat' ? null : v.w,
    r: v.r === 'semua' ? null : v.r,
    dari: v.r === 'custom' ? v.dari : null, sampai: v.r === 'custom' ? v.sampai : null,
    per: v.per,
  };
  for (const [k, x] of Object.entries(tulis)) if (x) p.set(k, x);
  return '/pesanan?' + p.toString();
}

const num = (n) => Number(n || 0).toLocaleString('id-ID');
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function tglPendek(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/* ── Ikon kecil (garis, mengikuti currentColor) ── */
const Ik = ({ d, size = 14 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const IChevron = () => <Ik d={<path d="m6 9 6 6 6-6" />} />;
const ICek = () => <Ik d={<path d="M20 6 9 17l-5-5" />} />;
const ICari = () => <Ik d={<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>} />;
const IKalender = () => <Ik d={<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>} />;
const IX = () => <Ik size={12} d={<path d="M18 6 6 18M6 6l12 12" />} />;

/** Menutup popover saat klik di luar atau menekan Escape. */
function useTutupLuar(buka, setBuka) {
  const ref = useRef(null);
  useEffect(() => {
    if (!buka) return;
    const klik = (e) => { if (ref.current && !ref.current.contains(e.target)) setBuka(false); };
    const esc = (e) => { if (e.key === 'Escape') setBuka(false); };
    document.addEventListener('mousedown', klik);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', klik); document.removeEventListener('keydown', esc); };
  }, [buka, setBuka]);
  return ref;
}

/**
 * Dropdown satu pilihan. `opsi` = [{ value, label, n?, sub? }]; value null
 * = pilihan "Semua …". Kotak cari muncul sendiri kalau pilihannya banyak.
 */
function Pilih({ label, nilai, opsi, onPilih, cari: pakaiCari, placeholderCari = 'Cari…', bawaan = null }) {
  const [buka, setBuka] = useState(false);
  const [kata, setKata] = useState('');
  const ref = useTutupLuar(buka, setBuka);
  const terpilih = opsi.find((o) => String(o.value ?? '') === String(nilai ?? '')) || opsi[0];
  const cariNyala = pakaiCari ?? opsi.length > 8;
  const tampil = kata
    ? opsi.filter((o) => o.value === null || String(o.label).toLowerCase().includes(kata.toLowerCase()))
    : opsi;

  return (
    <div className="fp-field" ref={ref}>
      <span className="fp-label">{label}</span>
      <button type="button" className="fp-select" aria-expanded={buka} aria-haspopup="listbox"
              data-aktif={String(nilai ?? '') !== String(bawaan ?? '') ? 'ya' : undefined}
              onClick={() => { setBuka(!buka); setKata(''); }}>
        <span className="fp-select-v">{terpilih?.label}</span>
        <IChevron />
      </button>
      {buka && (
        <div className="fp-pop" role="listbox">
          {cariNyala && (
            <div className="fp-pop-cari">
              <ICari />
              <input autoFocus value={kata} onChange={(e) => setKata(e.target.value)}
                     placeholder={placeholderCari} />
            </div>
          )}
          <div className="fp-pop-list">
            {tampil.map((o) => {
              const dipilih = String(o.value ?? '') === String(nilai ?? '');
              return (
                <button type="button" key={String(o.value)} role="option" aria-selected={dipilih}
                        className="fp-opt" onClick={() => { onPilih(o.value); setBuka(false); }}>
                  <span className="fp-opt-l">
                    {o.label}
                    {o.sub && <span className="fp-opt-sub">{o.sub}</span>}
                  </span>
                  {o.n !== undefined && <span className="fp-opt-n">{num(o.n)}</span>}
                  {dipilih && <ICek />}
                </button>
              );
            })}
            {!tampil.length && <div className="fp-kosong">Tidak ada yang cocok</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Dropdown tanggal: dasar waktu + pilihan cepat + rentang sendiri. */
function PilihTanggal({ v, ubah, basisList, rentangList, labelAktif }) {
  const [buka, setBuka] = useState(false);
  const ref = useTutupLuar(buka, setBuka);
  const [a, setA] = useState(v.dari || '');
  const [b, setB] = useState(v.sampai || '');
  useEffect(() => { setA(v.dari || ''); setB(v.sampai || ''); }, [v.dari, v.sampai]);

  const namaRentang = rentangList.find(([k]) => k === v.r)?.[1] || 'Semua waktu';
  const teks = v.r === 'custom' && v.dari
    ? `${tglPendek(v.dari)} – ${tglPendek(v.sampai || v.dari)}`
    : (labelAktif && v.r !== 'semua' ? labelAktif : namaRentang);
  const namaBasis = basisList.find(([k]) => k === v.w)?.[1] || basisList[0][1];

  return (
    <div className="fp-field" ref={ref}>
      <span className="fp-label">{namaBasis}</span>
      <button type="button" className="fp-select" aria-expanded={buka}
              data-aktif={v.r !== 'semua' ? 'ya' : undefined} onClick={() => setBuka(!buka)}>
        <IKalender />
        <span className="fp-select-v">{teks}</span>
        <IChevron />
      </button>
      {buka && (
        <div className="fp-pop fp-pop-lebar">
          <div className="fp-pop-judul">Dasar waktu</div>
          <div className="fp-seg">
            {basisList.map(([k, l]) => (
              <button type="button" key={k} aria-pressed={v.w === k} onClick={() => ubah({ w: k })}>
                {l.replace(/^Waktu /, '')}
              </button>
            ))}
          </div>
          <div className="fp-pop-judul">Rentang</div>
          <div className="fp-seg">
            {rentangList.filter(([k]) => k !== 'custom').map(([k, l]) => (
              <button type="button" key={k} aria-pressed={v.r === k}
                      onClick={() => { ubah({ r: k, dari: null, sampai: null }); setBuka(false); }}>
                {l}
              </button>
            ))}
          </div>
          <div className="fp-pop-judul">Pilih tanggal sendiri</div>
          <div className="fp-tgl">
            <input type="date" value={a} onChange={(e) => setA(e.target.value)} aria-label="Tanggal awal" />
            <span>s/d</span>
            <input type="date" value={b} onChange={(e) => setB(e.target.value)} aria-label="Tanggal akhir" />
            <button type="button" className="btn btn-sm btn-primary" disabled={!a}
                    onClick={() => { ubah({ r: 'custom', dari: a, sampai: b || a }); setBuka(false); }}>
              Pakai
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FilterPesanan({
  awal, tetap, opsiToko, opsiKurir, hitung, statusList, kunci, marketplace,
  tipeList, tahapList, basisList, rentangList, urutList, labelWaktu,
}) {
  const router = useRouter();
  const [v, setV] = useState({ ...BAWAAN, ...awal });
  const [jalan, setJalan] = useState(false);
  // Halaman server dimuat ulang → draf ikut alamat yang baru.
  useEffect(() => { setV({ ...BAWAAN, ...awal }); setJalan(false); }, [JSON.stringify(awal)]);  // eslint-disable-line

  const ubah = (x) => setV((l) => ({ ...l, ...x }));
  const berubah = Object.keys(BAWAAN).some((k) => String(v[k] ?? '') !== String((awal[k] ?? BAWAAN[k]) ?? ''));
  const adaSaring = Object.keys(BAWAAN).some((k) => String((awal[k] ?? BAWAAN[k]) ?? '') !== String(BAWAAN[k] ?? ''));

  const pergi = (url) => { setJalan(true); router.push(url); };
  const terapkan = (e) => {
    e?.preventDefault();
    // Memilih tahap gudang otomatis pindah ke status yang memuatnya —
    // "Sedang dikemas" di kartu Selesai hanya akan menghasilkan daftar kosong.
    let s = tetap.s;
    if (v.tahap) {
      const wadah = v.tahap === 'mintabatal' ? 'batal' : 'perlu';
      const kini = String(s || 'semua').split(',');
      if (!kini.includes(wadah) && !kini.includes('semua')) s = wadah;
    }
    pergi(keUrl({ ...tetap, ...v, s, cari: v.cari?.trim() || null }));
  };
  const aturUlang = () => pergi(keUrl({ ...tetap, ...BAWAAN }));

  // Tab marketplace: toko & ekspedisi dilepas, karena daftar pilihannya
  // ikut berganti dan pilihan lama belum tentu ada di marketplace baru.
  const keMp = (mp) => pergi(keUrl({ ...tetap, ...awal, mp, toko: null, kurir: null }));
  // Pindah kartu status melepas saringan tahap — tahap hanya bermakna di
  // Perlu Dikirim / Pembatalan.
  const keStatus = (s) => keUrl({ ...tetap, ...awal, s, tahap: null });

  return (
    <div className="fp" aria-busy={jalan}>
      <div className="fp-tabs" role="tablist" aria-label="Marketplace">
        {marketplace.map(([k, l]) => {
          const aktif = (tetap.mp || null) === k;
          return (
            <button type="button" key={String(k)} role="tab" aria-selected={aktif}
                    className="fp-tab" onClick={() => !aktif && keMp(k)}>
              <span className={'fp-mp fp-mp-' + (k || 'semua')} aria-hidden="true" />
              {l}
            </button>
          );
        })}
      </div>

      <form className="fp-panel" onSubmit={terapkan}>
        <label className="fp-cari">
          <ICari />
          <input value={v.cari || ''} onChange={(e) => ubah({ cari: e.target.value })}
                 placeholder="Cari no. pesanan, resi, SKU, nama barang, atau penerima…" />
          {v.cari && (
            <button type="button" className="fp-cari-x" aria-label="Hapus pencarian"
                    onClick={() => ubah({ cari: null })}><IX /></button>
          )}
        </label>

        <div className="fp-grid">
          <Pilih label="Toko" nilai={v.toko} onPilih={(x) => ubah({ toko: x })}
                 cari placeholderCari="Cari toko…" opsi={opsiToko} />
          <Pilih label="Status cetak resi" nilai={v.cetak} onPilih={(x) => ubah({ cetak: x })}
                 opsi={[{ value: null, label: 'Semua status cetak' },
                        { value: 'belum', label: 'Belum dicetak' },
                        { value: 'sudah', label: 'Sudah dicetak' }]} />
          <Pilih label="Tipe pengiriman" nilai={v.tipe} onPilih={(x) => ubah({ tipe: x })}
                 opsi={[{ value: null, label: 'Semua tipe pengiriman' },
                        ...tipeList.map(([k, l]) => ({ value: k, label: l }))]} />
          <Pilih label="Tahap proses" nilai={v.tahap} onPilih={(x) => ubah({ tahap: x })}
                 opsi={[{ value: null, label: 'Semua tahap' },
                        ...tahapList.map((t) => ({ value: t.key, label: t.label, n: t.n }))]} />
          <Pilih label="Ekspedisi" nilai={v.kurir} onPilih={(x) => ubah({ kurir: x })}
                 cari placeholderCari="Cari ekspedisi…" opsi={opsiKurir} />
          <Pilih label="Batas kirim" nilai={v.kadaluarsa} onPilih={(x) => ubah({ kadaluarsa: x })}
                 opsi={[{ value: null, label: 'Semua pesanan' },
                        { value: 'lewat', label: 'Sudah lewat batas', n: hitung.lewat },
                        { value: 'segera', label: 'Kurang dari 24 jam', n: hitung.segera }]} />
          <PilihTanggal v={v} ubah={ubah} basisList={basisList} rentangList={rentangList}
                        labelAktif={labelWaktu} />
          <Pilih label="Urutkan" nilai={v.urut} bawaan="batas" onPilih={(x) => ubah({ urut: x })}
                 opsi={urutList.map(([k, l]) => ({ value: k, label: l }))} />
          <Pilih label="Arah urutan" nilai={v.arah} bawaan="turun" onPilih={(x) => ubah({ arah: x })}
                 opsi={[{ value: 'turun', label: 'Baru → lama / Z → A' },
                        { value: 'naik', label: 'Lama → baru / A → Z' }]} />
        </div>

        <div className="fp-aksi">
          <button type="button" className="fp-reset" onClick={aturUlang} disabled={!adaSaring && !berubah}>
            Atur ulang
          </button>
          <button type="submit" className="btn btn-primary fp-terapkan" disabled={!berubah || jalan}>
            {jalan ? 'Memuat…' : 'Terapkan'}
          </button>
          {berubah && <span className="fp-catat">Ada saringan yang belum diterapkan</span>}
        </div>
      </form>

      <div className="fp-kartu-grid">
        {statusList.map((x) => {
          const dipilih = kunci.includes(x.key);
          // Tombol +/− menambah atau mengurangi dari gabungan — supaya
          // "Dikirim + Selesai" tetap bisa dilihat sekaligus.
          const gabung = dipilih
            ? kunci.filter((k) => k !== x.key && k !== 'semua')
            : [...kunci.filter((k) => k !== 'semua'), x.key];
          return (
            <div key={x.key} className="fp-kartu" data-pilih={dipilih ? 'ya' : undefined}
                 data-nada={x.nada || undefined}>
              <a href={keStatus(x.key)} title={x.jelas} className="fp-kartu-a"
                 onClick={(e) => { e.preventDefault(); pergi(keStatus(x.key)); }}>
                <span className="fp-kartu-l">{x.label}</span>
                <span className="fp-kartu-n">{num(hitung[x.key])}</span>
              </a>
              {x.key !== 'semua' && (
                <a className="fp-kartu-plus" href={keStatus(gabung.length ? gabung.join(',') : 'semua')}
                   onClick={(e) => { e.preventDefault(); pergi(keStatus(gabung.length ? gabung.join(',') : 'semua')); }}
                   title={dipilih ? `Keluarkan ${x.label} dari gabungan` : `Gabungkan ${x.label} dengan status terpilih`}
                   aria-label={dipilih ? `Keluarkan ${x.label} dari gabungan` : `Gabungkan ${x.label}`}>
                  {dipilih && kunci.length > 1 ? '−' : '+'}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

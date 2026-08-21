import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kosong, Catatan, Galat } from '../UI';
import { Pilihan } from './Aksi';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema, q } from '@/lib/db';
import { STATUS, BASIS_WAKTU, URUT, cariStatus, kunciStatus, cariBasis, waktuDari, hitungStatus, daftar,
         hitungKurir, hitungBaris, PER_HALAMAN } from '@/lib/orders';
import RangePicker from '../RangePicker';
import GagalPack from './GagalPack';
import { TEMPLATE_BAWAAN } from '@/lib/kolom-ekspor';
import { num } from '@/lib/fmt';
import Paginasi from '../Paginasi';

export const dynamic = 'force-dynamic';

/**
 * "Semua waktu" sengaja ada dan sengaja jadi bawaan. Ini layar kerja
 * harian; pesanan yang dibuat tiga hari lalu tapi belum dikemas HARUS
 * tetap terlihat, dan bawaan "hari ini" akan menyembunyikannya diam-diam.
 */
const RENTANG_PESANAN = [
  ['semua',      'Semua waktu'],
  ['hari-ini',   'Hari ini'],
  ['kemarin',    'Kemarin'],
  ['7h',         '7 hari'],
  ['30h',        '30 hari'],
  ['90h',        '90 hari'],
  ['bulan-ini',  'Bulan ini'],
  ['bulan-lalu', 'Bulan lalu'],
  ['custom',     'Pilih jangka waktu'],
];

export default async function Pesanan({ searchParams }) {
  const uang = bolehUang(await peranSekarang());
  // Status boleh lebih dari satu, dipisah koma: ?s=dikirim,selesai
  const kunci = kunciStatus(searchParams?.s || 'baru');
  const status = kunci.length > 1 ? kunci : kunci[0];
  const statusParam = kunci.join(',');
  const toko = searchParams?.toko || null;
  const kadaluarsa = searchParams?.kadaluarsa || null;
  const kurir = searchParams?.kurir || null;
  const cari = searchParams?.cari || null;
  const cetak = ['sudah', 'belum'].includes(searchParams?.cetak) ? searchParams.cetak : null;
  const tpl = searchParams?.tpl || null;
  const urut = URUT.some((u) => u[0] === searchParams?.urut) ? searchParams.urut : 'batas';
  const arah = searchParams?.arah === 'naik' ? 'naik' : 'turun';
  const basis = searchParams?.w || 'dibuat';
  const kodeRentang = searchParams?.r || 'semua';
  const dari = searchParams?.dari || null;
  const sampai = searchParams?.sampai || null;
  const waktu = waktuDari({ w: basis, r: kodeRentang, dari, sampai });
  const perHalaman = PER_HALAMAN.includes(Number(searchParams?.per)) ? Number(searchParams.per) : 50;
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);
  const s = cariStatus(kunci[0]);

  let hitung = {}, rows = [], daftarToko = [], kurirList = [], total = 0, galat = null;
  try {
    await ensureSchema();
    [hitung, rows, daftarToko, kurirList, total] = await Promise.all([
      hitungStatus({ shopId: toko, waktu }),
      daftar({ status, shopId: toko, kadaluarsa, kurir, cari, waktu, cetak, urut, arah, halaman, perHalaman }),
      q('SELECT shop_id, shop_name FROM shops ORDER BY shop_name NULLS LAST'),
      hitungKurir({ status, shopId: toko, kadaluarsa, cari, waktu, cetak }),
      hitungBaris({ status, shopId: toko, kadaluarsa, kurir, cari, waktu, cetak }),
    ]);
  } catch (e) {
    galat = { pesan: e.message, detail: [e.code && `kode: ${e.code}`, e.detail, e.hint,
              e.position && `posisi: ${e.position}`].filter(Boolean).join('\n') || null };
  }

  const qs = (ubah) => {
    const p = new URLSearchParams();
    const v = { s: statusParam, toko, kadaluarsa, kurir, cari, cetak, tpl,
                urut: urut === 'batas' ? null : urut, arah: arah === 'turun' ? null : arah,
                w: basis === 'dibuat' ? null : basis,
                r: kodeRentang === 'semua' ? null : kodeRentang, dari, sampai,
                per: perHalaman === 50 ? null : perHalaman, ...ubah };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return '/pesanan?' + p.toString();
  };
  const unduh = (kodeTpl = null) => {
    const p = new URLSearchParams({ status });
    // Susunan kolom. Tanpa ini, yang dipakai susunan lama — supaya tautan
    // ekspor yang sudah tersimpan orang tetap menghasilkan berkas yang sama.
    const t = kodeTpl ?? tpl;
    if (t) p.set('tpl', t);
    if (cetak) p.set('cetak', cetak);
    if (urut !== 'batas') p.set('urut', urut);
    if (arah !== 'turun') p.set('arah', arah);
    if (toko) p.set('toko', toko);
    if (kadaluarsa) p.set('kadaluarsa', kadaluarsa);
    if (kurir) p.set('kurir', kurir);
    if (cari) p.set('cari', cari);
    // Ekspor mengikuti rentang yang sedang terlihat di layar — kalau tidak,
    // berkasnya berisi hal lain daripada yang barusan dilihat.
    if (kodeRentang !== 'semua') {
      p.set('w', basis); p.set('r', kodeRentang);
      if (dari) p.set('dari', dari);
      if (sampai) p.set('sampai', sampai);
    }
    return '/api/pesanan/export?' + p.toString();
  };

  const grup = [...new Set(STATUS.map((x) => x.grup))];

  return (
    <Shell judul="Pesanan" rute="/pesanan" kanan={<AutoSegar detik={60} />}>
      {galat && <Galat judul="Halaman Pesanan gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {!galat && <>
      {Number(hitung.mintabatal) > 0 && status !== 'mintabatal' && (
        <div className="note" style={{ borderColor: 'var(--warn)', background: 'var(--warn-tint)' }}>
          <div>
            <b>{num(hitung.mintabatal)} pesanan sedang diminta batal pembeli.</b>{' '}
            Kalau tidak ditanggapi, Shopee biasanya menyetujuinya sendiri setelah batas waktu.{' '}
            <a href={qs({ s: 'mintabatal', hal: null })}>Lihat daftarnya</a>.
          </div>
        </div>
      )}

      {Number(hitung.lewat) > 0 && (
        <Catatan>
          <b>{num(hitung.lewat)} pesanan sudah lewat batas waktu kirim.</b> Shopee bisa
          membatalkan pesanan dan menurunkan skor tokomu.
          {' '}<a href={qs({ kadaluarsa: 'lewat', s: 'semua' })} style={{ textDecoration: 'underline' }}>
            Lihat daftarnya
          </a>.
        </Catatan>
      )}

      <GagalPack />

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Dasar waktu</div>
          <div className="filter-vals">
            {BASIS_WAKTU.map(([kode, label]) => (
              <a key={kode} className="chip" href={qs({ w: kode, hal: null })}
                 aria-pressed={basis === kode}>{label}</a>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-key">Rentang</div>
          <RangePicker aktif={kodeRentang} awal={dari || ''} akhir={sampai || ''}
                       pilihan={RENTANG_PESANAN} />
        </div>

        {grup.map((g) => (
          <div className="filter-row" key={g}>
            <div className="filter-key">{g}</div>
            <div className="filter-vals">
              {STATUS.filter((x) => x.grup === g).map((x) => {
                const dipilih = kunci.includes(x.key);
                // Klik pada label = pilih status ini saja. Tombol +/−
                // menambah atau mengurangi dari gabungan, supaya
                // "Dikirim + Selesai" bisa dilihat sekaligus tanpa
                // kehilangan cara cepat berpindah satu tab.
                const gabung = x.key === 'semua'
                  ? ['semua']
                  : dipilih
                    ? kunci.filter((k) => k !== x.key && k !== 'semua')
                    : [...kunci.filter((k) => k !== 'semua'), x.key];
                return (
                  <span key={x.key} className="chip" aria-pressed={dipilih}
                        style={{ paddingRight: x.key === 'semua' ? undefined : 4 }}>
                    <a href={qs({ s: x.key })} title={x.jelas}
                       style={{ color: 'inherit', textDecoration: 'none' }}>
                      {x.label} <span className="n">{num(hitung[x.key] ?? 0)}</span>
                    </a>
                    {x.key !== 'semua' && (
                      <a href={qs({ s: gabung.length ? gabung.join(',') : 'semua' })}
                         title={dipilih ? `Keluarkan ${x.label} dari gabungan`
                                        : `Tambahkan ${x.label} ke gabungan`}
                         style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4,
                                  border: '1px solid var(--line-strong)', lineHeight: '16px',
                                  fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>
                        {dipilih ? '−' : '+'}
                      </a>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        ))}

        <div className="filter-row">
          <div className="filter-key">Urutkan</div>
          <div className="filter-vals">
            {URUT.map(([k, label]) => (
              <a key={k} className="chip" href={qs({ urut: k, hal: null })} aria-pressed={urut === k}>
                {label}
              </a>
            ))}
            <a className="chip" href={qs({ arah: arah === 'naik' ? 'turun' : 'naik', hal: null })}
               title="Balik arah urutan">
              {arah === 'naik' ? 'Naik: lama / A→Z' : 'Turun: baru / Z→A'}
            </a>
          </div>
        </div>

        {kunci.some((k) => ['proses', 'pickup', 'baru', 'semua'].includes(k)) && (
          <div className="filter-row">
            <div className="filter-key">Status resi</div>
            <div className="filter-vals">
              <a className="chip" href={qs({ cetak: null, hal: null })} aria-pressed={!cetak}>Semua</a>
              <a className="chip" href={qs({ cetak: 'belum', hal: null })} aria-pressed={cetak === 'belum'}
                 title="Labelnya belum pernah tercetak">Belum dicetak</a>
              <a className="chip" href={qs({ cetak: 'sudah', hal: null })} aria-pressed={cetak === 'sudah'}
                 title="Labelnya sudah pernah tercetak">Sudah dicetak</a>
            </div>
          </div>
        )}

        <div className="filter-row">
          <div className="filter-key">Batas kirim</div>
          <div className="filter-vals">
            <a className="chip" href={qs({ kadaluarsa: null })} aria-pressed={!kadaluarsa}>Semua</a>
            <a className="chip" href={qs({ kadaluarsa: 'lewat' })} aria-pressed={kadaluarsa === 'lewat'}>
              Sudah lewat <span className="n">{num(hitung.lewat ?? 0)}</span>
            </a>
            <a className="chip" href={qs({ kadaluarsa: 'segera' })} aria-pressed={kadaluarsa === 'segera'}>
              Kurang 24 jam <span className="n">{num(hitung.segera ?? 0)}</span>
            </a>
          </div>
        </div>

        {kurirList.length > 0 && (
          <div className="filter-row">
            <div className="filter-key">Kurir</div>
            <div className="filter-vals">
              <a className="chip" href={qs({ kurir: null })} aria-pressed={!kurir}>Semua</a>
              {kurirList.map((k) => (
                <a key={k.kurir} className="chip" href={qs({ kurir: k.kurir })}
                   aria-pressed={kurir === k.kurir}>
                  {k.kurir === '(kosong)' ? 'Belum ditentukan' : k.kurir}
                  <span className="n">{num(k.jumlah)}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {daftarToko.length > 1 && (
          <div className="filter-row">
            <div className="filter-key">Toko</div>
            <div className="filter-vals">
              <a className="chip" href={qs({ toko: null })} aria-pressed={!toko}>Semua toko</a>
              {daftarToko.map((t) => (
                <a key={t.shop_id} className="chip" href={qs({ toko: String(t.shop_id) })}
                   aria-pressed={String(toko) === String(t.shop_id)}>
                  {t.shop_name || `Toko ${t.shop_id}`}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{kunci.length > 1
            ? kunci.map((k) => cariStatus(k).label).join(' + ')
            : s.label}</h2>
          <span className="badge b-mute">
            {kunci.length > 1 ? 'Gabungan beberapa status' : s.jelas}
          </span>
          {waktu && (
            <span className="badge b-pos">
              {cariBasis(basis)[1].toLowerCase()}: {waktu.label}
            </span>
          )}
          <div className="spacer" />
          <span className="t-mute" style={{ fontSize: 12 }}>
            {total > 0
              ? `${num((halaman - 1) * perHalaman + 1)}–${num((halaman - 1) * perHalaman + rows.length)} dari ${num(total)}`
              : '0 pesanan'}
          </span>
          {uang && (
            <details className="menu-unduh" style={{ position: 'relative' }}>
              <summary className="btn btn-sm" style={{ listStyle: 'none', cursor: 'pointer' }}>
                Susunan kolom{tpl ? ': dipilih' : ''} ▾
              </summary>
              <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 40,
                            background: 'var(--surface)', border: '1px solid var(--line)',
                            borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-2)',
                            padding: 6, minWidth: 240 }}>
                <a className="nav-sub" href={qs({ tpl: null })}
                   aria-pressed={!tpl}>Bawaan (susunan lama)</a>
                {TEMPLATE_BAWAAN.map((t) => (
                  <a key={t.kode} className="nav-sub" href={qs({ tpl: t.kode })}
                     aria-pressed={tpl === t.kode}>
                    <span>{t.nama}</span><span className="nav-n">{t.kunci.length}</span>
                  </a>
                ))}
                <a className="nav-sub" href="/pesanan/template"
                   style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 8 }}>
                  Susun template sendiri…
                </a>
              </div>
            </details>
          )}
          {uang && <a className="btn btn-sm btn-primary" href={unduh()}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Ekspor Excel
          </a>}
        </div>
        <div className="card-body">
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={total} qs={qs}
                    aksi="/pesanan" cari={cari}
                    cariPlaceholder="Cari no. pesanan, no. resi, SKU, atau nama barang"
                    saring={{ s: status, toko, kadaluarsa, kurir,
                              per: perHalaman === 50 ? null : perHalaman }} />
          {rows.length
            ? <Pilihan pesanan={JSON.parse(JSON.stringify(rows))} tahap={kunci.length > 1 ? 'campuran' : kunci[0]} uang={uang} />
            : <Kosong judul={cari ? `Tidak ada yang cocok dengan "${cari}"` : `Tidak ada pesanan di "${s.label}"`}
                      anak={cari
                        ? 'Coba kata kunci lain, atau hapus pencariannya.'
                        : 'Tekan Sinkron di kanan atas untuk menarik pesanan terbaru dari Shopee.'} />}
          {rows.length > 0 && <Paginasi halaman={halaman} perHalaman={perHalaman} total={total}
                                        qs={qs} aksi="/pesanan" bawah />}
        </div>
      </div>
      </>}
    </Shell>
  );
}

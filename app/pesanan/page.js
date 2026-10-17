import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kosong, Catatan, Galat } from '../UI';
import { Pilihan } from './Aksi';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema, q } from '@/lib/db';
import { STATUS, TAHAP, TIPE_KIRIM, BASIS_WAKTU, URUT, cariStatus, cariTahap, terjemahLama,
         kunciStatus, cariBasis, waktuDari, hitungStatus, daftar,
         hitungKurir, hitungBaris, PER_HALAMAN, MARKETPLACE, kunciMp } from '@/lib/orders';
import FilterPesanan from './FilterPesanan';
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
  // Kunci lama (?s=baru, ?s=proses, …) diterjemahkan ke Perlu Dikirim + tahap.
  const lama = terjemahLama(searchParams?.s);
  // Status boleh lebih dari satu, dipisah koma: ?s=dikirim,selesai
  const kunci = kunciStatus(lama ? lama.s : (searchParams?.s || 'semua'));
  const status = kunci.length > 1 ? kunci : kunci[0];
  const statusParam = kunci.join(',');
  const tahap = cariTahap(searchParams?.tahap)?.key || lama?.tahap || null;
  const toko = searchParams?.toko || null;
  // Tab marketplace: satu saja, atau kosong = semua marketplace.
  const mpSaring = kunciMp(searchParams?.mp)[0] || null;
  const mpParam = mpSaring;
  const kadaluarsa = ['lewat', 'segera'].includes(searchParams?.kadaluarsa) ? searchParams.kadaluarsa : null;
  const kurir = searchParams?.kurir || null;
  const cari = searchParams?.cari || null;
  const cetak = ['sudah', 'belum'].includes(searchParams?.cetak) ? searchParams.cetak : null;
  const tipe = TIPE_KIRIM.some(([k]) => k === searchParams?.tipe) ? searchParams.tipe : null;
  const tpl = searchParams?.tpl || null;
  const urut = URUT.some((u) => u[0] === searchParams?.urut) ? searchParams.urut : 'batas';
  const arah = searchParams?.arah === 'naik' ? 'naik' : 'turun';
  const basis = cariBasis(searchParams?.w)[0];
  const kodeRentang = searchParams?.r || 'semua';
  const dari = searchParams?.dari || null;
  const sampai = searchParams?.sampai || null;
  const waktu = waktuDari({ w: basis, r: kodeRentang, dari, sampai });
  const perHalaman = PER_HALAMAN.includes(Number(searchParams?.per)) ? Number(searchParams.per) : 50;
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);
  const s = cariStatus(kunci[0]);
  const th = cariTahap(tahap);
  const saringan = { shopId: toko, kadaluarsa, kurir, cari, waktu, cetak, tipe, tahap, mp: mpSaring };

  let hitung = {}, rows = [], daftarToko = [], kurirList = [], total = 0, galat = null;
  try {
    await ensureSchema();
    [hitung, rows, daftarToko, kurirList, total] = await Promise.all([
      hitungStatus(saringan),
      daftar({ ...saringan, status, urut, arah, halaman, perHalaman }),
      // Toko dari dua marketplace, mengikuti saklar yang menyala.
      q(`SELECT * FROM (
           SELECT shop_id::text AS shop_id, shop_name, 'shopee' AS platform FROM shops
           UNION ALL
           SELECT shop_id, shop_name, 'tiktok' FROM tiktok_shops) t
         WHERE ($1::text IS NULL OR platform = $1)
         ORDER BY platform, shop_name NULLS LAST`, [mpSaring]),
      hitungKurir({ ...saringan, status }),
      hitungBaris({ ...saringan, status }),
    ]);
  } catch (e) {
    galat = { pesan: e.message, detail: [e.code && `kode: ${e.code}`, e.detail, e.hint,
              e.position && `posisi: ${e.position}`].filter(Boolean).join('\n') || null };
  }

  const qs = (ubah) => {
    const p = new URLSearchParams();
    const v = { s: statusParam, mp: mpParam, toko, kadaluarsa, kurir, cari, cetak, tipe, tahap, tpl,
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
    if (tipe) p.set('tipe', tipe);
    if (tahap) p.set('tahap', tahap);
    if (urut !== 'batas') p.set('urut', urut);
    if (arah !== 'turun') p.set('arah', arah);
    if (toko) p.set('toko', toko);
    if (mpSaring) p.set('mp', mpSaring);
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

  return (
    <Shell judul="Pesanan" rute="/pesanan" kanan={<AutoSegar detik={60} />}>
      {galat && <Galat judul="Halaman Pesanan gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {!galat && <>
      {Number(hitung.t_mintabatal) > 0 && tahap !== 'mintabatal' && (
        <div className="note" style={{ borderColor: 'var(--warn)', background: 'var(--warn-tint)' }}>
          <div>
            <b>{num(hitung.t_mintabatal)} pesanan sedang diminta batal pembeli.</b>{' '}
            Kalau tidak ditanggapi, Shopee biasanya menyetujuinya sendiri setelah batas waktu.{' '}
            <a href={qs({ s: 'batal', tahap: 'mintabatal', hal: null })}>Lihat daftarnya</a>.
          </div>
        </div>
      )}

      {Number(hitung.lewat) > 0 && (
        <Catatan>
          <b>{num(hitung.lewat)} pesanan sudah lewat batas waktu kirim.</b> Shopee bisa
          membatalkan pesanan dan menurunkan skor tokomu.
          {' '}<a href={qs({ kadaluarsa: 'lewat', s: 'perlu', tahap: null, hal: null })} style={{ textDecoration: 'underline' }}>
            Lihat daftarnya
          </a>.
        </Catatan>
      )}

      <GagalPack />

      <FilterPesanan
        awal={{ toko, cetak, tipe, tahap, kurir, kadaluarsa, w: basis, r: kodeRentang, dari, sampai,
                urut, arah, cari }}
        tetap={{ s: statusParam, mp: mpParam, tpl, per: perHalaman === 50 ? null : perHalaman }}
        marketplace={[[null, 'Semua marketplace'], ...MARKETPLACE]}
        opsiToko={[{ value: null, label: 'Semua toko' },
                   ...daftarToko.map((t) => ({ value: String(t.shop_id),
                     label: t.shop_name || `Toko ${t.shop_id}`,
                     sub: !mpSaring ? (t.platform === 'tiktok' ? 'TikTok' : 'Shopee') : null }))]}
        opsiKurir={[{ value: null, label: 'Semua ekspedisi' },
                    ...kurirList.map((k) => ({ value: k.kurir,
                      label: k.kurir === '(kosong)' ? 'Belum ditentukan' : k.kurir, n: k.jumlah }))]}
        hitung={hitung}
        statusList={STATUS.map(({ key, label, jelas }) => ({ key, label, jelas }))}
        kunci={kunci}
        tipeList={TIPE_KIRIM}
        tahapList={TAHAP.map((t) => ({ key: t.key, label: t.label, n: hitung['t_' + t.key] ?? 0 }))}
        basisList={BASIS_WAKTU.map(([k, l]) => [k, l])}
        rentangList={RENTANG_PESANAN}
        urutList={URUT.map(([k, l]) => [k, l])}
        labelWaktu={waktu?.label || null} />

      <div className="card">
        <div className="card-head">
          <h2>{kunci.length > 1
            ? kunci.map((k) => cariStatus(k).label).join(' + ')
            : s.label}{th ? ` · ${th.label}` : ''}</h2>
          <span className="badge b-mute">
            {th ? th.jelas : kunci.length > 1 ? 'Gabungan beberapa status' : s.jelas}
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
                    aksi="/pesanan" tanpaCari />
          {rows.some((o) => o.platform === 'tiktok') && kunci.includes('perlu') && (
            <Catatan>
              <b>Pesanan TikTok diproses dari sini juga.</b> Di <b>Perlu Dikirim</b>, centang pesanan yang belum diproses lalu tekan
              <b> Atur kirim TikTok</b> (setara Pack); tahapnya pindah ke <b>Sedang dikemas</b>, dan resinya
              dicetak dari sana. Satu tindakan hanya untuk satu marketplace — pilih tab <b>TikTok</b>
              atau <b>Shopee</b> di atas supaya tumpukan resinya tidak tercampur. Scan &amp; Kirim, Sisihkan,
              dan Tandai dikemas masih khusus Shopee.
            </Catatan>
          )}
          {rows.length
            ? <Pilihan pesanan={JSON.parse(JSON.stringify(rows))} uang={uang}
                       tahap={tahap && tahap !== 'mintabatal' ? tahap
                              : kunci.length > 1 ? 'campuran' : kunci[0]} />
            : <Kosong judul={cari ? `Tidak ada yang cocok dengan "${cari}"` : `Tidak ada pesanan di "${s.label}${th ? ' · ' + th.label : ''}"`}
                      anak={cari
                        ? 'Coba kata kunci lain, atau hapus pencariannya.'
                        : 'Tekan Sinkron di kanan atas untuk menarik pesanan terbaru.'} />}
          {rows.length > 0 && <Paginasi halaman={halaman} perHalaman={perHalaman} total={total}
                                        qs={qs} aksi="/pesanan" bawah />}
        </div>
      </div>
      </>}
    </Shell>
  );
}

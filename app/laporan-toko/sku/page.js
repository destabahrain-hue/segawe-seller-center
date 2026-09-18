import Shell from '../../Shell';
import AutoSegar from '../../AutoSegar';
import { Kpi, Kosong, Catatan } from '../../UI';
import RangePicker from '../../RangePicker';
import { ensureSchema, q } from '@/lib/db';
import { skuBocor, iklanPerToko, iklanPerSku, ringkasIklanItem } from '@/lib/report';
import { rentang } from '@/lib/rentang';
import { rp, num, pct } from '@/lib/fmt';
import { bolehUang, peranSekarang } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Rutenya di bawah /laporan-toko supaya izin peran ikut otomatis — siapa
 * pun yang boleh melihat Laporan Toko boleh melihat analisa ini.
 */

const JENIS = [
  ['bocor',  'Semua yang bocor'],
  ['rugi',   'Rugi'],
  ['tipis',  'Margin tipis'],
  ['buta',   'HPP belum ada'],
  ['sehat',  'Sehat'],
  ['semua',  'Semua SKU'],
];

const LENCANA = {
  rugi:  ['b-neg',  'Rugi'],
  tipis: ['b-warn', 'Margin tipis'],
  buta:  ['b-warn', 'HPP belum ada'],
  sehat: ['b-pos',  'Sehat'],
};

export default async function SkuBocor({ searchParams }) {
  await ensureSchema();
  const uang = bolehUang(await peranSekarang());

  const kode = searchParams?.r || '30h';
  const r = rentang(kode, searchParams?.dari || null, searchParams?.sampai || null);
  const toko = searchParams?.toko ? Number(searchParams.toko) : null;
  const saring = JENIS.some(([k]) => k === searchParams?.f) ? searchParams.f : 'bocor';
  const ambang = Math.min(Math.max(Number(searchParams?.ambang) || 10, 0), 90) / 100;

  const [mentah, iklan, perSku, rinci, tokoList] = await Promise.all([
    skuBocor({ ...r, shopId: toko, ambangTipis: ambang }),
    iklanPerToko({ ...r, shopId: toko }),
    iklanPerSku({ ...r, shopId: toko }),
    ringkasIklanItem({ ...r, shopId: toko }).catch(() => null),
    q(`SELECT shop_id, shop_name FROM shops WHERE status = 'active'
        ORDER BY shop_name NULLS LAST, shop_id`),
  ]);

  /**
   * Biaya iklan ditempelkan ke tiap SKU, lalu laba dan jenisnya DIHITUNG
   * ULANG di atasnya. Ini bagian yang menentukan: kalau iklannya cuma
   * ditampilkan sebagai kolom tambahan tanpa ikut mengubah laba, SKU yang
   * sebenarnya rugi karena iklan akan tetap berlencana "sehat" — persis
   * kesalahan diam yang paling ingin dihindari halaman ini.
   *
   * SKU tanpa HPP tetap dikecualikan dari penilaian. Selama modalnya belum
   * ada, menambahkan biaya iklan tidak membuat labanya jadi bermakna.
   */
  const semua = mentah.map((x) => {
    const iklanSku = perSku.perSku[`${x.shopId}|${x.code}`] || 0;
    const laba = x.laba - iklanSku;
    const margin = x.omzet ? laba / x.omzet : 0;
    const jenis = x.jenis === 'buta' ? 'buta'
      : laba < 0 ? 'rugi'
      : margin < ambang ? 'tipis'
      : 'sehat';
    return {
      ...x,
      iklanSku,
      labaSebelumIklan: x.laba,
      laba, margin, jenis,
      perUnit: x.unit ? laba / x.unit : 0,
    };
  });

  const hitung = {
    rugi:  semua.filter((x) => x.jenis === 'rugi').length,
    tipis: semua.filter((x) => x.jenis === 'tipis').length,
    buta:  semua.filter((x) => x.jenis === 'buta').length,
    sehat: semua.filter((x) => x.jenis === 'sehat').length,
  };
  hitung.bocor = hitung.rugi + hitung.tipis + hitung.buta;
  hitung.semua = semua.length;

  const baris = (saring === 'semua' ? semua
    : saring === 'bocor' ? semua.filter((x) => x.jenis !== 'sehat')
    : semua.filter((x) => x.jenis === saring))
    // Yang paling merugikan di atas. Untuk SKU tanpa HPP, labanya belum
    // bermakna — diurutkan menurut omzet supaya yang paling besar
    // dampaknya kalau ternyata rugi muncul lebih dulu.
    .sort((a, b) => (a.jenis === 'buta' && b.jenis === 'buta'
      ? b.omzet - a.omzet
      : a.laba - b.laba));

  const rugiTotal = semua.filter((x) => x.jenis === 'rugi')
    .reduce((n, x) => n + x.laba, 0);
  const omzetButa = semua.filter((x) => x.jenis === 'buta')
    .reduce((n, x) => n + x.omzet, 0);
  const iklanTotal = Object.values(iklan).reduce((a, b) => a + b, 0);

  /**
   * SKU tanpa HPP DIKELUARKAN dari total laba.
   *
   * Kalau ikut, labanya dihitung seolah modalnya nol — angka totalnya jadi
   * terlalu besar, dan itu tidak kelihatan salah. Ini persis jenis
   * kesalahan diam yang membuat margin di Laporan Toko sempat terlihat
   * 58,8% padahal seluruh HPP nol. Lebih baik totalnya jujur tidak lengkap
   * daripada lengkap tapi menipu.
   */
  const berhpp = semua.filter((x) => x.jenis !== 'buta');
  const labaSebelumIklan = berhpp.reduce((n, x) => n + x.labaSebelumIklan, 0);
  const iklanTerbebani = berhpp.reduce((n, x) => n + x.iklanSku, 0);
  const labaSetelahIklan = labaSebelumIklan - iklanTerbebani;

  /**
   * Selisih antara biaya iklan toko dan yang berhasil dibebankan ke SKU.
   * Ditampilkan apa adanya, tidak dibagi diam-diam ke produk — sebabnya
   * nyata semua: iklan yang tidak melekat ke produk, produk yang belum ada
   * di katalog, SKU tanpa HPP yang sengaja dikecualikan, dan hari berjalan
   * yang belanjanya masih bertambah saat diukur.
   */
  const iklanTerpetakan = Object.values(perSku.terpetakan).reduce((a, b) => a + b, 0);
  const iklanSisa = Math.max(iklanTotal - iklanTerpetakan, 0);
  const adaDataIklanSku = iklanTerpetakan > 0;
  // Dua keadaan yang tampak sama di layar tapi tindakannya beda: rinciannya
  // belum pernah ditarik, atau sudah ditarik tapi tidak ada yang menempel.
  const rinciTersimpan = Number(rinci?.pokok || 0) * (1 + 0.11);
  const rinciAdaTapiTakMenempel = Number(rinci?.baris || 0) > 0 && iklanTerpetakan <= 0;

  const qs = (ubah = {}) => {
    const v = { r: kode === '30h' ? null : kode, dari: r.awal, sampai: r.akhir,
                toko, f: saring === 'bocor' ? null : saring,
                ambang: ambang === 0.10 ? null : Math.round(ambang * 100), ...ubah };
    const u = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, String(x));
    const s = u.toString();
    return '/laporan-toko/sku' + (s ? '?' + s : '');
  };

  return (
    <Shell judul="SKU Bocor" rute="/laporan-toko"
           kanan={<><a className="btn btn-sm" href="/laporan-toko">Kembali ke Laporan</a>
                   <AutoSegar detik={300} /></>}>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Periode</div>
          <RangePicker aktif={kode} awal={r.awal || ''} akhir={r.akhir || ''} />
        </div>
        <div className="filter-row">
          <div className="filter-key">Toko</div>
          <div className="filter-vals">
            <a className="chip" href={qs({ toko: null })} aria-pressed={!toko}>Semua toko</a>
            {tokoList.map((t) => (
              <a key={t.shop_id} className="chip" href={qs({ toko: t.shop_id })}
                 aria-pressed={String(toko) === String(t.shop_id)}>
                {t.shop_name || `Toko ${t.shop_id}`}
              </a>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-key">Tampilkan</div>
          <div className="filter-vals">
            {JENIS.map(([k, label]) => (
              <a key={k} className="chip" href={qs({ f: k })} aria-pressed={saring === k}>
                {label}<span className="n">{num(hitung[k] ?? 0)}</span>
              </a>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-key">Ambang tipis</div>
          <div className="filter-vals">
            {[5, 10, 15, 20, 30].map((p) => (
              <a key={p} className="chip" href={qs({ ambang: p })}
                 aria-pressed={Math.round(ambang * 100) === p}>margin di bawah {p}%</a>
            ))}
          </div>
        </div>
      </div>

      {uang && (
        <div className="kpi-row">
          <Kpi label="SKU rugi" nilai={num(hitung.rugi)}
               warna={hitung.rugi ? 'var(--neg)' : undefined}
               sub={rugiTotal < 0 ? `menggerus ${rp(Math.abs(rugiTotal))}` : 'tidak ada'} />
          <Kpi label="Margin tipis" nilai={num(hitung.tipis)}
               warna={hitung.tipis ? 'var(--warn)' : undefined}
               sub={`di bawah ${Math.round(ambang * 100)}%`} />
          <Kpi label="HPP belum ada" nilai={num(hitung.buta)}
               warna={hitung.buta ? 'var(--warn)' : undefined}
               sub={omzetButa ? `omzet ${rp(omzetButa)} belum terhitung` : 'semua sudah ber-HPP'} />
          <Kpi label={adaDataIklanSku ? 'Laba setelah iklan' : 'Laba sebelum iklan'}
               nilai={rp(adaDataIklanSku ? labaSetelahIklan : labaSebelumIklan)}
               warna={(adaDataIklanSku ? labaSetelahIklan : labaSebelumIklan) < 0
                        ? 'var(--neg)' : undefined}
               sub={[
                 hitung.buta ? `${hitung.buta} SKU tanpa HPP tidak dihitung` : null,
                 adaDataIklanSku ? `iklan ${rp(iklanTerbebani)} sudah dikurangkan`
                   : iklanTotal ? `beban iklan ${rp(iklanTotal)} BELUM dikurangkan` : null,
               ].filter(Boolean).join(' · ') || 'belum ada data iklan'} />
        </div>
      )}

      <Catatan>
        {adaDataIklanSku ? (
          <>
            <b>Biaya iklan di tabel ini nyata milik produknya</b>, bukan pembagian rata dari
            total toko — Shopee memberi biaya per produk untuk Iklan Individual maupun Iklan
            Produk Otomatis. Dari <b>{rp(iklanTotal)}</b> belanja iklan periode ini,{' '}
            <b>{rp(iklanTerpetakan)}</b> berhasil dibebankan ke SKU.
            {iklanSisa > 0 && (
              <> Sisa <b>{rp(iklanSisa)}</b> sengaja TIDAK dibagi: itu iklan yang tidak melekat
                ke produk, produk yang belum ada di katalog, dan belanja hari berjalan yang
                masih bertambah. Jadi laba total di atas masih sedikit lebih tinggi dari
                kenyataan.</>
            )}
          </>
        ) : (
          rinciAdaTapiTakMenempel ? (
          <>
            <b>Rincian biaya iklan sudah tersimpan ({rp(rinciTersimpan)}), tapi tidak ada satu
            pun yang menempel ke SKU di tabel ini.</b> Penyebab yang paling mungkin: produk
            yang diiklankan tidak terjual sama sekali pada periode ini, jadi tidak punya baris
            pesanan untuk ditempeli. Coba perlebar periodenya. Kalau tetap kosong padahal
            produknya jelas laku, berarti pemetaannya yang bermasalah dan perlu diperiksa.
          </>
          ) : (
          <>
            <b>Biaya iklan per produk belum pernah ditarik</b>, jadi laba di tabel ini masih
            laba <b>sebelum</b> iklan.
            {iklanTotal ? <> Beban iklan toko sebesar <b>{rp(iklanTotal)}</b> pada periode ini
              belum dikurangkan.</> : ' '} Tarik dulu lewat tombol di halaman Laporan Toko.
          </>
          )
        )}
      </Catatan>

      <div className="card">
        <div className="card-head">
          <h2>{JENIS.find(([k]) => k === saring)?.[1]}</h2>
          <span className="badge b-mute">{num(baris.length)} SKU</span>
        </div>

        {!baris.length ? (
          <div className="card-body">
            <Kosong judul={semua.length ? 'Tidak ada SKU di kelompok ini'
                            : 'Belum ada penjualan pada periode ini'}
                    anak={semua.length ? 'Bagus — coba kelompok lain di atas.'
                            : 'Coba perlebar periodenya.'} />
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th style={{ width: 52 }}></th>
                <th>SKU</th>
                {!toko && <th>Toko</th>}
                <th className="t-right">Terjual</th>
                {uang && <><th className="t-right">Omzet</th>
                <th className="t-right">HPP</th>
                <th className="t-right">Biaya platform</th>
                <th className="t-right">Iklan</th>
                <th className="t-right">
                  {adaDataIklanSku ? 'Laba setelah iklan' : 'Laba sebelum iklan'}
                </th>
                <th className="t-right">Margin</th>
                <th className="t-right">Per unit</th></>}
                <th>Keadaan</th>
              </tr></thead>
              <tbody>
                {baris.map((x) => {
                  const [kelas, teks] = LENCANA[x.jenis] || LENCANA.sehat;
                  return (
                    <tr key={`${x.shopId}-${x.code}`}>
                      <td>
                        {x.gambar
                          ? <img src={x.gambar} alt="" width={40} height={40} loading="lazy"
                                 style={{ borderRadius: 6, objectFit: 'cover',
                                          border: '1px solid var(--line)' }} />
                          : <div style={{ width: 40, height: 40, borderRadius: 6,
                                          background: 'var(--surface-sunken)',
                                          border: '1px solid var(--line)' }} />}
                      </td>
                      <td>
                        <div className="tt">{x.name}</div>
                        <div className="st mono">{x.code}</div>
                        {!x.tertaut && (
                          <span className="badge b-warn">belum tertaut Master SKU</span>
                        )}
                      </td>
                      {!toko && <td className="t-mute">{x.toko}</td>}
                      <td className="t-num">{num(x.unit)}</td>
                      {uang && <>
                        <td className="t-num">{rp(x.omzet)}</td>
                        <td className="t-num t-mute">{x.hpp > 0 ? rp(x.hpp) : '—'}</td>
                        <td className="t-num t-mute">{rp(x.biaya)}</td>
                        <td className="t-num t-mute">
                          {x.iklanSku > 0 ? rp(x.iklanSku) : '—'}
                        </td>
                        <td className="t-num t-strong"
                            style={x.laba < 0 ? { color: 'var(--neg)' } : undefined}>
                          {x.jenis === 'buta' ? <span className="t-mute">belum bermakna</span>
                            : rp(x.laba)}
                        </td>
                        <td className="t-num"
                            style={x.laba < 0 ? { color: 'var(--neg)' } : undefined}>
                          {x.jenis === 'buta' ? '—' : pct(x.margin * 100)}
                        </td>
                        <td className="t-num"
                            style={x.perUnit < 0 ? { color: 'var(--neg)' } : undefined}>
                          {x.jenis === 'buta' ? '—' : rp(x.perUnit)}
                        </td>
                      </>}
                      <td><span className={'badge ' + kelas}>{teks}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

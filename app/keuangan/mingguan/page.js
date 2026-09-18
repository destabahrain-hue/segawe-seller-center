import Shell from '../../Shell';
import { Kosong, Catatan, Galat } from '../../UI';
import AutoSegar from '../../AutoSegar';
import TarikRiwayatDana from './TarikRiwayatDana';
import { ensureSchema } from '@/lib/db';
import { ringkasMinggu, perSkuMinggu, daftarMinggu, belumCair, PPN_IKLAN } from '@/lib/mingguan';
import { rp, num, pct } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const tglMinggu = (senin) => {
  const a = new Date(`${senin}T00:00:00+07:00`);
  const b = new Date(a); b.setDate(b.getDate() + 6);
  const f = (d) => d.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short' });
  return `${f(a)} – ${f(b)} ${b.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric' })}`;
};

export default async function Mingguan({ searchParams }) {
  let minggu = [], data = null, perSku = [], sisa = null, galat = null;
  const toko = searchParams?.toko || null;
  let dipilih = searchParams?.m || null;

  try {
    await ensureSchema();
    // sisa dihitung TERPISAH dari minggu. Dulu ia ikut di dalam blok
    // `if (dipilih)`, jadi saat laporan kosong — saat penjelasannya paling
    // dibutuhkan — layar justru tidak menampilkan apa-apa.
    [minggu, sisa] = await Promise.all([daftarMinggu(), belumCair()]);
    dipilih = dipilih || minggu[0]?.senin || null;
    if (dipilih) {
      [data, perSku] = await Promise.all([
        ringkasMinggu(dipilih),
        perSkuMinggu(dipilih, toko),
      ]);
    }
  } catch (e) {
    galat = { pesan: e.message, detail: e.code ? `kode: ${e.code}` : null };
  }

  const qs = (u) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ m: dipilih, toko, ...u })) if (v) p.set(k, v);
    return '/mingguan?' + p.toString();
  };

  return (
    <Shell judul="Laporan Mingguan" rute="/keuangan" kanan={<AutoSegar detik={180} />}>
      {galat && <Galat judul="Laporan mingguan gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {!galat && (
        <>
          <Catatan>
            <b>Minggu dihitung dari tanggal dana dilepas Shopee</b>, bukan tanggal pesanan —
            sama seperti laporan bulananmu. Penjualan = uang yang benar-benar diterima.
            Biaya iklan sudah termasuk PPN {Math.round(PPN_IKLAN * 100)}%.
            {sisa?.jumlah > 0 && (
              <> Saat ini <b>{num(sisa.jumlah)} pesanan</b> belum punya tanggal pencairan,
                jadi belum masuk laporan minggu mana pun. Pesanan lama yang ditarik sebelum
                fitur ini ada perlu ditarik ulang — penjadwal mengerjakannya bertahap
                (sekitar 150 pesanan tiap 5 menit), atau tekan tombol di bawah untuk mempercepat.</>
            )}
          </Catatan>

          {sisa?.jumlah > 0 && <TarikRiwayatDana jumlah={sisa.jumlah} />}

          {!minggu.length ? (
            <Kosong judul="Belum ada pesanan yang dananya cair"
                    anak={sisa?.jumlah > 0
                      ? `Tanggal pencairan ${num(sisa.jumlah)} pesanan belum ditarik dari Shopee. `
                        + 'Tekan tombol di atas untuk mempercepat, atau biarkan penjadwal '
                        + 'mengerjakannya bertahap tiap beberapa menit.'
                      : 'Laporan terisi setelah Shopee melepas dana pesanan dan aplikasi menariknya. Tekan Sinkron, lalu tunggu beberapa putaran.'} />
          ) : (
            <>
              <div className="filter-bar">
                <div className="filter-row">
                  <div className="filter-key">Minggu</div>
                  <div className="filter-vals">
                    {minggu.slice(0, 12).map((w) => (
                      <a key={w.senin} className="chip" href={qs({ m: w.senin })}
                         aria-pressed={dipilih === w.senin}>
                        {tglMinggu(w.senin)} <span className="n">{num(w.pesanan)}</span>
                      </a>
                    ))}
                  </div>
                </div>
                {data?.toko.length > 1 && (
                  <div className="filter-row">
                    <div className="filter-key">Toko</div>
                    <div className="filter-vals">
                      <a className="chip" href={qs({ toko: null })} aria-pressed={!toko}>Semua toko</a>
                      {data.toko.map((t) => (
                        <a key={t.shopId} className="chip" href={qs({ toko: t.shopId })}
                           aria-pressed={toko === t.shopId}>{t.nama}</a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="kpi-row">
                <div className="kpi"><div className="k">Penjualan (uang masuk)</div>
                  <div className="v num">{rp(data.total.penjualan)}</div>
                  <div className="d">{num(data.total.pesanan)} pesanan cair</div></div>
                <div className="kpi"><div className="k">Laba kotor</div>
                  <div className="v num">{rp(data.total.labaKotor)}</div>
                  <div className="d">margin {pct(data.total.marginKotor)}</div></div>
                <div className="kpi"><div className="k">Biaya iklan</div>
                  <div className="v num">{rp(data.total.iklan)}</div>
                  <div className="d">termasuk PPN {rp(data.total.ppn)}</div></div>
                <div className="kpi"><div className="k">Laba bersih</div>
                  <div className="v num" style={{ color: data.total.laba < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                    {rp(data.total.laba)}</div>
                  <div className="d">margin {pct(data.total.marginBersih)}</div></div>
              </div>

              <div className="card" style={{ marginBottom: 'var(--s4)' }}>
                <div className="card-head">
                  <h2>Laba rugi per toko</h2>
                  <span className="badge b-mute">{tglMinggu(dipilih)}</span>
                  <div className="spacer" style={{ flex: 1 }} />
                  <a className="btn btn-sm btn-primary"
                     href={`/api/mingguan?m=${dipilih}${toko ? `&toko=${toko}` : ''}`}>Unduh Excel</a>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr>
                      <th>Toko</th><th className="t-right">Pesanan</th>
                      <th className="t-right">Penjualan</th><th className="t-right">HPP</th>
                      <th className="t-right">Laba kotor</th><th className="t-right">Iklan + PPN</th>
                      <th className="t-right">Laba bersih</th><th className="t-right">Margin</th>
                    </tr></thead>
                    <tbody>
                      {data.toko.map((t) => (
                        <tr key={t.shopId}>
                          <td className="t-strong">{t.nama}
                            {t.barisTanpaHpp > 0 && (
                              <div className="st"><span className="badge b-warn">
                                {num(t.barisTanpaHpp)} baris tanpa HPP</span></div>
                            )}
                          </td>
                          <td className="t-num">{num(t.pesanan)}</td>
                          <td className="t-num t-strong">{rp(t.penjualan)}</td>
                          <td className="t-num">{rp(t.hpp)}</td>
                          <td className="t-num">{rp(t.labaKotor)}</td>
                          <td className="t-num">{rp(t.iklan)}</td>
                          <td className="t-num t-strong"
                              style={{ color: t.laba < 0 ? 'var(--neg)' : undefined }}>{rp(t.laba)}</td>
                          <td className="t-num">{pct(t.marginBersih)}</td>
                        </tr>
                      ))}
                      {data.toko.length > 1 && (
                        <tr style={{ fontWeight: 600, borderTop: '2px solid var(--line-strong)' }}>
                          <td>Total {data.toko.length} toko</td>
                          <td className="t-num">{num(data.total.pesanan)}</td>
                          <td className="t-num">{rp(data.total.penjualan)}</td>
                          <td className="t-num">{rp(data.total.hpp)}</td>
                          <td className="t-num">{rp(data.total.labaKotor)}</td>
                          <td className="t-num">{rp(data.total.iklan)}</td>
                          <td className="t-num">{rp(data.total.laba)}</td>
                          <td className="t-num">{pct(data.total.marginBersih)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h2>Rekap per SKU</h2>
                  <span className="badge b-mute">{num(perSku.length)} SKU</span>
                  <div className="spacer" style={{ flex: 1 }} />
                  <span className="t-mute" style={{ fontSize: 12 }}>
                    Uang masuk dibagi proporsional untuk pesanan multi-SKU
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr>
                      <th>SKU</th><th className="t-right">Qty</th>
                      <th className="t-right">Uang masuk</th><th className="t-right">HPP</th>
                      <th className="t-right">Margin</th><th className="t-right">Margin %</th>
                    </tr></thead>
                    <tbody>
                      {perSku.map((s) => {
                        const uang = Number(s.uang_masuk) || 0;
                        const hpp = Number(s.hpp) || 0;
                        const m = uang - hpp;
                        return (
                          <tr key={s.sku}>
                            <td><div className="tt">{s.nama || s.sku}</div>
                              <div className="st mono">{s.sku}
                                {!s.tertaut && <span className="badge b-warn" style={{ marginLeft: 6 }}>belum tertaut</span>}
                                {s.ada_tanpa_hpp && <span className="badge b-warn" style={{ marginLeft: 6 }}>HPP kosong</span>}
                              </div></td>
                            <td className="t-num">{num(s.qty)}</td>
                            <td className="t-num t-strong">{rp(uang)}</td>
                            <td className="t-num">{rp(hpp)}</td>
                            <td className="t-num" style={{ color: m < 0 ? 'var(--neg)' : undefined }}>{rp(m)}</td>
                            <td className="t-num">{uang ? pct((m / uang) * 100) : '—'}</td>
                          </tr>
                        );
                      })}
                      {!perSku.length && <tr><td colSpan={6} className="t-mute">
                        Belum ada penjualan yang dananya cair di minggu ini.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Shell>
  );
}

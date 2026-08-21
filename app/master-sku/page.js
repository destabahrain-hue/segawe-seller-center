import Shell from '../Shell';
import { Catatan, Kosong } from '../UI';
import { HppInput, TambahMaster, Tautkan, HapusMaster, LepasTaut, AutoMap } from './Editor';
import PilihMassal from './PilihMassal';
import Paginasi, { PER_HALAMAN, bacaPer } from '../Paginasi';
import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema, q } from '@/lib/db';
import { rp, num, tgl } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function MasterSku({ searchParams }) {
  await ensureSchema();
  const uang = bolehUang(await peranSekarang());
  const jenis = ['tunggal', 'paket'].includes(searchParams?.j) ? searchParams.j : 'semua';
  const cari = (searchParams?.cari || '').trim() || null;
  const perHalaman = bacaPer(searchParams?.per);
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);
  const lewati = (halaman - 1) * perHalaman;

  // Penyaringan pindah ke SQL. Dulu seluruh Master SKU ditarik lalu disaring
  // di JavaScript — begitu jumlahnya ribuan, halamannya berat dan paginasi
  // tidak mungkin benar.
  const w = ['TRUE'];
  const pr = [];
  if (jenis !== 'semua') {
    pr.push(jenis);
    w.push(jenis === 'paket' ? `ms.kind = $${pr.length}` : `ms.kind <> 'paket' AND $${pr.length} = 'tunggal'`);
  }
  if (cari) {
    pr.push(`%${cari}%`);
    w.push(`(ms.code ILIKE $${pr.length} OR ms.name ILIKE $${pr.length})`);
  }
  const where = w.join(' AND ');

  const [master, jumlah, hitungJenis, ringkasSemua, komponen, belum, sudah, tokoAktif] = await Promise.all([
    q(`SELECT ms.*, img.url AS gambar,
              (SELECT h.hpp FROM master_sku_hpp h WHERE h.master_sku_id = ms.id
                ORDER BY h.effective_from DESC LIMIT 1) AS hpp,
              (SELECT h.effective_from FROM master_sku_hpp h WHERE h.master_sku_id = ms.id
                ORDER BY h.effective_from DESC LIMIT 1) AS berlaku,
              (SELECT COUNT(*) FROM sku_mapping m WHERE m.master_sku_id = ms.id) AS tertaut,
              (SELECT COUNT(*) FROM master_sku_component c WHERE c.child_id = ms.id) AS jadi_komponen
       FROM master_sku ms
       LEFT JOIN LATERAL (
         SELECT COALESCE(p.image_url, oi.image_url) AS url
         FROM sku_mapping sm
         LEFT JOIN products p ON p.shop_id = sm.shop_id
              AND NULLIF(TRIM(p.item_sku),'') = sm.shop_sku
         LEFT JOIN order_items oi ON NULLIF(TRIM(oi.item_sku),'') = sm.shop_sku
         WHERE sm.master_sku_id = ms.id
           AND COALESCE(p.image_url, oi.image_url) IS NOT NULL
         LIMIT 1) img ON TRUE
       WHERE ${where}
       ORDER BY ms.kind, ms.name
       LIMIT ${perHalaman} OFFSET ${lewati}`, pr),

    q(`SELECT COUNT(*)::int AS n FROM master_sku ms WHERE ${where}`, pr),

    // Angka di chip jenis harus menghitung SELURUH data, bukan halaman ini.
    q(`SELECT COUNT(*) FILTER (WHERE kind <> 'paket')::int AS tunggal,
              COUNT(*) FILTER (WHERE kind =  'paket')::int AS paket,
              COUNT(*)::int AS semua
         FROM master_sku`),

    // Daftar ringkas untuk pemilih isi paket — harus SEMUA SKU, bukan hanya
    // yang tampil di halaman ini, kalau tidak isian paket jadi tidak lengkap.
    q(`SELECT id, code, name, kind FROM master_sku ORDER BY kind, name`),
    q(`SELECT c.parent_id, c.qty, ms.id, ms.code, ms.name,
              (SELECT h.hpp FROM master_sku_hpp h WHERE h.master_sku_id = ms.id
                ORDER BY h.effective_from DESC LIMIT 1) AS hpp
       FROM master_sku_component c JOIN master_sku ms ON ms.id = c.child_id`),
    q(`
       SELECT shop_id, shop_name, sku FROM (
         SELECT o.shop_id, s.shop_name, COALESCE(oi.model_sku, oi.item_sku) AS sku
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN shops s ON s.shop_id = o.shop_id
         UNION
         SELECT p.shop_id, s2.shop_name,
                COALESCE(NULLIF(TRIM(pm.model_sku),''), NULLIF(TRIM(p.item_sku),'')) AS sku
         FROM products p
         LEFT JOIN product_models pm ON pm.product_id = p.id
         LEFT JOIN shops s2 ON s2.shop_id = p.shop_id
       ) g
       WHERE NULLIF(TRIM(g.sku),'') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM sku_mapping m
           WHERE m.shop_id = g.shop_id AND m.shop_sku = g.sku AND m.master_sku_id IS NOT NULL)
       GROUP BY shop_id, shop_name, sku
       ORDER BY shop_name NULLS LAST, sku
       LIMIT 300`),
    q(`SELECT m.shop_id, m.shop_sku, m.auto_linked, m.master_sku_id, s.shop_name, ms.code, ms.name
       FROM sku_mapping m
       LEFT JOIN shops s ON s.shop_id = m.shop_id
       LEFT JOIN master_sku ms ON ms.id = m.master_sku_id
       WHERE m.master_sku_id IS NOT NULL
       ORDER BY s.shop_name NULLS LAST, m.shop_sku LIMIT 300`),
    q(`SELECT shop_id, shop_name FROM shops WHERE status = 'active'
       ORDER BY shop_name NULLS LAST, shop_id`),
  ]);

  // ── Usulan pencocokan ──
  // Penautan otomatis hanya berani menyamakan yang identik setelah dinormalkan.
  // Sisanya ditebak di sini: kemiripan kata, ditampilkan sebagai saran yang
  // masih harus kamu setujui — bukan langsung ditautkan.
  const bersih = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const kata = (x) => bersih(x).split(' ').filter((w) => w.length > 1);

  function skor(a, b) {
    const A = kata(a), B = kata(b);
    if (!A.length || !B.length) return 0;
    const setB = new Set(B);
    const sama = A.filter((w) => setB.has(w)).length;
    const jaccard = sama / (new Set([...A, ...B]).size);
    const rapat = bersih(a).replace(/ /g, ''), rapatB = bersih(b).replace(/ /g, '');
    const memuat = rapat.includes(rapatB) || rapatB.includes(rapat) ? 0.35 : 0;
    return jaccard + memuat;
  }

  function tebak(sku) {
    let terbaik = null, nilai = 0;
    for (const m of master) {
      const n = Math.max(skor(sku, m.code), skor(sku, m.name) * 0.9);
      if (n > nilai) { nilai = n; terbaik = m; }
    }
    return nilai >= 0.45 ? { id: String(terbaik.id), code: terbaik.code, nilai } : null;
  }

  const tautanUntuk = (id) => sudah.filter((x) => String(x.master_sku_id) === String(id));
  // Diambil dari tabel toko, BUKAN dari tabel penautan — kalau dari penautan,
  // toko yang belum punya satu pun tautan justru tidak pernah terhitung
  // sebagai "belum ada", padahal itu justru yang perlu diketahui.
  const semuaToko = tokoAktif.map((t) => ({
    id: String(t.shop_id), nama: t.shop_name || `Toko ${t.shop_id}`,
  }));

  const isiPaket = (id) => komponen.filter((c) => String(c.parent_id) === String(id));
  const ringkas = ringkasSemua;
  const total = jumlah[0]?.n || 0;
  const hj = hitungJenis[0] || { tunggal: 0, paket: 0, semua: 0 };

  const qs = (ubah = {}) => {
    const v = { j: jenis === 'semua' ? null : jenis, cari,
                per: perHalaman === 50 ? null : perHalaman,
                hal: halaman === 1 ? null : halaman, ...ubah };
    const p = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, String(x));
    const s = p.toString();
    return '/master-sku' + (s ? '?' + s : '');
  };

  return (
    <Shell judul="Master SKU" rute="/master-sku">
      {belum.length > 0 && (
        <Catatan>
          <b>{belum.length} SKU toko belum tertaut.</b> Selama belum tertaut, HPP-nya dihitung nol
          dan laba jadi terlalu tinggi. Tautkan di tabel bawah — cukup sekali per SKU.
        </Catatan>
      )}

      <div className="form-row" style={{ marginBottom: 'var(--s4)' }}>
        <div className="form-row" style={{ marginBottom: 'var(--s4)' }}>
        <AutoMap />
      </div>

      {(() => {
        const tab = [
          ['semua',   'Semua',       hj.semua],
          ['tunggal', 'SKU tunggal', hj.tunggal],
          ['paket',   'SKU paket',   hj.paket],
        ];
        return (
          <div className="filter-bar">
            <div className="filter-row">
              <div className="filter-key">Jenis</div>
              <div className="filter-vals">
                {tab.map(([k, label, jml]) => (
                  <a key={k} className="chip" href={qs({ j: k === 'semua' ? null : k, hal: null })}
                     aria-pressed={jenis === k}>{label} <span className="n">{num(jml)}</span></a>
                ))}
              </div>
            </div>
            <div className="filter-row">
              <div className="filter-key">Arti</div>
              <div className="filter-vals">
                <span className="t-mute" style={{ fontSize: 12.5 }}>
                  <b>Tunggal</b> = barang yang dijual satuan.{' '}
                  <b>Paket</b> = bundling; stoknya tidak disimpan sendiri, melainkan
                  dipotong dari SKU tunggal di dalamnya.
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      <TambahMaster />
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head">
          <h2>Master SKU</h2>
          <span className="badge b-mute">HPP diisi sekali di sini, berlaku untuk semua toko</span>
        </div>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={total} qs={qs}
                    aksi="/master-sku" cari={cari}
                    cariPlaceholder="Cari kode atau nama Master SKU"
                    saring={{ j: jenis === 'semua' ? null : jenis,
                              per: perHalaman === 50 ? null : perHalaman }} />
          <PilihMassal />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th style={{ width: 34 }}>
                {/* Kotak "pilih semua" hanya mencakup HALAMAN INI. Mencakup
                    seluruh data akan membuat orang menghapus ribuan baris
                    yang tidak pernah dilihatnya. */}
                <input type="checkbox" id="pilih-semua-halaman" aria-label="Pilih semua di halaman ini" />
              </th>
              <th style={{ width: 56 }}></th>
              <th>Master SKU</th><th>Tipe</th><th className="t-right">SKU tertaut</th>
              {uang && <><th className="t-right">HPP berlaku</th><th>Mulai berlaku</th></>}<th>Isi paket</th>
              <th style={{ width: 120 }}></th>
            </tr></thead>
            <tbody>
              {master.map((m) => {
                const isi = isiPaket(m.id);
                const hppPaket = isi.reduce((a, c) => a + Number(c.hpp || 0) * c.qty, 0);
                return (
                  <tr key={m.id}>
                    <td>
                      <input type="checkbox" name="pilih-sku" value={m.id}
                             data-kode={m.code} aria-label={`Pilih ${m.code}`} />
                    </td>
                    <td>
                      {m.gambar
                        ? <img src={m.gambar} alt="" width={40} height={40} loading="lazy"
                               style={{ width: 40, height: 40, objectFit: 'cover', display: 'block',
                                        borderRadius: 'var(--r-sm)', border: '1px solid var(--line)',
                                        background: 'var(--surface-sunken)' }} />
                        : <span className="thumb" style={{ width: 40, height: 40 }}>
                            {String(m.code || '?').slice(0, 3).toUpperCase()}</span>}
                    </td>
                    <td>
                      <a href={`/master-sku/${m.id}`} style={{ textDecoration: 'none' }}>
                        <div className="tt" style={{ color: 'var(--brand)' }}>{m.name}</div>
                        <div className="st mono">{m.code}</div>
                      </a>
                    </td>
                    <td>
                      <span className={'badge ' + (m.kind === 'paket' ? 'b-info' : 'b-mute')}>
                        {m.kind === 'paket' ? 'Bundling' : 'Tunggal'}
                      </span>
                      {Number(m.jadi_komponen) > 0 && (
                        <div className="st">isi dari {num(m.jadi_komponen)} paket</div>
                      )}
                    </td>
                    <td className="t-num">
                      {Number(m.tertaut) === 0
                        ? <span className="t-mute">0</span>
                        : (() => {
                            const daftar = tautanUntuk(m.id);
                            const punya = new Set(daftar.map((d) => String(d.shop_id)));
                            const kurang = semuaToko.filter((t) => !punya.has(t.id));
                            return (
                              <details style={{ textAlign: 'left' }}>
                                <summary style={{ cursor: 'pointer', textAlign: 'right',
                                                  listStyle: 'none', fontWeight: 600 }}
                                         title="Klik untuk melihat SKU mana saja">
                                  {num(m.tertaut)} <span className="t-mute" style={{ fontWeight: 400 }}>lihat</span>
                                </summary>
                                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column',
                                              gap: 6, minWidth: 260 }}>
                                  {daftar.map((d, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center',
                                                          gap: 8, flexWrap: 'wrap' }}>
                                      <span className="st" style={{ margin: 0, minWidth: 110 }}>
                                        {d.shop_name || `Toko ${d.shop_id}`}
                                      </span>
                                      <span className="mono">{d.shop_sku}</span>
                                      <span className={'badge ' + (d.auto_linked ? 'b-mute' : 'b-info')}>
                                        {d.auto_linked ? 'otomatis' : 'manual'}
                                      </span>
                                      <LepasTaut shopId={d.shop_id} shopSku={d.shop_sku} />
                                    </div>
                                  ))}
                                  {kurang.length > 0 && (
                                    <div className="t-mute" style={{ fontSize: 11.5, marginTop: 2 }}>
                                      Belum ada di: {kurang.map((t) => t.nama).join(', ')}
                                    </div>
                                  )}
                                </div>
                              </details>
                            );
                          })()}
                    </td>
                    {uang && <>
                      <td className="t-right">
                        {m.kind === 'paket'
                          ? <span className="hpp-auto num">{rp(hppPaket)}</span>
                          : <HppInput id={m.id} awal={m.hpp ? Math.round(m.hpp) : ''} />}
                      </td>
                      <td className="t-mute">{m.kind === 'paket' ? 'dihitung otomatis' : tgl(m.berlaku)}</td>
                    </>}
                    <td>
                      {m.kind === 'paket' ? (
                        <>
                          {isi.map((c) => (
                            <div key={c.id} className="st">{c.code} × {c.qty}</div>
                          ))}
                          <a className="btn btn-sm" href={`/master-sku/${m.id}`}>Atur isi paket</a>
                        </>
                      ) : <span className="t-mute">—</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <a className="btn btn-sm" href={`/master-sku/${m.id}`}>Buka</a>
                        <HapusMaster id={m.id} kode={m.code} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!master.length && <tr><td colSpan={uang ? 8 : 6}>
                <Kosong judul="Belum ada Master SKU"
                        anak="Buat Master SKU dulu, lalu tautkan SKU dari tiap toko ke sini supaya HPP cukup diisi sekali." />
              </td></tr>}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <Paginasi halaman={halaman} perHalaman={perHalaman} total={total} qs={qs}
                      aksi="/master-sku" bawah />
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>SKU toko belum tertaut</h2>
          <span className="badge b-mute">{belum.length} SKU</span>
          <div className="spacer" />
          <span className="t-mute" style={{ fontSize: 12 }}>
            Daripada satu per satu, pakai <b>Petakan otomatis</b> di atas.
          </span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Toko</th><th>SKU di toko</th><th>Usulan</th><th style={{ width: 200 }}>Tautkan ke</th></tr></thead>
            <tbody>
              {belum.map((b, i) => {
                const u = tebak(b.sku);
                return (
                  <tr key={i}>
                    <td className="t-strong">{b.shop_name || `Toko ${b.shop_id}`}</td>
                    <td className="mono">{b.sku}</td>
                    <td>
                      {u
                        ? <Tautkan shopId={b.shop_id} shopSku={b.sku} semua={ringkas}
                                   usul={{ id: u.id, code: u.code }} />
                        : <span className="t-mute" style={{ fontSize: 12 }}>tidak ada yang mirip</span>}
                    </td>
                    <td><Tautkan shopId={b.shop_id} shopSku={b.sku} semua={ringkas} /></td>
                  </tr>
                );
              })}
              {!belum.length && <tr><td colSpan={4} className="t-mute">Semua SKU sudah tertaut. Bagus.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>SKU toko yang sudah tertaut</h2>
          <div className="spacer" /><span className="badge b-mute">{sudah.length} tautan</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Toko</th><th>SKU di toko</th><th>Tertaut ke</th><th>Cara</th><th style={{ width: 90 }}></th>
            </tr></thead>
            <tbody>
              {sudah.map((s, i) => (
                <tr key={i}>
                  <td className="t-strong">{s.shop_name || `Toko ${s.shop_id}`}</td>
                  <td className="mono">{s.shop_sku}</td>
                  <td>{s.code ? <><span className="t-strong">{s.code}</span> <span className="t-mute">{s.name}</span></> : <span className="t-mute">—</span>}</td>
                  <td><span className={'badge ' + (s.auto_linked ? 'b-mute' : 'b-info')}>
                    {s.auto_linked ? 'otomatis' : 'manual'}</span></td>
                  <td><LepasTaut shopId={s.shop_id} shopSku={s.shop_sku} /></td>
                </tr>
              ))}
              {!sudah.length && <tr><td colSpan={5} className="t-mute">Belum ada SKU toko yang tertaut.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

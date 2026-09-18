import Shell from '../../Shell';
import AutoSegar from '../../AutoSegar';
import { Kpi, Kosong } from '../../UI';
import Paginasi, { bacaPer } from '../../Paginasi';
import TarikRetur from './TarikRetur';
import { ensureSchema, q } from '@/lib/db';
import { ringkasRetur } from '@/lib/retur';
import { rp, num, jam } from '@/lib/fmt';
import { bolehUang, peranSekarang } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Rutenya di bawah /pesanan supaya izin peran ikut otomatis — siapa pun
 * yang boleh membuka Pesanan boleh membuka purna jual.
 *
 * Halaman ini BACA SAJA. Tombol setuju/sanggah sengaja belum ada:
 * menyetujui retur berarti uang kembali ke pembeli dan tidak bisa
 * dibatalkan, jadi dibangun terpisah setelah bentuk datanya terbukti.
 */

/** Alasan retur dari Shopee ditulis dalam kode; ini terjemahannya. */
const ALASAN = {
  NONE: 'Tidak disebutkan',
  NOT_RECEIPT: 'Barang tidak diterima',
  WRONG_ITEM: 'Barang salah kirim',
  ITEM_DAMAGED: 'Barang rusak',
  DIFF_DESC: 'Tidak sesuai deskripsi',
  MUTUAL_AGREE: 'Kesepakatan bersama',
  PHYSICAL_DMG: 'Kerusakan fisik',
  FUNCTIONAL_DMG: 'Tidak berfungsi',
  ITEM_NOT_RECEIVED: 'Barang tidak diterima',
  ITEM_WRONG_DAMAGED: 'Barang salah / rusak',
  CHANGE_MIND: 'Berubah pikiran',
  ITEM_MISSING: 'Barang kurang',
  EXPECTATION_FAILED: 'Tidak sesuai harapan',
  ITEM_FAKE: 'Barang palsu',
  SELLER_SENT_WRONG_ITEM: 'Penjual salah kirim',
  OTHER: 'Lainnya',
};

/** Status retur → label Indonesia + warna lencana. */
const STATUS = {
  REQUESTED:  ['Diajukan', 'b-warn'],
  PROCESSING: ['Diproses', 'b-warn'],
  SELLER_DISPUTE: ['Disanggah penjual', 'b-warn'],
  JUDGING:    ['Ditinjau Shopee', 'b-warn'],
  ACCEPTED:   ['Disetujui', 'b-neg'],
  CANCELLED:  ['Dibatalkan', 'b-mute'],
  CLOSED:     ['Selesai', 'b-mute'],
  REFUND_PAID:['Refund dibayar', 'b-neg'],
};

const SARING = [
  ['perlu',  'Perlu ditanggapi'],
  ['lewat',  'Tenggat lewat'],
  ['proses', 'Sedang berjalan'],
  ['tutup',  'Selesai / batal'],
  ['semua',  'Semua'],
];

/**
 * Syarat penyaring. Nama kolom SELALU diberi awalan `r.` karena tabel
 * shops juga punya kolom `status` — tanpa awalan, Postgres menolak dengan
 * "column reference status is ambiguous" begitu kedua tabel digabung.
 */
const KONDISI = {
  perlu:  `r.due_date IS NOT NULL AND r.due_date > now()
           AND r.status NOT IN ('CLOSED','CANCELLED')`,
  lewat:  `r.due_date IS NOT NULL AND r.due_date <= now()
           AND r.status NOT IN ('CLOSED','CANCELLED')`,
  proses: `r.status IN ('REQUESTED','PROCESSING','SELLER_DISPUTE','JUDGING')`,
  tutup:  `r.status IN ('CLOSED','CANCELLED','REFUND_PAID','ACCEPTED')`,
  semua:  'TRUE',
};

export default async function Retur({ searchParams }) {
  await ensureSchema();
  const uang = bolehUang(await peranSekarang());

  const saring = KONDISI[searchParams?.f] ? searchParams.f : 'perlu';
  const toko = searchParams?.toko || null;
  const cari = (searchParams?.cari || '').trim() || null;
  const perHalaman = bacaPer(searchParams?.per);
  const halaman = Math.max(Number(searchParams?.hal) || 1, 1);

  const w = [KONDISI[saring]];
  const p = [];
  if (toko) { p.push(Number(toko)); w.push(`r.shop_id = $${p.length}`); }
  if (cari) {
    p.push(`%${cari}%`);
    w.push(`(r.return_sn ILIKE $${p.length} OR r.order_sn ILIKE $${p.length}
             OR r.tracking_number ILIKE $${p.length})`);
  }
  const where = w.join(' AND ');

  const [baris, jml, hitung, tokoList, ringkas, sapuan] = await Promise.all([
    q(`SELECT r.*, s.shop_name
         FROM returns r LEFT JOIN shops s ON s.shop_id = r.shop_id
        WHERE ${where}
        ORDER BY r.due_date NULLS LAST, r.create_time DESC
        LIMIT ${perHalaman} OFFSET ${(halaman - 1) * perHalaman}`, p),
    q(`SELECT COUNT(*)::int AS n FROM returns r WHERE ${where}`, p),
    q(`SELECT ${SARING.map(([k]) => `COUNT(*) FILTER (WHERE ${KONDISI[k]})::int AS ${k}`).join(', ')}
         FROM returns r`),
    q(`SELECT s.shop_id, s.shop_name, COUNT(r.*)::int AS n
         FROM shops s LEFT JOIN returns r ON r.shop_id = s.shop_id
        GROUP BY 1,2 HAVING COUNT(r.*) > 0 ORDER BY 3 DESC`),
    ringkasRetur(),
    q(`SELECT COUNT(*)::int AS sisa FROM returns_sapuan WHERE selesai = false`),
  ]);

  const total = jml[0]?.n || 0;
  const h = hitung[0] || {};

  const qs = (ubah = {}) => {
    const v = { f: saring === 'perlu' ? null : saring, toko, cari,
                per: perHalaman === 50 ? null : perHalaman,
                hal: halaman === 1 ? null : halaman, ...ubah };
    const u = new URLSearchParams();
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, String(x));
    const s = u.toString();
    return '/pesanan/retur' + (s ? '?' + s : '');
  };

  return (
    <Shell judul="Purna Jual" rute="/pesanan"
           kanan={<><a className="btn btn-sm" href="/pesanan">Kembali ke Pesanan</a>
                   <AutoSegar detik={300} /></>}>

      <div className="kpi-row">
        <Kpi label="Perlu ditanggapi" nilai={num(ringkas.perlu_tanggapi || 0)}
             warna={ringkas.perlu_tanggapi ? 'var(--warn)' : undefined}
             sub="tenggat belum lewat" />
        <Kpi label="Tenggat lewat" nilai={num(ringkas.lewat || 0)}
             warna={ringkas.lewat ? 'var(--neg)' : undefined}
             sub="belum ditutup" />
        <Kpi label="Retur 7 hari" nilai={num(ringkas.baru_7hari || 0)} sub="baru masuk" />
        {uang && <Kpi label="Nilai refund" nilai={rp(ringkas.nilai_refund || 0)}
                      sub="seluruh retur belum batal" />}
      </div>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-body">
          <TarikRetur sisa={sapuan[0]?.sisa || 0} />
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="filter-key">Tampilkan</div>
          <div className="filter-vals">
            {SARING.map(([k, label]) => (
              <a key={k} className="chip" href={qs({ f: k, hal: null })} aria-pressed={saring === k}>
                {label}<span className="n">{num(h[k] ?? 0)}</span>
              </a>
            ))}
          </div>
        </div>
        {tokoList.length > 1 && (
          <div className="filter-row">
            <div className="filter-key">Toko</div>
            <div className="filter-vals">
              <a className="chip" href={qs({ toko: null, hal: null })} aria-pressed={!toko}>Semua</a>
              {tokoList.map((t) => (
                <a key={t.shop_id} className="chip" href={qs({ toko: t.shop_id, hal: null })}
                   aria-pressed={String(toko) === String(t.shop_id)}>
                  {t.shop_name}<span className="n">{num(t.n)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{SARING.find(([k]) => k === saring)?.[1]}</h2>
          <span className="badge b-mute">{num(total)}</span>
        </div>

        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Paginasi halaman={halaman} perHalaman={perHalaman} total={total} qs={qs}
                    aksi="/pesanan/retur" cari={cari}
                    cariPlaceholder="Cari no. retur, no. pesanan, atau resi" />
        </div>

        {!baris.length ? (
          <div className="card-body">
            <Kosong judul={total === 0 && saring === 'perlu' ? 'Tidak ada retur yang perlu ditanggapi'
                            : 'Tidak ada retur di kelompok ini'}
                    anak={ringkas.semua ? 'Coba kelompok lain di atas.'
                            : 'Belum ada data — tekan "Tarik data retur" lebih dulu.'} />
          </div>
        ) : baris.map((r) => {
          const [labelStatus, warna] = STATUS[r.status] || [r.status || '—', 'b-mute'];
          const item = Array.isArray(r.items) ? r.items : [];
          const lewat = r.due_date && new Date(r.due_date) <= new Date();
          return (
            <article key={r.return_sn} className="order"
                     style={lewat ? { borderColor: 'var(--neg)' } : undefined}>
              <div className="order-head">
                <span className="sn mono">{r.return_sn}</span>
                <span className="t-mute">·</span>
                <span className="t-mute">{r.shop_name || `Toko ${r.shop_id}`}</span>
                <span className={'badge ' + warna}>{labelStatus}</span>
                {r.solution === 1 && <span className="badge b-mute">Refund saja</span>}
                {r.validation_type === 'warehouse_validation' &&
                  <span className="badge b-mute">Cek di gudang Shopee</span>}
                <div className="spacer" style={{ flex: 1 }} />
                {r.order_sn && (
                  <a className="btn btn-sm" href={`/pesanan?s=semua&cari=${r.order_sn}`}>
                    Lihat pesanan
                  </a>
                )}
              </div>

              <div className="order-body">
                <div className="stack"><span className="k">Alasan</span>
                  <span className="v">{ALASAN[r.reason] || r.reason || '—'}</span>
                  {r.text_reason && <span className="s t-mute">{r.text_reason}</span>}
                  {r.reassessed_reason && (
                    <span className="s" style={{ color: 'var(--warn)' }}>
                      Dinilai ulang: {ALASAN[r.reassessed_reason] || r.reassessed_reason}
                    </span>
                  )}
                </div>

                <div className="stack"><span className="k">Barang</span>
                  {item.length ? item.slice(0, 3).map((x, i) => (
                    <span key={i} className="s">
                      {x.name}
                      <span className="t-mute"> × {x.amount}</span>
                      {x.item_sku && <div className="mono t-mute">{x.variation_sku || x.item_sku}</div>}
                    </span>
                  )) : <span className="v t-mute">—</span>}
                  {item.length > 3 && (
                    <span className="s t-mute">… dan {item.length - 3} barang lain</span>
                  )}
                </div>

                {uang && (
                  <div className="stack"><span className="k">Refund</span>
                    <span className="v num">{rp(r.refund_amount)}</span>
                    {Number(r.amount_before_discount) > Number(r.refund_amount) && (
                      <span className="s t-mute">sebelum diskon {rp(r.amount_before_discount)}</span>
                    )}
                  </div>
                )}

                {/* Tiga tenggat berbeda, dan yang kosong tidak ditampilkan.
                    due_date yang paling mendesak — itu batas KITA menanggapi. */}
                <div className="stack"><span className="k">Tenggat</span>
                  {[
                    ['Kita menanggapi', r.due_date, true],
                    ['Pembeli kirim balik', r.ship_due_date, false],
                    ['Kita setelah dikirim', r.seller_due_date, false],
                  ].filter(([, w]) => w).map(([label, w, utama]) => (
                    <span key={label} className="s" style={{ display: 'flex', gap: 6 }}>
                      <span className="t-mute" style={{ minWidth: 118, display: 'inline-block' }}>
                        {label}
                      </span>
                      <span style={utama && lewat ? { color: 'var(--neg)', fontWeight: 700 }
                                                   : utama ? { fontWeight: 600 } : undefined}>
                        {jam(w)}{utama && lewat ? ' — lewat' : ''}
                      </span>
                    </span>
                  ))}
                  <span className="s t-mute">Dibuat {jam(r.create_time)}</span>
                </div>

                <div className="stack"><span className="k">Keadaan</span>
                  {[
                    ['Negosiasi', r.negotiation_status],
                    ['Bukti penjual', r.proof_status],
                    ['Kompensasi', r.compensation_status],
                  ].filter(([, v]) => v && v !== 'NONE').map(([label, v]) => (
                    <span key={label} className="s">
                      <span className="t-mute">{label}: </span>{v}
                    </span>
                  ))}
                  {r.tracking_number && (
                    <span className="s">
                      <span className="t-mute">Resi retur: </span>
                      <span className="mono">{r.tracking_number}</span>
                    </span>
                  )}
                  {!r.needs_logistics && <span className="s t-mute">Tanpa pengiriman balik</span>}
                </div>
              </div>
            </article>
          );
        })}

        {total > 0 && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <Paginasi halaman={halaman} perHalaman={perHalaman} total={total} qs={qs}
                      aksi="/pesanan/retur" bawah />
          </div>
        )}
      </div>
    </Shell>
  );
}

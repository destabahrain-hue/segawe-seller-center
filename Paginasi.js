import { num } from '@/lib/fmt';

export const PER_HALAMAN = [20, 50, 100, 200, 500];
export const bacaPer = (v) => (PER_HALAMAN.includes(Number(v)) ? Number(v) : 50);

/**
 * Bilah navigasi halaman + kotak pencarian.
 *
 * Dipakai halaman Pesanan dan Produk. Bentuknya form biasa, jadi bekerja
 * tanpa JavaScript dan hasilnya bisa di-bookmark atau dikirim ke tim
 * lewat tautan.
 */
export default function Paginasi({
  halaman, perHalaman, total, qs, aksi,
  cari = null, saring = {}, cariPlaceholder = 'Cari…', bawah = false,
}) {
  if (!total) return null;
  const jumlahHalaman = Math.max(Math.ceil(total / perHalaman), 1);
  const ke = (h) => qs({ hal: h === 1 ? null : h });
  const mati = (ya) => (ya ? { opacity: .45, pointerEvents: 'none' } : undefined);

  return (
    <div className="form-row" style={{
      alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap',
      marginBottom: bawah ? 0 : 'var(--s3)', marginTop: bawah ? 'var(--s3)' : 0,
      paddingTop: bawah ? 'var(--s3)' : 0,
      borderTop: bawah ? '1px solid var(--line)' : 'none',
    }}>
      <a className="btn btn-sm" href={ke(1)} style={mati(halaman === 1)}>« Awal</a>
      <a className="btn btn-sm" href={ke(Math.max(halaman - 1, 1))} style={mati(halaman === 1)}>‹ Sebelumnya</a>

      <span className="t-mute" style={{ fontSize: 12.5, padding: '0 var(--s2)' }}>
        Halaman <b style={{ color: 'var(--ink)' }}>{num(halaman)}</b> dari {num(jumlahHalaman)}
      </span>

      <a className="btn btn-sm" href={ke(Math.min(halaman + 1, jumlahHalaman))}
         style={mati(halaman >= jumlahHalaman)}>Berikutnya ›</a>
      <a className="btn btn-sm" href={ke(jumlahHalaman)} style={mati(halaman >= jumlahHalaman)}>Akhir »</a>

      {!bawah ? (
        <form method="get" action={aksi}
              style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1,
                       justifyContent: 'center', minWidth: 280 }}>
          {Object.entries(saring).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={String(v)} /> : null)}
          <input name="cari" defaultValue={cari || ''} placeholder={cariPlaceholder}
                 style={{ width: '100%', maxWidth: 340, height: 28 }} />
          <button className="btn btn-sm btn-primary">Cari</button>
          {cari && <a className="btn btn-sm" href={qs({ cari: null, hal: null })}>Hapus</a>}
        </form>
      ) : <div className="spacer" style={{ flex: 1 }} />}

      <span className="t-mute" style={{ fontSize: 12 }}>Per halaman</span>
      {PER_HALAMAN.map((n) => (
        <a key={n} className="chip" href={qs({ per: n === 50 ? null : n, hal: null })}
           aria-pressed={perHalaman === n} style={{ height: 26, padding: '0 9px' }}>{n}</a>
      ))}
    </div>
  );
}

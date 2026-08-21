'use client';
import { useMemo, useState } from 'react';

/**
 * Layar Pack — "Atur penjemputan".
 *
 * Dikelompokkan per TOKO + KURIR, karena alamat jemput itu milik toko dan
 * jadwal jemput ditentukan kurir. Menggabungkan dua toko dalam satu baris
 * akan membuat alamatnya salah untuk salah satunya.
 *
 * Semua pilihan berasal dari Shopee. Aplikasi tidak pernah mengarang
 * alamat maupun jam — kalau Shopee tidak menawarkan, barisnya kosong dan
 * dikatakan apa adanya.
 */
export default function PackDialog({ grup: grupMasuk, dilewati, onBatal, onJalan, sibuk }) {
  const [mode, setMode] = useState('pickup');
  const [pil, setPil] = useState({});          // per kunci grup
  const [dibuang, setDibuang] = useState(new Set());
  const [buka, setBuka] = useState(new Set());

  // Satu baris = satu (toko × kurir). Parameter kirimnya sudah ditanyakan
  // sekali untuk seluruh kelompok, bukan per pesanan.
  const grup = useMemo(() => grupMasuk.filter((g) => g.siap)
    .map((g) => ({ ...g, contoh: g, modeShopee: g.mode || 'pickup' })), [grupMasuk]);

  const gagal = grupMasuk.filter((g) => !g.siap);
  const total = grup.filter((g) => !dibuang.has(g.kunci)).reduce((a, g) => a + g.jumlah, 0);

  const set = (kunci, k, v) => setPil((s) => ({ ...s, [kunci]: { ...(s[kunci] || {}), [k]: v } }));

  /** Alamat yang sedang dipilih untuk satu grup. */
  const alamatGrup = (g) => pil[g.kunci]?.alamatId || g.contoh.alamat?.id || null;

  /** Jadwal untuk alamat yang sedang dipilih. */
  const slotGrup = (g) => {
    const id = String(alamatGrup(g));
    return g.contoh.slotPerAlamat?.[id] || g.contoh.slot || [];
  };

  function kirim() {
    const pilihan = {};
    for (const g of grup) {
      if (dibuang.has(g.kunci)) continue;
      const pg = pil[g.kunci] || {};
      const slot = slotGrup(g);
      const hari = pg.hari || slot[0]?.hari || null;
      const slotId = pg.slotId || slot.find((s) => s.hari === hari)?.id || slot[0]?.id || null;
      const pakaiDropoff = mode === 'dropoff' || g.modeShopee === 'dropoff';
      for (const sn of g.orderSns) {
        pilihan[sn] = pakaiDropoff
          ? { mode: 'dropoff', branch_id: g.dropoff?.id || null }
          : { mode: 'pickup', address_id: alamatGrup(g), pickup_time_id: slotId };
      }
    }
    onJalan(pilihan, Object.keys(pilihan).length);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(7,10,18,.55)', zIndex: 90,
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                  padding: '4vh 16px', overflowY: 'auto' }}>
      <div className="card" style={{ width: 'min(1000px, 100%)' }}>
        <div className="card-head">
          <h2>Atur penjemputan</h2>
          <span className="badge b-mute">{total} pesanan</span>
          {dilewati > 0 && <span className="badge b-warn">{dilewati} sudah pernah di-Pack</span>}
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setMode(mode === 'pickup' ? 'dropoff' : 'pickup')}>
            {mode === 'pickup' ? 'Saya mau antar sendiri (drop-off)' : 'Kembali ke penjemputan'}
          </button>
        </div>

        <div className="card-body">
          {mode === 'dropoff' ? (
            <p style={{ marginTop: 0 }}>
              Semua pesanan akan diatur sebagai <b>antar sendiri ke titik drop-off</b>.
              Tidak ada alamat atau jadwal jemput yang perlu dipilih.
            </p>
          ) : grup.map((g) => {
            const mati = dibuang.has(g.kunci);
            const pg = pil[g.kunci] || {};
            const slot = slotGrup(g);
            const hariUnik = [...new Map(slot.map((s) => [s.hari, s])).values()];
            const hariDipilih = pg.hari || hariUnik[0]?.hari || '';
            const jamHariItu = slot.filter((s) => s.hari === hariDipilih);
            const terbuka = buka.has(g.kunci);

            return (
              <div key={g.kunci} className="card" style={{ marginBottom: 'var(--s3)',
                     opacity: mati ? .45 : 1 }}>
                <div className="card-head" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
                  <button className="btn btn-sm btn-quiet" onClick={() => setBuka((s) => {
                    const n = new Set(s); n.has(g.kunci) ? n.delete(g.kunci) : n.add(g.kunci); return n;
                  })}>{terbuka ? '▾' : '▸'}</button>
                  <h2 style={{ fontSize: 13.5 }}>{g.kunci}</h2>
                  <span className="badge b-mute">{g.jumlah} pesanan</span>
                  <div className="spacer" style={{ flex: 1 }} />
                  <button className="btn btn-sm" onClick={() => setDibuang((s) => {
                    const n = new Set(s); n.has(g.kunci) ? n.delete(g.kunci) : n.add(g.kunci); return n;
                  })}>{mati ? 'Ikutkan lagi' : 'Buang'}</button>
                </div>

                <div className="card-body" style={{ paddingTop: 'var(--s3)' }}>
                  {g.modeShopee === 'dropoff' ? (
                    <p style={{ margin: 0 }}>
                      <b>Shopee meminta pesanan ini diantar sendiri ke titik drop-off.</b>{' '}
                      Tidak ada alamat maupun jadwal jemput yang perlu dipilih
                      {g.contoh.dropoff?.teks ? <> — titiknya: <b>{g.contoh.dropoff.teks}</b></> : null}.
                    </p>
                  ) : (g.contoh.alamatLain || []).length === 0 ? (
                    <div>
                      <p className="err" style={{ marginTop: 0 }}>
                        Shopee tidak menawarkan satu pun alamat jemput untuk pesanan ini.
                      </p>
                      {(g.contoh.alamatTerdaftar || []).length > 0 ? (
                        <>
                          <p className="t-mute" style={{ fontSize: 12.5, margin: '6px 0' }}>
                            Alamat yang terdaftar di Seller Centre untuk toko ini:
                          </p>
                          {g.contoh.alamatTerdaftar.map((a) => (
                            <div key={a.id} className="st">
                              {a.teks} {a.penanda?.length ? <span className="badge b-mute">{a.penanda.join(', ')}</span> : null}
                            </div>
                          ))}
                          <p className="t-mute" style={{ fontSize: 12.5, marginTop: 8 }}>
                            Kalau tidak ada yang bertanda <span className="mono">pickup_address</span>,
                            atur dulu alamat penjemputan di Seller Centre.
                          </p>
                        </>
                      ) : (
                        <p className="t-mute" style={{ fontSize: 12.5 }}>
                          Daftar alamat toko juga kosong — periksa pengaturan alamat di Seller Centre.
                        </p>
                      )}
                    </div>
                  ) : (
                  <div className="form-row" style={{ gap: 'var(--s3)', flexWrap: 'wrap' }}>
                    <div className="field" style={{ minWidth: 320, flex: 2 }}>
                      <label>Dijemput di</label>
                      <select disabled={mati} value={alamatGrup(g) || ''}
                              onChange={(e) => { set(g.kunci, 'alamatId', e.target.value);
                                                 set(g.kunci, 'hari', ''); set(g.kunci, 'slotId', ''); }}>
                        {(g.contoh.alamatLain || []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.teks}{a.penanda?.length ? ` — ${a.penanda.join(', ')}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field" style={{ minWidth: 180, flex: 1 }}>
                      <label>Tanggal jemput</label>
                      <select disabled={mati || !hariUnik.length} value={hariDipilih}
                              onChange={(e) => { set(g.kunci, 'hari', e.target.value); set(g.kunci, 'slotId', ''); }}>
                        {hariUnik.map((s) => <option key={s.hari} value={s.hari}>{s.hariTeks}</option>)}
                        {!hariUnik.length && <option value="">Tidak ditawarkan Shopee</option>}
                      </select>
                    </div>
                    <div className="field" style={{ minWidth: 180, flex: 1 }}>
                      <label>Jam</label>
                      <select disabled={mati || !jamHariItu.length} value={pg.slotId || jamHariItu[0]?.id || ''}
                              onChange={(e) => set(g.kunci, 'slotId', e.target.value)}>
                        {jamHariItu.map((s) => <option key={s.id} value={s.id}>{s.jamTeks}</option>)}
                        {!jamHariItu.length && <option value="">Tidak ditawarkan Shopee</option>}
                      </select>
                    </div>
                  </div>
                  )}

                  {terbuka && (
                    <div className="table-wrap" style={{ marginTop: 'var(--s3)' }}>
                      <table>
                        <thead><tr><th>No. pesanan</th><th>Penerima</th><th>Kurir</th></tr></thead>
                        <tbody>
                          {g.orderSns.slice(0, 50).map((sn) => (
                            <tr key={sn}><td className="mono">{sn}</td>
                              <td className="t-mute">{g.toko}</td><td>{g.kurir}</td></tr>
                          ))}
                          {g.orderSns.length > 50 && (
                            <tr><td colSpan={3} className="t-mute">
                              … dan {g.orderSns.length - 50} pesanan lain
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {gagal.length > 0 && (
            <div className="note">
              <div>
                <b>{gagal.reduce((a, g) => a + (g.jumlah || 0), 0)} pesanan tidak bisa diproses</b> dan akan dilewati:
                {gagal.slice(0, 5).map((g, i) => (
                  <div key={i} className="st">
                    {g.kunci} ({g.jumlah} pesanan): {g.error || 'Shopee tidak menawarkan cara kirim'}
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="err" style={{ marginTop: 'var(--s3)' }}>
            Setelah disimpan, pengaturan pengiriman <b>tidak bisa dibatalkan</b> —
            pesanan resmi diatur di Shopee dan nomor resinya terbit.
          </p>

          <div className="form-row" style={{ marginTop: 'var(--s3)', justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onBatal} disabled={sibuk}>Tutup</button>
            <button className="btn btn-primary" onClick={kirim} disabled={sibuk || !total}>
              {sibuk ? 'Memproses…' : `Simpan & Pack ${total} pesanan`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

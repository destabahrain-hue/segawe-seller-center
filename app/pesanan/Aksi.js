'use client';
import { useState } from 'react';
import PackDialog from './PackDialog';

export function Pilihan({ pesanan, tahap, uang = true }) {
  const [pilih, setPilih] = useState(new Set());
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState('');
  const [pdf, setPdf] = useState(null);      // { url, jumlah, toko }
  const [packHasil, setPackHasil] = useState(null);
  const [dialog, setDialog] = useState(null);           // hasil pratinjau
  const [packTunggu, setPackTunggu] = useState(null);   // kemajuan saat menunggu
  const [kembar, setKembar] = useState(null);           // dialog resi sudah pernah dicetak
  const [tandai, setTandai] = useState(null);           // konfirmasi hasil cetak

  // Nama kurirnya yang menentukan, karena hanya itu yang kita punya.
  // Kalau ada nama kurir instan lain yang belum tertangkap, ia sekadar
  // tidak muncul di tombol — tidak ada yang rusak.
  const instan = (o) => /instant|instan|sameday|same[ -]?day/i.test(o.carrier || '');
  const terpilihInstan = pesanan.filter((o) => pilih.has(o.id) && instan(o));
  const jumlahInstan = terpilihInstan.length;
  const dilewatiInstan = pilih.size - jumlahInstan;

  const semua = pilih.size > 0 && pilih.size === pesanan.length;
  function toggle(id) {
    const n = new Set(pilih);
    n.has(id) ? n.delete(id) : n.add(id);
    setPilih(n);
  }
  function toggleSemua() {
    setPilih(semua ? new Set() : new Set(pesanan.map((o) => o.id)));
  }

  /**
   * Pack = ship_order, tidak bisa dibatalkan. Selalu dua langkah:
   * baca parameter dari Shopee, tampilkan layar pilihan, baru jalankan.
   */
  async function bukaPack() {
    setSibuk(true); setErr(''); setPackHasil(null);
    try {
      const j = await fetch('/api/pack', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...pilih], pratinjau: true }),
      }).then((r) => r.json());
      if (!j.ok) { setErr(j.error || 'Gagal membaca cara kirim'); return; }
      setDialog(j);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  async function jalankanPack(pilihan, jumlah) {
    if (!jumlah) { setErr('Tidak ada pesanan yang bisa diproses'); return; }
    setSibuk(true); setErr('');
    try {
      const j = await fetch('/api/pack', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...pilih], pilihan }),
      }).then((r) => r.json());
      if (!j.ok) { setErr(j.error || 'Gagal'); return; }
      setPilih(new Set());

      // Tunggu sampai semua tugas tuntas, jangan tutup dialog dulu.
      // Melapor "sudah diantrikan" lalu menutup layar membuat kegagalan
      // tidak pernah sampai ke orang yang menekan tombolnya.
      if (j.jobIds?.length) {
        setPackTunggu({ hitung: null, total: j.jobIds.length });
        const sampai = Date.now() + 5 * 60 * 1000;
        let akhir = null;
        while (Date.now() < sampai) {
          const s = await fetch(`/api/pack/status?ids=${j.jobIds.join(',')}`)
            .then((r) => r.json()).catch(() => null);
          if (s?.ok) {
            setPackTunggu({ hitung: s.hitung, total: j.jobIds.length });
            if (s.tuntas) { akhir = s; break; }
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        setPackTunggu(null);
        setDialog(null);
        setPackHasil({ ...j, selesai: akhir?.hitung?.selesai ?? null,
                       gagalRinci: akhir?.gagal || [],
                       belumTuntas: !akhir });
        return;
      }

      setDialog(null);
      setPackHasil(j);
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  /**
   * Sisihkan atau kembalikan pesanan.
   *
   * Tidak menyentuh Shopee sama sekali — hanya penanda di sisi kita supaya
   * pesanan tidak ikut terproses. Karena itu ia BUKAN tindakan yang tak
   * bisa dibatalkan, dan tidak perlu dialog pratinjau seperti Pack.
   */
  async function sisihkan(ids, kembalikan = false) {
    const daftar = Array.isArray(ids) ? ids : [...pilih];
    if (!daftar.length) { setErr('Tidak ada pesanan dipilih'); return; }
    let alasan = null;
    if (!kembalikan) {
      alasan = window.prompt(
        `Sisihkan ${daftar.length} pesanan. Alasannya? (boleh dikosongkan)`, 'Stok kosong');
      if (alasan === null) return;   // ditekan Batal
    }
    setSibuk(true); setErr('');
    try {
      const j = await fetch('/api/pesanan/sisihkan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: daftar, alasan, kembalikan }),
      }).then((r) => r.json());
      if (!j.ok) { setErr(j.error || 'Gagal'); return; }
      if (j.dilewati > 0) {
        setErr(`${j.dilewati} pesanan dilewati — pengirimannya sudah diatur, jadi tidak bisa disisihkan.`);
        await new Promise((r) => setTimeout(r, 1800));
      }
      location.reload();
    } catch (e) { setErr(e.message); }
    finally { setSibuk(false); }
  }

  /** Cetak resi untuk pesanan instan yang belum di-Pack. */
  async function cetakInstan() {
    if (dilewatiInstan > 0) {
      setErr(`${dilewatiInstan} pesanan non-instan dilewati — resinya baru ada setelah di-Pack.`);
    }
    await cetakResi(terpilihInstan.map((o) => o.id));
  }

  /**
   * `idsKhusus` HANYA diterima kalau benar-benar berupa daftar id.
   *
   * Dipasang langsung sebagai onClick, React mengirim objek peristiwa
   * sebagai argumen pertama — dan objek itu menyimpan rujukan melingkar ke
   * simpul DOM. JSON.stringify lalu meledak dengan "Converting circular
   * structure to JSON", dan cetak resi berhenti sebelum sempat memanggil
   * apa pun. Penjagaan ini membuat pemanggilan dari mana pun tetap aman.
   */
  async function cetakResi(idsKhusus = null) {
    /**
     * Penjaga bentuk argumen.
     *
     * Fungsi ini pernah dipasang langsung sebagai onClick, dan React
     * mengirim OBJEK EVENT sebagai argumen pertama. Objek itu menyimpan
     * rujukan balik ke elemen DOM, jadi JSON.stringify meledak dengan
     * "Converting circular structure to JSON" — permintaannya bahkan tidak
     * pernah terkirim, dan resi tidak bisa dicetak sama sekali.
     *
     * Yang dipakai HANYA kalau argumennya benar-benar daftar id.
     */
    /**
     * Urutan id mengikuti URUTAN DI LAYAR, bukan urutan klik.
     *
     * `pilih` adalah Set — isinya urut sesuai kapan dicentang, dan itu
     * tidak ada hubungannya dengan pengurutan yang sedang dipakai. Kalau
     * dikirim apa adanya, urutan halaman PDF jadi acak dan sortir per SKU
     * yang barusan disusun di layar tidak ada gunanya.
     */
    const ids = Array.isArray(idsKhusus)
      ? idsKhusus
      : pesanan.filter((o) => pilih.has(o.id)).map((o) => o.id);
    if (!ids.length) { setErr('Tidak ada pesanan dipilih'); return; }

    /**
     * Gerbang resi kembar.
     *
     * Resi yang tercetak dua kali berarti dua lembar dengan nomor sama
     * beredar di meja packing — dan salah satunya bisa menempel di paket
     * yang keliru. print_count sudah dicatat tiap kali label keluar, jadi
     * di sinilah tempat memakainya.
     *
     * Kalau ada yang sudah pernah dicetak, cetak TIDAK langsung jalan:
     * layar bertanya dulu, dan mencetak ulang semuanya menuntut kode
     * pengesahan supaya tidak bisa dilakukan dengan sekali klik refleks.
     */
    const sudah = pesanan.filter((o) => ids.includes(o.id) && Number(o.print_count) > 0);
    if (sudah.length) {
      setKembar({
        ids,
        sudah,
        belum: ids.filter((id) => !sudah.some((o) => o.id === id)),
        kode: String(Math.floor(10 + Math.random() * 90)),
        ketik: '',
      });
      return;
    }
    await jalankanCetak(ids);
  }

  /** Cetak sungguhan — dipanggil setelah gerbang di atas dilewati. */
  async function jalankanCetak(ids) {
    if (!ids.length) { setErr('Tidak ada pesanan yang perlu dicetak'); return; }

    // Jendela dibuka SEKARANG, saat klik masih dianggap aksi pengguna.
    // Kalau dibuka setelah await, peramban memblokirnya diam-diam —
    // tidak ada pesan gagal, tapi juga tidak terjadi apa-apa.
    const jendela = window.open('', '_blank');
    // Jendela baru bawaannya HITAM KOSONG sampai PDF-nya datang, dan
    // mengambil label dari Shopee bisa memakan puluhan detik. Layar kosong
    // itu membuat orang mengira aplikasinya menggantung, lalu menekan
    // tombolnya lagi. Diisi halaman tunggu dulu.
    tulisLayarTunggu(jendela, ids.length);
    setSibuk(true); setErr(''); setPdf(null);
    try {
      const r = await fetch('/api/label', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!(r.headers.get('content-type') || '').includes('pdf')) {
        jendela?.close();
        const j = await r.json().catch(() => ({}));
        setErr(j.error || `Gagal mencetak (HTTP ${r.status})`);
        return;
      }

      const jumlah = r.headers.get('X-Jumlah-Label') || '?';
      const toko = r.headers.get('X-Jumlah-Toko') || '1';
      const dilewati = Number(r.headers.get('X-Dilewati') || 0);
      const catatan = decodeURIComponent(r.headers.get('X-Catatan') || '');

      const url = URL.createObjectURL(await r.blob());
      if (jendela && !jendela.closed) jendela.location.href = url;

      // Halaman TIDAK dimuat ulang otomatis — memuat ulang membuang
      // tautan PDF-nya. Tautannya ditampilkan supaya tetap bisa dibuka
      // kalau peramban memblokir jendela barunya.
      setPdf({ url, jumlah, toko });
      if (dilewati > 0 || catatan) setErr(`${dilewati} pesanan dilewati. ${catatan}`);

      // Konfirmasi hasil cetak. print_count baru naik setelah ini —
      // lihat catatan di /api/label/tandai.
      const sn = decodeURIComponent(r.headers.get('X-Order-Sn') || '')
        .split(',').map((x) => x.trim()).filter(Boolean);
      if (sn.length) setTandai({ sn, jumlah, sibuk: false });
    } catch (e) {
      jendela?.close();
      setErr(e.message);
    } finally {
      setSibuk(false);
    }
  }

  async function jalan(aksi) {
    setSibuk(true); setErr('');
    try {
      const r = await fetch('/api/pesanan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi, ids: [...pilih] }),
      });
      const j = await r.json();
      if (j.ok) location.reload(); else { setErr(j.error || 'Gagal'); setSibuk(false); }
    } catch (e) { setErr(e.message); setSibuk(false); }
  }

  return (
    <>
      <div className="bulkbar">
        <input type="checkbox" checked={semua} onChange={toggleSemua}
               aria-label="Pilih semua pesanan di halaman ini" />
        <span className="t">
          {pilih.size ? `${pilih.size} pesanan dipilih` : `Pilih pesanan untuk ditandai (${pesanan.length} di halaman ini)`}
        </span>
        <div className="spacer" />
        {tahap === 'sisih' && (
          <button className="btn btn-sm btn-primary" disabled={!pilih.size || sibuk}
                  onClick={() => sisihkan(null, true)}
                  title="Kembalikan ke alur kerja normal">
            {sibuk ? 'Memproses…' : 'Kembalikan ke pesanan baru'}
          </button>
        )}
        {['baru', 'gagalpack', 'verifikasi'].includes(tahap) && (
          <button className="btn btn-sm" disabled={!pilih.size || sibuk}
                  onClick={() => sisihkan()}
                  title="Tahan pesanan ini supaya tidak ikut diproses">
            Sisihkan
          </button>
        )}
        {tahap === 'baru' && jumlahInstan > 0 && (
          /* Shopee mau membuat label instan/sameday SEBELUM pengirimannya
             diatur — sudah dibuktikan lewat /api/diagnosa-label. Kurir
             reguler tidak bisa, jadi tombolnya hanya menyertakan yang
             instan dan mengatakan berapa yang dilewati. */
          <button className="btn btn-sm" disabled={sibuk}
                  onClick={() => cetakInstan()}
                  title="Cetak resi lebih dulu untuk kurir instan/sameday, sebelum pengirimannya diatur">
            {sibuk ? 'Menyiapkan…' : `Cetak resi instan (${jumlahInstan})`}
          </button>
        )}
        {(tahap === 'baru' || tahap === 'gagalpack' || tahap === 'verifikasi') ? (
          <button className="btn btn-sm btn-primary" disabled={!pilih.size || sibuk}
                  onClick={bukaPack}
                  title="Atur pengiriman ke Shopee dan terbitkan nomor resi">
            {sibuk ? 'Memproses…' : (tahap === 'baru' ? 'Pack' : 'Coba Pack lagi')}
          </button>
        ) : (
          <button className="btn btn-sm" disabled={!pilih.size || sibuk} onClick={() => cetakResi()}
                  title="Ambil PDF label dari Shopee, lalu buka untuk dicetak">
            {sibuk ? 'Menyiapkan…' : 'Cetak resi'}
          </button>
        )}
        {tahap === 'proses' && (
          <>
            {/* Tidak butuh pilihan — layar scan bekerja per barcode, bukan
                per centang, jadi tombolnya tidak ikut disabled. */}
            <a className="btn btn-sm" href="/pesanan/scan"
               title="Pindahkan ke Siap dijemput dengan menembak barcode resi">
              Scan &amp; Kirim
            </a>
            <button className="btn btn-sm" disabled={!pilih.size || sibuk}
                    onClick={() => jalan('batal-cetak')}>Kembalikan ke baru</button>
            <button className="btn btn-sm btn-primary" disabled={!pilih.size || sibuk}
                    onClick={() => jalan('kemas')}>Tandai selesai dikemas</button>
          </>
        )}
        {tahap === 'pickup' && (
          <button className="btn btn-sm" disabled={!pilih.size || sibuk}
                  onClick={() => jalan('batal-kemas')}>Kembalikan ke dikemas</button>
        )}
        {(tahap === 'baru' || tahap === 'semua' || tahap === 'gagalpack'
          || tahap === 'verifikasi') && tahap !== 'proses' && (
          <button className="btn btn-sm" disabled={!pilih.size || sibuk}
                  onClick={() => jalan('kemas')}>Langsung tandai dikemas</button>
        )}
      </div>
      {err && <p className="err">{err}</p>}

      {tandai && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 92, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', padding: 20,
                      background: 'rgba(11,18,38,.62)' }}
             role="alertdialog" aria-modal="true">
          <div className="card" style={{ width: 'min(520px,100%)' }}>
            <div className="card-head"><h2>Cetaknya berhasil?</h2></div>
            <div className="card-body">
              <p style={{ marginTop: 0 }}>
                <b>{tandai.jumlah} label sudah dibuat</b> dan terbuka di jendela sebelah.
                Tekan <b>Sudah tercetak</b> hanya kalau kertasnya benar-benar keluar.
              </p>
              <p className="t-mute" style={{ fontSize: 12.5, marginBottom: 0 }}>
                Penanda ini yang dipakai untuk mencegah resi tercetak dua kali. Kalau
                printer macet atau kamu batal mencetak, pilih <b>Belum</b> — supaya
                pesanan ini tidak dikira sudah selesai dicetak.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center',
                          padding: 'var(--s4)', borderTop: '1px solid var(--line)' }}>
              <div className="spacer" style={{ flex: 1 }} />
              <button className="btn btn-sm" disabled={tandai.sibuk}
                      onClick={() => setTandai(null)}>Belum</button>
              <button className="btn btn-sm btn-primary" disabled={tandai.sibuk}
                      onClick={async () => {
                        setTandai((t) => ({ ...t, sibuk: true }));
                        try {
                          await fetch('/api/label/tandai', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ order_sn: tandai.sn }),
                          });
                        } catch { /* penandaan gagal tidak menghalangi pekerjaan */ }
                        setTandai(null);
                        location.reload();
                      }}>
                {tandai.sibuk ? 'Menandai…' : 'Sudah tercetak'}
              </button>
            </div>
          </div>
        </div>
      )}

      {kembar && (() => {
        const semuaSudah = kembar.belum.length === 0;
        const kodeCocok = kembar.ketik.trim() === kembar.kode;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', padding: 20,
                        background: 'rgba(11,18,38,.62)' }}
               role="alertdialog" aria-modal="true">
            <div className="card" style={{ width: 'min(620px,100%)', maxHeight: '86vh',
                                           display: 'flex', flexDirection: 'column' }}>
              <div className="card-head"><h2>Sebagian resi sudah pernah dicetak</h2></div>
              <div className="card-body" style={{ overflow: 'auto' }}>
                <div className="note" style={{ background: 'var(--warn-tint)',
                                               borderColor: 'var(--warn)', marginTop: 0 }}>
                  <div>
                    Dari <b>{kembar.ids.length}</b> pesanan yang dipilih,{' '}
                    <b>{kembar.sudah.length}</b> resinya sudah pernah keluar.
                    Mencetak ulang berarti ada dua lembar dengan nomor resi sama di meja packing.
                  </div>
                </div>

                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table>
                    <thead><tr>
                      <th>No. pesanan</th><th>No. resi</th>
                      <th className="t-right">Sudah dicetak</th>
                    </tr></thead>
                    <tbody>
                      {kembar.sudah.map((o) => (
                        <tr key={o.id}>
                          <td className="mono">{o.order_sn}</td>
                          <td className="mono t-mute">{o.tracking_no || '—'}</td>
                          <td className="t-num">{Number(o.print_count)}×</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    Mau mencetak ulang semuanya? Ketik kode{' '}
                    <span className="mono" style={{ fontSize: 16, color: 'var(--neg)' }}>{kembar.kode}</span>
                  </div>
                  <input value={kembar.ketik} inputMode="numeric" autoComplete="off"
                         placeholder={`Ketik ${kembar.kode}`}
                         onChange={(e) => setKembar((k) => ({ ...k, ketik: e.target.value }))}
                         style={{ width: 160, height: 32 }} />
                  <div className="st t-mute" style={{ marginTop: 4 }}>
                    Kode ini sengaja ada supaya cetak ulang tidak terjadi karena klik refleks.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center',
                            padding: 'var(--s4)', borderTop: '1px solid var(--line)' }}>
                <span className="t-mute" style={{ fontSize: 12.5, flex: 1 }}>
                  {semuaSudah
                    ? 'Semua yang dipilih sudah pernah dicetak.'
                    : `${kembar.belum.length} pesanan belum pernah dicetak.`}
                </span>
                <button className="btn btn-sm" onClick={() => setKembar(null)}>Batalkan</button>
                <button className="btn btn-sm btn-primary" disabled={semuaSudah}
                        onClick={() => { const b = kembar.belum; setKembar(null); jalankanCetak(b); }}>
                  Lewati yang sudah dicetak{semuaSudah ? '' : ` (${kembar.belum.length})`}
                </button>
                <button className="btn btn-sm" disabled={!kodeCocok}
                        style={kodeCocok
                          ? { background: 'var(--neg)', borderColor: 'var(--neg)', color: '#fff' }
                          : undefined}
                        onClick={() => { const a = kembar.ids; setKembar(null); jalankanCetak(a); }}>
                  Cetak semua ({kembar.ids.length})
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {dialog && (
        <PackDialog grup={dialog.grup} dilewati={dialog.dilewati} sibuk={sibuk}
                    onBatal={() => setDialog(null)} onJalan={jalankanPack} />
      )}

      {packTunggu && (
        <div className="note" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <b>Memproses {packTunggu.total} pesanan…</b>{' '}
            {packTunggu.hitung
              ? `${packTunggu.hitung.selesai} selesai`
                + (packTunggu.hitung.gagal ? `, ${packTunggu.hitung.gagal} gagal` : '')
                + `, ${packTunggu.hitung.menunggu + packTunggu.hitung.jalan} sisa`
              : 'menghubungi Shopee…'}
            <div className="st" style={{ marginTop: 4 }}>
              Jangan tutup halaman ini dulu — hasil tiap pesanan ditampilkan setelah semuanya tuntas.
            </div>
          </div>
        </div>
      )}

      {packHasil && (() => {
        const rinci = packHasil.gagalRinci || [];
        const adaGagal = rinci.length > 0;
        return (
          <div className="note" style={{
            background: adaGagal ? 'var(--neg-tint)' : 'var(--pos-tint)',
            borderColor: adaGagal ? 'var(--neg)' : 'var(--pos)', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {packHasil.selesai !== null && packHasil.selesai !== undefined ? (
                <b>{packHasil.selesai} pesanan berhasil di-Pack{adaGagal ? `, ${rinci.length} gagal.` : '.'}</b>
              ) : (
                <b>{packHasil.diantrikan} pesanan masuk antrean Pack.</b>
              )}
              {packHasil.dilewati > 0 && <> {packHasil.dilewati} dilewati karena sudah pernah di-Pack.</>}
              {packHasil.belumTuntas && (
                <div className="st" style={{ marginTop: 4 }}>
                  Sebagian masih dikerjakan di latar belakang — hasilnya menyusul di Antrean Tugas.
                </div>
              )}

              {adaGagal && (
                <div style={{ marginTop: 8, maxHeight: 240, overflow: 'auto' }}>
                  <div className="st" style={{ marginBottom: 4 }}>
                    Pesanan berikut <b>belum diatur pengirimannya di Shopee</b> dan resinya belum
                    terbit. Semuanya masih ada di daftar dan bisa dipilih ulang untuk dicoba lagi.
                  </div>
                  {rinci.map((g) => (
                    <div key={g.order_sn} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{g.order_sn}</span>
                      {g.toko && <span className="t-mute"> · {g.toko}</span>}
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{g.alasan}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="form-row" style={{ gap: 6 }}>
              <a className="btn btn-sm" href="/antrean">Lihat antrean</a>
              <button className="btn btn-sm btn-primary" onClick={() => location.reload()}>Segarkan daftar</button>
            </div>
          </div>
        );
      })()}

      {pdf && (
        <div className="note" style={{ background: 'var(--pos-tint)', borderColor: 'var(--pos)',
                                       color: 'var(--pos)', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <b>{pdf.jumlah} label siap</b>
            {Number(pdf.toko) > 1 && <> dari {pdf.toko} toko, tergabung dalam satu berkas</>}.
            {' '}Kalau tab barunya tidak terbuka, peramban memblokirnya — pakai tombol di kanan.
          </div>
          <div className="form-row" style={{ gap: 6 }}>
            <a className="btn btn-sm btn-primary" href={pdf.url} target="_blank" rel="noreferrer">
              Buka PDF resi
            </a>
            <a className="btn btn-sm" href={pdf.url} download={`Resi-${pdf.jumlah}-label.pdf`}>
              Unduh
            </a>
            <button className="btn btn-sm" onClick={() => location.reload()}>Segarkan daftar</button>
          </div>
        </div>
      )}

      <div style={{ display: 'none' }} id="pilih-state">{[...pilih].join(',')}</div>

      {pesanan.map((o) => (
        <Baris key={o.id} o={o} uang={uang} dipilih={pilih.has(o.id)} onToggle={() => toggle(o.id)}
               tahap={tahap} sibuk={sibuk}
               onSisih={() => sisihkan([o.id], tahap === 'sisih')} />
      ))}
    </>
  );
}

/**
 * Tombol tanggapi permintaan batal. Satu pesanan, dua konfirmasi berbeda —
 * menyetujui tidak bisa ditarik kembali, menolak masih bisa diminta lagi
 * oleh pembeli, jadi peringatannya tidak disamakan.
 */
function TanggapiBatal({ o }) {
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState('');

  async function jalan(keputusan) {
    const setuju = keputusan === 'ACCEPT';
    const teks = setuju
      ? `Setujui pembatalan pesanan ${o.order_sn}?\n\n`
        + `Pesanan akan BENAR-BENAR DIBATALKAN di Shopee dan tidak bisa dikembalikan — `
        + `di aplikasi ini maupun di Seller Centre.`
      : `Tolak permintaan batal pesanan ${o.order_sn}?\n\n`
        + `Pesanan kembali diproses seperti biasa. Pembeli masih bisa mengajukan lagi.`;
    if (!confirm(teks)) return;

    setSibuk(true); setErr('');
    try {
      const j = await fetch('/api/batal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: o.id, keputusan }),
      }).then((r) => r.json());
      if (!j.ok) { setErr(j.error || 'Gagal'); setSibuk(false); return; }
      location.reload();
    } catch (e) { setErr(e.message); setSibuk(false); }
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn btn-sm" disabled={sibuk} onClick={() => jalan('REJECT')}>
        Tolak permintaan
      </button>
      <button className="btn btn-sm btn-danger" disabled={sibuk} onClick={() => jalan('ACCEPT')}>
        {sibuk ? 'Mengirim…' : 'Setujui pembatalan'}
      </button>
      {err && <span className="err" style={{ margin: 0, fontSize: 11.5 }}>{err}</span>}
    </div>
  );
}

function Baris({ o, uang = true, dipilih, onToggle, tahap, sibuk, onSisih }) {
  const item = o.item || [];
  const tanda = o.lewat ? 'b-neg' : o.segera ? 'b-warn' : null;
  const teks = o.lewat ? `Lewat batas ${sisa(o.ship_by_date)}`
             : o.segera ? `Sisa ${sisa(o.ship_by_date)}` : null;

  return (
    <article className="order" style={o.lewat ? { borderColor: 'var(--neg)' } : undefined}>
      <div className="order-head">
        <input type="checkbox" checked={dipilih} onChange={onToggle}
               aria-label={`Pilih pesanan ${o.order_sn}`} />
        <span className="sn mono">{o.order_sn}</span><span>·</span>
        <span>{o.shop_name || `Toko ${o.shop_id}`}</span><span>·</span>
        <span>{jam(o.created_time)}</span>
        <div className="spacer" />
        {o.status === 'IN_CANCEL' && (
          <span className="badge b-warn">menunggu keputusanmu</span>
        )}
        {Number(o.print_count) > 0 && (
          <span className="badge b-pos" title={`Label sudah dicetak ${o.print_count} kali`}>
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              {[3, 6, 8, 11, 14, 16, 19].map((x, i) => (
                <rect key={x} x={x} y="5" width={i % 3 === 0 ? 2 : 1} height="14" fill="currentColor" />
              ))}
            </svg>
            × {o.print_count}
          </span>
        )}
        {teks && <span className={'badge ' + tanda}>{teks}</span>}
        {o.pack_gagal_at && (
          <span className={'badge ' + (o.pack_gagal_jenis === 'marketplace' ? 'b-warn' : 'b-neg')}>
            {o.pack_gagal_jenis === 'marketplace' ? 'Shopee belum siap' : 'Pack ditolak'}
          </span>
        )}
        <span className="badge b-mute">{o.status}</span>
        {/* Tombol per baris, seperti BigSeller: menyisihkan satu pesanan
            tidak perlu mencentangnya dulu. */}
        {onSisih && ['baru', 'gagalpack', 'verifikasi', 'sisih'].includes(tahap) && (
          <button className="btn btn-sm" disabled={sibuk} onClick={onSisih}
                  title={tahap === 'sisih'
                    ? 'Kembalikan ke alur kerja normal'
                    : 'Tahan pesanan ini supaya tidak ikut diproses'}
                  style={{ padding: '2px 8px', fontSize: 11.5 }}>
            {tahap === 'sisih' ? 'Kembalikan' : 'Sisihkan'}
          </button>
        )}
      </div>

      {o.disisihkan_at && (
        <div style={{ padding: '8px 12px', fontSize: 12.5, background: 'var(--warn-tint)',
                      borderTop: '1px solid var(--line)' }}>
          <b>Disisihkan {jam(o.disisihkan_at)}</b>
          {o.disisihkan_oleh && <span className="t-mute"> oleh {o.disisihkan_oleh}</span>}
          {o.disisihkan_alasan && <div style={{ color: 'var(--ink-2)' }}>{o.disisihkan_alasan}</div>}
          {/* Batas kirim SENGAJA tetap ditampilkan di sini. Menyisihkan
              bukan membatalkan — jam Shopee tetap berjalan. */}
        </div>
      )}

      {/* Alasan mentah dari Shopee ditampilkan apa adanya. Kalau ada pesan
          baru yang sebenarnya masuk kategori "belum siap", di sinilah ia
          akan kelihatan — daripada disembunyikan di balik label buatan. */}
      {o.pack_gagal_at && (
        <div style={{ padding: '8px 12px', fontSize: 12.5,
                      background: o.pack_gagal_jenis === 'marketplace'
                        ? 'var(--warn-tint)' : 'var(--neg-tint)',
                      borderTop: '1px solid var(--line)' }}>
          <b>{o.pack_gagal_jenis === 'marketplace'
            ? 'Shopee belum siap memproses pesanan ini.'
            : 'Shopee menolak permintaan Pack.'}</b>{' '}
          <span style={{ color: 'var(--ink-2)' }}>{o.pack_gagal_pesan}</span>
          <span className="t-mute"> · {jam(o.pack_gagal_at)}</span>
        </div>
      )}
      <div className="order-body">
        <div className="stack">
          <span className="k">Barang</span>
          {item.map((it, i) => (
            <span key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: i ? 6 : 0 }}>
              {it.gambar
                ? <img src={it.gambar} alt="" width={40} height={40} loading="lazy"
                       style={{ width: 40, height: 40, flex: '0 0 40px', objectFit: 'cover',
                                borderRadius: 'var(--r-sm)', border: '1px solid var(--line)',
                                background: 'var(--surface-sunken)' }} />
                : <span className="thumb" style={{ flex: '0 0 40px', width: 40, height: 40 }}>
                    {String(it.sku || it.nama || '?').slice(0, 3).toUpperCase()}
                  </span>}
              <span style={{ minWidth: 0 }}>
                <span className="v" style={{ fontWeight: 500, display: 'block' }}>{it.nama}</span>
                <span className="s mono">{it.sku || '—'} × {it.qty}</span>
              </span>
            </span>
          ))}
        </div>
        {uang && (
          <div className="stack"><span className="k">Nilai</span>
            <span className="v num">{rp(o.total_amount)}</span></div>
        )}
        <div className="stack"><span className="k">Penerima</span>
          <span className="v">{o.recipient_name || o.buyer_username || '—'}</span>
          <span className="s">{[o.city, o.region].filter(Boolean).join(', ') || '—'}</span></div>
        {(o.status === 'IN_CANCEL' || o.status === 'CANCELLED') && (
          <div className="stack" style={{ minWidth: 210 }}>
            <span className="k">
              {o.status === 'IN_CANCEL' ? 'Permintaan batal' : 'Dibatalkan'}
            </span>
            <span className="v" style={{ fontWeight: 500 }}>
              {o.cancel_reason || 'Alasan tidak disebutkan'}
            </span>
            <span className="s">
              {o.cancel_by ? `oleh ${o.cancel_by}` : ''}
              {o.cancel_req_at ? ` · diminta ${jam(o.cancel_req_at)}` : ''}
              {o.cancelled_at ? ` · batal ${jam(o.cancelled_at)}` : ''}
            </span>
            {o.status === 'IN_CANCEL' && (
              <div style={{ marginTop: 8 }}><TanggapiBatal o={o} /></div>
            )}
          </div>
        )}

        <div className="stack"><span className="k">Kurir &amp; resi</span>
          {o.carrier
            ? <span className="v">{o.carrier}</span>
            : <span className="v t-mute" style={{ fontWeight: 500 }}>belum ditentukan</span>}
          <span className="s mono">{o.tracking_no || 'belum ada resi'}</span>
          {Array.isArray(o.tracking_info) && o.tracking_info.length > 0 && (
            <details style={{ marginTop: 2 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--brand)' }}>
                {o.tracking_status || 'perjalanan paket'} · {o.tracking_info.length} pembaruan
              </summary>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5,
                            borderLeft: '2px solid var(--line)', paddingLeft: 9 }}>
                {o.tracking_info.slice(0, 8).map((t, i) => (
                  <div key={i} style={{ fontSize: 11.5 }}>
                    <span className="t-mute">{t.waktu ? jam(t.waktu) : '—'}</span>
                    <div style={{ color: 'var(--ink-2)' }}>{t.catatan || t.status}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
        {/* Riwayat waktu satu pesanan, bukan cuma batas kirimnya.
            Saat pesanan tersendat, pertanyaan pertama selalu "sejak kapan
            berhenti di sini" — dan itu tidak bisa dijawab kalau yang
            tersimpan hanya satu stempel waktu. Baris yang kosong tidak
            ditampilkan supaya kolomnya tidak penuh tanda pisah. */}
        <div className="stack"><span className="k">Waktu</span>
          {[
            ['Dibuat', o.created_time, null],
            ['Dibayar', o.paid_at, null],
            ['Batas kirim', o.ship_by_date, o.lewat ? 'var(--neg)' : o.segera ? 'var(--warn)' : null],
            ['Resi dicetak', o.printed_at, null],
            ['Diatur kirim', o.ship_arranged_at, null],
            ['Dikemas', o.packed_at, null],
            ['Dikirim', o.ship_time, null],
            ['Selesai', o.completed_at, null],
            ['Dibatalkan', o.cancelled_at, 'var(--neg)'],
          ].filter(([, w]) => w).map(([label, w, warna]) => (
            <span key={label} className="s" style={{ display: 'flex', gap: 6 }}>
              <span className="t-mute" style={{ minWidth: 78, display: 'inline-block' }}>{label}</span>
              <span style={warna ? { color: warna, fontWeight: 600 } : undefined}>{jam(w)}</span>
            </span>
          ))}
          {teks && <span className="s" style={{ color: tanda === 'b-neg' ? 'var(--neg)' : 'var(--warn)',
                                                fontWeight: 600 }}>{teks}</span>}
        </div>
      </div>
    </article>
  );
}

function sisa(d) {
  if (!d) return '';
  const m = Math.abs((new Date(d).getTime() - Date.now()) / 60000);
  return m < 60 ? `${Math.round(m)} menit` : `${Math.floor(m / 60)} jam`;
}
const jam = (d) => d ? new Date(d).toLocaleString('id-ID',
  { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const rp = (n) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);

/**
 * Isi jendela baru dengan halaman tunggu.
 *
 * Ditulis langsung sebagai HTML, bukan diarahkan ke sebuah alamat, karena
 * jendelanya harus terisi SEKARANG — sebelum satu pun panggilan ke Shopee
 * dimulai. Mengarahkannya ke halaman lain berarti menunggu satu putaran
 * jaringan lagi, dan justru layar kosong itu yang mau dihindari.
 */
function tulisLayarTunggu(jendela, jumlah) {
  if (!jendela || jendela.closed) return;
  try {
    jendela.document.open();
    jendela.document.write(`<!doctype html><html lang="id"><head>
<meta charset="utf-8"><title>Menyiapkan resi…</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7fb;color:#111827}
  .kotak{max-width:420px;padding:32px 34px;background:#fff;border-radius:14px;
         box-shadow:0 10px 30px rgba(15,23,42,.10);text-align:center}
  h1{font-size:17px;margin:0 0 6px}
  p{margin:0;font-size:13.5px;color:#4b5563;line-height:1.55}
  .bar{margin:18px 0 14px;height:6px;border-radius:99px;background:#e5e7eb;overflow:hidden}
  .bar i{display:block;height:100%;width:40%;border-radius:99px;background:#2563eb;
         animation:geser 1.15s ease-in-out infinite}
  @keyframes geser{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
  .kecil{margin-top:14px;font-size:12px;color:#6b7280}
</style></head><body>
<div class="kotak">
  <h1>Menyiapkan ${jumlah} resi…</h1>
  <div class="bar"><i></i></div>
  <p>Label diambil langsung dari Shopee, satu per toko. Untuk pesanan banyak
     ini bisa memakan waktu hingga satu menit.</p>
  <p class="kecil">Jangan tutup jendela ini — PDF-nya akan muncul di sini sendiri.</p>
</div></body></html>`);
    jendela.document.close();
  } catch { /* peramban menolak menulis: biarkan kosong, PDF tetap menyusul */ }
}

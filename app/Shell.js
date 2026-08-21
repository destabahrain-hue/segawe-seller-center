import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { Galat } from './UI';
import { q } from '@/lib/db';
import { jam } from '@/lib/fmt';
import { sesi, peranSekarang, bolehRute } from '@/lib/auth';

/**
 * Jumlah pesanan per status untuk sidebar.
 *
 * Satu kueri untuk SEMUA status sekaligus, bukan satu per status —
 * Shell dipakai di setiap halaman, jadi biayanya harus sekecil mungkin.
 * Kegagalannya sengaja ditelan: angka di sidebar adalah pemanis, dan
 * tidak boleh menjatuhkan seluruh halaman kalau kueri ini bermasalah.
 */
let cacheHitung = { pada: 0, nilai: null };

async function hitungPesanan(boleh) {
  if (!boleh) return null;

  /**
   * Hasilnya ditahan 20 detik.
   *
   * Kuerinya menyapu seluruh tabel pesanan — terukur 16 md pada 45 ribu
   * baris. Itu murah sekali, tapi dibayar di SETIAP pemuatan halaman,
   * termasuk halaman yang tidak ada hubungannya dengan pesanan. Menahannya
   * sebentar membuat angkanya tetap terasa hidup tanpa menyapu tabel
   * berulang kali saat orang berpindah-pindah halaman.
   */
  if (cacheHitung.nilai && Date.now() - cacheHitung.pada < 20000) return cacheHitung.nilai;

  try {
    const { STATUS } = await import('@/lib/orders');
    const bagian = STATUS
      .map((x) => `COUNT(*) FILTER (WHERE ${x.cond})::int AS ${x.key}`)
      .join(',\n             ');
    const r = await q(`SELECT ${bagian} FROM orders o`);
    cacheHitung = { pada: Date.now(), nilai: r[0] || null };
    return cacheHitung.nilai;
  } catch { return null; }
}

async function terakhirSinkron() {
  try {
    const r = await q('SELECT MAX(last_sync_at) AS t FROM shops');
    return r[0]?.t ? `Sinkron terakhir ${jam(r[0].t)}` : 'Belum pernah sinkron';
  } catch { return 'Belum pernah sinkron'; }
}

/**
 * Kerangka semua halaman, sekaligus penjaga izin lapis kedua.
 *
 * Middleware sudah menjaga rute memakai izin dari cookie, tapi cookie bisa
 * basi kalau peran baru saja diubah. Di sini izinnya dibaca ulang dari
 * database, jadi perubahan peran berlaku seketika.
 */
export default async function Shell({ judul, kanan, rute = null, children }) {
  const [sinkron, s, peran] = await Promise.all([
    terakhirSinkron(), Promise.resolve(sesi()), peranSekarang(),
  ]);

  const p = peran || { nama: 'Tanpa peran', rute: [], uang: false, kelola: false };
  const ditolak = rute && !bolehRute(p, rute);

  // Hanya dihitung untuk yang memang boleh membuka halaman Pesanan.
  const hitung = await hitungPesanan(bolehRute(p, '/pesanan'));

  return (
    <div className="shell">
      <Sidebar sinkron={sinkron} peran={p.nama} nama={s?.nama || ''} rute={p.rute}
               hitung={hitung} />
      <div className="main">
        <Topbar judul={judul} kanan={ditolak ? null : kanan} />
        <div className="content">
          {ditolak ? (
            <Galat judul="Halaman ini di luar aksesmu"
                   pesan={`Akunmu berperan ${p.nama}, dan peran itu tidak diberi akses ke halaman ini.`}
                   detail="Minta pemilik akun menambahkan izinnya di halaman Pengguna → Peran." />
          ) : children}
        </div>
      </div>
    </div>
  );
}

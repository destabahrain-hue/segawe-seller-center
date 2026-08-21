import Shell from '../Shell';
import { Kosong, Catatan, Galat } from '../UI';
import { TambahPengguna, UbahPeranAkun, AksiPengguna, TombolPeran, HapusPeran } from './Kelola';
import { ensureSchema, q } from '@/lib/db';
import { daftarPeran, peranSekarang, bolehKelola, HALAMAN, akunMaster } from '@/lib/auth';
import { jam } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Pengguna() {
  const p = await peranSekarang();
  let rows = [], peran = [], galat = null;
  try {
    await ensureSchema();
    [rows, peran] = await Promise.all([
      q(`SELECT u.id, u.nama, u.username, u.aktif, u.last_login, u.role_id, r.nama AS peran_nama
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
         ORDER BY u.aktif DESC, u.nama`),
      daftarPeran(),
    ]);
  } catch (e) {
    galat = { pesan: e.message, detail: e.code ? `kode: ${e.code}` : null };
  }

  if (!bolehKelola(p)) {
    return <Shell judul="Pengguna">
      <Catatan>Hanya peran yang diberi izin mengelola pengguna yang bisa membuka halaman ini.</Catatan>
    </Shell>;
  }

  const label = (rute) => HALAMAN.find((h) => h.rute === rute)?.label || rute;
  const master = akunMaster();

  return (
    <Shell judul="Pengguna & Peran">
      {galat && <Galat judul="Halaman Pengguna gagal dimuat" pesan={galat.pesan} detail={galat.detail} />}
      {!galat && <>
        {!rows.length && (
          <Catatan>
            <b>Belum ada pengguna.</b> Selama daftar ini kosong, kata sandi lama
            (<span className="mono">APP_PASSWORD</span>) masih bisa dipakai masuk sebagai Pemilik.
            Begitu kamu membuat pengguna pertama, cara lama itu berhenti berlaku — jadi
            <b> buat akun untuk dirimu sendiri lebih dulu dengan peran Pemilik</b>.
          </Catatan>
        )}

        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <div className="card-head">
            <h2>Akun master</h2>
            <span className={'badge ' + (master ? 'b-pos' : 'b-warn')}>
              {master ? 'aktif' : 'belum diatur'}
            </span>
          </div>
          <div className="card-body">
            {master ? (
              <>
                <p style={{ marginTop: 0 }}>
                  Akun master <b className="mono">{master.username}</b> diatur lewat variabel
                  Railway, bukan di sini. Selalu berperan pemilik penuh, tidak bisa dihapus
                  atau diubah izinnya dari halaman ini.
                </p>
                <p className="t-mute" style={{ fontSize: 12.5, margin: 0 }}>
                  Simpan untuk keadaan darurat — kalau izinmu sendiri salah diatur atau
                  akunmu tidak sengaja dinonaktifkan, akun ini tetap bisa masuk.
                  Jangan dipakai sehari-hari.
                </p>
              </>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>
                  Belum ada akun master. Tanpa itu, kalau semua akun pemilik terkunci atau
                  izinnya salah diatur, tidak ada jalan masuk selain mengubah database langsung.
                </p>
                <p className="t-mute" style={{ fontSize: 12.5, margin: 0 }}>
                  Cara mengaturnya: tambahkan variabel <span className="mono">MASTER_USERNAME</span> dan
                  <span className="mono"> MASTER_PASSWORD</span> di Railway, lalu deploy ulang.
                  Kata sandi minimal 12 karakter — kalau kurang, dianggap belum diatur.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <div className="card-head">
            <h2>Peran</h2>
            <span className="badge b-mute">{peran.length}</span>
            <div className="spacer" style={{ flex: 1 }} />
            <TombolPeran halaman={HALAMAN} label="Peran baru" />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Peran</th><th>Halaman yang boleh dibuka</th>
                <th style={{ width: 110 }}>Angka rupiah</th><th style={{ width: 90 }}>Akun</th>
                <th style={{ width: 150 }}></th>
              </tr></thead>
              <tbody>
                {peran.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="tt">{r.nama}
                        {r.bawaan && <span className="badge b-mute" style={{ marginLeft: 6 }}>bawaan</span>}
                        {r.kelola && <span className="badge b-info" style={{ marginLeft: 6 }}>kelola pengguna</span>}
                      </div>
                      {r.jelas && <div className="st">{r.jelas}</div>}
                    </td>
                    <td className="t-mute" style={{ fontSize: 11.5 }}>
                      {(r.rute || []).includes('*')
                        ? <span className="badge b-pos">Semua halaman</span>
                        : (r.rute || []).map(label).join(' · ') || '—'}
                    </td>
                    <td><span className={'badge ' + (r.uang ? 'b-pos' : 'b-neg')}>
                      {r.uang ? 'Terlihat' : 'Disembunyikan'}</span></td>
                    <td className="t-num">{r.jumlah_akun}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <TombolPeran peran={JSON.parse(JSON.stringify(r))} halaman={HALAMAN} />
                        {!r.bawaan && <HapusPeran id={r.id} nama={r.nama} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <TambahPengguna peran={JSON.parse(JSON.stringify(peran))} />

        <div className="card">
          <div className="card-head"><h2>Akun</h2>
            <div className="spacer" style={{ flex: 1 }} /><span className="badge b-mute">{rows.length} akun</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Nama</th><th>Nama pengguna</th><th style={{ width: 170 }}>Peran</th>
                <th>Status</th><th>Terakhir masuk</th><th style={{ width: 230 }}></th>
              </tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} style={u.aktif ? undefined : { opacity: .5 }}>
                    <td className="t-strong">{u.nama}</td>
                    <td className="mono">{u.username}</td>
                    <td><UbahPeranAkun id={u.id} nilai={u.role_id}
                                       peran={JSON.parse(JSON.stringify(peran))} /></td>
                    <td><span className={'badge ' + (u.aktif ? 'b-pos' : 'b-mute')}>
                      {u.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
                    <td className="t-mute">{u.last_login ? jam(u.last_login) : 'belum pernah'}</td>
                    <td><AksiPengguna id={u.id} aktif={u.aktif} /></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6}>
                  <Kosong judul="Belum ada pengguna"
                          anak="Tambahkan akun untuk tiap anggota tim, lalu beri peran sesuai pekerjaannya." />
                </td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>}
    </Shell>
  );
}

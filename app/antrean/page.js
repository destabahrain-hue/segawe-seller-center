import Shell from '../Shell';
import AutoSegar from '../AutoSegar';
import { Kosong } from '../UI';
import { ensureSchema, q } from '@/lib/db';
import { jam, num } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const BADGE = { pending: 'b-mute', running: 'b-info', done: 'b-pos', failed: 'b-neg' };
const NAMA = { pending: 'Menunggu', running: 'Berjalan', done: 'Selesai', failed: 'Gagal' };

export default async function Antrean() {
  await ensureSchema();
  const [jobs, riwayat] = await Promise.all([
    q(`SELECT j.*, s.shop_name FROM jobs j LEFT JOIN shops s ON s.shop_id = j.shop_id
       ORDER BY j.id DESC LIMIT 60`),
    q(`SELECT * FROM activity_log ORDER BY id DESC LIMIT 40`),
  ]);

  return (
    <Shell judul="Antrean Tugas" rute="/antrean" kanan={<AutoSegar detik={20} />}>
      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="card-head"><h2>Antrean</h2>
          <div className="spacer" />
          <span className="badge b-mute">Perubahan massal dikerjakan bertahap dengan jeda</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tugas</th><th>Toko</th><th className="t-right">Progres</th><th>Status</th><th>Waktu</th><th>Catatan</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="t-strong">{j.kind}</td>
                  <td>{j.shop_name || (j.shop_id ? `Toko ${j.shop_id}` : 'semua toko')}</td>
                  <td className="t-num">{num(j.done_steps)} / {num(j.total_steps)}</td>
                  <td><span className={'badge ' + (BADGE[j.status] || 'b-mute')}>{NAMA[j.status] || j.status}</span></td>
                  <td className="t-mute">{jam(j.created_at)}</td>
                  <td className="t-mute" style={{ maxWidth: 320 }}>{j.last_error || '—'}</td>
                </tr>
              ))}
              {!jobs.length && <tr><td colSpan={6}>
                <Kosong judul="Antrean kosong" anak="Tugas muncul di sini saat kamu melakukan perubahan massal pada produk." />
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Riwayat sistem</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Waktu</th><th>Jenis</th><th>Pesan</th><th>Hasil</th></tr></thead>
            <tbody>
              {riwayat.map((r) => (
                <tr key={r.id}>
                  <td className="t-mute">{jam(r.created_at)}</td>
                  <td className="t-strong">{r.kind}</td>
                  <td>{r.message}</td>
                  <td><span className={'badge ' + (r.ok ? 'b-pos' : 'b-neg')}>{r.ok ? 'OK' : 'Gagal'}</span></td>
                </tr>
              ))}
              {!riwayat.length && <tr><td colSpan={4} className="t-mute">Belum ada riwayat.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

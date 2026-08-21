import Shell from '../Shell';
import { peranSekarang, rutePertama, HALAMAN } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Dilarang() {
  const p = await peranSekarang();
  const label = (r) => HALAMAN.find((h) => h.rute === r)?.label || r;
  const boleh = (p?.rute || []).includes('*')
    ? ['Semua halaman']
    : (p?.rute || []).map(label);

  return (
    <Shell judul="Tidak punya akses">
      <div className="card" style={{ borderColor: 'var(--warn)' }}>
        <div className="card-head" style={{ background: 'var(--warn-tint)' }}>
          <h2 style={{ color: 'var(--warn)' }}>Halaman ini di luar aksesmu</h2>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0 }}>
            Akunmu berperan <b>{p?.nama || '—'}</b>.{p?.jelas ? ` ${p.jelas}` : ''}
          </p>
          {boleh.length > 0 && (
            <p className="t-mute" style={{ fontSize: 12.5 }}>
              Halaman yang boleh kamu buka: {boleh.join(' · ')}
            </p>
          )}
          <p className="t-mute" style={{ fontSize: 12.5 }}>
            Kalau kamu memang perlu membuka halaman ini, minta pemilik akun menambahkan
            izinnya di halaman Pengguna → Peran.
          </p>
          <a className="btn btn-primary" href={rutePertama(p)}>Kembali ke halaman yang boleh dibuka</a>
        </div>
      </div>
    </Shell>
  );
}

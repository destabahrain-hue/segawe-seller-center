import Logo from '../Logo';

export const dynamic = 'force-dynamic';

export default function Login({ searchParams }) {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ color: 'var(--brand)' }}><Logo /></div>
        <form action="/api/login" method="post">
          <div className="field" style={{ marginBottom: 'var(--s3)' }}>
            <label htmlFor="u">Nama pengguna</label>
            <input id="u" name="username" autoFocus autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="pw">Kata sandi</label>
            <input id="pw" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--s4)' }}>Masuk</button>
          {searchParams?.salah && <p className="err">Nama pengguna atau kata sandi salah.</p>}
          {searchParams?.galat && <p className="err">{searchParams.galat}</p>}
        </form>
      </div>
    </div>
  );
}

import { NextResponse } from 'next/server';
import { ensureSchema, q, one, log } from '@/lib/db';
import { peranSekarang, bolehKelola, buatHash, HALAMAN } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ruteSah = (arr) => {
  const sah = new Set(HALAMAN.map((h) => h.rute));
  return [...new Set((arr || []).filter((r) => r === '*' || sah.has(r)))];
};

export async function POST(req) {
  const p = await peranSekarang();
  if (!bolehKelola(p)) {
    return NextResponse.json({ ok: false, error: 'Hanya peran yang boleh mengelola pengguna' }, { status: 403 });
  }
  const b = await req.json();
  try {
    await ensureSchema();

    // ── Peran ──
    if (b.aksi === 'peran-buat' || b.aksi === 'peran-ubah') {
      const nama = String(b.nama || '').trim();
      if (!nama) return NextResponse.json({ ok: false, error: 'Nama peran wajib diisi' }, { status: 400 });
      const rute = ruteSah(b.rute);

      if (b.aksi === 'peran-buat') {
        const ada = await one('SELECT id FROM roles WHERE lower(nama) = lower($1)', [nama]);
        if (ada) return NextResponse.json({ ok: false, error: 'Nama peran sudah dipakai' }, { status: 409 });
        await q(`INSERT INTO roles (nama, jelas, rute, uang, kelola) VALUES ($1,$2,$3,$4,$5)`,
          [nama, b.jelas || null, rute, !!b.uang, !!b.kelola]);
        await log('pengguna', `Peran ${nama} dibuat`);
      } else {
        await q(`UPDATE roles SET nama = $2, jelas = $3, rute = $4, uang = $5, kelola = $6 WHERE id = $1`,
          [b.id, nama, b.jelas || null, rute, !!b.uang, !!b.kelola]);
        await log('pengguna', `Peran ${nama} diubah`);
      }
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === 'peran-hapus') {
      const r = await one('SELECT nama, bawaan FROM roles WHERE id = $1', [b.id]);
      if (!r) return NextResponse.json({ ok: false, error: 'Peran tidak ditemukan' }, { status: 404 });
      if (r.bawaan) return NextResponse.json({ ok: false, error: 'Peran bawaan tidak bisa dihapus' }, { status: 400 });
      const pakai = await one('SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1', [b.id]);
      if (Number(pakai?.n) > 0) {
        return NextResponse.json({
          ok: false, error: `Masih dipakai ${pakai.n} akun. Pindahkan akunnya ke peran lain dulu.`,
        }, { status: 400 });
      }
      await q('DELETE FROM roles WHERE id = $1', [b.id]);
      return NextResponse.json({ ok: true });
    }

    // ── Pengguna ──
    if (b.aksi === 'buat') {
      const u = String(b.username || '').trim();
      if (!u || !b.sandi || String(b.sandi).length < 8) {
        return NextResponse.json({ ok: false, error: 'Nama pengguna wajib dan kata sandi minimal 8 karakter' }, { status: 400 });
      }
      if (!b.role_id) return NextResponse.json({ ok: false, error: 'Peran belum dipilih' }, { status: 400 });
      const ada = await one(`SELECT id FROM users WHERE lower(username) = lower($1)`, [u]);
      if (ada) return NextResponse.json({ ok: false, error: 'Nama pengguna sudah dipakai' }, { status: 409 });

      await q(`INSERT INTO users (nama, username, password_hash, peran, role_id)
               VALUES ($1,$2,$3,'',$4)`,
        [String(b.nama || u).trim(), u, buatHash(b.sandi), b.role_id]);
      await log('pengguna', `Pengguna ${u} dibuat`);
      return NextResponse.json({ ok: true });
    }

    if (b.aksi === 'peran')  { await q(`UPDATE users SET role_id = $2 WHERE id = $1`, [b.id, b.role_id]); return NextResponse.json({ ok: true }); }
    if (b.aksi === 'aktif')  { await q(`UPDATE users SET aktif = $2 WHERE id = $1`, [b.id, !!b.aktif]); return NextResponse.json({ ok: true }); }
    if (b.aksi === 'sandi') {
      if (!b.sandi || String(b.sandi).length < 8) {
        return NextResponse.json({ ok: false, error: 'Kata sandi minimal 8 karakter' }, { status: 400 });
      }
      await q(`UPDATE users SET password_hash = $2 WHERE id = $1`, [b.id, buatHash(b.sandi)]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenal' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

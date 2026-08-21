import { NextResponse } from 'next/server';
import { ensureSchema, q, log } from '@/lib/db';
import { sesi } from '@/lib/auth';
import { kunciSah, TEMPLATE_BAWAAN } from '@/lib/kolom-ekspor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSchema();
    const rows = await q(
      `SELECT id, nama, kunci, dibuat_oleh, updated_at FROM export_template ORDER BY lower(nama)`);
    return NextResponse.json({ ok: true, template: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await ensureSchema();
    const b = await req.json();
    const nama = String(b.nama || '').trim().slice(0, 80);
    const kunci = kunciSah(b.kunci);
    const oleh = sesi()?.nama || null;

    if (!nama) return NextResponse.json({ ok: false, error: 'Nama template kosong' }, { status: 400 });
    if (!kunci.length) {
      return NextResponse.json({ ok: false, error: 'Pilih minimal satu kolom' }, { status: 400 });
    }
    // Nama template bawaan tidak boleh dipakai — kalau tidak, di daftar akan
    // ada dua pilihan dengan nama sama dan orang tidak tahu mana yang dipakai.
    if (TEMPLATE_BAWAAN.some((t) => t.nama.toLowerCase() === nama.toLowerCase())) {
      return NextResponse.json({ ok: false, error: `"${nama}" sudah dipakai template bawaan` }, { status: 409 });
    }

    if (b.id) {
      const r = await q(
        `UPDATE export_template SET nama = $2, kunci = $3::jsonb, updated_at = now()
          WHERE id = $1 RETURNING id`, [Number(b.id), nama, JSON.stringify(kunci)]);
      if (!r.length) return NextResponse.json({ ok: false, error: 'Template tidak ditemukan' }, { status: 404 });
      await log('ekspor', `Template "${nama}" diubah oleh ${oleh || '-'} (${kunci.length} kolom)`);
      return NextResponse.json({ ok: true, id: Number(b.id) });
    }

    const r = await q(
      `INSERT INTO export_template (nama, kunci, dibuat_oleh) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (lower(nama)) DO UPDATE
         SET kunci = EXCLUDED.kunci, updated_at = now()
       RETURNING id`, [nama, JSON.stringify(kunci), oleh]);
    await log('ekspor', `Template "${nama}" disimpan oleh ${oleh || '-'} (${kunci.length} kolom)`);
    return NextResponse.json({ ok: true, id: r[0]?.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    await ensureSchema();
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!id) return NextResponse.json({ ok: false, error: 'id kosong' }, { status: 400 });
    const r = await q('DELETE FROM export_template WHERE id = $1 RETURNING nama', [id]);
    await log('ekspor', `Template "${r[0]?.nama || id}" dihapus`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

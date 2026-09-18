import { peranSekarang, bolehUang } from '@/lib/auth';
import { ensureSchema } from '@/lib/db';
import { eksporKeuangan, namaBerkas } from '@/lib/ekspor-keuangan';

export const dynamic = 'force-dynamic';

/**
 * Unduh laporan keuangan sebagai .xlsx.
 *
 * Bulanan : /api/keuangan/ekspor?bulan=2026-08-01
 * Rentang : /api/keuangan/ekspor?dari=2026-08-31&sampai=2026-09-07&mode=minggu
 *
 * Dijaga bolehUang() seperti seluruh halaman keuangan — middleware
 * hanya memeriksa tiket sesi, tidak memeriksa peran, jadi penjagaan
 * peran wajib ada di sini.
 */
export async function GET(req) {
  if (!bolehUang(await peranSekarang())) {
    return new Response('Tidak punya akses ke data keuangan', { status: 403 });
  }
  await ensureSchema();

  const { searchParams } = new URL(req.url);
  const bulan = searchParams.get('bulan');
  const mode = searchParams.get('mode') || (bulan ? 'bulan' : 'minggu');

  let dari, sampai;
  if (bulan) {
    const d = new Date(`${bulan}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return new Response('Bulan tidak sah', { status: 400 });
    dari = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    sampai = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  } else {
    dari = searchParams.get('dari');
    sampai = searchParams.get('sampai');
    if (!dari || !sampai) return new Response('Isi bulan, atau dari dan sampai', { status: 400 });
  }

  try {
    const buf = await eksporKeuangan({ dari, sampai, mode });
    const nama = namaBerkas({ dari, sampai, mode });
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nama}"`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(`Gagal menyusun berkas: ${e.message}`, { status: 500 });
  }
}

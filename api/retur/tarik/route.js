import { NextResponse } from 'next/server';
import { ensureSchema, q, one } from '@/lib/db';
import { sapuReturSemua } from '@/lib/retur';

export const dynamic = 'force-dynamic';

/**
 * Tarik retur — berjalan di LATAR, layar memantau.
 *
 * Dulu tombol ini menunggu sampai delapan toko selesai disapu dalam SATU
 * permintaan. Begitu retur bertambah (2.700+, ±60 halaman Shopee), lamanya
 * melewati batas waktu proxy Railway: Railway memutus sambungan dan
 * mengirim teks "upstream error" — bukan JSON — sehingga layar menampilkan
 * "Unexpected token 'u', "upstream error" is not valid JSON". Penarikannya
 * sendiri bisa saja masih berjalan; yang putus hanya penantiannya.
 *
 * Sekarang POST hanya MEMULAI penarikan lalu langsung menjawab; hasilnya
 * dicatat di jadwal 'retur_manual' dan dibaca lewat GET. Server NSC adalah
 * proses yang hidup terus (next start), jadi pekerjaan setelah jawaban
 * dikirim tetap berlanjut. Penanda di memori mencegah dua penarikan jalan
 * bersamaan kalau tombol ditekan berkali-kali.
 */
let berjalan = null;   // { mulai: Date }

async function catat(teks) {
  await q(`INSERT INTO jadwal (nama, last_run, last_note) VALUES ('retur_manual', now(), $1)
           ON CONFLICT (nama) DO UPDATE SET last_run = now(), last_note = EXCLUDED.last_note`,
    [String(teks).slice(0, 1000)]).catch(() => {});
}

export async function POST() {
  try {
    await ensureSchema();
    if (berjalan) {
      return NextResponse.json({ ok: true, berjalan: true, mulai: berjalan.mulai, sudahJalan: true });
    }
    berjalan = { mulai: new Date() };
    await catat('BERJALAN — dimulai dari tombol Tarik data retur');
    sapuReturSemua()
      .then(async (hasil) => {
        const n = hasil.reduce((a, x) => a + (x.tersimpan || 0), 0);
        const gagal = hasil.filter((x) => !x.ok);
        await catat(`SELESAI — ${n} retur tersimpan dari ${hasil.length} toko`
          + (gagal.length ? `; ${gagal.length} toko gagal: `
            + gagal.map((g) => `${g.nama} — ${g.error}`).join('; ') : ''));
      })
      .catch(async (e) => { await catat(`GAGAL — ${e.message}`); })
      .finally(() => { berjalan = null; });
    return NextResponse.json({ ok: true, berjalan: true, mulai: berjalan.mulai });
  } catch (e) {
    berjalan = null;
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

/** Keadaan penarikan terakhir, untuk dipantau layar. */
export async function GET() {
  try {
    await ensureSchema();
    const r = await one(`SELECT last_run, last_note FROM jadwal WHERE nama = 'retur_manual'`);
    return NextResponse.json({ ok: true, berjalan: !!berjalan, mulai: berjalan?.mulai || null,
      terakhir: r?.last_run || null, catatan: r?.last_note || null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

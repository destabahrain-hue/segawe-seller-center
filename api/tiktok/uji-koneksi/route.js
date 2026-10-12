import { NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import { sesi } from '@/lib/auth';
import { ujiKoneksi } from '@/lib/tiktok';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Kenapa penukaran token berbunyi "fetch failed"?
 *
 * Rute ini memisahkan dua pertanyaan yang sering tercampur:
 *   1. Apakah nama hostnya bisa diterjemahkan DNS? (lookup)
 *   2. Kalau bisa, apakah koneksinya terbentuk dan TikTok menjawab? (ujiKoneksi)
 *
 * Host resmi menurut dokumen TikTok adalah auth.tiktok-shops.com untuk SEMUA
 * market. Kandidat lain diuji hanya untuk memastikan masalahnya bukan pada
 * satu nama tertentu.
 */
const KANDIDAT = [
  'https://auth.tiktok-shops.com',
  'https://open-api.tiktokglobalshop.com',
];

export async function GET(req) {
  if (!sesi()) return NextResponse.json({ ok: false, error: 'Belum masuk' }, { status: 401 });
  const pilih = new URL(req.url).searchParams.get('host');
  const daftar = pilih ? [pilih] : KANDIDAT;

  const hasil = [];
  for (const host of daftar) {
    const nama = new URL(host).hostname;
    let dnsHasil;
    try {
      const alamat = await dns.lookup(nama, { all: true });
      dnsHasil = alamat.map((a) => `${a.address} (IPv${a.family})`);
    } catch (e) { dnsHasil = { galat: `${e.code || ''} ${e.message}`.trim() }; }
    hasil.push({ ...(await ujiKoneksi(host)), dns: dnsHasil });
  }

  return NextResponse.json({
    ok: true,
    catatan: 'tersambung:true berarti jalur jaringan hidup — balasan galat dari TikTok soal '
           + 'auth code palsu justru pertanda baik. tersambung:false dengan kode ENOTFOUND '
           + 'berarti DNS, ETIMEDOUT berarti diblokir atau tidak dijawab.',
    hasil,
  });
}

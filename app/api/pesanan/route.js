import { NextResponse } from 'next/server';
import { q, log } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Menandai tahap alur kerja gudang. Shopee tidak menyimpan ini —
 * "resi dicetak" dan "selesai dikemas" adalah catatan internal kita.
 */
export async function POST(req) {
  const { aksi, ids } = await req.json();
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ ok: false, error: 'Tidak ada pesanan dipilih' }, { status: 400 });
  }
  const kolom = { cetak: 'printed_at', kemas: 'packed_at' }[aksi];
  const batal = { 'batal-cetak': 'printed_at', 'batal-kemas': 'packed_at' }[aksi];

  try {
    if (kolom) {
      // Menandai "dikemas" tanpa pernah "dicetak" tetap mengisi keduanya,
      // supaya urutan tahapnya tidak bolong.
      const juga = aksi === 'kemas' ? ', printed_at = COALESCE(printed_at, now())' : '';
      await q(`UPDATE orders SET ${kolom} = COALESCE(${kolom}, now())${juga} WHERE id = ANY($1::bigint[])`, [ids]);
      await log('pesanan', `${ids.length} pesanan ditandai ${aksi === 'cetak' ? 'resi dicetak' : 'selesai dikemas'}`);
      return NextResponse.json({ ok: true, jumlah: ids.length });
    }
    if (batal) {
      const juga = aksi === 'batal-cetak' ? ', packed_at = NULL' : '';
      await q(`UPDATE orders SET ${batal} = NULL${juga} WHERE id = ANY($1::bigint[])`, [ids]);
      return NextResponse.json({ ok: true, jumlah: ids.length });
    }
    return NextResponse.json({ ok: false, error: 'Aksi tidak dikenal' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

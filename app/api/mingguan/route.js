import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { ringkasMinggu, perSkuMinggu, PPN_IKLAN } from '@/lib/mingguan';
import { buatXlsx } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';

const bulat = (n) => Math.round(Number(n) || 0);

export async function GET(req) {
  try {
    await ensureSchema();
    const u = new URL(req.url);
    const senin = u.searchParams.get('m');
    const toko = u.searchParams.get('toko') || null;
    if (!senin) return NextResponse.json({ ok: false, error: 'Sertakan ?m=YYYY-MM-DD' }, { status: 400 });

    const [data, perSku] = await Promise.all([ringkasMinggu(senin), perSkuMinggu(senin, toko)]);

    // Satu lembar berisi dua bagian: laba rugi per toko, lalu rekap per SKU.
    // Sengaja tidak memakai formula — angkanya sudah final dari database,
    // dan lembar ini untuk dibaca, bukan diutak-atik.
    const rows = [];
    rows.push(['LABA RUGI PER TOKO', '', '', '', '', '', '', '']);
    rows.push(['Toko', 'Pesanan', 'Penjualan', 'HPP', 'Laba kotor',
               `Iklan (PPN ${Math.round(PPN_IKLAN * 100)}%)`, 'Laba bersih', 'Margin %']);
    for (const t of data.toko) {
      rows.push([t.nama, t.pesanan, bulat(t.penjualan), bulat(t.hpp), bulat(t.labaKotor),
                 bulat(t.iklan), bulat(t.laba), Number(t.marginBersih.toFixed(1))]);
    }
    rows.push(['TOTAL', data.total.pesanan, bulat(data.total.penjualan), bulat(data.total.hpp),
               bulat(data.total.labaKotor), bulat(data.total.iklan), bulat(data.total.laba),
               Number(data.total.marginBersih.toFixed(1))]);

    rows.push(['', '', '', '', '', '', '', '']);
    rows.push(['RINCIAN BIAYA IKLAN', '', '', '', '', '', '', '']);
    rows.push(['Pengeluaran iklan (kotor)', bulat(data.total.iklanKotor), '', '', '', '', '', '']);
    rows.push([`PPN ${Math.round(PPN_IKLAN * 100)}% dari pengeluaran`, bulat(data.total.ppn), '', '', '', '', '', '']);
    rows.push(['Total biaya iklan', bulat(data.total.iklan), '', '', '', '', '', '']);
    rows.push(['Catatan', 'Bonus saldo iklan & ROAS rebate belum tersedia lewat API Shopee, jadi belum dikurangkan',
               '', '', '', '', '', '']);

    rows.push(['', '', '', '', '', '', '', '']);
    rows.push(['REKAP PER SKU', '', '', '', '', '', '', '']);
    rows.push(['SKU', 'Nama', 'Qty', 'Uang masuk', 'HPP', 'Margin', 'Margin %', 'Catatan']);
    for (const s of perSku) {
      const uang = Number(s.uang_masuk) || 0;
      const hpp = Number(s.hpp) || 0;
      const m = uang - hpp;
      rows.push([s.sku, s.nama || '', Number(s.qty) || 0, bulat(uang), bulat(hpp), bulat(m),
                 uang ? Number(((m / uang) * 100).toFixed(1)) : 0,
                 [!s.tertaut ? 'belum tertaut' : null, s.ada_tanpa_hpp ? 'HPP kosong' : null]
                   .filter(Boolean).join(', ')]);
    }

    const buf = buatXlsx({
      nama: `Minggu ${senin}`,
      header: ['Laporan Keuangan Mingguan', `Minggu mulai ${senin}`,
               'Dasar: tanggal dana dilepas Shopee', '', '', '', '', ''],
      rows,
    });

    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Laporan-Mingguan-${senin}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

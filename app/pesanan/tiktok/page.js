import { redirect } from 'next/navigation';

/**
 * Halaman Pesanan TikTok yang terpisah sudah dilebur ke /pesanan.
 *
 * Pesanan TikTok kini tampil di halaman Pesanan yang sama dengan Shopee,
 * dengan tab, filter, dan urutan yang persis sama; saklar Marketplace di
 * atasnya memisahkan keduanya bila perlu (misalnya untuk cetak resi).
 * Alamat lama dialihkan supaya tautan yang sudah tersimpan tetap jalan.
 */
export default function PesananTiktokLama({ searchParams }) {
  const p = new URLSearchParams({ mp: 'tiktok', s: 'semua' });
  if (searchParams?.cari) p.set('cari', searchParams.cari);
  redirect('/pesanan?' + p.toString());
}

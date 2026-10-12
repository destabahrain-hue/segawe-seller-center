import { redirect } from 'next/navigation';

/**
 * Sebaran wilayah sudah dihapus: Shopee menyensor SELURUH alamat pembeli
 * (termasuk kota & provinsi) untuk tipe app ini, dibuktikan lewat
 * /api/diagnosa-alamat. Halaman penggantinya Distribusi Kurir.
 *
 * Berkas ini dulu masih meng-import fungsi `wilayah` yang sudah tidak ada,
 * sehingga membuka alamat lamanya membuat halaman galat. Dialihkan saja.
 */
export default function WilayahLama() {
  redirect('/pelanggan/kurir');
}

import { redirect } from 'next/navigation';

/**
 * Penautan SKU TikTok pindah ke halaman Master SKU, satu tempat dengan SKU
 * Shopee — memisahkannya membuat tim harus ingat dua tempat untuk pekerjaan
 * yang sama. Alamat lama diarahkan ke sana supaya tautan lama tidak mati.
 */
export default function SkuTiktokPindah() {
  redirect('/master-sku');
}
